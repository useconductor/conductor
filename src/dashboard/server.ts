import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import crypto from 'crypto';
import { ConfigManager } from '../core/config.js';
import { Keychain } from '../security/keychain.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Constants ────────────────────────────────────────────────────────────────

const ALL_PLUGINS: readonly string[] = [
  'calculator', 'colors', 'cron', 'crypto', 'fun', 'gcal', 'gdrive',
  'github', 'github-actions', 'gmail', 'hash', 'homekit', 'memory',
  'n8n', 'network', 'notes', 'notion', 'slack', 'spotify', 'system', 'text-tools',
  'timezone', 'translate', 'url-tools', 'vercel', 'weather', 'x',
] as const;

const PLUGIN_REQUIRED_CREDS: Record<string, { service: string; key: string }[]> = {
  'github':         [{ service: 'github',   key: 'token'        }],
  'github-actions': [{ service: 'github',   key: 'token'        }],
  'gmail':          [{ service: 'google',   key: 'access_token' }],
  'gcal':           [{ service: 'google',   key: 'access_token' }],
  'gdrive':         [{ service: 'google',   key: 'access_token' }],
  'notion':         [{ service: 'notion',   key: 'api_key'      }],
  'spotify':        [{ service: 'spotify',  key: 'client_id'    }],
  'n8n':            [{ service: 'n8n',      key: 'api_key'      }],
  'vercel':         [{ service: 'vercel',   key: 'token'        }],
  'weather':        [{ service: 'weather',  key: 'api_key'      }],
  'x':              [{ service: 'x',        key: 'api_key'      }],
  'homekit':        [{ service: 'homekit',  key: 'base_url'     }],
  'slack':          [{ service: 'slack',    key: 'bot_token'    }],
};

interface CredentialEntry { service: string; key: string }

const KNOWN_CREDENTIALS: CredentialEntry[] = [
  { service: 'conductor', key: 'api_key'      },
  { service: 'claude',   key: 'api_key'       },
  { service: 'openai',   key: 'api_key'       },
  { service: 'gemini',   key: 'api_key'       },
  { service: 'github',   key: 'token'         },
  { service: 'telegram', key: 'bot_token'     },
  { service: 'spotify',  key: 'client_id'     },
  { service: 'spotify',  key: 'client_secret' },
  { service: 'notion',   key: 'api_key'       },
  { service: 'n8n',      key: 'api_key'       },
  { service: 'vercel',   key: 'token'         },
  { service: 'weather',  key: 'api_key'       },
  { service: 'x',        key: 'api_key'       },
  { service: 'google',   key: 'access_token'  },
  { service: 'slack',    key: 'bot_token'     },
];

// Bundled Google OAuth app — users never need to create their own
const GOOGLE_CLIENT_ID     = '529105409300-vmtlgnvcpfohtd7ha9o98fkel6ldjmin.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const GOOGLE_REDIRECT_URI  = 'http://localhost:4242/api/auth/google/callback';

// ── Public types ──────────────────────────────────────────────────────────────

