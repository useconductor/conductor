import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execFileAsync = promisify(execFile);

// Whitelist of safe commands — no shell interpretation
const SAFE_COMMANDS = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'find',
  'stat',
  'file',
  'pwd',
  'whoami',
  'date',
  'uptime',
  'df',
  'du',
  'free',
  'top',
  'git',
  'node',
  'npm',
  'pnpm',
  'yarn',
  'python',
  'python3',
  'pip',
  'pip3',
  'make',
  'cmake',
  'cargo',
  'go',
  'rustc',
  'gcc',
  'clang',
  'curl',
  'wget',
  'ssh',
  'scp',
  'rsync',
  'docker',
  'docker-compose',
  'kubectl',
  'helm',
  'terraform',
  'ansible',
  'vault',
  'psql',
  'mysql',
  'mongosh',
  'redis-cli',
  'jq',
  'yq',
  'sed',
  'awk',
  'cut',
  'sort',
  'uniq',
  'tr',
  'xargs',
  'zip',
  'unzip',
  'tar',
  'gzip',
  'chmod',
  'chown',
  'mkdir',
  'rmdir',
  'cp',
  'mv',
  'rm',
  'touch',
  'ln',
  'diff',
  'patch',
  'md5sum',
  'sha256sum',
  'sha1sum',
]);

// Dangerous patterns that are never allowed even with approval
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+\/\b/,
  /\bmkfs\b/,
  /\bdd\s+if\b/,
  /\bchmod\s+[0-7]*777\s+\/\b/,
  /\bchown\s+-R\s+\S+\s+\/\b/,
  /\b:\(\)\{\s*:\|:\s*&\s*\}\s*;:\b/, // fork bomb
  /\/dev\/(zero|null|random|urandom)/,
  /\bnc\s+-[el]/, // netcat listener
  /\bpython.*-c.*import.*socket/,
  /\bbash\s+-i/,
  /\beval\b/,
  /\bcurl.*\|\s*(ba)?sh\b/,
  /\bwget.*-O-.*\|\s*(ba)?sh\b/,
];

function isDangerous(cmd: string): { safe: boolean; reason?: string } {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(cmd)) {
      return { safe: false, reason: `Command matches dangerous pattern: ${pattern.source}` };
    }
  }
  return { safe: true };
}

function validatePathArg(arg: string): string {
  const resolved = path.resolve(arg);
  if (resolved.includes('..') && !resolved.startsWith(process.cwd())) {
    throw new Error(
      `COND-FS-001: Path traversal detected: ${arg}. Paths must be within the current working directory.`,
    );
  }
  return resolved;
}

export class ShellPlugin implements Plugin {
  name = 'shell';
  description = 'Safe shell command execution with approval workflow and path validation';
  version = '1.0.0';

  async initialize(_conductor: Conductor): Promise<void> {}
  isConfigured(): boolean {
    return true;
  }

