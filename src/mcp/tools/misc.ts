import { PluginManager } from '../../plugins/manager.js';
import { Conductor } from '../../core/conductor.js';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  handler: (input: any) => Promise<any>;
}

/** Get built-in tools that are always available. */
export function getBuiltinTools(conductor: Conductor): MCPTool[] {
  return [
    {
      name: 'conductor_status',
      description: 'Get the current status of Conductor',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const config = conductor.getConfig();
        return {
          user: config.get('user.name') || 'not set',
          ai_provider: config.get('ai.provider') || 'none',
          plugins_enabled: config.get<string[]>('plugins.enabled') || [],
        };
      },
    },
    {
      name: 'conductor_recent_activity',
      description: 'Get recent activity from Conductor',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of entries', default: 10 },
        },
      },
      handler: async (input: { limit?: number }) => {
        return await conductor.getRecentActivity(input.limit || 10);
      },
    },
  ];
}

/** Get tools from enabled plugins only (not all registered plugins). */
export async function getPluginTools(pluginManager: PluginManager): Promise<MCPTool[]> {
  // Only returns tools from plugins that are both enabled AND initialized
  const pluginTools = await pluginManager.getEnabledTools();

  return pluginTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    handler: tool.handler,
  }));
}

/** Get all available MCP tools (builtin + enabled plugins). */
export async function getAllTools(conductor: Conductor, pluginManager: PluginManager): Promise<MCPTool[]> {
  const builtin = getBuiltinTools(conductor);
  const pluginTools = await getPluginTools(pluginManager);
  return [...builtin, ...pluginTools];
}