export interface DashboardServer {
  port: number;
  close(): Promise<void>;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function startDashboard(port = 4242): Promise<DashboardServer> {
  const config  = new ConfigManager();
  await config.initialize();
  const keychain = new Keychain(config.getConfigDir());

  // Auto-store bundled Google OAuth creds so the rest of Conductor can use them
  const existingOAuth = config.get<{ clientId?: string }>('oauth.google');
  if (!existingOAuth?.clientId) {
    await config.set('oauth.google', {
      clientId:     GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      redirectUri:  GOOGLE_REDIRECT_URI,
    });
  }

  const app = express();
  app.use(express.json());

  // CORS
  app.use((_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });
  app.options('/{*path}', (_req: Request, res: Response): void => { res.sendStatus(204); });

  // ── Static ────────────────────────────────────────────────────────────────
  app.get('/', (_req: Request, res: Response): void => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  // ── Status ────────────────────────────────────────────────────────────────
  app.get('/api/status', async (_req: Request, res: Response): Promise<void> => {
    let version = 'unknown';
    try {
      const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
      version = (JSON.parse(await fs.readFile(pkgPath, 'utf-8')) as { version?: string }).version ?? 'unknown';
    } catch { /* ignore */ }
    res.json({ version, configDir: config.getConfigDir(), nodeVersion: process.version, platform: process.platform });
  });

  // ── Config ────────────────────────────────────────────────────────────────
  app.get('/api/config', (_req: Request, res: Response): void => {
    res.json(config.getConfig());
  });

  app.post('/api/config', async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { key?: string; value?: unknown };
    if (typeof body.key !== 'string' || body.key.trim() === '') {
      res.status(400).json({ error: '`key` must be a non-empty string' }); return;
    }
    await config.set(body.key, body.value);
    res.json({ ok: true });
  });

  // ── Plugins ───────────────────────────────────────────────────────────────
  app.get('/api/plugins', (_req: Request, res: Response): void => {
    const installed = config.get<string[]>('plugins.installed') ?? [];
    const enabled   = config.get<string[]>('plugins.enabled')   ?? [];
    res.json({ installed, enabled, all: ALL_PLUGINS, requiredCreds: PLUGIN_REQUIRED_CREDS });
  });

  app.post('/api/plugins/toggle', async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { plugin?: string; enabled?: boolean };
    if (typeof body.plugin !== 'string' || body.plugin.trim() === '') {
      res.status(400).json({ error: '`plugin` must be a non-empty string' }); return;
    }
    if (typeof body.enabled !== 'boolean') {
      res.status(400).json({ error: '`enabled` must be a boolean' }); return;
    }

    if (body.enabled && PLUGIN_REQUIRED_CREDS[body.plugin]) {
      const missing: string[] = [];
      for (const { service, key } of PLUGIN_REQUIRED_CREDS[body.plugin]) {
        if (!(await keychain.has(service, key))) missing.push(`${service} / ${key}`);
      }
      if (missing.length > 0) {
        res.status(400).json({ error: `Missing credentials: ${missing.join(', ')}`, missingCreds: missing });
        return;
      }
    }

    const current = config.get<string[]>('plugins.enabled') ?? [];
    const updated  = body.enabled
      ? current.includes(body.plugin) ? current : [...current, body.plugin]
      : current.filter((p: string) => p !== body.plugin);

    await config.set('plugins.enabled', updated);
    res.json({ ok: true, enabled: updated });
  });

  // ── Credentials ───────────────────────────────────────────────────────────
  app.get('/api/credentials', async (_req: Request, res: Response): Promise<void> => {
    const result = await Promise.all(
      KNOWN_CREDENTIALS.map(async ({ service, key }) => ({
        service, key,
        hasValue: await keychain.has(service, key),
      }))
    );
    res.json(result);
  });

