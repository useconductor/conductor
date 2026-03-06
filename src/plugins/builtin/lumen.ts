import { Plugin, PluginTool, PluginConfigSchema } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

const execAsync = promisify(exec);

const LUMEN_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: 'Run a shell command and return stdout/stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          working_dir: { type: 'string' },
          timeout: { type: 'integer' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file, creating directories as needed.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
];

const LUMEN_SYSTEM = `You are Lumen, an agentic AI coding assistant built by Alexander (TheAlxLabs). You run inside Conductor. You have access to tools: run_shell, read_file, write_file. Think step-by-step. Always use tools to verify your work. Be concise in explanations but thorough in execution.`;

async function executeTool(name: string, args: any): Promise<string> {
  if (name === 'run_shell') {
    try {
      const { stdout, stderr } = await execAsync(args.command, {
        cwd: args.working_dir || process.cwd(),
        timeout: (args.timeout || 30) * 1000,
      });
      return JSON.stringify({ stdout, stderr, returncode: 0 });
    } catch (e: any) {
      return JSON.stringify({
        stdout: e.stdout || '',
        stderr: e.stderr || e.message,
        returncode: e.code || 1,
      });
    }
  }

  if (name === 'read_file') {
    try {
      const content = await readFile(args.path, 'utf8');
      return JSON.stringify({ content, success: true });
    } catch (e: any) {
      return JSON.stringify({ error: e.message, success: false });
    }
  }

  if (name === 'write_file') {
    try {
      await mkdir(dirname(args.path), { recursive: true });
      await writeFile(args.path, args.content, 'utf8');
      return JSON.stringify({ success: true, path: args.path });
    } catch (e: any) {
      return JSON.stringify({ error: e.message, success: false });
    }
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}

async function runLumenAgent(
  task: string,
  endpoint: string,
  model: string,
  maxIterations = 10
): Promise<{ result: string; iterations: number; toolCalls: string[] }> {
  const messages: any[] = [
    { role: 'system', content: LUMEN_SYSTEM },
    { role: 'user', content: task },
  ];

  const toolCallLog: string[] = [];
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    const response = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        tools: LUMEN_TOOLS,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Lumen API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const message = data.message;
    messages.push(message);

    // No tool calls — Lumen is done
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return {
        result: message.content || '(no response)',
        iterations,
        toolCalls: toolCallLog,
      };
    }

    // Execute each tool call
    for (const toolCall of message.tool_calls) {
      const name = toolCall.function.name;
      const args =
        typeof toolCall.function.arguments === 'string'
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments;

      const logEntry = `${name}(${JSON.stringify(args)})`;
      toolCallLog.push(logEntry);
      process.stderr.write(`[Lumen] → ${logEntry}\n`);

      const result = await executeTool(name, args);
      process.stderr.write(`[Lumen] ← ${result.slice(0, 150)}\n`);

      messages.push({ role: 'tool', content: result });
    }
  }

  return {
    result: 'Max iterations reached without a final answer.',
    iterations,
    toolCalls: toolCallLog,
  };
}

export class LumenPlugin implements Plugin {
  name = 'lumen';
  description = 'Lumen — agentic AI coding assistant by TheAlxLabs. Writes code, runs shell commands, uses git/GitHub autonomously.';
  version = '1.0.0';

  private endpoint = 'http://localhost:11434';
  private model = 'lumen';

  configSchema: PluginConfigSchema = {
    fields: [
      {
        key: 'endpoint',
        label: 'Ollama Endpoint',
        type: 'string',
        description: 'URL where Ollama is running (default: http://localhost:11434)',
        required: false,
      },
      {
        key: 'model',
        label: 'Model Name',
        type: 'string',
        description: 'Ollama model name to use (default: lumen)',
        required: false,
      },
    ],
    setupInstructions: `
Lumen Setup:
1. Install Ollama: brew install ollama
2. Pull Lumen: ollama pull thealxlabs/lumen
   OR import from GGUF: ollama create lumen -f Lumen.Modelfile
3. Start Ollama: ollama serve
4. Enable this plugin: conductor plugin enable lumen
`,
  };

  async initialize(conductor: Conductor): Promise<void> {
    const config = conductor.getConfig();
    this.endpoint = config.get<string>('plugins.lumen.endpoint') || 'http://localhost:11434';
    this.model = config.get<string>('plugins.lumen.model') || 'lumen';

    // Verify Ollama is reachable
    const ok = await this.ping();
    if (!ok) {
      throw new Error(
        `Lumen: Cannot reach Ollama at ${this.endpoint}. Run: ollama serve`
      );
    }

    // Check if the model exists
    const models = await this.listModels();
    if (!models.some(m => m.includes(this.model))) {
      throw new Error(
        `Lumen: Model "${this.model}" not found in Ollama. Run: ollama pull thealxlabs/lumen`
      );
    }
  }

  isConfigured(): boolean {
    return true; // Config is optional — uses defaults
  }

