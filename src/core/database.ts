import initSqlJs, { Database } from 'sql.js';
import fs from 'fs/promises';
import path from 'path';
import { AIMessage } from '../ai/base.js';

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
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        role TEXT NOT NULL,
        content TEXT,
        tool_calls TEXT,
        tool_call_id TEXT,
        name TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS core_memory (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        text TEXT NOT NULL,
        category TEXT,
        importance REAL,
        tags TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
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

  async addMessage(userId: string, message: AIMessage): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const toolCalls = message.tool_calls ? JSON.stringify(message.tool_calls) : null;
    this.db.run(
      `INSERT INTO messages (user_id, role, content, tool_calls, tool_call_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        message.role,
        message.content || null,
        toolCalls,
        message.tool_call_id || null,
        message.name || null,
      ]
    );
    await this.save();
  }

  async getHistory(userId: string, limit: number = 20): Promise<AIMessage[]> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(
      `SELECT * FROM (SELECT * FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC`
    );
    stmt.bind([userId, limit]);

    const results: AIMessage[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      results.push({
        role: row.role as any,
        content: row.content || '',
        ...(row.tool_calls ? { tool_calls: JSON.parse(row.tool_calls) } : {}),
        ...(row.tool_call_id ? { tool_call_id: row.tool_call_id } : {}),
        ...(row.name ? { name: row.name } : {}),
      });
    }
    stmt.free();
    return results;
  }

  async addCoreMemory(entry: { id: string, userId: string, text: string, category: string, importance: number, tags?: string[] }): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run(
      `INSERT INTO core_memory (id, user_id, text, category, importance, tags) VALUES (?, ?, ?, ?, ?, ?)`,
      [entry.id, entry.userId, entry.text, entry.category, entry.importance, entry.tags ? JSON.stringify(entry.tags) : null]
    );
    await this.save();
  }

  async searchCoreMemory(userId: string, query: string, limit: number = 5, category?: string): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');

    let sql = `SELECT * FROM core_memory WHERE user_id = ? AND text LIKE ?`;
    let params: any[] = [userId, `%${query}%`];

    if (category) {
      sql += ` AND category = ?`;
      params.push(category);
    }

    sql += ` ORDER BY importance DESC, timestamp DESC LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    stmt.bind(params);

    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  async deleteCoreMemory(id: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run(`DELETE FROM core_memory WHERE id = ?`, [id]);
    await this.save();
    // SQLite run() doesn't return changes cleanly in sql.js without extra steps, we assume it succeeds
    return true;
  }

  async listCoreMemory(userId: string, category?: string, limit: number = 20): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');
    let sql = `SELECT * FROM core_memory WHERE user_id = ?`;
    let params: any[] = [userId];

    if (category) {
      sql += ` AND category = ?`;
      params.push(category);
    }
    sql += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    stmt.bind(params);

    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  async searchMessages(userId: string, query: string, limit: number = 10): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');

    // Simple fast LIKE search to prevent heavy vector RAM usage
    const stmt = this.db.prepare(
      `SELECT role, content, timestamp FROM messages WHERE user_id = ? AND content LIKE ? ORDER BY timestamp DESC LIMIT ?`
    );
    stmt.bind([userId, `%${query}%`, limit]);

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
