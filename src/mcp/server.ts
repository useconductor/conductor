import { Conductor } from '../core/conductor.js';
import { PluginManager } from '../plugins/manager.js';
import { getAllTools } from './tools/misc.js';

/**
 * Start the MCP server in stdio mode.
 * Reads JSON-RPC from stdin, writes responses to stdout.
 * All logging goes to stderr to avoid protocol corruption.
 */
export async function startMCPServer(conductor: Conductor): Promise<void> {
  const pluginManager = new PluginManager(conductor);
  const tools = await getAllTools(conductor, pluginManager);

  process.stderr.write(`MCP server started with ${tools.length} tools\n`);

  // Read from stdin
  let buffer = '';
  process.stdin.setEncoding('utf-8');

  process.stdin.on('data', async (chunk: string) => {
    buffer += chunk;

    // Process complete JSON-RPC messages (newline-delimited)
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const request = JSON.parse(line);
        const response = await handleRequest(request, tools);
        if (response) {
          // Only write to stdout for protocol messages
          process.stdout.write(JSON.stringify(response) + '\n');
        }
      } catch (error: any) {
        process.stderr.write(`MCP parse error: ${error.message}\n`);
      }
    }
  });

  process.stdin.on('end', () => {
    process.stderr.write('MCP server stdin closed\n');
    process.exit(0);
  });
}

async function handleRequest(
  request: any,
  tools: Awaited<ReturnType<typeof getAllTools>>
): Promise<any> {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'conductor', version: '0.1.0' },
          capabilities: { tools: {} },
        },
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      };

    case 'tools/call': {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `Unknown tool: ${params?.name}` },
        };
      }

      try {
        const result = await tool.handler(params?.arguments || {});
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              { type: 'text', text: JSON.stringify(result, null, 2) },
            ],
          },
        };
      } catch (error: any) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
          },
        };
      }
    }

    case 'notifications/initialized':
      // Notification, no response needed
      return null;

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}