  app.post('/api/credentials', async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { service?: string; key?: string; value?: string };
    if (!body.service || !body.key || !body.value) {
      res.status(400).json({ error: '`service`, `key`, and `value` are all required' }); return;
    }
    await keychain.set(body.service, body.key, body.value);
    res.json({ ok: true });
  });

  app.delete('/api/credentials/:service/:key', async (req: Request, res: Response): Promise<void> => {
    const { service, key } = req.params as { service: string; key: string };
    await keychain.delete(service, key);
    res.json({ ok: true });
  });

  // ── Google OAuth ──────────────────────────────────────────────────────────
  app.get('/api/auth/google/status', async (_req: Request, res: Response): Promise<void> => {
    const connected = await keychain.has('google', 'access_token');
    res.json({ connected });
  });

  app.get('/api/auth/google/url', async (_req: Request, res: Response): Promise<void> => {
    try {
      const { google } = await import('googleapis');
      const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
      const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/drive.file',
        ],
      });
      res.json({ url });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/auth/google/callback', async (req: Request, res: Response): Promise<void> => {
    const code = (req.query as Record<string, string>).code;
    if (!code) { res.status(400).send('<h2>Missing code</h2>'); return; }
    try {
      const { google } = await import('googleapis');
      const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
      const { tokens } = await oauth2Client.getToken(code);
      if (tokens.access_token)  await keychain.set('google', 'access_token',  tokens.access_token);
      if (tokens.refresh_token) await keychain.set('google', 'refresh_token', tokens.refresh_token);
      res.send(`<!DOCTYPE html><html><head><title>Connected</title></head>
        <body style="font-family:system-ui;text-align:center;padding:60px;background:#0d0d0d;color:#e8e8e8">
          <h2 style="color:#22c55e;margin-bottom:12px">✓ Google Connected</h2>
          <p style="color:#888">Gmail, Calendar, and Drive are ready.</p>
          <p style="color:#555;font-size:12px;margin-top:8px">This tab will close automatically.</p>
          <script>setTimeout(()=>{window.close();},1800);</script>
        </body></html>`);
    } catch (e: unknown) {
      res.status(500).send(`<h2 style="color:#ef4444">Auth failed: ${(e as Error).message}</h2>`);
    }
  });

  app.delete('/api/auth/google', async (_req: Request, res: Response): Promise<void> => {
    await keychain.delete('google', 'access_token');
    await keychain.delete('google', 'refresh_token');
    res.json({ ok: true });
  });

  // ── Activity log ──────────────────────────────────────────────────────────
  app.get('/api/activity', async (_req: Request, res: Response): Promise<void> => {
    try {
      const logsDir = path.join(config.getConfigDir(), 'logs');
      let entries: unknown[] = [];
      try {
        const files = await fs.readdir(logsDir);
        for (const f of files.filter((f: string) => f.endsWith('.json')).slice(-5)) {
          try {
            const raw = await fs.readFile(path.join(logsDir, f), 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) entries.push(...parsed);
            else entries.push(parsed);
          } catch { /* skip bad file */ }
        }
      } catch { /* no logs dir */ }
      res.json({ entries: entries.slice(-20) });
    } catch {
      res.json({ entries: [] });
    }
  });

  // ── Lumen API key management ──────────────────────────────────────────────

  // Generate a new API key and store it in the keychain.
  // Returns the plaintext key once — caller must save it.
  app.post('/api/lumen/key', async (_req: Request, res: Response): Promise<void> => {
    const newKey = 'cnd_' + crypto.randomBytes(24).toString('hex');
    await keychain.set('conductor', 'api_key', newKey);
    res.json({ ok: true, key: newKey });
  });

  // Check whether an API key exists (does not reveal the key itself).
  app.get('/api/lumen/key/status', async (_req: Request, res: Response): Promise<void> => {
    const hasKey = await keychain.has('conductor', 'api_key');
    res.json({ hasKey });
  });

  // Revoke the current API key.
  app.delete('/api/lumen/key', async (_req: Request, res: Response): Promise<void> => {
    await keychain.delete('conductor', 'api_key');
    res.json({ ok: true });
  });

  // ── Lumen AI endpoint (requires API key) ──────────────────────────────────
  //
  // Allows remote callers to forward a task to the local Lumen/Ollama instance.
  // Authentication: Authorization: Bearer <api-key>
  app.post('/api/lumen/ask', async (req: Request, res: Response): Promise<void> => {
    // Validate Bearer token
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Authorization header. Use: Authorization: Bearer <api-key>' });
      return;
    }
    const providedKey = authHeader.slice(7);
    const storedKey = await keychain.get('conductor', 'api_key');
    if (!storedKey || !crypto.timingSafeEqual(Buffer.from(providedKey), Buffer.from(storedKey))) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    const body = req.body as { task?: string; max_iterations?: number };
    if (!body.task || typeof body.task !== 'string' || body.task.trim() === '') {
      res.status(400).json({ error: '`task` is required' });
      return;
    }

    const endpoint = config.get<string>('plugins.lumen.endpoint') || 'http://localhost:11434';
    const model    = config.get<string>('plugins.lumen.model')    || 'lumen';

    try {
      const { runLumenAgent } = await import('../plugins/builtin/lumen.js');
      const result = await runLumenAgent(body.task.trim(), endpoint, model, body.max_iterations ?? 10);
      res.json(result);
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ── Start ─────────────────────────────────────────────────────────────────
  return new Promise<DashboardServer>((resolve, reject) => {
    const server = app.listen(port, () => {
      resolve({
        port,
        close: (): Promise<void> =>
          new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res()))),
      });
    });
    server.on('error', reject);
  });
}
