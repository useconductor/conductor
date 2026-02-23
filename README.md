# Conductor

> Your AI integration hub — 27 plugins, 150+ tools, one installer. Now with Slack, Telegram, Proactive Mode, and Persona Routing.

Conductor is a TypeScript-based AI engine that bridges the gap between LLMs (Claude, GPT-4o, Gemini, Ollama, OpenRouter) and your digital workflow. It exposes a massive library of tools—including Gmail, Spotify, GitHub, and Slack—as an **MCP server**, **Telegram bot**, or **Slack bot**.

---

## What is Conductor?

Conductor sits between you and your AI model. You send a natural language request; Conductor figures out which tools to use, chains multiple calls together, and returns a result.

**Example flow:**

```
You: "Check my unread Gmail, add any urgent items to my calendar, then notify me on Slack."

Conductor:
  1. determinePersona() → "general"
  2. gmail_list() → 3 unread emails
  3. AI identifies 1 urgent item
  4. gcal_create_event() → event created
  5. Slack message sent → "Done: 1 event added from email."
```

Conductor works the same way whether you talk to it through a Slack message, a Telegram bot, or the Claude Desktop app via MCP.

---

## What's New

- **Proactive Mode** — Autonomous reasoning loop that monitors your system and services every N minutes and acts without prompting.
- **Persona Routing** — AI-driven request classification routes to the right tool set (Coder, Social, Researcher, General).
- **Slack Integration** — Deploy Conductor as a Slack bot to bring AI tool-calling to your workspace.
- **Enhanced Google OAuth** — Streamlined authentication flow shared across Gemini, Gmail, Calendar, and Drive.
- **Advanced Tool Calling** — Improved logic for AI-driven multi-step execution.
- **Hardened Security** — AES-256-GCM keychain encryption tied to hardware IDs.

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

The 14-step interactive installer configures AI providers, Google OAuth, Slack/Telegram tokens, and Claude Desktop MCP. Every step is optional and skippable.

**Requirements:**
- Node.js >= 18.0.0
- npm

The installer checks for Node.js automatically and guides you through setup. It is fully idempotent — re-running it is safe.

---

## Supported AI Providers

| Provider | Model | Setup |
|---|---|---|
| **Anthropic Claude** | claude-3-5-sonnet, claude-3-opus | `conductor ai setup` → choose Claude |
| **OpenAI** | gpt-4o, gpt-4-turbo | `conductor ai setup` → choose OpenAI |
| **Google Gemini** | gemini-1.5-pro, gemini-flash | `conductor ai setup` → choose Gemini |
| **Ollama** | llama3, mistral, any local model | `conductor ai setup` → choose Ollama |
| **OpenRouter** | 200+ models via one API | `conductor ai setup` → choose OpenRouter |

Switch at any time:

```bash
conductor ai switch gemini
conductor ai switch claude
conductor ai switch ollama
```

**Ollama (fully local, no API key):**

