/**
 * Conductor MCP Server — The AI Tool Hub
 *
 * A world-class MCP server that exposes every Conductor plugin as an MCP tool.
 * Any AI agent (Claude Code, Cursor, Cline, Aider, etc.) connects once and
 * gets access to 100+ tools across GitHub, Docker, databases, file ops, and more.
 *
 * Architecture:
 *   - StdioServerTransport for direct AI agent integration
 *   - HTTP/SSE transport for web dashboards and remote agents
 *   - Auto-discovery of all enabled plugins
 *   - Zod-validated input schemas
 *   - Structured error responses
 *   - Tool call logging and metrics
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'module';

import type { Conductor } from '../core/conductor.js';
import type { PluginTool } from '../plugins/manager.js';
import { PluginManager } from '../plugins/manager.js';
import { validateTools } from '../plugins/validation.js';

const _require = createRequire(import.meta.url);
const { version } = _require('../../package.json') as { version: string };

// ── Metrics ──────────────────────────────────────────────────────────────────

interface ToolMetrics {
  calls: number;
  errors: number;
  lastCallAt?: string;
  avgLatencyMs: number;
}

const metrics: Map<string, ToolMetrics> = new Map();

function recordCall(name: string, success: boolean, latencyMs: number): void {
  const existing = metrics.get(name) ?? { calls: 0, errors: 0, avgLatencyMs: 0 };
  const n = existing.calls + 1;
  metrics.set(name, {
    calls: n,
    errors: existing.errors + (success ? 0 : 1),
    lastCallAt: new Date().toISOString(),
    avgLatencyMs: existing.avgLatencyMs + (latencyMs - existing.avgLatencyMs) / n,
  });
}

// ── Tool Registry ────────────────────────────────────────────────────────────

interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  plugin: string;
  requiresApproval: boolean;
}

async function buildToolRegistry(
  conductor: Conductor,
  pluginManager: PluginManager,
): Promise<RegisteredTool[]> {
  const tools: RegisteredTool[] = [];

  // Built-in conductor tools
  tools.push({
    name: 'conductor_status',
    description: 'Get the current status of Conductor including enabled plugins and AI provider',
    plugin: 'conductor',
    requiresApproval: false,
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const config = conductor.getConfig();
      return {
        version,
        user: config.get('user.name') || 'not set',
        ai_provider: config.get('ai.provider') || 'none',
        plugins_enabled: config.get<string[]>('plugins.enabled') || [],
        total_tools: tools.length,
      };
    },
  });

  tools.push({
    name: 'conductor_tools_list',
    description: 'List all available MCP tools grouped by plugin. Use this to discover what tools are available.',
    plugin: 'conductor',
    requiresApproval: false,
    inputSchema: {
      type: 'object',
      properties: {
        plugin: { type: 'string', description: 'Filter by plugin name' },
      },
    },
    handler: async (args: { plugin?: string }) => {
      const byPlugin: Record<string, string[]> = {};
      for (const t of tools) {
        if (args.plugin && t.plugin !== args.plugin) continue;
        (byPlugin[t.plugin] ??= []).push(t.name);
      }
      return { plugins: byPlugin, total: tools.length };
    },
  });

  tools.push({
    name: 'conductor_metrics',
    description: 'Get tool call metrics (calls, errors, avg latency)',
    plugin: 'conductor',
    requiresApproval: false,
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const result: Record<string, ToolMetrics> = {};
      for (const [name, m] of metrics) result[name] = m;
      return { metrics: result };
    },
  });

  // Plugin tools (with Zod validation)
  const pluginTools = await pluginManager.getEnabledTools();
  const validatedTools = validateTools(pluginTools);
  for (const pt of validatedTools) {
    tools.push({
      name: pt.name,
      description: pt.description,
      inputSchema: pt.inputSchema,
      handler: pt.handler,
      plugin: 'plugin',
      requiresApproval: pt.requiresApproval ?? false,
    });
  }

  return tools;
}

// ── Server ───────────────────────────────────────────────────────────────────

export interface MCPServerOptions {
  /** Transport mode. stdio for AI agents, http for web dashboards. */
  transport?: 'stdio' | 'http';
  /** HTTP port when transport is http. */
  port?: number;
}

export async function startMCPServer(
  conductor: Conductor,
  options: MCPServerOptions = {},
): Promise<void> {
  const pluginManager = new PluginManager(conductor);
  const tools = await buildToolRegistry(conductor, pluginManager);

  process.stderr.write(`[MCP] Starting Conductor MCP server v${version}\n`);
  process.stderr.write(`[MCP] ${tools.length} tools available\n`);

  const server = new Server(
    { name: 'conductor', version },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  // ── tools/list ───────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    })),
  }));

  // ── tools/call ───────────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const tool = tools.find((t) => t.name === name);

    if (!tool) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}. Run conductor_tools_list to see available tools.` }],
        isError: true,
      };
    }

    const start = Date.now();
    try {
      process.stderr.write(`[MCP] → ${name}\n`);
      const result = await tool.handler(args);
      const latency = Date.now() - start;
      recordCall(name, true, latency);

      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      process.stderr.write(`[MCP] ← ${name} (${latency}ms)\n`);

      return {
        content: [{ type: 'text' as const, text }],
      };
    } catch (err: unknown) {
      const latency = Date.now() - start;
      recordCall(name, false, latency);

      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[MCP] ✗ ${name}: ${message} (${latency}ms)\n`);

      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  // ── resources/list (stub for future file/resource exposure) ──────────────
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [],
  }));

  // ── prompts/list (stub for future prompt templates) ──────────────────────
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [],
  }));

  // ── Transport ────────────────────────────────────────────────────────────
  const transportMode = options.transport ?? 'stdio';

  if (transportMode === 'http') {
    // HTTP/SSE transport for web dashboards and remote agents
    const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
    const express = (await import('express')).default;
    const app = express();
    const port = options.port ?? 3000;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sseTransport: any = null;

    app.get('/sse', async (_req, res) => {
      sseTransport = new SSEServerTransport('/messages', res);
      await server.connect(sseTransport);
      process.stderr.write(`[MCP] SSE client connected\n`);
    });

    app.post('/messages', async (req, res) => {
      if (sseTransport) {
        await sseTransport.handlePostMessage(req, res);
      } else {
        res.status(503).json({ error: 'No SSE connection established' });
      }
    });

    app.listen(port, () => {
      process.stderr.write(`[MCP] HTTP server listening on port ${port}\n`);
    });
  } else {
    // Stdio transport for direct AI agent integration (Claude Code, Cursor, etc.)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('[MCP] Connected via stdio\n');
  }
}
