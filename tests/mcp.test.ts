/**
 * MCP Integration Tests
 *
 * Spawns the real MCP server as a child process over stdio and drives it with
 * JSON-RPC 2.0 messages — the same way Claude Desktop or any MCP client does.
 *
 * Requirements: project must be built (`npm run build`) before running these.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, '../dist/cli/index.js');

// ── JSON-RPC helpers ─────────────────────────────────────────────────────────

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

class MCPClient {
  private proc: ChildProcess;
  private buffer = '';
  private pending = new Map<number, (r: JsonRpcResponse) => void>();
  private nextId = 1;

  constructor() {
    this.proc = spawn('node', [CLI_PATH, 'mcp', 'start'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          const cb = this.pending.get(msg.id as number);
          if (cb) {
            this.pending.delete(msg.id as number);
            cb(msg);
          }
        } catch {
          // non-JSON line (server startup messages go to stderr anyway)
        }
      }
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for response to method: ${method} (id=${id})`));
      }, 10_000);

      this.pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });

      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.proc.stdin!.write(msg);
    });
  }

  close(): void {
    this.proc.stdin!.end();
    this.proc.kill();
  }
}

// ── Test suite ───────────────────────────────────────────────────────────────

let client: MCPClient;

beforeAll(async () => {
  client = new MCPClient();
  // Initialize handshake (required by MCP protocol before any other calls)
  await client.send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'vitest', version: '1.0' },
  });
}, 15_000);

afterAll(() => {
  client.close();
});

describe('MCP protocol — initialize', () => {
  it('returns server name and version', async () => {
    // Re-send initialize to get a fresh response for assertion
    const res = await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '1.0' },
    });
    expect(res.error).toBeUndefined();
    expect(res.result?.serverInfo).toMatchObject({ name: 'conductor' });
    expect(typeof (res.result?.serverInfo as any)?.version).toBe('string');
  });

  it('advertises tools capability', async () => {
    const res = await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '1.0' },
    });
    expect((res.result?.capabilities as any)?.tools).toBeDefined();
  });
});

describe('MCP protocol — tools/list', () => {
  it('returns 100+ tools', async () => {
    const res = await client.send('tools/list', {});
    expect(res.error).toBeUndefined();
    const tools = (res.result?.tools as unknown[]) ?? [];
    expect(tools.length).toBeGreaterThanOrEqual(100);
  });

  it('every tool has name, description, inputSchema', async () => {
    const res = await client.send('tools/list', {});
    const tools = (res.result?.tools as Array<Record<string, unknown>>) ?? [];
    for (const t of tools) {
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(t.inputSchema).toBeDefined();
    }
  });

  it('includes core conductor_ tools', async () => {
    const res = await client.send('tools/list', {});
    const names = ((res.result?.tools as Array<Record<string, unknown>>) ?? []).map((t) => t.name);
    expect(names).toContain('conductor_status');
    expect(names).toContain('conductor_tools_list');
    expect(names).toContain('conductor_health');
    expect(names).toContain('conductor_metrics');
  });

  it('includes zero-config plugin tools', async () => {
    const res = await client.send('tools/list', {});
    const names = ((res.result?.tools as Array<Record<string, unknown>>) ?? []).map((t) => t.name);
    expect(names).toContain('calc_math');
    expect(names).toContain('hash_text');
    expect(names).toContain('time_now');
    expect(names).toContain('color_convert');
    expect(names).toContain('text_stats');
  });
});

describe('MCP protocol — tools/call', () => {
  it('calls conductor_status and returns version info', async () => {
    const res = await client.send('tools/call', {
      name: 'conductor_status',
      arguments: {},
    });
    expect(res.error).toBeUndefined();
    const content = (res.result?.content as Array<{ type: string; text: string }>)?.[0];
    expect(content?.type).toBe('text');
    const parsed = JSON.parse(content!.text);
    expect(typeof parsed.version).toBe('string');
    expect(typeof parsed.total_tools).toBe('number');
    expect(parsed.total_tools).toBeGreaterThanOrEqual(100);
  });

  it('calls calc_math to evaluate an expression', async () => {
    const res = await client.send('tools/call', {
      name: 'calc_math',
      arguments: { expression: '2 + 2' },
    });
    expect(res.error).toBeUndefined();
    const content = (res.result?.content as Array<{ type: string; text: string }>)?.[0];
    expect(content?.text).toContain('4');
  });

  it('calls hash_text to hash a string', async () => {
    const res = await client.send('tools/call', {
      name: 'hash_text',
      arguments: { text: 'hello', algorithm: 'sha256' },
    });
    expect(res.error).toBeUndefined();
    const content = (res.result?.content as Array<{ type: string; text: string }>)?.[0];
    const parsed = JSON.parse(content!.text);
    // sha256 of "hello"
    expect(parsed.hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('calls time_now for UTC timezone', async () => {
    const res = await client.send('tools/call', {
      name: 'time_now',
      arguments: { timezone: 'UTC' },
    });
    expect(res.error).toBeUndefined();
    const content = (res.result?.content as Array<{ type: string; text: string }>)?.[0];
    expect(content?.text).toBeTruthy();
  });

  it('calls conductor_tools_list to filter by plugin', async () => {
    const res = await client.send('tools/call', {
      name: 'conductor_tools_list',
      arguments: { plugin: 'conductor' },
    });
    expect(res.error).toBeUndefined();
    const content = (res.result?.content as Array<{ type: string; text: string }>)?.[0];
    const parsed = JSON.parse(content!.text);
    expect(parsed.plugins.conductor).toBeDefined();
  });

  it('returns error response for unknown tool', async () => {
    const res = await client.send('tools/call', {
      name: 'nonexistent_tool_xyz',
      arguments: {},
    });
    expect(res.result?.isError).toBe(true);
    const content = (res.result?.content as Array<{ type: string; text: string }>)?.[0];
    expect(content?.text).toMatch(/unknown tool/i);
  });
});

describe('MCP protocol — resources/list + prompts/list', () => {
  it('resources/list returns empty array', async () => {
    const res = await client.send('resources/list', {});
    expect(res.error).toBeUndefined();
    expect((res.result?.resources as unknown[]) ?? []).toHaveLength(0);
  });

  it('prompts/list returns empty array', async () => {
    const res = await client.send('prompts/list', {});
    expect(res.error).toBeUndefined();
    expect((res.result?.prompts as unknown[]) ?? []).toHaveLength(0);
  });
});