Conductor connects to your local Ollama server at `http://localhost:11434` by default. Start Ollama first with `ollama serve`, then run `conductor ai setup` and choose Ollama.

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
conductor proactive start     # Start autonomous mode (every 30 min)
```

---

## Architecture

Conductor is built around four core components:

### 1. Core (`src/core/`)

- **`Conductor`** — The central orchestrator. Initializes configuration, the database, plugins, and AI on startup. Owns the proactive reasoning loop and notification dispatch.
- **`ConfigManager`** — Reads and writes `~/.conductor/config.json`. Supports dot-path key access (e.g., `plugins.enabled`). Config writes are atomic (write to `.tmp`, then rename).
- **`DatabaseManager`** — SQLite database via `sql.js`. Stores conversation history, plugin registry, activity logs, and credentials metadata.

### 2. AI Layer (`src/ai/`)

- **`AIManager`** — Loads the configured provider, runs the agent loop, and manages Persona Routing. The `handleConversation()` method drives up to 15 tool-calling iterations per request before halting.
- Provider implementations: `ClaudeProvider`, `OpenAIProvider`, `GeminiProvider`, `OllamaProvider`, `OpenRouterProvider` — each implements a common `AIProvider` interface with `complete()`, `test()`, and `parseIntent()`.

### 3. Plugin System (`src/plugins/`)

- **`PluginManager`** — Loads all builtin plugins at startup, checks `config.json` for which are enabled, and exposes `getEnabledTools()` to the AI layer.
- Each plugin exports a `Plugin` object with a name, description, and array of `PluginTool` entries. Tools declare an `inputSchema` (JSON Schema) and an async `execute()` / `handler()` function.
- Tools can declare `requiresApproval: true` — when an AI tries to call such a tool, execution pauses and the user is notified for manual approval via Slack or Telegram.

### 4. Interfaces

- **MCP Server** (`src/mcp/`) — Implements the Model Context Protocol so Conductor's tools appear natively in Claude Desktop. Runs in stdio mode.
- **Slack Bot** (`src/bot/slack.ts`) — Uses `@slack/bolt`. Listens for `@conductor` mentions and DMs.
- **Telegram Bot** (`src/bot/telegram.ts`) — Uses `telegraf`. Handles `/start`, `/approve`, `/deny`, and conversational messages.

### Agent Loop

Each conversation turn runs a loop (max 15 iterations):

```
1. User message → stored in SQLite conversation history
2. Persona detection → classifies request into coder / social / researcher / general
3. System prompt set → per-persona instructions injected
4. AI provider called with full history + available tools
5. If tool calls returned → execute each tool, append results
6. If requiresApproval tool → pause loop, notify user
7. Repeat from step 4 until AI returns a plain text response
8. Final response returned to the user interface
```

Conductor keeps the last 30 messages of conversation history per user for context.

---

## Plugins & Tools

### Zero-Config Utilities (no API key required)

| Plugin | Description | Key Tools |
|---|---|---|
| **calculator** | Math, unit conversions, date calculations | `calc_math`, `calc_convert`, `calc_date` |
| **colors** | Color conversion, palettes, contrast checking | `color_convert`, `color_palette`, `color_contrast` |
| **crypto** | Live cryptocurrency prices and market data | `crypto_price`, `crypto_trending`, `crypto_search` |
| **fun** | Jokes, cat facts, trivia, quotes | `fun_joke`, `fun_trivia`, `fun_quote` |
| **hash** | Hashing, Base64 encoding, UUID & password generation | `hash_text`, `base64_encode`, `generate_uuid`, `generate_password` |
| **network** | DNS lookup, IP geolocation, port checking | `dns_lookup`, `ip_info`, `reverse_dns` |
| **text-tools** | JSON formatting, text stats, regex, string transforms | `json_format`, `text_stats`, `regex_test`, `text_transform` |
| **timezone** | World clock, timezone conversion | `time_now`, `time_convert` |
| **translate** | Free translation between languages | `translate_text` |
| **url-tools** | Expand short URLs, check status, inspect headers | `url_expand`, `url_status`, `url_headers` |
| **weather** | Current weather and 7-day forecasts (Open-Meteo) | `weather_current`, `weather_forecast` |
| **system** | CPU, memory, disk, network, top processes | `system_info`, `system_processes`, `system_network` |
| **github** | Public GitHub user and repo data | `github_user`, `github_repo`, `github_trending` |

### Memory & Scheduling (Zero-Config)

| Plugin | Description | Key Tools |
|---|---|---|
| **memory** | Long-term memory stored in SQLite | `memory_store`, `memory_recall`, `memory_forget`, `search_past_conversations` |
| **notes** | Local markdown notes in `~/.conductor/notes/` | create, list, search, tag, link, pin, archive |
| **cron** | Schedule recurring tasks with natural language | `cron_schedule`, `cron_list`, `cron_cancel`, `cron_run_now` |

### Google Services (OAuth required)

| Plugin | Description | Key Tools |
|---|---|---|
| **gmail** | Read, search, and send Gmail | `gmail_list`, `gmail_search`, `gmail_send`, `gmail_reply` |
| **gcal** | Manage Google Calendar events | `gcal_list_events`, `gcal_create_event`, `gcal_update_event`, `gcal_delete_event` |
| **gdrive** | Browse, search, read, and upload Drive files | `gdrive_list`, `gdrive_search`, `gdrive_read`, `gdrive_upload_text` |

### Developer Tools (API token required)

| Plugin | Description | Key Tools |
|---|---|---|
| **github_actions** | Full CI/CD, PRs, issues, releases | workflow runs, PRs, issues, releases, code search |
| **vercel** | Manage deployments, projects, domains, env vars | `vercel_deployments`, `vercel_projects`, `vercel_domains`, `vercel_env` |
| **n8n** | Automation workflow management via webhooks | manage workflows and webhook triggers |

### Third-Party Services

| Plugin | Description | Key Tools |
|---|---|---|
| **notion** | Read and write Notion databases | query databases, create/update pages |
| **spotify** | Full playback control and library management | `spotify_current`, `spotify_play`, `spotify_queue`, `spotify_playlists`, `spotify_recommendations` |
| **x** | Post tweets, read timeline, manage lists | post, search, manage followers |
| **homekit** | Control HomeKit devices via Homebridge | `homekit_toggle`, `homekit_set`, `homekit_rooms`, `homekit_accessories` |

---

## Example Prompts

```
"What's the weather in Berlin this week?"
"Translate this paragraph to Japanese."
"Find my 3 latest unread emails and summarize them."
"Schedule a meeting with Alex tomorrow at 2pm and add it to my calendar."
"Play my Discover Weekly on Spotify and queue 5 more similar tracks."
"Search GitHub for trending TypeScript projects and give me the top 5."
"Generate a UUID and a secure 20-character password."
"Check if my website is responding and show me the response headers."
"Show me my top CPU-consuming processes."
"Convert 250 USD to EUR."
```

---

## Proactive Mode

Proactive Mode starts an autonomous reasoning loop that runs every N minutes without any user prompts.

```bash
conductor proactive start              # Run every 30 minutes (default)
conductor proactive start --interval 10  # Run every 10 minutes
```

**What happens each cycle:**

1. **Context gathering** — Conductor collects system stats (CPU, RAM, disk), recent activity, unread Gmail count, and upcoming calendar events.
2. **AI reasoning** — The context is sent to your AI provider with instructions to identify problems and take action.
3. **Approval gate** — Sensitive actions can be held for human approval before execution.
4. **Notification** — Results are sent to you via Slack or Telegram.
5. **Activity logging** — All cycle results are saved to the database.

**Example:** Proactive Mode might notice your disk is 90% full, archive old logs automatically, and send you a Slack message summarizing what it did.

---

## Persona Routing

When you send a message, Conductor classifies it into one of four personas before selecting tools:

| Persona | Triggers | Tool Focus |
|---|---|---|
| **Coder** | Code writing, debugging, git, bash, file management | github_actions, vercel, system, hash, text-tools |
| **Social** | Posting tweets, Slack/Telegram messages, email replies | x, slack, telegram, gmail |
| **Researcher** | Web search, page reading, summarization | weather, translate, url-tools, network |
| **General** | Calendar, emails, small talk, everything else | gcal, gmail, memory, notes, cron |

Routing happens automatically. You don't need to specify a persona — Conductor infers it from your message using a fast AI classification call before the main conversation loop begins.

---

## Approval Gates

Tools can require human approval before execution. When an AI attempts to use an approval-gated tool:

1. The agent loop pauses immediately.
2. A notification is sent to you via Slack or Telegram with the tool name and arguments.
3. You reply with `/approve <tool_call_id>` to allow it, or `/deny <tool_call_id>` to block it.
4. Conductor resumes the conversation loop with the result.

This is especially useful for Proactive Mode, where the AI acts autonomously — approval gates ensure destructive or irreversible actions always go through you first.

---

## CLI Reference

```bash
# AI provider management
conductor ai setup                   # Interactive AI provider configuration
conductor ai switch <provider>       # Switch to a different AI provider (claude, openai, gemini, ollama, openrouter)
conductor ai test                    # Test the current AI provider connection

