import { Conductor } from '../core/conductor.js';

export interface Plugin {
  name: string;
  description: string;
  version: string;
  initialize(conductor: Conductor): Promise<void>;
  isConfigured(): boolean;
  getTools(): PluginTool[];
  configSchema?: PluginConfigSchema;
}

export interface PluginConfigSchema {
  fields: {
    key: string;
    label: string;
    type: 'string' | 'password' | 'number' | 'boolean';
    description?: string;
    required: boolean;
    secret?: boolean; // If true, stored in Keychain instead of config.json
    service?: string; // For secret fields, the Keychain service name
  }[];
  setupInstructions?: string;
}

export interface PluginTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  handler: (input: any) => Promise<any>;
  requiresApproval?: boolean;
}

export class PluginManager {
  private conductor: Conductor;
  private plugins: Map<string, Plugin> = new Map();
  private initializedPlugins: Set<string> = new Set();

  constructor(conductor: Conductor) {
    this.conductor = conductor;
  }

  /** Register a plugin without initializing it. */
  registerPlugin(plugin: Plugin): void {
    this.plugins.set(plugin.name, plugin);
  }

  /** Load all builtin plugins (register only, no init). */
  async loadBuiltins(): Promise<void> {
    const builtins = await import('./builtin/index.js');
    for (const plugin of builtins.getAllBuiltinPlugins()) {
      this.registerPlugin(plugin);
    }
  }

  /** Get a plugin by name. Lazily initializes on first use. */
  async getPlugin(name: string): Promise<Plugin | undefined> {
    const plugin = this.plugins.get(name);
    if (!plugin) return undefined;

    if (!this.initializedPlugins.has(name)) {
      try {
        await plugin.initialize(this.conductor);
        this.initializedPlugins.add(name);
      } catch (error: any) {
        process.stderr.write(`Error: Failed to initialize plugin "${name}": ${error.message}\n`);
        return undefined; // Don't return a broken plugin
      }
    }

    return plugin;
  }

  /** List all registered plugins. Does NOT initialize them. */
  listPlugins(): Array<{
    name: string;
    description: string;
    version: string;
    enabled: boolean;
    configSchema?: PluginConfigSchema;
  }> {
    const enabledPlugins =
      this.conductor.getConfig().get<string[]>('plugins.enabled') || [];

    return Array.from(this.plugins.values()).map((plugin) => ({
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      enabled: enabledPlugins.includes(plugin.name),
      configSchema: plugin.configSchema,
    }));
  }

  isPluginEnabled(name: string): boolean {
    const enabled =
      this.conductor.getConfig().get<string[]>('plugins.enabled') || [];
    return enabled.includes(name);
  }

  async enablePlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error(`Plugin not found: ${name}`);

    // Initialize to verify it works
    if (!this.initializedPlugins.has(name)) {
      try {
        await plugin.initialize(this.conductor);
        this.initializedPlugins.add(name);
      } catch (error: any) {
        throw new Error(`Failed to enable plugin "${name}": initialization failed: ${error.message}`);
      }
    }

    const enabled =
      this.conductor.getConfig().get<string[]>('plugins.enabled') || [];
    if (!enabled.includes(name)) {
      enabled.push(name);
      await this.conductor.getConfig().set('plugins.enabled', enabled);
    }
  }

  async disablePlugin(name: string): Promise<void> {
    const enabled =
      this.conductor.getConfig().get<string[]>('plugins.enabled') || [];
    const filtered = enabled.filter((p) => p !== name);
    await this.conductor.getConfig().set('plugins.enabled', filtered);
    this.initializedPlugins.delete(name);
  }

  /** Get MCP tools from enabled plugins only. */
  async getEnabledTools(): Promise<PluginTool[]> {
    const tools: PluginTool[] = [];
    const enabledNames =
      this.conductor.getConfig().get<string[]>('plugins.enabled') || [];

    for (const name of enabledNames) {
      try {
        const plugin = await this.getPlugin(name);
        if (plugin) {
          tools.push(...plugin.getTools());
        }
      } catch (error: any) {
        process.stderr.write(
          `Warning: plugin "${name}" failed to load: ${error.message}\n`
        );
      }
    }

    return tools;
  }
}
