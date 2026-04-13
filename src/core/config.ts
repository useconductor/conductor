import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import { EncryptionManager } from './encryption.js';

export interface ConductorConfig {
  user?: {
    id: string;
    name?: string;
    role?: string;
    projects?: string;
    services?: string[];
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
  private encryption: EncryptionManager;

  constructor(customPath?: string) {
    this.configDir = customPath || path.join(homedir(), '.conductor');
    this.configPath = path.join(this.configDir, 'config.json');
    this.config = {};
    this.encryption = new EncryptionManager(this.configDir);
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

  // Encrypt sensitive values before saving
  private async encryptSensitive(obj: Record<string, unknown>): Promise<Record<string, unknown>> {
    const SENSITIVE_KEYS = ['key', 'secret', 'token', 'password', 'api_key', 'access_token'];
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) {
        result[key] = await this.encryption.encrypt(value);
      } else if (typeof value === 'object') {
        result[key] = await this.encryptSensitive(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  // Decrypt sensitive values after loading
  private async decryptSensitive(obj: Record<string, unknown>): Promise<Record<string, unknown>> {
    const SENSITIVE_KEYS = ['key', 'secret', 'token', 'password', 'api_key', 'access_token'];
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) {
        try {
          result[key] = await this.encryption.decrypt(value);
        } catch {
          result[key] = value; // Not encrypted, use as-is
        }
      } else if (typeof value === 'object') {
        result[key] = await this.decryptSensitive(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(data);
      this.config = (await this.decryptSensitive(parsed)) as ConductorConfig;
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
    const encrypted = await this.encryptSensitive(this.config as unknown as Record<string, unknown>);
    const tmp = this.configPath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(encrypted, null, 2), 'utf-8');
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
