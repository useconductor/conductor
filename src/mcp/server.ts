import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'module';
import { Conductor } from '../core/conductor.js';
import { PluginManager } from '../plugins/manager.js';
import { getAllTools } from './tools/misc.js';

const _require = createRequire(import.meta.url);
const { version } = _require('../../package.json') as { version: string };

/**
 * Start the MCP server using the official @modelcontextprotocol/sdk.
 * Uses StdioServerTransport — reads from stdin, writes to stdout.
 * All logging goes to stderr so stdout remains protocol-clean.
 */
export async function startMCPServer(conductor: Conductor): Promise<void> {
  const pluginManager = new PluginManager(conductor);
  const tools = await getAllTools(conductor, pluginManager);

  process.stderr.write(`MCP server starting with ${tools.length} tools\n`);

  const server = new Server(
    { name: 'conductor', version },
    { capabilities: { tools: {} } },
  );

  // ── tools/list ─────────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    })),
  }));

  // ── tools/call ─────────────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      process.stderr.write(`  MCP tool call: ${name}\n`);
      const result = await tool.handler(args);
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return {
        content: [{ type: 'text' as const, text }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error executing ${name}: ${message}` }],
        isError: true,
      };
    }
  });

  // ── Transport ──────────────────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(`MCP server connected via stdio\n`);
}