# MCP server (Claude Desktop)
conductor mcp setup                  # Configure MCP for Claude Desktop
conductor mcp status                 # Show MCP server status
conductor mcp start                  # Start MCP server in stdio mode
conductor mcp remove                 # Remove MCP configuration

# Plugin management
conductor plugins list               # List all plugins with enabled/disabled status
conductor plugins enable <name>      # Enable a plugin
conductor plugins disable <name>     # Disable a plugin

# Proactive Mode
conductor proactive start            # Start autonomous reasoning loop (default: every 30 min)
conductor proactive start -i 15      # Run every 15 minutes

# Authentication
conductor auth google                # Browser-based Google OAuth
conductor auth google -f <path>      # Import Google credentials from JSON file

# Bots
conductor slack setup                # Configure Slack Bot and App tokens
conductor slack start                # Start Slack bot
conductor telegram setup             # Configure Telegram bot token
conductor telegram start             # Start Telegram bot

# Status
conductor status                     # Check overall setup and plugin health
```

---

## Configuration

All configuration lives in `~/.conductor/`:

```
~/.conductor/
├── config.json          # Main config (AI provider, enabled plugins, settings)
├── conductor.db         # SQLite database (conversation history, memory, activity logs)
├── keychain/            # AES-256-GCM encrypted credentials
├── notes/               # Markdown notes (notes plugin)
├── scheduler.json       # Scheduled cron tasks
└── logs/                # Activity logs
```

**Key management commands:**

```bash
conductor auth google           # Add Google credentials (Gmail, Calendar, Drive)
conductor ai setup              # Add AI provider API keys
conductor plugins enable slack  # Enable Slack (will prompt for tokens)
```

No raw secrets are stored in `config.json`. All credentials are encrypted in `~/.conductor/keychain/` using AES-256-GCM with a key derived from your machine's hardware ID.

### `config.json` structure

```json
{
  "user": { "id": "...", "name": "...", "role": "..." },
  "ai": {
    "provider": "claude",
    "model": "claude-3-5-sonnet-20241022"
  },
  "plugins": {
    "installed": ["gmail", "spotify", "github"],
    "enabled": ["gmail", "spotify"]
  },
  "security": {
    "filesystem_access": { "enabled": false, "allowed_paths": [] },
    "system_commands": false,
    "desktop_control": false
  }
}
```

---

## Security

Credentials are encrypted using **AES-256-GCM**. The master key is derived via `scrypt` from your machine's hardware ID, ensuring secrets only decrypt on the machine that created them.

- **Keychain location**: `~/.conductor/keychain/`
- **Permissions**: `0700`
- **No raw secrets** stored in `config.json`
- **Approval gates** for sensitive proactive actions (configurable)

Report vulnerabilities privately via [GitHub Security Advisories](https://github.com/thealxlabs/conductor/security/advisories/new) — do not open a public issue.

---

## Development

**Requirements:** Node.js >= 18, TypeScript 5.x

```bash
npm run dev    # Start in watch mode (tsx watch)
npm run build  # Transpile TypeScript to dist/
npm start      # Run production build
npm test       # Run all tests (skips auth-required plugins)
npm run test:full  # Run all tests including auth plugins
```

### Project Structure

```
src/
├── ai/           # AI provider implementations (Claude, OpenAI, Gemini, Ollama, OpenRouter)
├── bot/          # Slack and Telegram bot interfaces
├── cli/          # Commander.js CLI commands
├── config/       # OAuth credential helpers
├── core/         # Conductor orchestrator, ConfigManager, DatabaseManager
├── mcp/          # MCP server and tool registration
├── plugins/      # Plugin manager + 27 builtin plugins
├── security/     # AES-256-GCM keychain implementation
└── utils/        # Shared utilities
```

### Adding a Plugin

Implement the `Plugin` interface in `src/plugins/builtin/` and register it in `src/plugins/builtin/index.ts`. It will automatically appear across all interfaces (MCP, Slack, Telegram).

```typescript
import { Plugin, PluginTool, ToolResult } from '../types';

export const myPlugin: Plugin = {
  name: 'my-plugin',
  description: 'What this plugin does',
  tools: [
    {
      name: 'my_tool',
      description: 'What this tool does',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Input value' },
        },
        required: ['query'],
      },
      execute: async (args: { query: string }): Promise<ToolResult> => {
        // your logic here
        return { success: true, data: `Result for: ${args.query}` };
      },
    },
  ],
};
```

Then add it to `src/plugins/builtin/index.ts`:

```typescript
import { myPlugin } from './my-plugin';

export const builtinPlugins: Plugin[] = [
  // ... existing plugins
  myPlugin,
];
```

Your plugin will be available via `conductor plugins enable my-plugin` and will show up in all interfaces.

---

## License

[Apache-2.0](LICENSE) — [Alexander Wondwossen](https://github.com/thealxlabs) / TheAlxLabs
