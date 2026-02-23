# Conductor

> Your AI integration hub — 27+ plugins, 150+ tools, one installer. Now with Slack and Telegram.

Conductor is a TypeScript-based AI engine that bridges the gap between LLMs (Claude, GPT-4o, Gemini, Ollama, OpenRouter) and your digital workflow. It exposes a massive library of tools—including Gmail, Spotify, GitHub, and Slack—as an **MCP server**, **Telegram bot**, or **Slack bot**.

---

## What is Conductor?

Conductor sits between your AI model and your apps. You describe what you want in plain language; Conductor figures out which tools to call, executes them (chaining multiple steps if needed), and hands the results back through whichever interface you're using.

```
You: "Play something chill on Spotify and add today's standup to my calendar"
 └─► Conductor routes to Persona: General
      ├─► spotify.play_track(...)
      └─► gcal.create_event(...)
```

**End-to-end flow:**

1. You send a message via Slack, Telegram, or an MCP-connected app (e.g. Claude Desktop)
2. Conductor's **Router Agent** classifies your intent and picks the right AI persona
3. The selected persona calls the relevant plugin tools (multi-step, with full tool-call looping)
4. Results are streamed back to you

---

## What's New

* **Slack Integration**: Deploy Conductor as a Slack bot to bring AI tool-calling to your workspace.
* **Proactive Mode**: An autonomous background loop that checks your services, summarizes events, and pushes notifications.
* **Persona Routing**: Automatically selects the best AI persona (Coder, Social, Researcher, General) for each request.
* **Enhanced Google OAuth**: Streamlined authentication flow shared across Gemini, Gmail, Calendar, and Drive.
* **Advanced Tool Calling**: Improved logic for AI-driven multi-step execution.
* **Hardened Security**: Enhanced AES-256-GCM keychain encryption tied to hardware IDs.

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

The interactive installer configures AI providers, Google OAuth, Slack/Telegram tokens, and Claude Desktop MCP. Every step is optional and skippable.

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
              │  27+ Plugins    │
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
conductor ai setup            # Configure your AI provider
conductor ai switch gemini    # Swap your primary AI model
```

---

## Supported AI Providers

| Provider | Setup Command | Notes |
| --- | --- | --- |
| **Claude** (Anthropic) | `conductor ai setup` → select Claude | Recommended for MCP use |
| **GPT-4o** (OpenAI) | `conductor ai setup` → select OpenAI | |
| **Gemini** (Google) | `conductor auth google` then `conductor ai setup` | Shares Google OAuth |
| **Ollama** (local) | `conductor ai setup` → select Ollama | Runs fully offline |
| **OpenRouter** | `conductor ai setup` → select OpenRouter | Access many models via one key |

---

## Plugins & Tools

### Zero-Config Utilities (always available)

| Plugin | Description |
| --- | --- |
| `crypto` | Live cryptocurrency prices and market data |
| `weather` | Local weather forecasts |
| `system` | CPU, RAM, disk, and process information |
| `url-tools` | URL shortening, expansion, and metadata |
| `fun` | Random jokes, facts, and trivia |
| `hash` | MD5, SHA-256, and other hash functions |
| `translate` | Text translation between languages |
| `calculator` | Math expressions and unit conversions |
| `colors` | Color format conversion (HEX, RGB, HSL) |
| `network` | IP lookup, DNS, ping, and port checks |
| `text-tools` | Word count, case conversion, diff, and more |
| `github` | GitHub repo search, issues, and PRs |
| `timezone` | Time conversion across timezones |

### Memory & Productivity (zero config)

| Plugin | Description |
| --- | --- |
| `memory` | Persistent key-value store across conversations |
| `notes` | Local Markdown note creation and search |
| `cron` | Schedule tasks to run at recurring intervals |

### Google Services (require Google OAuth)

```bash
conductor auth google    # Authenticate once for all Google plugins
```

| Plugin | Description |
| --- | --- |
| `gmail` | Read, search, send, and reply to emails |
| `gcal` | Create, list, and update calendar events |
| `gdrive` | Browse, search, and download Drive files |

### Developer Tools (require API tokens)

| Plugin | Description |
| --- | --- |
| `github_actions` | Trigger CI/CD workflows and check run logs |
| `vercel` | List deployments, check build status, manage projects |
| `n8n` | Execute n8n workflows and retrieve execution results |

### Third-Party Services

| Plugin | Description |
| --- | --- |
| `notion` | Query databases, create pages, and search Notion |
| `x` | Post tweets, read timelines, and search X/Twitter |
| `spotify` | Playback control, search, playlists, and recommendations |
| `homekit` | Control HomeKit-compatible smart home accessories |
| `slack` | Send messages, read mentions, manage channels |

### Example Prompts

```
"What's my CPU usage? If it's over 80%, send me a Telegram notification."
"Search my Gmail for unread messages from GitHub and summarize them."
"Add the last song I played on Spotify to my 'Best of 2026' playlist."
"Create a calendar event for standup tomorrow at 9am."
"Push the latest commit to my vercel project and check if it deployed."
"Translate 'Hello, world!' to Japanese, French, and Spanish."
```

---

## Proactive Mode

Proactive Mode runs an autonomous background loop that periodically checks your services and pushes notifications without you needing to ask.

```bash
conductor proactive start         # Start the loop (default: every 30 minutes)
conductor proactive start --interval 15   # Run every 15 minutes
conductor proactive stop          # Stop the loop
```

Each cycle, Conductor:
1. Queries key services (unread email, upcoming events, system health, etc.)
2. Reasons over the results using the AI model
3. Sends a summary notification via Telegram or Slack

Proactive cycles are logged to `~/.conductor/conductor.db` so you can review past summaries.

---

## Persona Routing

Every incoming message is classified by a lightweight **Router Agent** before being handled. The router picks one of four personas:

| Persona | Triggers on | Behavior |
| --- | --- | --- |
| **Coder** | Code, git, bash, file management requests | Focused on precision and technical correctness |
| **Social** | Slack, Telegram, X/Twitter, messaging tasks | Writes concise, engaging, professional copy |
| **Researcher** | Web search, page reading, summarization | Thorough and citation-aware |
| **General** | Everything else | Balanced, multi-tool orchestrator |

Routing is transparent—you don't need to choose a persona manually. The system falls back to General if the intent is ambiguous.

---

## CLI Reference

```bash
# Status & info
conductor status                  # Show AI provider, enabled plugins, bot status
conductor version                 # Print version number