  private async runCommand(
    cmd: string,
    args: string[],
    cwd?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const workingDir = cwd ? validatePathArg(cwd) : process.cwd();
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        cwd: workingDir,
      });
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return {
          stdout: (e.stdout ?? '').trim(),
          stderr: (e.stderr ?? '').trim(),
          exitCode: e.code ?? 1,
        };
      }
      throw err;
    }
  }

  getTools(): PluginTool[] {
    return [
      {
        name: 'shell_run',
        description:
          'Run a shell command. Commands are validated against a safety whitelist. Dangerous commands are blocked entirely.',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to run (e.g. "ls -la")' },
            cwd: { type: 'string', description: 'Working directory (must be within current project)' },
          },
          required: ['command'],
        },
        handler: async (input: { command: string; cwd?: string }) => {
          const parts = input.command.trim().split(/\s+/);
          const cmd = parts[0];

          if (!cmd) throw new Error('COND-SYS-001: Empty command provided to shell executor.');
          if (!SAFE_COMMANDS.has(cmd)) {
            throw new Error(
              `COND-SEC-001: Command "${cmd}" is not in the safe command whitelist. Allowed commands: ${Array.from(SAFE_COMMANDS).sort().join(', ')}. Review the whitelist in shell.ts for approved commands.`,
            );
          }

          const safety = isDangerous(input.command);
          if (!safety.safe)
            throw new Error(
              `COND-SEC-002: ${safety.reason ?? 'Command blocked by safety check'}. Review DANGEROUS_PATTERNS in shell.ts for blocked patterns.`,
            );

          const result = await this.runCommand(cmd, parts.slice(1), input.cwd);
          return {
            command: input.command,
            cwd: input.cwd ?? process.cwd(),
            exit_code: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
          };
        },
        requiresApproval: true,
      },
      {
        name: 'shell_read_file',
        description: 'Read the contents of a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to read' },
            limit: { type: 'number', description: 'Maximum bytes to read', default: 100000 },
          },
          required: ['path'],
        },
        handler: async (input: { path: string; limit?: number }) => {
          const filePath = validatePathArg(input.path);
          const stat = await fs.stat(filePath);
          if (!stat.isFile())
            throw new Error(`COND-FS-002: Not a file: ${input.path}. Verify the path exists and is a regular file.`);
          const limit = input.limit ?? 100000;
          if (stat.size > limit)
            throw new Error(
              `COND-FS-003: File too large (${stat.size} bytes). Limit: ${limit} bytes. Use shell_run with head command for large files, or increase the limit parameter.`,
            );
          const content = await fs.readFile(filePath, 'utf-8');
          return { path: input.path, size: stat.size, content };
        },
      },
      {
        name: 'shell_write_file',
        description: 'Write content to a file. Creates parent directories if needed.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to write' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['path', 'content'],
        },
        handler: async (input: { path: string; content: string }) => {
          const filePath = validatePathArg(input.path);
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, input.content, 'utf-8');
          return { path: input.path, bytes_written: Buffer.byteLength(input.content, 'utf-8') };
        },
        requiresApproval: true,
      },
      {
        name: 'shell_list_dir',
        description: 'List directory contents',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path', default: '.' },
            recursive: { type: 'boolean', description: 'List recursively', default: false },
          },
        },
        handler: async (input: { path?: string; recursive?: boolean; pattern?: string }) => {
          const dirPath = validatePathArg(input.path ?? '.');
          const stat = await fs.stat(dirPath);
          if (!stat.isDirectory())
            throw new Error(`COND-FS-004: Not a directory: ${input.path}. Verify the path exists and is a directory.`);
          if (input.recursive) {
            const { glob } = await import('glob');
            const matches = await glob(input.pattern ?? '**/*', { cwd: dirPath, nodir: false });
            return {
              path: input.path ?? '.',
              pattern: input.pattern ?? '**/*',
              entries: matches.slice(0, 500),
              truncated: matches.length > 500,
            };
          }
          const entries = await fs.readdir(dirPath, { withFileTypes: true });
          return {
            path: input.path ?? '.',
            entries: entries.map((e) => ({
              name: e.name,
              type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other',
            })),
          };
        },
      },
      {
        name: 'shell_search_files',
        description: 'Search for files by name pattern',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory to search in', default: '.' },
            pattern: { type: 'string', description: 'Glob pattern (e.g. "*.ts", "**/*.test.ts")' },
          },
          required: ['pattern'],
        },
        handler: async (input: { pattern: string; path?: string }) => {
          const dirPath = validatePathArg(input.path ?? '.');
          const { glob } = await import('glob');
          const matches = await glob(input.pattern, { cwd: dirPath, nodir: false });
          return {
            path: input.path ?? '.',
            pattern: input.pattern,
            matches: matches.slice(0, 200),
            truncated: matches.length > 200,
          };
        },
      },
      {
        name: 'shell_search_content',
        description: 'Search file contents using grep',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Regex pattern to search for' },
            path: { type: 'string', description: 'Directory to search in', default: '.' },
            include: { type: 'string', description: 'File glob to include (e.g. "*.ts")' },
          },
          required: ['pattern'],
        },
        handler: async (input: { pattern: string; path?: string; include?: string }) => {
          const dirPath = validatePathArg(input.path ?? '.');
          const args = ['-rn', '--color=never', input.pattern, dirPath];
          if (input.include) args.push('--include', input.include);
          const result = await this.runCommand('grep', args);
          if (result.exitCode === 1) return { pattern: input.pattern, matches: [] };
          if (result.exitCode > 1)
            throw new Error(
              `COND-SYS-002: Grep command failed with exit code ${result.exitCode}. Error: ${result.stderr}`,
            );
          const lines = result.stdout.split('\n').slice(0, 100);
          return { pattern: input.pattern, matches: lines, truncated: result.stdout.split('\n').length > 100 };
        },
      },
    ];
  }
}
