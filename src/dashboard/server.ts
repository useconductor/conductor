import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import crypto from 'crypto';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import rateLimit from 'express-rate-limit';
import { ConfigManager } from '../core/config.js';
import { DatabaseManager } from '../core/database.js';
import { Keychain } from '../security/keychain.js';
import type { Conductor } from '../core/conductor.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Constants ────────────────────────────────────────────────────────────────

const ALL_PLUGINS: readonly string[] = [
  'calculator',
  'colors',
  'cron',
  'crypto',
  'fun',
  'gcal',
  'gdrive',
  'github',
  'github-actions',
  'gmail',
  'hash',
  'homekit',
  'memory',
  'n8n',
  'network',
  'notes',
  'notion',
  'slack',
  'spotify',
  'system',
  'text-tools',
  'timezone',
  'todoist',
  'translate',
  'url-tools',
  'vercel',
  'weather',
  'x',
] as const;

const PLUGIN_REQUIRED_CREDS: Record<string, { service: string; key: string }[]> = {
  github: [{ service: 'github', key: 'token' }],
  'github-actions': [{ service: 'github', key: 'token' }],
  gmail: [{ service: 'google', key: 'access_token' }],
  gcal: [{ service: 'google', key: 'access_token' }],
  gdrive: [{ service: 'google', key: 'access_token' }],
  notion: [{ service: 'notion', key: 'api_key' }],
  spotify: [{ service: 'spotify', key: 'client_id' }],
  n8n: [{ service: 'n8n', key: 'api_key' }],
  vercel: [{ service: 'vercel', key: 'token' }],
  weather: [{ service: 'weather', key: 'api_key' }],
  x: [{ service: 'x', key: 'api_key' }],
  homekit: [{ service: 'homekit', key: 'base_url' }],
  slack: [{ service: 'slack', key: 'bot_token' }],
  todoist: [{ service: 'todoist', key: 'api_token' }],
};

interface CredentialEntry {
  service: string;
  key: string;
}

const KNOWN_CREDENTIALS: CredentialEntry[] = [
  { service: 'conductor', key: 'api_key' },
  { service: 'claude', key: 'api_key' },
  { service: 'openai', key: 'api_key' },
  { service: 'gemini', key: 'api_key' },
  { service: 'github', key: 'token' },
  { service: 'telegram', key: 'bot_token' },
  { service: 'spotify', key: 'client_id' },
  { service: 'spotify', key: 'client_secret' },
  { service: 'notion', key: 'api_key' },
  { service: 'n8n', key: 'api_key' },
  { service: 'vercel', key: 'token' },
  { service: 'weather', key: 'api_key' },
  { service: 'x', key: 'api_key' },
  { service: 'google', key: 'access_token' },
  { service: 'slack', key: 'bot_token' },
  { service: 'todoist', key: 'api_token' },
];

// Bundled Google OAuth app — users never need to create their own
const GOOGLE_CLIENT_ID = '529105409300-vmtlgnvcpfohtd7ha9o98fkel6ldjmin.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET: string | undefined = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = 'http://localhost:4242/api/auth/google/callback';

// ── Public types ──────────────────────────────────────────────────────────────

export interface DashboardServer {
  port: number;
  close(): Promise<void>;
}

// ── Main export ───────────────────────────────────────────────────────────────

/** Generate or load the persistent dashboard session token. */
async function getDashboardToken(configDir: string): Promise<string> {
  const tokenPath = path.join(configDir, 'dashboard.token');
  try {
    const existing = (await fs.readFile(tokenPath, 'utf-8')).trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* not yet created */
  }

  const token = crypto.randomBytes(24).toString('hex');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(tokenPath, token, { mode: 0o600 });
  return token;
}

/** In-memory log buffer for SSE streaming */
const logBuffer: Array<{ level: string; message: string; timestamp: string }> = [];
const maxLogBuffer = 500;
const sseClients: Set<Response> = new Set();

