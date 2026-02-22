import { Plugin } from '../manager.js';

// ── Core utilities ─────────────────────────────────────────────────────────
import { CryptoPlugin } from './crypto.js';
import { WeatherPlugin } from './weather.js';
import { SystemInfoPlugin } from './system.js';
import { URLToolsPlugin } from './url-tools.js';
import { FunPlugin } from './fun.js';
import { HashPlugin } from './hash.js';
import { TranslatePlugin } from './translate.js';
import { CalculatorPlugin } from './calculator.js';
import { ColorPlugin } from './colors.js';
import { NetworkPlugin } from './network.js';
import { TextToolsPlugin } from './text-tools.js';
import { GitHubPlugin } from './github.js';
import { TimezonePlugin } from './timezone.js';

// ── Memory & scheduling ────────────────────────────────────────────────────
import { MemoryPlugin } from './memory.js';
import { NotesPlugin } from './notes.js';
import { CronPlugin } from './cron.js';

// ── Google services ────────────────────────────────────────────────────────
import { GmailPlugin } from './gmail.js';
import { GoogleCalendarPlugin } from './gcal.js';
import { GoogleDrivePlugin } from './gdrive.js';

// ── Developer tools ────────────────────────────────────────────────────────
import { GitHubActionsPlugin } from './github-actions.js';
import { VercelPlugin } from './vercel.js';
import { N8nPlugin } from './n8n.js';

// ── Third-party services ───────────────────────────────────────────────────
import { NotionPlugin } from './notion.js';
import { XPlugin } from './x.js';
import { SpotifyPlugin } from './spotify.js';
import { HomeKitPlugin } from './homekit.js';

/** Returns all builtin plugins (not initialized — just constructed). */
export function getAllBuiltinPlugins(): Plugin[] {
  return [
    // ── Utilities (zero config, always available) ──────────────────────────
    new CryptoPlugin(),
    new WeatherPlugin(),
    new SystemInfoPlugin(),
    new URLToolsPlugin(),
    new FunPlugin(),
    new HashPlugin(),
    new TranslatePlugin(),
    new CalculatorPlugin(),
    new ColorPlugin(),
    new NetworkPlugin(),
    new TextToolsPlugin(),
    new GitHubPlugin(),
    new TimezonePlugin(),

    // ── Memory & productivity (zero config) ────────────────────────────────
    new MemoryPlugin(),
    new NotesPlugin(),
    new CronPlugin(),

    // ── Google (require Google OAuth) ──────────────────────────────────────
    new GmailPlugin(),
    new GoogleCalendarPlugin(),
    new GoogleDrivePlugin(),

    // ── Developer (require API tokens) ────────────────────────────────────
    new GitHubActionsPlugin(),
    new VercelPlugin(),
    new N8nPlugin(),

    // ── Services (require API tokens) ─────────────────────────────────────
    new NotionPlugin(),
    new XPlugin(),
    new SpotifyPlugin(),

    // ── Smart Home ─────────────────────────────────────────────────────────
    new HomeKitPlugin(),
  ];
}
