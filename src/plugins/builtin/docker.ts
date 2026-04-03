import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class DockerPlugin implements Plugin {
  name = 'docker';
  description = 'Docker container, image, volume, and network management';
  version = '1.0.0';

  async initialize(_conductor: Conductor): Promise<void> {}
  isConfigured(): boolean { return true; }

  private async docker(args: string[]): Promise<{ stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await execFileAsync('docker', args, { timeout: 30000 });
      return { stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Docker command failed: ${msg}`);
    }
  }

  getTools(): PluginTool[] {
    return [
      {
        name: 'docker_containers',
        description: 'List Docker containers. Use --all to include stopped containers.',
        inputSchema: {
          type: 'object',
          properties: {
            all: { type: 'boolean', description: 'Include stopped containers', default: false },
            filters: { type: 'string', description: 'Docker filter flags (e.g. "status=running")' },
          },
        },
        handler: async (input: { all?: boolean; filters?: string }) => {
          const args = ['ps', '--format', '{{json .}}'];
          if (input.all) args.push('-a');
          if (input.filters) args.push('--filter', input.filters);
          const { stdout } = await this.docker(args);
          if (!stdout) return { containers: [] };
          return { containers: stdout.split('\n').map((line) => {
            try { return JSON.parse(line); } catch { return null; }
          }).filter((c): c is Record<string, unknown> => c !== null) };
        },
      },
      {
        name: 'docker_container_logs',
        description: 'Get logs from a Docker container',
        inputSchema: {
          type: 'object',
          properties: {
            container: { type: 'string', description: 'Container name or ID' },
            tail: { type: 'number', description: 'Number of lines from end', default: 100 },
          },
          required: ['container'],
        },
        handler: async (input: { container: string; tail?: number }) => {
          const args = ['logs', '--tail', String(input.tail ?? 100), input.container];
          const { stdout, stderr } = await this.docker(args);
          return { container: input.container, logs: stdout || stderr };
        },
      },
      {
        name: 'docker_container_action',
        description: 'Start, stop, restart, pause, unpause, or kill a Docker container',
        inputSchema: {
          type: 'object',
          properties: {
            container: { type: 'string', description: 'Container name or ID' },
            action: { type: 'string', enum: ['start', 'stop', 'restart', 'pause', 'unpause', 'kill', 'remove'], description: 'Action to perform' },
          },
          required: ['container', 'action'],
        },
        handler: async (input: { container: string; action: string }) => {
          const args = [input.action, input.container];
          if (input.action === 'remove') args.push('-f');
          await this.docker(args);
          return { container: input.container, action: input.action, status: 'success' };
        },
      },
      {
        name: 'docker_images',
        description: 'List Docker images',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: async () => {
          const { stdout } = await this.docker(['images', '--format', '{{json .}}']);
          if (!stdout) return { images: [] };
          return { images: stdout.split('\n').map((line) => {
            try { return JSON.parse(line); } catch { return null; }
          }).filter((c): c is Record<string, unknown> => c !== null) };
        },
      },
      {
        name: 'docker_pull',
        description: 'Pull a Docker image',
        inputSchema: {
          type: 'object',
          properties: {
            image: { type: 'string', description: 'Image name (e.g. "nginx:latest")' },
          },
          required: ['image'],
        },
        handler: async (input: { image: string }) => {
          const { stdout } = await this.docker(['pull', input.image]);
          return { image: input.image, result: stdout };
        },
      },
      {
        name: 'docker_run',
        description: 'Run a Docker container. Requires approval for security.',
        inputSchema: {
          type: 'object',
          properties: {
            image: { type: 'string', description: 'Image to run' },
            name: { type: 'string', description: 'Container name' },
            ports: { type: 'array', items: { type: 'string' }, description: 'Port mappings (e.g. ["8080:80"])' },
            env: { type: 'array', items: { type: 'string' }, description: 'Environment variables (e.g. ["KEY=value"])' },
            volumes: { type: 'array', items: { type: 'string' }, description: 'Volume mounts (e.g. ["/host:/container"])' },
            detach: { type: 'boolean', description: 'Run in background', default: true },
            command: { type: 'string', description: 'Command to run inside container' },
          },
          required: ['image'],
        },
        handler: async (input: {
          image: string; name?: string; ports?: string[]; env?: string[];
          volumes?: string[]; detach?: boolean; command?: string;
        }) => {
          const args = ['run'];
          if (input.name) args.push('--name', input.name);
          if (input.detach) args.push('-d');
          if (input.ports) for (const p of input.ports) args.push('-p', p);
          if (input.env) for (const e of input.env) args.push('-e', e);
          if (input.volumes) for (const v of input.volumes) args.push('-v', v);
          args.push(input.image);
          if (input.command) args.push(input.command);
          const { stdout } = await this.docker(args);
          return { image: input.image, container_id: stdout.trim() };
        },
        requiresApproval: true,
      },
      {
        name: 'docker_volumes',
        description: 'List Docker volumes',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const { stdout } = await this.docker(['volume', 'ls', '--format', '{{json .}}']);
          if (!stdout) return { volumes: [] };
          return { volumes: stdout.split('\n').map((line) => {
            try { return JSON.parse(line); } catch { return null; }
          }).filter((c): c is Record<string, unknown> => c !== null) };
        },
      },
      {
        name: 'docker_networks',
        description: 'List Docker networks',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const { stdout } = await this.docker(['network', 'ls', '--format', '{{json .}}']);
          if (!stdout) return { networks: [] };
          return { networks: stdout.split('\n').map((line) => {
            try { return JSON.parse(line); } catch { return null; }
          }).filter((c): c is Record<string, unknown> => c !== null) };
        },
      },
      {
        name: 'docker_stats',
        description: 'Get resource usage stats for running containers',
        inputSchema: {
          type: 'object',
          properties: {
            container: { type: 'string', description: 'Specific container (omit for all)' },
          },
        },
        handler: async (input: { container?: string }) => {
          const args = ['stats', '--no-stream', '--format', '{{json .}}'];
          if (input.container) args.push(input.container);
          const { stdout } = await this.docker(args);
          if (!stdout) return { stats: [] };
          return { stats: stdout.split('\n').map((line) => {
            try { return JSON.parse(line); } catch { return null; }
          }).filter((c): c is Record<string, unknown> => c !== null) };
        },
      },
    ];
  }
}
