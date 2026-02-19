import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';

export interface ConductorConfig {
  user?: {
    id: string;
    name?: string;
    role?: string;
    projects?: string;
    services?: string[];
    onboarding_complete?: boolean;
    verified_at?: string;
  };
  telegram?: {
    enabled?: boolean;
    bot_username?: string;
    user_id?: number;
    verified?: boolean;
    verified_at?: string;
  };
  ai?: {
    provider?: 'claude' | 'openai' | 'gemini' | 'ollama' | string;
    model?: string;
    mode?: 'desktop_app' | 'api' | 'telegram' | 'oauth';
    api_config?: {
      endpoint?: string;
      key_stored?: boolean;
      max_tokens?: number;
    };
    local_config?: {
      endpoint?: string;
      model?: string;
      context_window?: number;
    };
  };
  oauth?: {
    google?: {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
    };
  };
  plugins?: {
    installed: string[];
    enabled: string[];
  };
  security?: {
    allowed_plugins: string[];
    filesystem_access: {
      enabled: boolean;
      allowed_paths: string[];
    };
    system_commands: boolean;
    desktop_control: boolean;
  };
}

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private config: ConductorConfig;

  constructor(customPath?: string) {
    this.configDir = customPath || path.join(homedir(), '.conductor');
    this.configPath = path.join(this.configDir, 'config.json');
    this.config = {};
  }

  async initialize(): Promise<void> {
    // Create config directory tree
    try {
      await fs.mkdir(this.configDir, { recursive: true });
      await fs.mkdir(path.join(this.configDir, 'plugins'), { recursive: true });
      await fs.mkdir(path.join(this.configDir, 'logs'), { recursive: true });
      await fs.mkdir(path.join(this.configDir, 'keychain'), { recursive: true, mode: 0o700 });
    } catch (error) {
      throw new Error(`Failed to create config directory: ${error}`);
    }

    await this.load();
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      this.config = JSON.parse(data);
    } catch {
      // Config doesn't exist yet — use defaults
      this.config = {
        plugins: {
          installed: [],
          enabled: [],
        },
        security: {
          allowed_plugins: [],
          filesystem_access: {
            enabled: false,
            allowed_paths: [],
          },
          system_commands: false,
          desktop_control: false,
        },
      };
      await this.save();
    }
  }

  async save(): Promise<void> {
    const tmp = this.configPath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.config, null, 2), 'utf-8');
    await fs.rename(tmp, this.configPath);
  }

  get<T>(key: string): T | undefined {
    const keys = key.split('.');
    let value: any = this.config;

    for (const k of keys) {
      if (value === undefined || value === null) return undefined;
      value = value[k];
    }

    return value as T;
  }

  async set(key: string, value: any): Promise<void> {
    const keys = key.split('.');
    let target: any = this.config;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in target) || typeof target[k] !== 'object') {
        target[k] = {};
      }
      target = target[k];
    }

    target[keys[keys.length - 1]] = value;
    await this.save();
  }

  getConfigDir(): string {
    return this.configDir;
  }

  getConfig(): ConductorConfig {
    return this.config;
  }
}
