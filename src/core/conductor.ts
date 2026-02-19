import { ConfigManager } from './config.js';
import { DatabaseManager } from './database.js';

export interface ConductorOptions {
  /** Suppress stdout output (required for MCP mode where stdout is protocol). */
  quiet?: boolean;
}

export class Conductor {
  private config: ConfigManager;
  private db: DatabaseManager;
  private initialized: boolean = false;
  private quiet: boolean;

  constructor(configPath?: string, options?: ConductorOptions) {
    this.config = new ConfigManager(configPath);
    this.db = new DatabaseManager(this.config.getConfigDir());
    this.quiet = options?.quiet ?? false;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!this.quiet) {
      process.stderr.write('Initializing Conductor...\n');
    }

    await this.config.initialize();
    await this.db.initialize();

    this.initialized = true;

    await this.db.logActivity('system', 'conductor_initialized');
  }

  getConfig(): ConfigManager {
    return this.config;
  }

  getDatabase(): DatabaseManager {
    return this.db;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async shutdown(): Promise<void> {
    if (this.initialized) {
      await this.db.logActivity('system', 'conductor_shutdown');
      await this.db.close();
    }
  }

  // Quick access methods
  async getUserInfo() {
    return this.config.get('user');
  }

  async getTelegramConfig() {
    return this.config.get('telegram');
  }

  async getAIConfig() {
    return this.config.get('ai');
  }

  async getPlugins() {
    return this.db.getPlugins();
  }

  async getRecentActivity(limit: number = 20) {
    return this.db.getRecentActivity(limit);
  }
}