function interceptLogs(): void {
  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  function pushLog(level: string, args: unknown[]): void {
    const message = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    const entry = { level, message, timestamp: new Date().toISOString() };
    logBuffer.push(entry);
    if (logBuffer.length > maxLogBuffer) logBuffer.shift();
    const data = `data: ${JSON.stringify(entry)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(data);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  console.log = (...args: unknown[]) => {
    origLog(...args);
    pushLog('info', args);
  };
  console.error = (...args: unknown[]) => {
    origError(...args);
    pushLog('error', args);
  };
  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    pushLog('warn', args);
  };
}

export async function startDashboard(port = 4242, conductorInstance?: Conductor): Promise<DashboardServer> {
  interceptLogs();

  const config = new ConfigManager();
  await config.initialize();
  const keychain = new Keychain(config.getConfigDir());

  // Initialize database for conversations endpoint
  const db = new DatabaseManager(config.getConfigDir());
  try {
    await db.initialize();
  } catch {
    // DB may not exist yet — conversations endpoint will return empty
  }

  // Generate / load session token
  const dashboardToken = await getDashboardToken(config.getConfigDir());

  // Auto-store bundled Google OAuth creds so the rest of Conductor can use them
  const existingOAuth = config.get<{ clientId?: string }>('oauth.google');
  if (!existingOAuth?.clientId && GOOGLE_CLIENT_SECRET) {
    await config.set('oauth.google', {
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      redirectUri: GOOGLE_REDIRECT_URI,
    });
  }

  const app = express();
  app.use(express.json());

  // CORS — allow both localhost and 127.0.0.1
  app.use((_req: Request, res: Response, next: NextFunction): void => {
    const origin = (_req.headers.origin as string) || '';
    const allowed = ['http://localhost:4242', 'http://127.0.0.1:4242'];
    if (allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:4242');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    next();
  });
  app.options('/{*path}', (_req: Request, res: Response): void => {
    res.sendStatus(204);
  });

  // ── Authentication middleware for /api/* routes ───────────────────────────
  // The Google OAuth callback must remain open (browser redirect from google.com)
  app.use('/api', (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === '/auth/google/callback') {
      next();
      return;
    }
    // Accept token from Authorization header OR ?token= query param (needed for EventSource / SSE)
    const authHeader = req.headers['authorization'];
    const queryToken = (req.query as Record<string, string>).token;
    const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (queryToken ?? '');
    if (!rawToken) {
      res.status(401).json({
        error:
          'COND-AUTH-001: Unauthorized — include Authorization: Bearer <token>. Generate a token with: conductor dashboard token',
      });
      return;
    }
    const provided = rawToken;
    // Constant-time comparison to prevent timing attacks
    try {
      const tokenBuf = Buffer.from(dashboardToken, 'utf-8');
      const providedBuf = Buffer.from(provided, 'utf-8');
      if (tokenBuf.length !== providedBuf.length || !crypto.timingSafeEqual(tokenBuf, providedBuf)) {
        res
          .status(401)
          .json({ error: 'COND-AUTH-002: Invalid token. Generate a new token with: conductor dashboard token' });
        return;
      }
    } catch {
      res
        .status(401)
        .json({ error: 'COND-AUTH-003: Invalid token format. Generate a new token with: conductor dashboard token' });
      return;
    }
    next();
  });

  // ── Static ────────────────────────────────────────────────────────────────
  // Inject dashboard token as a meta tag so the JS can read it
  app.get('/', async (_req: Request, res: Response): Promise<void> => {
    try {
      const htmlPath = path.join(__dirname, 'index.html');
      let html = await fs.readFile(htmlPath, 'utf-8');
      // Inject meta tag with the token right before </head>
      // Replace the placeholder meta tag that's already in the HTML template
      html = html.replace(
        '<meta name="dashboard-token" content="">',
        `<meta name="dashboard-token" content="${dashboardToken}">`,
      );
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch {
      res.status(500).send('Dashboard HTML not found. Run: npm run build');
    }
  });

  // ── Status ────────────────────────────────────────────────────────────────
  app.get('/api/status', async (_req: Request, res: Response): Promise<void> => {
    let version = 'unknown';
    try {
      const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
      version = (JSON.parse(await fs.readFile(pkgPath, 'utf-8')) as { version?: string }).version ?? 'unknown';
    } catch {
      /* ignore */
    }
    res.json({ version, configDir: config.getConfigDir(), nodeVersion: process.version, platform: process.platform });
  });

  // ── Config ────────────────────────────────────────────────────────────────
  app.get('/api/config', (_req: Request, res: Response): void => {
    res.json(config.getConfig());
  });

  app.post('/api/config', async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { key?: string; value?: unknown };
    if (typeof body.key !== 'string' || body.key.trim() === '') {
      res.status(400).json({ error: '`key` must be a non-empty string' });
      return;
    }
    await config.set(body.key, body.value);
    res.json({ ok: true });
  });

  // ── Plugins ───────────────────────────────────────────────────────────────
  app.get('/api/plugins', (_req: Request, res: Response): void => {
    const installed = config.get<string[]>('plugins.installed') ?? [];
    const enabled = config.get<string[]>('plugins.enabled') ?? [];
    res.json({ installed, enabled, all: ALL_PLUGINS, requiredCreds: PLUGIN_REQUIRED_CREDS });
  });

  app.post('/api/plugins/toggle', async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { plugin?: string; enabled?: boolean };
    if (typeof body.plugin !== 'string' || body.plugin.trim() === '') {
      res.status(400).json({ error: '`plugin` must be a non-empty string' });
      return;
    }
    if (typeof body.enabled !== 'boolean') {
      res.status(400).json({ error: '`enabled` must be a boolean' });
      return;
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
    const updated = body.enabled
      ? current.includes(body.plugin)
        ? current
        : [...current, body.plugin]
      : current.filter((p: string) => p !== body.plugin);

    await config.set('plugins.enabled', updated);
    res.json({ ok: true, enabled: updated });
  });

  // ── Credentials ───────────────────────────────────────────────────────────
  app.get('/api/credentials', async (_req: Request, res: Response): Promise<void> => {
    const result = await Promise.all(
      KNOWN_CREDENTIALS.map(async ({ service, key }) => ({
        service,
        key,
        hasValue: await keychain.has(service, key),
      })),
    );
    res.json(result);
  });

  app.post('/api/credentials', async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { service?: string; key?: string; value?: string };
    if (!body.service || !body.key || !body.value) {
      res.status(400).json({ error: '`service`, `key`, and `value` are all required' });
      return;
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
    if (!GOOGLE_CLIENT_SECRET) {
      res.status(503).json({ error: 'Google OAuth is not configured — set GOOGLE_CLIENT_SECRET env var' });
      return;
    }
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
    if (!GOOGLE_CLIENT_SECRET) {
      res.status(503).json({ error: 'Google OAuth is not configured — set GOOGLE_CLIENT_SECRET env var' });
      return;
    }
    const code = (req.query as Record<string, string>).code;
    if (!code) {
      res.status(400).send('<h2>Missing code</h2>');
      return;
    }
    try {
      const { google } = await import('googleapis');
      const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
      const { tokens } = await oauth2Client.getToken(code);
      if (tokens.access_token) await keychain.set('google', 'access_token', tokens.access_token);
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
          } catch {
            /* skip bad file */
          }
        }
      } catch {
        /* no logs dir */
      }
      res.json({ entries: entries.slice(-20) });
    } catch {
      res.json({ entries: [] });
    }
  });

  // ── System Control ────────────────────────────────────────────────────────

  // Safe command runner using execFile (no shell interpretation)
  async function runCmd(cmd: string, timeoutMs = 30000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // Whitelist of allowed dashboard commands
    const allowedPrefixes = [
      'ps ',
      'tasklist',
      'open ',
      'xdg-open',
      'screencapture',
      'scrot',
      'pbpaste',
      'xclip',
      'xsel',
      'ifconfig',
      'ip ',
      'netstat',
      'ss ',
      'lsof',
      'docker ',
      'crontab',
      'git ',
    ];
    const trimmed = cmd.trim();
    const isAllowed = allowedPrefixes.some((p) => trimmed.startsWith(p));
    if (!isAllowed) {
      return { stdout: '', stderr: `Command not allowed in dashboard: ${trimmed}`, exitCode: 1 };
    }
    const [executable, ...args] = trimmed.split(/\s+/);
    try {
      const { stdout, stderr } = await execFileAsync(executable, args, {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout: (stdout ?? '').trim(), stderr: (stderr ?? '').trim(), exitCode: 0 };
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return { stdout: (e.stdout ?? '').trim(), stderr: (e.stderr ?? '').trim(), exitCode: e.code ?? 1 };
      }
      return { stdout: '', stderr: String(err), exitCode: 1 };
    }
  }

  // GET /api/system/info
  app.get('/api/system/info', async (_req: Request, res: Response): Promise<void> => {
    const cpus = os.cpus();
    res.json({
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
      },
      cpu: {
        model: cpus[0]?.model ?? 'unknown',
        cores: cpus.length,
        usage: null, // point-in-time snapshot not meaningful without sampling interval
      },
    });
  });

  // POST /api/system/shell — REMOVED for security
  // Shell access through a web dashboard is an unacceptable attack surface.
  // Use the CLI directly for shell operations.
  app.post('/api/system/shell', async (_req: Request, res: Response): Promise<void> => {
    res.status(410).json({ error: 'Shell endpoint has been removed for security. Use the CLI directly.' });
  });

  // GET /api/system/processes — REMOVED (relied on shell execution)
  app.get('/api/system/processes', async (_req: Request, res: Response): Promise<void> => {
    res.status(410).json({ error: 'Process listing endpoint has been removed (relied on shell execution).' });
  });

  // POST /api/system/open
  app.post('/api/system/open', async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { path?: string };
    if (!body.path || typeof body.path !== 'string' || body.path.trim() === '') {
      res.status(400).json({ error: '`path` is required' });
      return;
    }
    const platform = os.platform();
    let opener: string;
    if (platform === 'darwin') opener = 'open';
    else if (platform === 'win32') opener = 'start ""';
    else opener = 'xdg-open';
    const result = await runCmd(`${opener} ${JSON.stringify(body.path.trim())}`);
    res.json(result);
  });

  // POST /api/system/notify
  app.post('/api/system/notify', async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { title?: string; message?: string };
    if (!body.title || !body.message) {
      res.status(400).json({ error: '`title` and `message` are required' });
      return;
    }
    const platform = os.platform();
    let cmd: string;
    if (platform === 'darwin') {
      const t = body.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const m = body.message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      cmd = `osascript -e 'display notification "${m}" with title "${t}"'`;
    } else {
      cmd = `notify-send ${JSON.stringify(body.title)} ${JSON.stringify(body.message)}`;
    }
    const result = await runCmd(cmd);
    res.json(result);
  });

  // GET /api/system/clipboard
  app.get('/api/system/clipboard', async (_req: Request, res: Response): Promise<void> => {
    const platform = os.platform();
    const cmd = platform === 'darwin' ? 'pbpaste' : 'xclip -o';
    const result = await runCmd(cmd);
    res.json({ text: result.stdout, ...result });
  });

  // POST /api/system/clipboard
  app.post('/api/system/clipboard', async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { text?: string };
    if (typeof body.text !== 'string') {
      res.status(400).json({ error: '`text` is required' });
      return;
    }
    const platform = os.platform();
    const cmd = platform === 'darwin' ? 'pbcopy' : 'xclip -selection clipboard';
    const result = await runCmd(`printf '%s' ${JSON.stringify(body.text)} | ${cmd}`);
    res.json(result);
  });

  // GET /api/system/screenshot
  app.get('/api/system/screenshot', async (_req: Request, res: Response): Promise<void> => {
    const platform = os.platform();
    const tmpFile = '/tmp/conductor-screenshot.png';
    let captureResult: { stdout: string; stderr: string; exitCode: number };
    if (platform === 'darwin') {
      captureResult = await runCmd(`screencapture -x -t png ${tmpFile}`);
    } else {
      captureResult = await runCmd(`scrot ${tmpFile}`);
    }
    if (captureResult.exitCode !== 0) {
      res.status(500).json({ error: 'Screenshot failed', ...captureResult });
      return;
    }
    try {
      const imgBuf = await fs.readFile(tmpFile);
      const image = imgBuf.toString('base64');
      await fs.unlink(tmpFile).catch(() => {
        /* best-effort cleanup */
      });
      res.json({ image, mimeType: 'image/png' });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // POST /api/system/type
  app.post('/api/system/type', async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { text?: string };
    if (typeof body.text !== 'string' || body.text === '') {
      res.status(400).json({ error: '`text` is required' });
      return;
    }
    const platform = os.platform();
    let cmd: string;
    if (platform === 'darwin') {
      const escaped = body.text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      cmd = `osascript -e 'tell application "System Events" to keystroke "${escaped}"'`;
    } else {
      cmd = `xdotool type ${JSON.stringify(body.text)}`;
    }
    const result = await runCmd(cmd);
    res.json(result);
  });

  // GET /api/system/windows
  app.get('/api/system/windows', async (_req: Request, res: Response): Promise<void> => {
    const platform = os.platform();
    let cmd: string;
    if (platform === 'darwin') {
      cmd = `osascript -e 'tell application "System Events" to get name of every process whose background only is false'`;
    } else if (platform === 'win32') {
      cmd = `powershell -Command "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object -ExpandProperty MainWindowTitle"`;
    } else {
      cmd = `wmctrl -l 2>/dev/null || xdotool search --onlyvisible --name "" getwindowname 2>/dev/null || echo ''`;
    }
    const result = await runCmd(cmd);
    const apps = result.stdout
      .split(/,\s*|\n/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
    res.json({ apps, raw: result.stdout });
  });

  // ── File System Routes ────────────────────────────────────────────────────

  const ALLOWED_TEXT_EXTENSIONS = new Set([
    '.txt',
    '.md',
    '.json',
    '.ts',
    '.js',
    '.py',
    '.sh',
    '.yaml',
    '.yml',
    '.toml',
    '.env',
    '.log',
    '.csv',
    '.html',
    '.css',
    '.xml',
    '.sql',
    '.go',
    '.rs',
    '.rb',
    '.php',
    '.java',
    '.c',
    '.cpp',
    '.h',
  ]);

  function isSafePath(rawPath: string, mustBeUnder?: string): { safe: boolean; resolved: string } {
    const resolved = path.resolve(rawPath);
    if (rawPath.includes('..') || resolved !== path.normalize(resolved)) {
      return { safe: false, resolved };
    }
    if (mustBeUnder) {
      const base = path.resolve(mustBeUnder);
      if (!resolved.startsWith(base + path.sep) && resolved !== base) {
        return { safe: false, resolved };
      }
    }
    return { safe: true, resolved };
  }

  // GET /api/fs/list
  app.get('/api/fs/list', async (req: Request, res: Response): Promise<void> => {
    let rawPath = (req.query as Record<string, string>).path;
    // Normalize: missing, empty, or '~' → home dir; relative → join with home dir
    if (!rawPath || rawPath === '~') {
      rawPath = os.homedir();
    } else if (!path.isAbsolute(rawPath)) {
      rawPath = path.join(os.homedir(), rawPath);
    }
    const { safe, resolved } = isSafePath(rawPath);
    if (!safe) {
      res.status(400).json({ error: 'Invalid path — traversal not allowed' });
      return;
    }
    try {
      const names = await fs.readdir(resolved);
      const capped = names.slice(0, 200);
      const entries = await Promise.all(
        capped.map(async (name) => {
          try {
            const stat = await fs.stat(path.join(resolved, name));
            return {
              name,
              type: stat.isDirectory() ? 'dir' : 'file',
              size: stat.size,
              modified: stat.mtime.toISOString(),
              permissions: (stat.mode & 0o777).toString(8).padStart(3, '0'),
            };
          } catch {
            return { name, type: 'unknown', size: 0, modified: null, permissions: '000' };
          }
        }),
      );
      res.json({ entries, path: resolved });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // GET /api/fs/read
  app.get('/api/fs/read', async (req: Request, res: Response): Promise<void> => {
    const rawPath = (req.query as Record<string, string>).path;
    if (!rawPath) {
      res.status(400).json({ error: '`path` query parameter is required' });
      return;
    }
    const { safe, resolved } = isSafePath(rawPath);
    if (!safe) {
      res.status(400).json({ error: 'Invalid path — traversal not allowed' });
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    if (!ALLOWED_TEXT_EXTENSIONS.has(ext)) {
      res.status(400).json({ error: `File extension '${ext}' is not allowed` });
      return;
    }
    try {
      const stat = await fs.stat(resolved);
      if (stat.size > 1024 * 1024) {
        res.status(400).json({ error: 'File exceeds 1MB limit' });
        return;
      }
      const content = await fs.readFile(resolved, 'utf-8');
      res.json({ content, size: stat.size, encoding: 'utf-8' });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // POST /api/fs/write
  app.post('/api/fs/write', async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { path?: string; content?: string };
    if (!body.path || typeof body.path !== 'string') {
      res.status(400).json({ error: '`path` is required' });
      return;
    }
    if (typeof body.content !== 'string') {
      res.status(400).json({ error: '`content` is required' });
      return;
    }
    const { safe, resolved } = isSafePath(body.path, os.homedir());
    if (!safe) {
      res.status(400).json({ error: 'Invalid path — traversal above home directory not allowed' });
      return;
    }
    const contentBytes = Buffer.byteLength(body.content, 'utf-8');
    if (contentBytes > 512 * 1024) {
      res.status(400).json({ error: 'Content exceeds 512KB limit' });
      return;
    }
    try {
      await fs.writeFile(resolved, body.content, 'utf-8');
      res.json({ ok: true, bytesWritten: contentBytes });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // POST /api/fs/delete
  app.post('/api/fs/delete', async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { path?: string };
    if (!body.path || typeof body.path !== 'string') {
      res.status(400).json({ error: '`path` is required' });
      return;
    }
    const { safe, resolved } = isSafePath(body.path, os.homedir());
    if (!safe) {
      res.status(400).json({ error: 'Invalid path — traversal above home directory not allowed' });
      return;
    }
    try {
      const stat = await fs.stat(resolved);
      if (stat.isDirectory()) {
        await fs.rmdir(resolved); // only succeeds on empty dirs
      } else {
        await fs.unlink(resolved);
      }
      res.json({ ok: true });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ── Enhanced Process Manager ──────────────────────────────────────────────

  // GET /api/system/processes/detail
  app.get('/api/system/processes/detail', async (_req: Request, res: Response): Promise<void> => {
    const platform = os.platform();
    const cmd = platform === 'win32' ? 'tasklist /FO CSV /NH' : 'ps aux';
    const result = await runCmd(cmd);
    const lines = result.stdout.split('\n').filter((l: string) => l.trim().length > 0);
    const dataLines = platform === 'win32' ? lines : lines.slice(1); // skip header on unix
    const processes = dataLines.slice(0, 30).map((line: string) => {
      if (platform === 'win32') {
        const parts = line.split(',').map((p: string) => p.replace(/"/g, '').trim());
        return { pid: parseInt(parts[1] ?? '0', 10), user: 'N/A', cpu: 'N/A', mem: 'N/A', command: parts[0] ?? line };
      }
      // ps aux format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
      const parts = line.trim().split(/\s+/);
      return {
        pid: parseInt(parts[1] ?? '0', 10),
        user: parts[0] ?? '',
        cpu: parts[2] ?? '',
        mem: parts[3] ?? '',
        command: parts.slice(10).join(' '),
      };
    });
    res.json({ processes });
  });

  // POST /api/system/processes/kill
  app.post('/api/system/processes/kill', (req: Request, res: Response): void => {
    const body = req.body as { pid?: number };
    if (typeof body.pid !== 'number' || !Number.isInteger(body.pid)) {
      res.status(400).json({ error: '`pid` must be an integer' });
      return;
    }
    if (body.pid <= 1000) {
      res.status(400).json({ error: 'Refusing to kill system process (pid <= 1000)' });
      return;
    }
    try {
      process.kill(body.pid, 'SIGTERM');
      res.json({ ok: true });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ── Real-time System Metrics ───────────────────────────────────────────────

  // GET /api/system/metrics
  app.get('/api/system/metrics', (_req: Request, res: Response): void => {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    res.json({
      loadAvg: os.loadavg(),
      memory: {
        total,
        free,
        used,
        usedPercent: Math.round((used / total) * 10000) / 100,
      },
      uptime: os.uptime(),
      platform: os.platform(),
    });
  });

  // ── Network Connections ───────────────────────────────────────────────────

  // GET /api/system/network
  app.get('/api/system/network', async (_req: Request, res: Response): Promise<void> => {
    const platform = os.platform();
    let connCmd: string;
    let ifaceCmd: string;
    if (platform === 'darwin') {
      connCmd = 'netstat -an | grep ESTABLISHED | head -20';
      ifaceCmd = 'ifconfig';
    } else {
      connCmd = 'ss -tuln | head -20';
      ifaceCmd = 'ip addr';
    }
    const [connResult, ifaceResult] = await Promise.all([runCmd(connCmd), runCmd(ifaceCmd)]);
    const connections = connResult.stdout
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0);
    res.json({ connections, interfaces: ifaceResult.stdout });
  });

  // ── Environment Variables ─────────────────────────────────────────────────

  // GET /api/system/env
  app.get('/api/system/env', (_req: Request, res: Response): void => {
    const SAFE_KEYS = new Set(['PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'NODE_ENV', 'PORT']);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && (SAFE_KEYS.has(k) || k.startsWith('CONDUCTOR_'))) {
        env[k] = v;
      }
    }
    res.json({ env });
  });

  // ── Git Status ────────────────────────────────────────────────────────────

  // GET /api/git/status
  app.get('/api/git/status', async (req: Request, res: Response): Promise<void> => {
    const rawPath = (req.query as Record<string, string>).path;
    if (!rawPath) {
      res.status(400).json({ error: '`path` query parameter is required' });
      return;
    }
    const { safe, resolved } = isSafePath(rawPath);
    if (!safe) {
      res.status(400).json({ error: 'Invalid path — traversal not allowed' });
      return;
    }
    const [statusResult, logResult] = await Promise.all([
      runCmd(`git -C ${JSON.stringify(resolved)} status --porcelain -b 2>&1`),
      runCmd(`git -C ${JSON.stringify(resolved)} log --oneline -10 2>&1`),
    ]);

    const isRepo = statusResult.exitCode === 0;
    let branch = '';
    let statusText = statusResult.stdout;

    if (isRepo) {
      // First line of --porcelain -b is "## <branch>..." or "## HEAD (no branch)"
      const lines = statusResult.stdout.split('\n');
      const branchLine = lines[0] ?? '';
      const branchMatch = branchLine.match(/^## ([^.]+)/);
      branch = branchMatch ? branchMatch[1].trim() : '';
      statusText = lines.slice(1).join('\n');
    }

    const recentCommits = isRepo ? logResult.stdout.split('\n').filter((l: string) => l.trim().length > 0) : [];

    res.json({ branch, status: statusText, recentCommits, isRepo });
  });

  // ── Docker ────────────────────────────────────────────────────────────────

  // GET /api/docker/containers
  app.get('/api/docker/containers', async (_req: Request, res: Response): Promise<void> => {
    const result = await runCmd('docker ps --format "{{json .}}" 2>&1');
    if (
      result.exitCode !== 0 ||
      result.stdout.includes('command not found') ||
      result.stdout.includes('Cannot connect')
    ) {
      res.json({ available: false, containers: [] });
      return;
    }
    const containers = result.stdout
      .split('\n')
      .filter((l: string) => l.trim().startsWith('{'))
      .map((l: string) => {
        try {
          return JSON.parse(l) as unknown;
        } catch {
          return null;
        }
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
    res.json({ available: true, containers });
  });

  // POST /api/docker/containers/:id/action
  app.post('/api/docker/containers/:id/action', async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as { id: string };
    const body = req.body as { action?: string };
    const allowed = new Set(['start', 'stop', 'restart']);
    if (!body.action || !allowed.has(body.action)) {
      res.status(400).json({ error: "`action` must be 'start', 'stop', or 'restart'" });
      return;
    }
    // Validate container id: alphanumeric, dashes, underscores only
    if (!/^[a-zA-Z0-9_\-]+$/.test(id)) {
      res.status(400).json({ error: 'Invalid container id' });
      return;
    }
    const result = await runCmd(`docker ${body.action} ${id} 2>&1`);
    if (result.exitCode !== 0) {
      res.status(500).json({ error: result.stdout || result.stderr });
      return;
    }
    res.json({ ok: true });
  });

  // ── Notes & Memory ────────────────────────────────────────────────────────

  interface Note {
    id: string;
    title: string;
    content: string;
    created: string;
    updated: string;
  }

  const notesDir = path.join(os.homedir(), '.conductor');
  const notesFile = path.join(notesDir, 'notes.json');

  async function readNotes(): Promise<Note[]> {
    try {
      const raw = await fs.readFile(notesFile, 'utf-8');
      return JSON.parse(raw) as Note[];
    } catch {
      return [];
    }
  }

  async function writeNotes(notes: Note[]): Promise<void> {
    await fs.mkdir(notesDir, { recursive: true });
    await fs.writeFile(notesFile, JSON.stringify(notes, null, 2), 'utf-8');
  }

  // GET /api/notes
  app.get('/api/notes', async (_req: Request, res: Response): Promise<void> => {
    const notes = await readNotes();
    res.json({ notes });
  });

  // POST /api/notes
  app.post('/api/notes', async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { title?: string; content?: string };
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      res.status(400).json({ error: '`title` is required' });
      return;
    }
    if (typeof body.content !== 'string') {
      res.status(400).json({ error: '`content` is required' });
      return;
    }
    const notes = await readNotes();
    const now = new Date().toISOString();
    const note: Note = {
      id: crypto.randomBytes(8).toString('hex'),
      title: body.title.trim(),
      content: body.content,
      created: now,
      updated: now,
    };
    notes.push(note);
    await writeNotes(notes);
    res.json({ ok: true, note });
  });

  // PUT /api/notes/:id — update title and/or content
  app.put('/api/notes/:id', async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as { id: string };
    const body = req.body as { title?: string; content?: string };
    const notes = await readNotes();
    const idx = notes.findIndex((n) => n.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    if (typeof body.title === 'string') notes[idx].title = body.title.trim() || notes[idx].title;
    if (typeof body.content === 'string') notes[idx].content = body.content;
    notes[idx].updated = new Date().toISOString();
    await writeNotes(notes);
    res.json({ ok: true, note: notes[idx] });
  });

  // DELETE /api/notes/:id
  app.delete('/api/notes/:id', async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as { id: string };
    const notes = await readNotes();
    const filtered = notes.filter((n) => n.id !== id);
    if (filtered.length === notes.length) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    await writeNotes(filtered);
    res.json({ ok: true });
  });

  // ── Cron Jobs ─────────────────────────────────────────────────────────────

  // GET /api/cron
  app.get('/api/cron', async (_req: Request, res: Response): Promise<void> => {
    const result = await runCmd('crontab -l 2>/dev/null');
    const raw = result.stdout;
    const entries = raw
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0 && !l.startsWith('#'));
    res.json({ entries, raw });
  });

  // ── Todoist proxy ─────────────────────────────────────────────────────────
  //
  // All routes forward to https://api.todoist.com/api/v1 using the token
  // stored in the keychain.  The token is never sent to the browser.

  async function todoistProxy(
    token: string,
    path: string,
    options: RequestInit = {},
  ): Promise<{ status: number; body: unknown }> {
    let todoistRes: globalThis.Response;
    try {
      const url = `https://api.todoist.com/api/v1${path}`;
      const { headers: extraHeaders, ...restOptions } = options;
      todoistRes = await fetch(url, {
        ...restOptions,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...((extraHeaders as Record<string, string> | undefined) ?? {}),
        },
      });
    } catch (fetchErr: unknown) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      console.error('[todoist-proxy] fetch error:', msg);
      return { status: 502, body: { error: `Failed to reach Todoist: ${msg}` } };
    }

    if (todoistRes.status === 204) {
      return { status: 200, body: { ok: true } };
    }

    const rawText = await todoistRes.text().catch(() => '');

    if (!todoistRes.ok) {
      console.error(`[todoist-proxy] Todoist ${todoistRes.status} for ${path}:`, rawText.slice(0, 200));
      return {
        status: todoistRes.status,
        body: { error: `Todoist error ${todoistRes.status}: ${rawText.slice(0, 120)}` },
      };
    }

    if (!rawText) return { status: 200, body: [] };

    try {
      const data = JSON.parse(rawText);
      // API v1 wraps list responses in { results: [], next_cursor }
      if (data !== null && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).results)) {
        return { status: 200, body: (data as Record<string, unknown>).results };
      }
      return { status: 200, body: data };
    } catch {
      console.error('[todoist-proxy] JSON parse failed, raw:', rawText.slice(0, 200));
      return { status: 502, body: { error: `Todoist returned non-JSON: ${rawText.slice(0, 80)}` } };
    }
  }

  // GET /api/todoist/status
  app.get('/api/todoist/status', async (_req: Request, res: Response): Promise<void> => {
    const configured = await keychain.has('todoist', 'api_token');
    res.json({ configured });
  });

  // GET /api/todoist/projects
  app.get('/api/todoist/projects', async (_req: Request, res: Response): Promise<void> => {
    const token = await keychain.get('todoist', 'api_token');
    if (!token) {
      res.status(400).json({ error: 'Todoist not configured' });
      return;
    }

    const { status, body } = await todoistProxy(token, '/projects');
    res.status(status).json(body);
  });

  // GET /api/todoist/tasks — supports ?project_id, ?label, ?filter
  app.get('/api/todoist/tasks', async (req: Request, res: Response): Promise<void> => {
    const token = await keychain.get('todoist', 'api_token');
    if (!token) {
      res.status(400).json({ error: 'Todoist not configured' });
      return;
    }

    const query = req.query as Record<string, string>;
    const params = new URLSearchParams();
    for (const key of ['project_id', 'label', 'filter'] as const) {
      if (query[key]) params.set(key, query[key]);
    }
    const qs = params.toString() ? `?${params.toString()}` : '';

    const { status, body } = await todoistProxy(token, `/tasks${qs}`);
    res.status(status).json(body);
  });

  // POST /api/todoist/tasks — create a task
  app.post('/api/todoist/tasks', async (req: Request, res: Response): Promise<void> => {
    const token = await keychain.get('todoist', 'api_token');
    if (!token) {
      res.status(400).json({ error: 'Todoist not configured' });
      return;
    }

    const { status, body } = await todoistProxy(token, '/tasks', {
      method: 'POST',
      body: JSON.stringify(req.body),
    });
    res.status(status).json(body);
  });

  // POST /api/todoist/tasks/:id — update a task
  app.post('/api/todoist/tasks/:id', async (req: Request, res: Response): Promise<void> => {
    const token = await keychain.get('todoist', 'api_token');
    if (!token) {
      res.status(400).json({ error: 'Todoist not configured' });
      return;
    }

    const { id } = req.params as { id: string };
    const { status, body } = await todoistProxy(token, `/tasks/${id}`, {
      method: 'POST',
      body: JSON.stringify(req.body),
    });
    res.status(status).json(body);
  });

  // POST /api/todoist/tasks/:id/close — complete a task
  app.post('/api/todoist/tasks/:id/close', async (req: Request, res: Response): Promise<void> => {
    const token = await keychain.get('todoist', 'api_token');
    if (!token) {
      res.status(400).json({ error: 'Todoist not configured' });
      return;
    }

    const { id } = req.params as { id: string };
    const { status, body } = await todoistProxy(token, `/tasks/${id}/close`, {
      method: 'POST',
    });
    // Todoist returns 204 on success — normalise to a JSON ok response for the
    // frontend so it doesn't have to special-case empty bodies.
    if (status === 204) {
      res.json({ ok: true });
      return;
    }
    res.status(status).json(body);
  });

  // DELETE /api/todoist/tasks/:id — delete a task
  app.delete('/api/todoist/tasks/:id', async (req: Request, res: Response): Promise<void> => {
    const token = await keychain.get('todoist', 'api_token');
    if (!token) {
      res.status(400).json({ error: 'Todoist not configured' });
      return;
    }

    const { id } = req.params as { id: string };
    const { status, body } = await todoistProxy(token, `/tasks/${id}`, {
      method: 'DELETE',
    });
    if (status === 204) {
      res.json({ ok: true });
      return;
    }
    res.status(status).json(body);
  });

  // ── Conversations ─────────────────────────────────────────────────────────
  app.get('/api/conversations', async (_req: Request, res: Response): Promise<void> => {
    try {
      const messages = await db.getRecentMessages(200);
      res.json({ messages: messages.reverse() });
    } catch {
      res.json({ messages: [] });
    }
  });

  // ── Live Log Stream (SSE) ─────────────────────────────────────────────────
  app.get('/api/logs/stream', (req: Request, res: Response): void => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send buffered logs first
    for (const entry of logBuffer) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // ── Chat (AI) ─────────────────────────────────────────────────────────────

  const PLUGIN_CATALOG: Record<string, { desc: string; category: string; requiresAuth: boolean; authLabel?: string }> =
    {
      calculator: {
        desc: 'Evaluate mathematical expressions and unit conversions',
        category: 'Utilities',
        requiresAuth: false,
      },
      colors: {
        desc: 'Convert and manipulate colors (hex, rgb, hsl, name)',
        category: 'Utilities',
        requiresAuth: false,
      },
      cron: { desc: 'Manage and inspect system cron jobs', category: 'System', requiresAuth: false },
      crypto: { desc: 'Encrypt, decrypt, and generate cryptographic keys', category: 'Security', requiresAuth: false },
      fun: { desc: 'Jokes, trivia, dice rolls, and random fun', category: 'Utilities', requiresAuth: false },
      gcal: {
        desc: 'Read, create, and manage Google Calendar events',
        category: 'Google',
        requiresAuth: true,
        authLabel: 'Google OAuth',
      },
      gdrive: {
        desc: 'List, read, and upload files to Google Drive',
        category: 'Google',
        requiresAuth: true,
        authLabel: 'Google OAuth',
      },
      github: {
        desc: 'Manage repos, issues, PRs, and gists on GitHub',
        category: 'Developer',
        requiresAuth: true,
        authLabel: 'GitHub Token',
      },
      'github-actions': {
        desc: 'Trigger and monitor GitHub Actions CI/CD workflows',
        category: 'Developer',
        requiresAuth: true,
        authLabel: 'GitHub Token',
      },
      gmail: {
        desc: 'Read, search, send, and label Gmail messages',
        category: 'Google',
        requiresAuth: true,
        authLabel: 'Google OAuth',
      },
      hash: { desc: 'Compute MD5, SHA-1, SHA-256, and bcrypt hashes', category: 'Security', requiresAuth: false },
      homekit: {
        desc: 'Control HomeKit smart home devices and accessories',
        category: 'Smart Home',
        requiresAuth: true,
        authLabel: 'HomeKit Bridge URL',
      },
      memory: { desc: 'Store and recall information across conversations', category: 'AI', requiresAuth: false },
      n8n: {
        desc: 'Trigger n8n automation workflows via webhook',
        category: 'Automation',
        requiresAuth: true,
        authLabel: 'n8n API Key',
      },
      network: { desc: 'DNS lookup, ping, port scan, and IP geolocation', category: 'System', requiresAuth: false },
      notes: { desc: 'Create, read, update, and delete personal notes', category: 'Productivity', requiresAuth: false },
      notion: {
        desc: 'Query, create, and update Notion databases and pages',
        category: 'Productivity',
        requiresAuth: true,
        authLabel: 'Notion API Key',
      },
      slack: {
        desc: 'Send messages and read channels in Slack workspaces',
        category: 'Communication',
        requiresAuth: true,
        authLabel: 'Slack Bot Token',
      },
      spotify: {
        desc: 'Control Spotify playback and browse music catalog',
        category: 'Entertainment',
        requiresAuth: true,
        authLabel: 'Spotify OAuth',
      },
      system: {
        desc: 'CPU, memory, disk stats, processes, and shell commands',
        category: 'System',
        requiresAuth: false,
      },
      'text-tools': {
        desc: 'Transform text: case, trim, word count, slugify, base64',
        category: 'Utilities',
        requiresAuth: false,
      },
      timezone: { desc: 'Convert times between timezones worldwide', category: 'Utilities', requiresAuth: false },
      todoist: {
        desc: 'Manage Todoist tasks, projects, and priorities',
        category: 'Productivity',
        requiresAuth: true,
        authLabel: 'Todoist API Token',
      },
      translate: { desc: 'Translate text between 100+ languages', category: 'Utilities', requiresAuth: false },
      'url-tools': {
        desc: 'Parse, encode, decode, and expand shortened URLs',
        category: 'Utilities',
        requiresAuth: false,
      },
      vercel: {
        desc: 'Manage Vercel deployments, projects, and domains',
        category: 'Developer',
        requiresAuth: true,
        authLabel: 'Vercel Token',
      },
      weather: {
        desc: 'Current conditions and forecasts for any location',
        category: 'Utilities',
        requiresAuth: true,
        authLabel: 'Weather API Key',
      },
      x: {
        desc: 'Post tweets and read your X/Twitter timeline',
        category: 'Social',
        requiresAuth: true,
        authLabel: 'X API Key',
      },
    };

  let _chatConductorInstance: Conductor | null = conductorInstance ?? null;

  async function getChatConductor(): Promise<Conductor> {
    if (_chatConductorInstance) return _chatConductorInstance;
    const { Conductor: ConductorClass } = await import('../core/conductor.js');
    _chatConductorInstance = new ConductorClass(undefined, { quiet: true });
    await _chatConductorInstance.initialize();
    return _chatConductorInstance;
  }

  // POST /api/chat
  app.post('/api/chat', async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { message?: string; userId?: string };
    if (!body.message || typeof body.message !== 'string' || body.message.trim() === '') {
      res.status(400).json({ error: '`message` is required' });
      return;
    }

    const userId = body.userId && typeof body.userId === 'string' ? body.userId.trim() : 'dashboard-user';

    try {
      const c = await getChatConductor();
      const ai = c.getAIManager();

      const result = await ai.handleConversation(userId, body.message.trim());

      // Extract tool calls from the current turn: walk backwards from the end,
      // collect tool messages until we hit the user message we just added.
      const history = await c.getDatabase().getHistory(userId, 60);
      const toolCalls: Array<{ tool: string; success: boolean }> = [];
      for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg.role === 'user') break; // stop at the user message for this turn
        if (msg.role === 'tool' && msg.name) {
          toolCalls.unshift({ tool: msg.name, success: !String(msg.content ?? '').startsWith('Error') });
        }
      }

      const providerName = c.getConfig().get<string>('ai.provider') ?? 'unknown';
      const modelName = c.getConfig().get<string>('ai.model') ?? '';

      res.json({
        response: result.text,
        toolCalls,
        approvalRequired: result.approvalRequired ?? null,
        provider: providerName,
        model: modelName,
      });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // GET /api/chat/history
  app.get('/api/chat/history', async (req: Request, res: Response): Promise<void> => {
    const userId = ((req.query as Record<string, string>).userId ?? 'dashboard-user').trim();
    try {
      const c = await getChatConductor();
      const messages = await c.getDatabase().getHistory(userId, 100);
      res.json({ messages });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // DELETE /api/chat/history
  app.delete('/api/chat/history', async (req: Request, res: Response): Promise<void> => {
    const userId = ((req.query as Record<string, string>).userId ?? 'dashboard-user').trim();
    try {
      const c = await getChatConductor();
      await c.getDatabase().clearHistory(userId);
      res.json({ ok: true });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // GET /api/marketplace
  app.get('/api/marketplace', (_req: Request, res: Response): void => {
    const installedPlugins = config.get<string[]>('plugins.installed') ?? [];
    const enabledPlugins = config.get<string[]>('plugins.enabled') ?? [];

    const plugins = Object.entries(PLUGIN_CATALOG).map(([name, meta]) => ({
      name,
      ...meta,
      installed: installedPlugins.includes(name) || ALL_PLUGINS.includes(name as never),
      enabled: enabledPlugins.includes(name),
      requiredCreds: PLUGIN_REQUIRED_CREDS[name] ?? [],
    }));

    res.json({ plugins });
  });

  // ── Start — bind to 127.0.0.1 only (not 0.0.0.0) ────────────────────────
  return new Promise<DashboardServer>((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      process.stderr.write(`Dashboard running at http://127.0.0.1:${port}\n`);
      process.stderr.write(`Dashboard token stored at ${path.join(config.getConfigDir(), 'dashboard.token')}\n`);
      resolve({
        port,
        close: (): Promise<void> => new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
    server.on('error', reject);
  });
}
