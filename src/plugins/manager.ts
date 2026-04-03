import { Conductor } from '../core/conductor.js';
export type { ToolContext } from '../core/interfaces.js';

export interface Plugin {
  name: string;
  description: string;
  version: string;
  initialize(conductor: Conductor): Promise<void>;
  isConfigured(): boolean;
  getTools(): PluginTool[];
  configSchema?: PluginConfigSchema;
  /** Optional: return a short context string for the proactive reasoning cycle. */
  getContext?(): Promise<string | null>;
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

/** The canonical input type for all tool handlers at runtime. */
export type ToolInput = Record<string, unknown>;
/** Tool handlers should return a string or a plain-object result. */
export type ToolOutput = string | Record<string, unknown>;

export interface PluginTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (input: any) => Promise<any>;
  requiresApproval?: boolean;
}

export interface PluginStatus {
  name: string;
  status: 'ready' | 'not_configured' | 'init_failed' | 'disabled';
  toolCount: number;
  error?: string;
  setupCommand?: string;
}

export class PluginManager {
  private conductor: Conductor;
  private plugins: Map<string, Plugin> = new Map();
  private initializedPlugins: Set<string> = new Set();
  private initErrors: Map<string, string> = new Map();

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
        this.initErrors.delete(name);
      } catch (error: any) {
        const msg: string = error.message ?? String(error);
        this.initErrors.set(name, msg);
        process.stderr.write(`[conductor] ✗ ${name}: init failed — ${msg}\n`);
        process.stderr.write(`[conductor]   → Run: conductor doctor ${name}\n`);
        return undefined;
      }
    }

    return plugin;
  }

  /** Get the recorded init error for a plugin, if any. */
  getInitError(name: string): string | undefined {
    return this.initErrors.get(name);
  }

  /**
   * Probe all enabled plugins and return a status summary.
   * Used by the MCP startup summary and conductor doctor.
   */
  async getStatusSummary(): Promise<PluginStatus[]> {
    const enabledNames = this.conductor.getConfig().get<string[]>('plugins.enabled') ?? [];
    const statuses: PluginStatus[] = [];

    for (const name of enabledNames) {
      const plugin = this.plugins.get(name);
      if (!plugin) {
        statuses.push({ name, status: 'disabled', toolCount: 0 });
        continue;
      }

      if (!plugin.isConfigured()) {
        statuses.push({
          name,
          status: 'not_configured',
          toolCount: 0,
          setupCommand: `conductor plugins setup ${name}`,
        });
        continue;
      }

      // Attempt init if not done yet
      if (!this.initializedPlugins.has(name)) {
        await this.getPlugin(name);
      }

      const err = this.initErrors.get(name);
      if (err) {
        statuses.push({ name, status: 'init_failed', toolCount: 0, error: err });
      } else {
        const toolCount = plugin.getTools().length;
        statuses.push({ name, status: 'ready', toolCount });
      }
    }

    return statuses;
  }

  /** List all registered plugins. Does NOT initialize them. */
  listPlugins(): Array<{
    name: string;
    description: string;
    version: string;
    enabled: boolean;
    configSchema?: PluginConfigSchema;
  }> {
    const enabledPlugins = this.conductor.getConfig().get<string[]>('plugins.enabled') || [];

    return Array.from(this.plugins.values()).map((plugin) => ({
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      enabled: enabledPlugins.includes(plugin.name),
      configSchema: plugin.configSchema,
    }));
  }

  isPluginEnabled(name: string): boolean {
    const enabled = this.conductor.getConfig().get<string[]>('plugins.enabled') || [];
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

    const enabled = this.conductor.getConfig().get<string[]>('plugins.enabled') || [];
    if (!enabled.includes(name)) {
      enabled.push(name);
      await this.conductor.getConfig().set('plugins.enabled', enabled);
    }
  }

  async disablePlugin(name: string): Promise<void> {
    const enabled = this.conductor.getConfig().get<string[]>('plugins.enabled') || [];
    const filtered = enabled.filter((p) => p !== name);
    await this.conductor.getConfig().set('plugins.enabled', filtered);
    this.initializedPlugins.delete(name);
  }

  /** Get MCP tools from enabled plugins only. */
  async getEnabledTools(): Promise<PluginTool[]> {
    const tools: PluginTool[] = [];
    const enabledNames = this.conductor.getConfig().get<string[]>('plugins.enabled') || [];

    for (const name of enabledNames) {
      try {
        const plugin = await this.getPlugin(name);
        if (plugin) {
          tools.push(...plugin.getTools());
        }
      } catch (error: any) {
        process.stderr.write(`Warning: plugin "${name}" failed to load: ${error.message}\n`);
      }
    }

    return tools;
  }
}
