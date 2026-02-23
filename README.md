# Conductor

> Your AI integration hub — 27 plugins, 150+ tools, one installer. Now with Slack, Telegram, and Proactive Mode.

Conductor is a TypeScript-based AI engine that bridges the gap between LLMs (Claude, GPT-4o, Gemini, Ollama, OpenRouter) and your digital workflow. It exposes a massive library of tools—including Gmail, Spotify, GitHub, Slack, and HomeKit—as an **MCP server**, **Telegram bot**, or **Slack bot**.

---

## How It Works

1. **Configure an AI provider** — Claude, GPT-4o, Gemini, Ollama, or OpenRouter
2. **Enable plugins** — pick from 27 built-ins covering Google, GitHub, Spotify, Notion, and more
3. **Choose your interface** — talk to it via Slack, Telegram, or wire it into Claude Desktop via MCP
4. **Use natural language** — Conductor routes your request to the right tools and chains calls automatically

**Example flow:**

```
You (Slack): "Summarize my unread emails and add any meetings to my calendar"
    └─> gmail_list + gmail_read  →  AI summarizes  →  gcal_create_event
```

---

## What's New

* **Proactive Mode**: An autonomous reasoning loop that monitors your context and acts without you asking
* **Persona Routing**: Automatically switches between Coder, Social Manager, Researcher, and General personas based on your request
* **Slack Integration**: Deploy Conductor as a Slack bot to bring AI tool-calling to your workspace
* **Enhanced Google OAuth**: Streamlined authentication shared across Gemini, Gmail, Calendar, and Drive
* **Hardened Security**: AES-256-GCM keychain encryption tied to your machine's hardware ID

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

The interactive installer configures your AI provider, Google OAuth, Slack/Telegram tokens, and Claude Desktop MCP. Every step is optional and skippable.

---

## Interface Options

```
┌─────────────────────────────────────────────────────┐
│                   Your AI Provider                  │
│    Claude · GPT-4o · Gemini · Ollama · OpenRouter   │
└──────────────────────┬──────────────────────────────┘
                       │
              ┌────────▼────────┐
              │    Conductor    │
              │  27 Plugins     │
              │  150+ Tools     │
              └──┬─────┬─────┬──┘
                 │     │     │
      ┌──────────▼─┐ ┌─▼─────▼──┐ ┌──────────▼──┐
      │  Slack Bot │ │ Telegram │ │  MCP Server │
      └────────────┘ └──────────┘ └─────────────┘
```

---

## Quick Start

```bash
conductor status              # Check setup and plugin health
conductor slack start         # Launch the Slack bot
conductor telegram start      # Launch the Telegram bot
conductor mcp setup           # Auto-configure Claude Desktop
conductor ai switch gemini    # Swap your primary AI model
conductor proactive start     # Start the autonomous loop
```

---

## Supported AI Providers

| Provider | Setup Command | Notes |
|---|---|---|
| **Claude** (Anthropic) | `conductor ai setup` → choose Claude | Requires Anthropic API key |
| **GPT-4o** (OpenAI) | `conductor ai setup` → choose OpenAI | Requires OpenAI API key |
| **Gemini** (Google) | `conductor ai setup` → choose Gemini | Works with Google OAuth or API key |
| **Ollama** (Local) | `conductor ai setup` → choose Ollama | Runs locally, no key needed |
| **OpenRouter** | `conductor ai setup` → choose OpenRouter | Access to 100+ models via one key |

Switch providers any time:

```bash
conductor ai switch claude
conductor ai switch openai
conductor ai switch gemini
conductor ai switch ollama
conductor ai switch openrouter
```

---

## Plugins & Tools

27 built-in plugins, organized by category. Enable or disable any plugin:

```bash
conductor plugins list
conductor plugins enable spotify
conductor plugins disable x
```

### Zero-Config Utilities (No API Key Required)

