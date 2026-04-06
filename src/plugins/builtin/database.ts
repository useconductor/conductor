import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';

export class DatabasePlugin implements Plugin {
  name = 'database';
  description = 'Query PostgreSQL, MySQL, MongoDB, and Redis databases';
  version = '1.0.0';

  configSchema = {
    fields: [
      {
        key: 'postgres_url',
        label: 'PostgreSQL Connection URL',
        type: 'password' as const,
        required: false,
        secret: true,
        service: 'database',
        description: 'postgresql://user:pass@host:5432/db',
      },
      {
        key: 'mysql_url',
        label: 'MySQL Connection URL',
        type: 'password' as const,
        required: false,
        secret: true,
        service: 'database',
        description: 'mysql://user:pass@host:3306/db',
      },
      {
        key: 'mongo_url',
        label: 'MongoDB Connection URL',
        type: 'password' as const,
        required: false,
        secret: true,
        service: 'database',
        description: 'mongodb://user:pass@host:27017/db',
      },
      {
        key: 'redis_url',
        label: 'Redis Connection URL',
        type: 'password' as const,
        required: false,
        secret: true,
        service: 'database',
        description: 'redis://:pass@host:6379/0',
      },
    ],
    setupInstructions: 'Add database connection URLs. Only configured databases will be available.',
  };

  private conductor?: Conductor;
  private configuredUrls: Set<string> = new Set();

  async initialize(conductor: Conductor): Promise<void> {
    this.conductor = conductor;
    // Pre-check which databases are actually configured
    try {
      const { Keychain } = await import('../../security/keychain.js');
      const kc = new Keychain(conductor.getConfig().getConfigDir());
      const keys = ['postgres_url', 'mysql_url', 'mongo_url', 'redis_url'];
      for (const k of keys) {
        try {
          const val = await kc.get('database', k);
          if (val) this.configuredUrls.add(k);
        } catch { /* not stored */ }
      }
      // Also check environment variables as fallback
      if (process.env['DATABASE_URL'] || process.env['POSTGRES_URL']) this.configuredUrls.add('postgres_url');
      if (process.env['MYSQL_URL']) this.configuredUrls.add('mysql_url');
      if (process.env['MONGO_URL'] || process.env['MONGODB_URL']) this.configuredUrls.add('mongo_url');
      if (process.env['REDIS_URL']) this.configuredUrls.add('redis_url');
    } catch { /* keychain not available */ }
  }

  isConfigured(): boolean {
    return this.configuredUrls.size > 0;
  }

  private async getKeychain(): Promise<import('../../security/keychain.js').Keychain> {
    if (!this.conductor) throw new Error('Database plugin not initialized');
    const { Keychain } = await import('../../security/keychain.js');
    return new Keychain(this.conductor.getConfig().getConfigDir());
  }

  private async runPsql(url: string, query: string): Promise<string> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync('psql', [url, '-t', '-A', '-c', query], { timeout: 30000 });
      return stdout.trim();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`PostgreSQL query failed: ${msg}`);
    }
  }

  private async runMysql(url: string, query: string): Promise<string> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync('mysql', [url, '-e', query, '-N', '-B'], { timeout: 30000 });
      return stdout.trim();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`MySQL query failed: ${msg}`);
    }
  }

  private async runMongo(
    url: string,
    db: string,
    collection: string,
    operation: string,
    filter: string,
  ): Promise<string> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const script = `
      const db_conn = connect("${url}");
      db_conn.use("${db}");
      const result = db_conn.getCollection("${collection}").${operation}(${filter});
      printjson(result);
    `;
    try {
      const { stdout } = await execFileAsync('mongosh', ['--quiet', '--eval', script], { timeout: 30000 });
      return stdout.trim();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`MongoDB operation failed: ${msg}`);
    }
  }

  private async runRedis(url: string, command: string, args: string[]): Promise<string> {
    const { createClient } = await import('redis');
    const client = createClient({ url });
    await client.connect();
    try {
      const result = await client.sendCommand([command, ...args]);
      return typeof result === 'string' ? result : JSON.stringify(result);
    } finally {
      await client.quit();
    }
  }

  getTools(): PluginTool[] {
    return [
      {
        name: 'db_postgres_query',
        description: 'Execute a read-only SQL query on PostgreSQL. SELECT only — no writes allowed.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'SQL query (SELECT only)' },
          },
          required: ['query'],
        },
        handler: async (input: { query: string }) => {
          if (!/^\s*SELECT\b/i.test(input.query)) {
            throw new Error('Only SELECT queries are allowed. Use db_postgres_write for write operations.');
          }
          if (!this.conductor) throw new Error('Database plugin not initialized');
          const keychain = await this.getKeychain();
          const url = await keychain.get('database', 'postgres_url');
          if (!url)
            throw new Error('PostgreSQL URL not configured. Run: conductor config set database.postgres_url <url>');
          const result = await this.runPsql(url, input.query);
          return { database: 'postgresql', query: input.query, result };
        },
      },
      {
        name: 'db_mysql_query',
        description: 'Execute a read-only SQL query on MySQL. SELECT only — no writes allowed.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'SQL query (SELECT only)' },
          },
          required: ['query'],
        },
        handler: async (input: { query: string }) => {
          if (!/^\s*SELECT\b/i.test(input.query)) {
            throw new Error('Only SELECT queries are allowed.');
          }
          if (!this.conductor) throw new Error('Database plugin not initialized');
          const keychain = await this.getKeychain();
          const url = await keychain.get('database', 'mysql_url');
          if (!url) throw new Error('MySQL URL not configured.');
          const result = await this.runMysql(url, input.query);
          return { database: 'mysql', query: input.query, result };
        },
      },
      {
        name: 'db_mongo_find',
        description: 'Query a MongoDB collection',
        inputSchema: {
          type: 'object',
          properties: {
            database: { type: 'string', description: 'Database name' },
            collection: { type: 'string', description: 'Collection name' },
            filter: { type: 'string', description: 'JSON filter object (e.g. \'{"status":"active"}\')', default: '{}' },
          },
          required: ['database', 'collection'],
        },
        handler: async (input: { database: string; collection: string; filter?: string }) => {
          if (!this.conductor) throw new Error('Database plugin not initialized');
          const keychain = await this.getKeychain();
          const url = await keychain.get('database', 'mongo_url');
          if (!url) throw new Error('MongoDB URL not configured.');
          const filter = input.filter ?? '{}';
          const result = await this.runMongo(url, input.database, input.collection, 'find', filter);
          return { database: input.database, collection: input.collection, filter, result };
        },
      },
      {
        name: 'db_redis_command',
        description: 'Execute a Redis command',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Redis command (e.g. "GET", "SET", "KEYS", "HGETALL")' },
            args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
          },
          required: ['command'],
        },
        handler: async (input: { command: string; args?: string[] }) => {
          if (!this.conductor) throw new Error('Database plugin not initialized');
          const keychain = await this.getKeychain();
          const url = await keychain.get('database', 'redis_url');
          if (!url) throw new Error('Redis URL not configured.');
          const result = await this.runRedis(url, input.command, input.args ?? []);
          return { database: 'redis', command: input.command, args: input.args, result };
        },
      },
      {
        name: 'db_list_connections',
        description: 'List configured database connections (without exposing credentials)',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          if (!this.conductor) throw new Error('Database plugin not initialized');
          const keychain = await this.getKeychain();
          const connections: Record<string, boolean> = {};
          for (const key of ['postgres_url', 'mysql_url', 'mongo_url', 'redis_url']) {
            connections[key] = await keychain.has('database', key);
          }
          return { connections };
        },
      },
    ];
  }
}