# AI providers
conductor ai setup                # Interactive provider configuration
conductor ai test                 # Send a test prompt to the current provider
conductor ai switch <provider>    # Switch active provider (claude/openai/gemini/ollama/openrouter)

# Plugins
conductor plugins list            # List all plugins and enabled status
conductor plugins enable <name>   # Enable a plugin
conductor plugins disable <name>  # Disable a plugin

# MCP server
conductor mcp setup               # Write MCP config to Claude Desktop
conductor mcp start               # Start the MCP server (stdio)
conductor mcp status              # Show current MCP config
conductor mcp remove              # Remove MCP configuration

# Telegram bot
conductor telegram setup          # Configure bot token
conductor telegram start          # Start the bot

# Slack bot
conductor slack setup             # Configure bot and app tokens
conductor slack start             # Start the bot

# Google auth
conductor auth google             # Browser-based OAuth (Gmail, Calendar, Drive, Gemini)

# Maintenance
conductor reset                   # Reset all configuration
```

---

## Configuration

All configuration lives in `~/.conductor/`:

```
~/.conductor/
├── config.json          # Non-secret settings (AI provider, enabled plugins, user info)
├── keychain/            # AES-256-GCM encrypted secrets (API keys, tokens)
│   └── *.enc
└── conductor.db         # SQLite — conversation history, plugin logs, proactive summaries
```

Key management commands:
```bash
conductor auth google    # Store Google credentials in keychain
conductor ai setup       # Store AI API key in keychain
```

No raw secrets are ever written to `config.json`.

---

## Security

Credentials are encrypted using **AES-256-GCM**. The master key is derived via `scrypt` from your machine's hardware ID, ensuring secrets only decrypt on the machine that created them.

* **Keychain Location**: `~/.conductor/keychain/`
* **Permissions**: `0700`
* **Note**: No raw secrets are stored in `config.json`

---

## Development

```bash
npm run dev    # Start in watch mode (tsx)
npm run build  # Transpile TypeScript → dist/
npm start      # Run production build
npm test       # Run plugin tests (skip auth-gated plugins)
```

### Writing a Plugin

Create a file in `src/plugins/builtin/` implementing the `Plugin` interface:

```typescript
import { Plugin, PluginTool } from '../manager.js';

export class MyPlugin implements Plugin {
  name = 'my-plugin';
  description = 'What this plugin does';

  getTools(): PluginTool[] {
    return [
      {
        name: 'my_tool',
        description: 'Do something useful',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'The input value' },
          },
          required: ['input'],
        },
        handler: async ({ input }: { input: string }) => {
          return { result: `Processed: ${input}` };
        },
      },
    ];
  }
}
```

Then register it in `src/plugins/builtin/index.ts`:

```typescript
import { MyPlugin } from './my-plugin.js';

export function getAllBuiltinPlugins(): Plugin[] {
  return [
    // ... existing plugins
    new MyPlugin(),
  ];
}
```

Your plugin's tools will automatically appear in all interfaces (MCP, Slack, Telegram) without any additional wiring.

---

## License

[Apache-2.0](LICENSE) — [Alexander Wondwossen](https://github.com/thealxlabs) / TheAlxLabs