| Plugin | Description | Key Tools |
|---|---|---|
| `calculator` | Math expressions, unit conversions, date calculations | `calc_math`, `calc_convert`, `calc_date` |
| `colors` | Color conversion (hex/rgb/hsl), palette generation, contrast checking | `color_convert`, `color_contrast`, `color_palette` |
| `crypto` | Live cryptocurrency prices, market data, trending coins | `crypto_price`, `crypto_trending`, `crypto_search` |
| `fun` | Jokes, cat facts, trivia, random numbers, quotes | `fun_joke`, `fun_cat_fact`, `fun_trivia`, `fun_quote` |
| `hash` | Hashing, encoding, UUID and password generation | `hash_text`, `base64_encode`, `generate_uuid`, `generate_password` |
| `network` | DNS lookup, IP geolocation, public IP, reverse DNS | `dns_lookup`, `ip_info`, `reverse_dns` |
| `system` | CPU, memory, disk, network stats, running processes | `system_info`, `system_processes`, `system_network` |
| `text-tools` | JSON formatting, text stats, regex testing, string manipulation | `json_format`, `text_stats`, `regex_test`, `text_transform` |
| `timezone` | World clock, timezone conversions, current time in any city | `time_now`, `time_convert` |
| `translate` | Translate text between any languages (free, no key) | `translate_text` |
| `url-tools` | Expand short links, check URL status, extract headers | `url_expand`, `url_status`, `url_headers` |
| `weather` | Current weather and forecasts via Open-Meteo (no key) | `weather_current`, `weather_forecast` |
| `github` | Public GitHub repos, user info, trending (no token needed) | `github_user`, `github_repo`, `github_trending` |

### Memory & Productivity (Zero Config)

| Plugin | Description | Key Tools |
|---|---|---|
| `memory` | Long-term memory — store and recall facts across conversations | `memory_store`, `memory_recall`, `memory_list`, `memory_forget` |
| `notes` | Local markdown notes — read, write, search offline | `notes_create`, `notes_read`, `notes_search`, `notes_daily` |
| `cron` | Persistent scheduled tasks with natural language time parsing | `cron_schedule`, `cron_list`, `cron_cancel`, `cron_history` |

### Google Services (Requires Google OAuth)

Run `conductor auth google` to authenticate once. All three plugins share the same token.

| Plugin | Description | Key Tools |
|---|---|---|
| `gmail` | Read, search, send, and manage Gmail | `gmail_list`, `gmail_read`, `gmail_search`, `gmail_send`, `gmail_reply`, `gmail_trash` |
| `gcal` | Read and manage Google Calendar events | `gcal_list_events`, `gcal_create_event`, `gcal_update_event`, `gcal_delete_event` |
| `gdrive` | List, search, read, and upload files in Google Drive | `gdrive_list`, `gdrive_search`, `gdrive_read`, `gdrive_upload_text` |

### Developer Tools (Require API Tokens)

| Plugin | Description | Key Tools |
|---|---|---|
| `github_actions` | Trigger CI/CD, check logs, manage PRs and issues (requires GitHub token) | `gh_workflow_runs`, `gh_trigger_workflow`, `gh_create_pr`, `gh_list_issues`, `gh_code_search` |
| `vercel` | Manage deployments, check logs, configure environments | `vercel_deployments`, `vercel_redeploy`, `vercel_logs`, `vercel_env_list` |
| `n8n` | Execute workflows, manage tasks, check execution history | `n8n_workflows`, `n8n_trigger`, `n8n_executions`, `n8n_health` |

### Third-Party Services (Require API Tokens)

| Plugin | Description | Key Tools |
|---|---|---|
| `notion` | Read, search, and create Notion pages and databases | `notion_search`, `notion_read_page`, `notion_create_page`, `notion_query_database` |
| `spotify` | Playback control, playlists, recommendations | `spotify_now_playing`, `spotify_play`, `spotify_search`, `spotify_recommendations` |
| `x` | Post tweets, search X, get timelines and user info | `x_post_tweet`, `x_search`, `x_get_timeline` |
| `homekit` | Control HomeKit smart home devices via Homebridge | `homekit_accessories`, `homekit_set`, `homekit_toggle`, `homekit_rooms` |

---

## Example Prompts

```
"What's my CPU usage? If it's over 80%, send me a Telegram alert."
"Summarize my unread emails and add any meetings to my Google Calendar."
"Play my top tracks on Spotify and tell me what's currently on."
"Search GitHub for trending TypeScript repos and open the top one."
"Schedule a daily reminder at 9am to review my Notion task database."
"What's the weather in Tokyo and what time is it there right now?"
```

---

## Proactive Mode

Proactive Mode runs an autonomous reasoning loop in the background. At each interval, Conductor gathers context about your environment and decides what to do — without you having to ask.

```bash
conductor proactive start                  # Default: every 30 minutes
conductor proactive start --interval 15   # Every 15 minutes
```

**What happens each cycle:**

