# Conductor

> Your AI integration hub — 25 plugins, 146 tools, one installer.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-blue.svg)](https://typescriptlang.org)

Conductor is a TypeScript-based AI integration hub that connects multiple AI providers with external services and exposes everything as an MCP server or Telegram bot. One install — Claude, GPT-4o, Gemini, Ollama, Gmail, Spotify, GitHub Actions, Vercel, n8n, and more, all in one place.

---

## Install

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/thealxlabs/conductor/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/thealxlabs/conductor/main/install.ps1 | iex
```

**From source:**

```bash
git clone https://github.com/thealxlabs/conductor.git
cd conductor
bash install.sh
```

The installer walks you through 14 steps — AI provider, Google OAuth, third-party services, Telegram, and Claude Desktop MCP. Every step is optional and skippable. Run it again at any time to add more integrations.

---

## What it does

```
┌─────────────────────────────────────────────────────┐
│                   Your AI Provider                  │
│         Claude · GPT-4o · Gemini · Ollama           │
└──────────────────────┬──────────────────────────────┘
                       │
              ┌────────▼────────┐
              │    Conductor    │
              │  25 plugins     │
              │  146 tools      │
              └───┬─────────┬───┘
                  │         │
     ┌────────────▼──┐   ┌──▼────────────────┐
     │  Telegram Bot │   │   MCP Server      │
     │  ask anything │   │  Claude Desktop   │
     └───────────────┘   └───────────────────┘
```

---

## Quick start

```bash
conductor status              # Check your setup
conductor ai test             # Test AI connection
conductor telegram start      # Start Telegram bot
conductor mcp start           # Start MCP server for Claude Desktop
conductor plugins list        # Browse all plugins
```

---

## Plugins

### Zero config — no API keys needed

| Plugin | Tools | What it does |
|--------|------:|--------------|
| `crypto` | 3 | Live crypto prices, trending coins, search (CoinGecko) |
| `weather` | 2 | Current weather + 7-day forecast (Open-Meteo, free) |
| `system` | 3 | CPU, RAM, disk, network stats, running processes |
| `url-tools` | 3 | Expand short links, check HTTP status, inspect headers |
| `fun` | 5 | Jokes, cat facts, trivia, quotes, random numbers |
| `hash` | 5 | SHA-256/512, MD5, Base64, UUID, password generator |
| `translate` | 1 | 50+ languages via MyMemory |
| `calculator` | 3 | Math expressions, unit conversion, date arithmetic |
| `colors` | 3 | Hex/RGB/HSL conversion, palette generation, WCAG contrast |
| `network` | 3 | DNS lookup, IP geolocation, reverse DNS |
| `text-tools` | 4 | JSON formatting, word stats, regex tester, case transforms |
| `github` | 4 | Public profiles, repos, trending, code search |
| `timezone` | 2 | World clock, timezone converter |
| `notes` | 8 | Local markdown notes with search, tags, backlinks, templates |
| `cron` | 6 | Schedule tasks with natural language — "every day at 9am" |
| `memory` | 4 | Semantic long-term memory across conversations |

### Google services — require Google OAuth

One OAuth flow covers all three. Run `conductor ai setup google` or paste a token during install.

| Plugin | Tools | What it does |
|--------|------:|--------------|
| `gmail` | 7 | List, read, search, send, reply, mark read, trash |
| `gcal` | 6 | List calendars/events, create, update, delete |
| `gdrive` | 7 | List, search, read Docs/Sheets as text, upload, delete |

### Developer tools — require API tokens

| Plugin | Tools | Setup |
|--------|------:|-------|
| `github_actions` | 15 | Workflow runs, PRs, issues, releases, notifications, code search |
| `vercel` | 14 | Deployments, projects, env vars, domains, build logs |
| `n8n` | 12 | Trigger workflows, inspect executions, fire webhooks |

### Third-party services — require API tokens

| Plugin | Tools | Setup |
|--------|------:|-------|
| `notion` | 6 | Search, read, create, append pages; query databases |
| `x` | 6 | Search tweets, timelines, post, delete, like |
| `spotify` | 14 | Playback, search, playlists, queue, recommendations, top tracks |

---

## Notable tools

### Notes (`notes_*`)

Local markdown notes with zero dependencies. Full-text search, `#hashtag` auto-detection, `[[wiki-link]]` backlinks, and 5 built-in templates: meeting, todo, idea, project, and daily journal.

```
notes_create   — New note, optionally from a template
notes_read     — Read by ID or fuzzy title match
notes_update   — Append or replace content, add tags
notes_search   — Full-text search with tag + date filters
notes_list     — Browse all notes sorted by update time
notes_daily    — Get or create today's journal entry
notes_stats    — Word counts, top tags, recent activity
```

### Scheduler (`cron_*`)

Natural language scheduling that persists across restarts. No cron syntax needed.

```
"every day at 9am"        → daily at 9:00
"every Monday at 8am"     → weekly
"in 30 minutes"           → one-shot
"every weekday at 6pm"    → Mon–Fri
"every 15 minutes"        → high-frequency recurring
"every month on the 1st"  → monthly
```

Fires webhooks or logs messages on trigger. Tracks run history (last 50 per task), supports pause/resume without deleting, and auto-deletes after N runs.

### Spotify (`spotify_*`)

Full playback control with auto-refreshing tokens.

```
spotify_play            — Play by name, URI, album, or playlist
spotify_recommendations — Seeded by your listening history, tunable by energy/mood/BPM
spotify_top_tracks      — Your stats across short (4wk), medium (6mo), long term
spotify_queue           — Add tracks by name or URI
spotify_devices         — List and target specific playback devices
```

### GitHub Actions (`gh_*`)

Full CI/CD management without opening a browser.

```
gh_my_repos          — Your repos sorted by last push
gh_workflow_runs     — Recent runs with status, duration, trigger
gh_trigger_workflow  — Fire workflow_dispatch with custom inputs
gh_run_status        — Per-job, per-step breakdown
gh_cancel_run        — Cancel in-progress builds
gh_create_pr         — Open pull requests
gh_merge_pr          — Merge with squash/rebase/merge
gh_create_release    — Tag + publish with auto-generated notes
gh_notifications     — Unread — mentions, reviews needed, CI failures
gh_code_search       — Search code across all repos
```

### n8n (`n8n_*`)

Every workflow you've built in n8n becomes an AI-callable tool.

```
n8n_list_workflows    — All workflows with active/inactive status
n8n_trigger_webhook   — Fire webhook-triggered workflows with payloads
n8n_execute_workflow  — Trigger any workflow directly
n8n_list_executions   — Recent runs with status and timing
n8n_get_execution     — Full execution detail + output data
n8n_retry_execution   — Retry failed runs
n8n_health            — Instance status and queue depth
```

---

## Plugin management

```bash
conductor plugins list                    # All plugins with enable/disable status
conductor plugins enable spotify          # Enable a plugin
conductor plugins disable spotify         # Disable a plugin
conductor plugins config n8n api_key KEY  # Set a credential for a plugin
conductor plugins test gmail              # Verify a plugin's connection
```

---

## AI providers

```bash
conductor ai setup          # Interactive setup wizard
conductor ai setup google   # Google OAuth (covers Gemini + all Google plugins)
conductor ai test           # Test current provider
conductor ai switch openai  # Switch providers
```

Supported: `claude`, `openai`, `gemini`, `ollama`, `openrouter`

---

## Telegram bot

```bash
conductor telegram setup   # Configure bot token
conductor telegram start   # Start bot
conductor telegram stop    # Stop bot
```

Once running, just talk to it. The AI has access to every enabled plugin. `/tools` lists what's available.

---

## MCP server (Claude Desktop)

```bash
conductor mcp setup   # Auto-configure Claude Desktop config
conductor mcp start   # Start MCP server
```

After setup, every enabled plugin tool appears inside Claude Desktop. The installer backs up your existing Claude Desktop config before modifying it.

---

## Security

All credentials are encrypted with **AES-256-GCM**. The master key is derived via scrypt from your machine's hardware ID — credentials only decrypt on the machine that created them. The keychain lives at `~/.conductor/keychain/` with `0700` permissions.

```
~/.conductor/
├── config.json           # Plugin settings (no secrets here)
├── keychain/             # Encrypted credentials (0700)
│   ├── google.access_token.enc
│   ├── spotify.access_token.enc
│   └── ...
├── notes/                # Your markdown notes
│   ├── .index.json
│   └── *.md
└── scheduler.json        # Scheduled task state
```

---

## Adding a plugin

Create `src/plugins/builtin/myplugin.ts` implementing the `Plugin` interface:

```typescript
import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';

export class MyPlugin implements Plugin {
  name = 'myplugin';
  description = 'What it does';
  version = '1.0.0';

  async initialize(conductor: Conductor): Promise<void> {}
  isConfigured(): boolean { return true; }

  getTools(): PluginTool[] {
    return [
      {
        name: 'my_tool',
        description: 'What this tool does',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'The input' },
          },
          required: ['input'],
        },
        handler: async ({ input }: any) => {
          return { result: `Got: ${input}` };
        },
      },
    ];
  }
}
```

Then register it in `src/plugins/builtin/index.ts`. It will automatically appear in both the MCP server and Telegram bot.

---

## Development

```bash
npm run dev    # Watch mode
npm run build  # Compile TypeScript → dist/
npm start      # Run compiled output
```

---

## License

[MIT](LICENSE) — [Alexander Wondwossen](https://github.com/thealxlabs) / TheAlxLabs
