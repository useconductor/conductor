import initSqlJs, { Database } from 'sql.js';
import fs from 'fs/promises';
import path from 'path';

export class DatabaseManager {
  private db: Database | null = null;
  private dbPath: string;

  constructor(configDir: string) {
    this.dbPath = path.join(configDir, 'conductor.db');
  }

  async initialize(): Promise<void> {
    const SQL = await initSqlJs();

    // Try to load existing database
    try {
      const buffer = await fs.readFile(this.dbPath);
      this.db = new SQL.Database(new Uint8Array(buffer));
    } catch {
      // Create new database
      this.db = new SQL.Database();
      await this.createTables();
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_id TEXT,
        action TEXT NOT NULL,
        plugin TEXT,
        details TEXT,
        success BOOLEAN DEFAULT 1
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        version TEXT,
        enabled BOOLEAN DEFAULT 0,
        config TEXT,
        installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used DATETIME
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service TEXT NOT NULL UNIQUE,
        encrypted_data TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        message TEXT,
        response TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        ai_provider TEXT,
        tokens_used INTEGER
      )
    `);

    await this.save();
  }

  async logActivity(
    userId: string,
    action: string,
    plugin?: string,
    details?: string,
    success: boolean = true
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO activity_logs (user_id, action, plugin, details, success)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, action, plugin ?? null, details ?? null, success ? 1 : 0]
    );

    await this.save();
  }

  async getRecentActivity(limit: number = 50): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');

    // sql.js exec() doesn't support parameterized queries — use prepare+bind
    const stmt = this.db.prepare(
      `SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT ?`
    );
    stmt.bind([limit]);

    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  async savePlugin(plugin: {
    id: string;
    name: string;
    type: string;
    version?: string;
    enabled?: boolean;
    config?: any;
  }): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const configJson = plugin.config ? JSON.stringify(plugin.config) : null;

    this.db.run(
      `INSERT OR REPLACE INTO plugins (id, name, type, version, enabled, config)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        plugin.id,
        plugin.name,
        plugin.type,
        plugin.version || '1.0.0',
        plugin.enabled ? 1 : 0,
        configJson,
      ]
    );

    await this.save();
  }

  async getPlugins(): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`SELECT * FROM plugins ORDER BY name`);
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  async updatePluginStatus(pluginId: string, enabled: boolean): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `UPDATE plugins SET enabled = ?, last_used = CURRENT_TIMESTAMP WHERE id = ?`,
      [enabled ? 1 : 0, pluginId]
    );

    await this.save();
  }

  async save(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const data = this.db.export();
    const tmp = this.dbPath + '.tmp';
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, this.dbPath);
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.save();
      this.db.close();
      this.db = null;
    }
  }
}