1. **Context gathering** — system stats, recent activity, unread emails, upcoming calendar events
2. **Autonomous reasoning** — AI analyzes context and decides if action is needed
3. **Tool execution** — runs approved tools automatically
4. **Notification** — sends a Telegram or Slack message summarizing actions taken

Tools marked `requiresApproval: true` are paused until you explicitly approve them via Telegram or Slack.

---

## Persona Routing

Conductor automatically selects the best AI persona based on what you ask:

| Persona | Triggered by | Focus |
|---|---|---|
| **Coder** | Code, debugging, git, bash, file tasks | Clean, well-documented code and shell commands |
| **Social Manager** | X/Twitter, Slack, Telegram, communications | Engaging and professional updates |
| **Researcher** | Web search, summaries, factual questions | Thorough investigation and sourcing |
| **General** | Everything else | Helpful, concise, tool-capable assistant |

Routing is automatic — Conductor asks the AI to classify your intent and switches system prompts before responding. The same 150+ tools are available in every persona.

---

## CLI Reference

```bash
# AI Provider
conductor ai setup                        # Interactive AI configuration
conductor ai switch <provider>            # Switch provider (claude/openai/gemini/ollama/openrouter)
conductor ai test                         # Test the current AI provider

# Authentication
conductor auth google                     # Browser-based Google OAuth
conductor google                          # Alias for auth google

# MCP (Claude Desktop)
conductor mcp setup                       # Configure Claude Desktop MCP
conductor mcp status                      # Show MCP server status
conductor mcp start                       # Start MCP server in stdio mode
conductor mcp remove                      # Remove MCP configuration

# Telegram Bot
conductor telegram setup                  # Configure Telegram bot token
conductor telegram start                  # Start the Telegram bot

# Slack Bot
conductor slack setup                     # Configure Slack Bot and App tokens
conductor slack start                     # Start the Slack bot

# Plugins
conductor plugins list                    # List all plugins and their status
conductor plugins enable <name>           # Enable a plugin
conductor plugins disable <name>          # Disable a plugin

# Autonomous Mode
conductor proactive start [--interval N]  # Start proactive loop (N = minutes)

# Status
conductor status                          # Check setup and plugin health
```

---

## Configuration

All configuration lives in `~/.conductor/`:

```
~/.conductor/
├── config.json          # AI provider, plugin list, feature flags
├── keychain/            # AES-256-GCM encrypted credentials (chmod 0700)
│   ├── google           # Google OAuth tokens
│   ├── github           # GitHub personal access token
│   ├── spotify          # Spotify OAuth tokens
│   └── ...              # One file per service
├── conductor.db         # SQLite: activity logs, memory, messages
└── notes/               # Local markdown notes (notes plugin)
```

**Key management:**

```bash
conductor ai setup          # Store AI provider API key
conductor auth google        # Store Google OAuth tokens
conductor plugins enable x   # Prompts for X/Twitter API keys
```

No raw secrets are stored in `config.json`. Everything sensitive goes through the hardware-locked keychain.

---

## Security

Credentials are encrypted using **AES-256-GCM**. The master key is derived via `scrypt` from your machine's hardware ID, so secrets only decrypt on the machine that created them.

* **Keychain location**: `~/.conductor/keychain/`
* **Permissions**: `0700` (owner only)
* **Key derivation**: `scrypt` from hardware ID
* No raw secrets in `config.json`

---

## Development

```bash
npm run dev    # Start in watch mode
npm run build  # Transpile TypeScript
npm start      # Run production build
```

### Writing a Plugin

Implement the `Plugin` interface and register it in `src/plugins/builtin/index.ts`:

```typescript
// src/plugins/builtin/my-plugin/index.ts
import { Plugin, ToolDefinition } from '../../types';

export const myPlugin: Plugin = {
  name: 'my-plugin',
  description: 'Does something useful',
  tools: [
    {
      name: 'my_tool',
      description: 'Performs an action',
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'The input value' },
        },
        required: ['input'],
      },
      handler: async ({ input }) => {
        return { result: `Processed: ${input}` };
      },
    },
  ],
};
```

Register it:

```typescript
// src/plugins/builtin/index.ts
import { myPlugin } from './my-plugin';

export const builtinPlugins: Plugin[] = [
  // ...existing plugins,
  myPlugin,
];
```

The plugin will automatically appear across all interfaces — MCP, Slack, and Telegram.

---

## License

[MIT](LICENSE) — [Alexander Wondwossen](https://github.com/thealxlabs) / TheAlxLabs
