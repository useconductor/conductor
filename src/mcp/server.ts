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
 *   - Circuit breakers per tool (prevents cascading failures)
 *   - Automatic retries with exponential backoff
 *   - Audit logging (tamper-evident, SHA-256 chained)
 *   - Health check system with per-plugin status
 *   - Tool call metrics and latency tracking
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
import { CircuitBreaker, CircuitOpenError } from '../core/circuit-breaker.js';
import { withRetry } from '../core/retry.js';
import { AuditLogger } from '../core/audit.js';
import { HealthChecker } from '../core/health.js';
import { WebhookManager } from '../core/webhooks.js';
import { logger } from '../core/logger.js';

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
    inputSchema: { type: 'object', properties: {} },
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
    name: 'conductor_health',
    description: 'Get detailed health report for all Conductor subsystems',
    plugin: 'conductor',
    requiresApproval: false,
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      return await globalHealthChecker.detailed(version);
    },
  });

  tools.push({
    name: 'conductor_audit_query',
    description: 'Query the audit log for recent events. Supports filtering by actor, action, resource, result.',
    plugin: 'conductor',
    requiresApproval: false,
    inputSchema: {
      type: 'object',
      properties: {
        actor: { type: 'string', description: 'Filter by actor' },
        action: { type: 'string', description: 'Filter by action type' },
        resource: { type: 'string', description: 'Filter by resource' },
        result: { type: 'string', enum: ['success', 'failure', 'denied', 'timeout'], description: 'Filter by result' },
        limit: { type: 'number', description: 'Max entries to return', default: 50 },
      },
    },
    handler: async (args: { actor?: string; action?: string; resource?: string; result?: string; limit?: number }) => {
      return globalAuditLogger.query({ ...args, limit: args.limit ?? 50 });
    },
  });

  tools.push({
    name: 'conductor_metrics',
    description: 'Get tool call metrics (calls, errors, avg latency)',
    plugin: 'conductor',
    requiresApproval: false,
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const result: Record<string, ToolMetrics> = {};
      for (const [name, m] of metrics) result[name] = m;
      return { metrics: result };
    },
  });

  tools.push({
    name: 'conductor_webhooks_list',
    description: 'List all webhook subscriptions',
    plugin: 'conductor',
    requiresApproval: false,
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const subs = globalWebhookManager.list();
      return { subscriptions: subs.map((s) => ({ id: s.id, url: s.url, events: s.events, active: s.active, failures: s.consecutiveFailures })) };
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

// ── Global Infrastructure ────────────────────────────────────────────────────

let globalAuditLogger: AuditLogger;
let globalHealthChecker: HealthChecker;
let globalWebhookManager: WebhookManager;
const circuitBreakers: Map<string, CircuitBreaker> = new Map();

/**
 * Initialize global infrastructure (audit, health, webhooks).
 * Called once when the MCP server starts.
 */
async function initInfrastructure(conductor: Conductor): Promise<void> {
  const configDir = conductor.getConfig().getConfigDir();

  // Audit logger
  globalAuditLogger = new AuditLogger(configDir);

  // Health checker
  globalHealthChecker = new HealthChecker();

  // Register health checks for each plugin
  const pluginManager = new PluginManager(conductor);
  await pluginManager.loadBuiltins();
  for (const plugin of pluginManager.listPlugins()) {
    globalHealthChecker.register(`plugin:${plugin.name}`, async () => ({
      name: plugin.name,
      status: plugin.enabled ? 'ok' : 'down',
      message: plugin.enabled ? `${plugin.description}` : 'Plugin disabled',
    }));
  }

  // Webhook manager
  globalWebhookManager = new WebhookManager(configDir);
  await globalWebhookManager.load();
  globalHealthChecker.setWebhookCount(globalWebhookManager.list().filter((s) => s.active).length);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await globalAuditLogger.close();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await globalAuditLogger.close();
    process.exit(0);
  });
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
  // Initialize infrastructure
  await initInfrastructure(conductor);

  const pluginManager = new PluginManager(conductor);
  const tools = await buildToolRegistry(conductor, pluginManager);

  // Create circuit breakers for each tool
  for (const tool of tools) {
    circuitBreakers.set(tool.name, new CircuitBreaker());
    globalHealthChecker.registerCircuitBreaker(tool.name, circuitBreakers.get(tool.name)!);
  }

  process.stderr.write(`[MCP] Starting Conductor MCP server v${version}\n`);
  process.stderr.write(`[MCP] ${tools.length} tools available\n`);
  process.stderr.write(`[MCP] Audit logging enabled\n`);
  process.stderr.write(`[MCP] Circuit breakers active for all tools\n`);

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

      // Get or create circuit breaker for this tool
      let breaker = circuitBreakers.get(name);
      if (!breaker) {
        breaker = new CircuitBreaker();
        circuitBreakers.set(name, breaker);
        globalHealthChecker.registerCircuitBreaker(name, breaker);
      }

      // Execute through circuit breaker + retry
      const result = await breaker.execute(async () =>
        withRetry(
          async () => tool.handler(args),
          { maxAttempts: 3, baseDelay: 500, maxDelay: 10000 },
        ),
      );

      const latency = Date.now() - start;
      recordCall(name, true, latency);
      globalHealthChecker.recordToolCall(true, latency);

      // Audit log
      await globalAuditLogger.toolCall('mcp', name, args, 'success', { latency_ms: latency });

      // Emit webhook event
      await globalWebhookManager.emit({
        type: 'tool_called',
        resource: name,
        data: { latency_ms: latency, success: true },
      });

      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      process.stderr.write(`[MCP] ← ${name} (${latency}ms)\n`);

      return {
        content: [{ type: 'text' as const, text }],
      };
    } catch (err: unknown) {
      const latency = Date.now() - start;
      recordCall(name, false, latency);
      globalHealthChecker.recordToolCall(false, latency);

      const message = err instanceof Error ? err.message : String(err);
      const isCircuitOpen = err instanceof CircuitOpenError;
      const result = isCircuitOpen ? 'denied' : 'failure';

      // Audit log
      await globalAuditLogger.toolCall('mcp', name, args, result as 'success' | 'failure' | 'denied' | 'timeout', {
        latency_ms: latency,
        error: message,
        circuit_open: isCircuitOpen,
      });

      // Emit webhook event
      await globalWebhookManager.emit({
        type: 'tool_failed',
        resource: name,
        data: { latency_ms: latency, error: message, circuit_open: isCircuitOpen },
      });

      logger.warn({ tool: name, error: message, latency_ms: latency, circuit_open: isCircuitOpen }, 'Tool call failed');

      process.stderr.write(`[MCP] ✗ ${name}: ${message} (${latency}ms)\n`);

      return {
        content: [{ type: 'text' as const, text: isCircuitOpen ? `Service unavailable: ${name} is temporarily disabled due to repeated failures. Try again later.` : `Error: ${message}` }],
        isError: true,
      };
    }
  });

  // ── resources/list ───────────────────────────────────────────────────────
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [],
  }));

  // ── prompts/list ─────────────────────────────────────────────────────────
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [],
  }));

  // ── Transport ────────────────────────────────────────────────────────────
  const transportMode = options.transport ?? 'stdio';

  if (transportMode === 'http') {
    const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
    const express = (await import('express')).default;
    const rateLimit = (await import('express-rate-limit')).default;
    const app = express();
    const port = options.port ?? 3000;

    // Rate limiting
    app.use(rateLimit({ windowMs: 60_000, max: 1000, standardHeaders: true, legacyHeaders: false }));

    // Health endpoints
    app.get('/health', async (_req, res) => {
      const report = await globalHealthChecker.detailed(version);
      res.status(report.status === 'down' ? 503 : 200).json(report);
    });

    app.get('/health/ready', async (_req, res) => {
      const ready = await globalHealthChecker.ready();
      res.status(ready.ready ? 200 : 503).json(ready);
    });

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
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('[MCP] Connected via stdio\n');
  }
}