  private async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  private async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`);
      const data = (await res.json()) as any;
      return data.models?.map((m: any) => m.name) || [];
    } catch {
      return [];
    }
  }

  getTools(): PluginTool[] {
    return [
      // ── Main agent tool ───────────────────────────────────────────────
      {
        name: 'lumen_ask',
        description:
          'Ask Lumen to complete a coding task autonomously. Lumen can write code, run shell commands, use git, fix bugs, and more.',
        inputSchema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The task for Lumen to complete, e.g. "commit all changes with message fix: auth"',
            },
            max_iterations: {
              type: 'number',
              description: 'Max agentic loop iterations (default: 10)',
            },
          },
          required: ['task'],
        },
        handler: async (input: { task: string; max_iterations?: number }) => {
          const { result, iterations, toolCalls } = await runLumenAgent(
            input.task,
            this.endpoint,
            this.model,
            input.max_iterations || 10
          );
          return { result, iterations, toolCalls };
        },
      },

      // ── Git shortcuts ─────────────────────────────────────────────────
      {
        name: 'lumen_git_commit',
        description: 'Stage all changes and commit with a message using Lumen.',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Commit message' },
            working_dir: { type: 'string', description: 'Repo directory (default: cwd)' },
          },
          required: ['message'],
        },
        handler: async (input: { message: string; working_dir?: string }) => {
          const cwd = input.working_dir || process.cwd();
          const { result, toolCalls } = await runLumenAgent(
            `Stage all changes and commit with message: "${input.message}". Working directory: ${cwd}`,
            this.endpoint,
            this.model
          );
          return { result, toolCalls };
        },
      },

      {
        name: 'lumen_git_push',
        description: 'Push current branch to origin using Lumen.',
        inputSchema: {
          type: 'object',
          properties: {
            working_dir: { type: 'string', description: 'Repo directory (default: cwd)' },
          },
          required: [],
        },
        handler: async (input: { working_dir?: string }) => {
          const cwd = input.working_dir || process.cwd();
          const { result, toolCalls } = await runLumenAgent(
            `Push the current branch to origin. Working directory: ${cwd}`,
            this.endpoint,
            this.model
          );
          return { result, toolCalls };
        },
      },

      {
        name: 'lumen_git_status',
        description: 'Get git status of a repository using Lumen.',
        inputSchema: {
          type: 'object',
          properties: {
            working_dir: { type: 'string', description: 'Repo directory (default: cwd)' },
          },
          required: [],
        },
        handler: async (input: { working_dir?: string }) => {
          const cwd = input.working_dir || process.cwd();
          const { result, toolCalls } = await runLumenAgent(
            `Show git status and a brief summary of changes. Working directory: ${cwd}`,
            this.endpoint,
            this.model
          );
          return { result, toolCalls };
        },
      },

      // ── Code tools ────────────────────────────────────────────────────
      {
        name: 'lumen_fix_bug',
        description: 'Ask Lumen to investigate and fix a bug in your codebase.',
        inputSchema: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Bug description or error message' },
            working_dir: { type: 'string', description: 'Project directory (default: cwd)' },
          },
          required: ['description'],
        },
        handler: async (input: { description: string; working_dir?: string }) => {
          const cwd = input.working_dir || process.cwd();
          const { result, toolCalls } = await runLumenAgent(
            `Investigate and fix this bug: ${input.description}\nWorking directory: ${cwd}`,
            this.endpoint,
            this.model
          );
          return { result, toolCalls };
        },
      },

      {
        name: 'lumen_write_file',
        description: 'Ask Lumen to write or generate a file with given requirements.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to create/overwrite' },
            requirements: { type: 'string', description: 'What the file should contain or do' },
          },
          required: ['path', 'requirements'],
        },
        handler: async (input: { path: string; requirements: string }) => {
          const { result, toolCalls } = await runLumenAgent(
            `Write a file at "${input.path}" with these requirements: ${input.requirements}`,
            this.endpoint,
            this.model
          );
          return { result, toolCalls };
        },
      },

      // ── Shell tool ────────────────────────────────────────────────────
      {
        name: 'lumen_shell',
        description: 'Ask Lumen to run a shell task and interpret the results.',
        inputSchema: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'What you want done in the terminal' },
            working_dir: { type: 'string', description: 'Working directory (default: cwd)' },
          },
          required: ['task'],
        },
        handler: async (input: { task: string; working_dir?: string }) => {
          const cwd = input.working_dir || process.cwd();
          const { result, toolCalls } = await runLumenAgent(
            `${input.task}\nWorking directory: ${cwd}`,
            this.endpoint,
            this.model
          );
          return { result, toolCalls };
        },
      },

      // ── Status / ping ─────────────────────────────────────────────────
      {
        name: 'lumen_ping',
        description: 'Check if Lumen is running and available.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        handler: async () => {
          const ok = await this.ping();
          if (!ok) return { status: 'offline', endpoint: this.endpoint };
          const models = await this.listModels();
          const hasLumen = models.some(m => m.includes(this.model));
          return {
            status: hasLumen ? 'ready' : 'ollama_running_but_model_missing',
            model: this.model,
            endpoint: this.endpoint,
            available_models: models,
            hint: hasLumen ? null : `Run: ollama pull thealxlabs/lumen`,
          };
        },
      },
    ];
  }
}
