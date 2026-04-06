import initSqlJs, { Database } from 'sql.js';
import fs from 'fs/promises';
import { writeFileSync, renameSync } from 'fs';
import path from 'path';
import { AIMessage } from '../ai/base.js';

export class DatabaseManager {
  private db: Database | null = null;
  private dbPath: string;
  /** Pending debounced flush timer */
  private flushTimer: NodeJS.Timeout | null = null;
  /** True when in-memory state has outpaced what's on disk */
  private dirty = false;
  /** Debounce interval in ms — flush at most this often */
  private static readonly DEBOUNCE_MS = 500;

  constructor(configDir: string) {
    this.dbPath = path.join(configDir, 'conductor.db');

    // Ensure flush on process exit
    const onExit = (): void => {
      this.flushSync();
    };
    process.on('exit', onExit);
    process.on('SIGINT', () => {
      this.flushSync();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      this.flushSync();
      process.exit(0);
    });
  }

  /**
   * Mark the database dirty and arm the debounce timer.
   * Multiple writes within DEBOUNCE_MS coalesce into a single disk write.
   */
  private scheduleFlush(): void {
    this.dirty = true;
    if (this.flushTimer) return; // timer already armed — do nothing more
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.save().catch((err) => {
        process.stderr.write(`DatabaseManager: flush error: ${(err as Error).message}\n`);
      });
    }, DatabaseManager.DEBOUNCE_MS);
  }

  /**
   * Synchronous flush used by signal handlers — no async I/O allowed after
   * SIGINT/SIGTERM because the event loop may already be draining.
   * Uses the top-level `writeFileSync`/`renameSync` imports (not require()).
   */
  private flushSync(): void {
    if (!this.db || !this.dirty) return;
    try {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      const data = this.db.export();
      const tmp = this.dbPath + '.tmp';
      writeFileSync(tmp, data);
      renameSync(tmp, this.dbPath);
      this.dirty = false;
    } catch {
      /* best-effort on shutdown */
    }
  }

  /** Cancel the debounce timer and flush immediately (async). */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.dirty) {
      await this.save();
    }
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

    // Always run migrations — safe to run on both new and existing databases
    this.runMigrations();
  }

  /** Current schema version — bump this whenever tables change. */
  private static readonly SCHEMA_VERSION = 1;

  private runMigrations(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Ensure schema_version table exists
    this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const stmt = this.db.prepare('SELECT MAX(version) AS v FROM schema_version');
    stmt.step();
    const row = stmt.getAsObject() as { v: number | null };
    stmt.free();
    const current = row.v ?? 0;

    if (current < 1) {
      // Migration 1: initial schema (all existing tables)
      this.db.run(`INSERT INTO schema_version (version) VALUES (1)`);
    }

    // Future migrations go here:
    // if (current < 2) { this.db.run(`ALTER TABLE ...`); this.db.run(`INSERT INTO schema_version (version) VALUES (2)`); }
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

    // Immediate save on fresh database creation
    await this.save();
  }

  async logActivity(
    userId: string,
    action: string,
    plugin?: string,
    details?: string,
    success: boolean = true,
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO activity_logs (user_id, action, plugin, details, success)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, action, plugin ?? null, details ?? null, success ? 1 : 0],
    );

    this.scheduleFlush();
  }

  async getRecentActivity(limit: number = 50): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');

    // sql.js exec() doesn't support parameterized queries — use prepare+bind
    const stmt = this.db.prepare(`SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT ?`);
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
      [userId, message.role, message.content || null, toolCalls, message.tool_call_id || null, message.name || null],
    );
    this.scheduleFlush();
  }

  async getHistory(userId: string, limit: number = 20): Promise<AIMessage[]> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(
      `SELECT * FROM (SELECT * FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC`,
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

  async clearHistory(userId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run(`DELETE FROM messages WHERE user_id = ?`, [userId]);
    this.scheduleFlush();
  }

  async addCoreMemory(entry: {
    id: string;
    userId: string;
    text: string;
    category: string;
    importance: number;
    tags?: string[];
  }): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run(`INSERT INTO core_memory (id, user_id, text, category, importance, tags) VALUES (?, ?, ?, ?, ?, ?)`, [
      entry.id,
      entry.userId,
      entry.text,
      entry.category,
      entry.importance,
      entry.tags ? JSON.stringify(entry.tags) : null,
    ]);
    this.scheduleFlush();
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
    this.scheduleFlush();
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

  /** Get recent messages across all users for the dashboard conversations view. */
  async getRecentMessages(limit: number = 100): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare(
      `SELECT user_id, role, content, timestamp FROM messages
       WHERE role IN ('user', 'assistant')
       ORDER BY id DESC LIMIT ?`,
    );
    stmt.bind([limit]);
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
      `SELECT role, content, timestamp FROM messages WHERE user_id = ? AND content LIKE ? ORDER BY timestamp DESC LIMIT ?`,
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
      [plugin.id, plugin.name, plugin.type, plugin.version || '1.0.0', plugin.enabled ? 1 : 0, configJson],
    );

    this.scheduleFlush();
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

    this.db.run(`UPDATE plugins SET enabled = ?, last_used = CURRENT_TIMESTAMP WHERE id = ?`, [
      enabled ? 1 : 0,
      pluginId,
    ]);

    this.scheduleFlush();
  }

  async save(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    // Clear dirty before the I/O so a write that arrives mid-save
    // will re-arm the flag and schedule another flush rather than
    // being silently dropped.
    this.dirty = false;
    const data = this.db.export();
    const tmp = this.dbPath + '.tmp';
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, this.dbPath);
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.flush();
      this.db.close();
      this.db = null;
    }
  }
}
