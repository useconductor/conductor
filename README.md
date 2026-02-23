# Conductor

> Your AI integration hub — 27+ plugins, 150+ tools, one installer. Now with Slack and Telegram.

Conductor is a TypeScript-based AI engine that bridges the gap between LLMs (Claude, GPT-4o, Gemini, Ollama, OpenRouter) and your digital workflow. It exposes a massive library of tools—including Gmail, Spotify, GitHub, and Slack—as an **MCP server**, **Telegram bot**, or **Slack bot**.

---

## What is Conductor?

Conductor acts as a universal middleware between your AI model and the services you use every day. Instead of writing bespoke integrations for each tool, you configure Conductor once and every supported AI provider gets immediate access to your entire plugin library through a uniform tool-calling interface.

**How it works:**

1. You configure your preferred AI provider (Claude, GPT-4o, Gemini, Ollama, or OpenRouter) during setup
2. You enable the plugins you want (Gmail, Spotify, GitHub, etc.)
3. You interact with the AI through Slack, Telegram, or Claude Desktop via MCP
4. Conductor routes your message to the AI, which calls tools as needed, and returns the result

The same plugins work identically across all three interfaces — configure once, use everywhere.

---

## What's New

* **Slack Integration**: Deploy Conductor as a Slack bot to bring AI tool-calling to your workspace
* **Enhanced Google OAuth**: Streamlined authentication flow shared across Gemini, Gmail, Calendar, and Drive
* **Advanced Tool Calling**: Improved logic for AI-driven multi-step execution
* **Hardened Security**: Enhanced AES-256-GCM keychain encryption tied to hardware IDs
* **Proactive Mode**: Autonomous reasoning loop that monitors your systems and notifies you of issues
* **Persona Routing**: AI automatically adopts the right persona (Coder, Social, Researcher, or General) based on your request

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

**Requirements:** Node.js >= 18.0.0

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

### MCP Server (Claude Desktop)

Conductor exposes all your enabled plugins as an MCP (Model Context Protocol) server. When connected to Claude Desktop, Claude gets native access to every tool.

```bash
conductor mcp setup    # Auto-configure Claude Desktop
conductor mcp start    # Start MCP server (stdio)
conductor mcp status   # Show MCP server status
conductor mcp remove   # Remove MCP configuration
```

### Telegram Bot

A full-featured Telegram bot that lets you talk to your AI and execute tools from anywhere.

```bash
conductor telegram setup   # Configure Telegram bot token
conductor telegram start   # Launch the Telegram bot
```

### Slack Bot

Bring Conductor into your Slack workspace. The bot responds to direct messages and app mentions, with full tool-calling support.

```bash
conductor slack setup   # Configure Slack Bot and App tokens
conductor slack start   # Launch the Slack bot
```

To set up the Slack app, visit [api.slack.com/apps](https://api.slack.com/apps) and:
1. Create a new app with Socket Mode enabled
2. Copy your **Bot User OAuth Token** (`xoxb-...`) from "OAuth & Permissions"
3. Copy your **App-Level Token** (`xapp-...`) from "Basic Information"

---

## Quick Start

```bash
conductor status              # Check setup and plugin health
conductor slack start         # Launch the Slack bot
conductor telegram start      # Launch the Telegram bot
conductor mcp setup           # Auto-configure Claude Desktop
conductor ai switch gemini    # Swap your primary AI model
conductor logs                # View recent activity
conductor plugins list        # Show all available plugins
conductor plugins enable gmail   # Enable a plugin
conductor plugins disable spotify # Disable a plugin
```

---

## Supported AI Providers

| Provider | Setup Command | Notes |
|---|---|---|
| **Claude** (Anthropic) | `conductor ai setup` | Requires API key |
| **GPT-4o** (OpenAI) | `conductor ai setup` | Requires API key |
| **Gemini** (Google) | `conductor auth google` | Uses Google OAuth or API key |
| **Ollama** (Local) | `conductor ai setup` | Requires local Ollama instance |
| **OpenRouter** | `conductor ai setup` | Access 100+ models via one API key |

Switch providers at any time:

```bash
conductor ai setup     # Interactive provider configuration
conductor ai test      # Test current provider connection
```

---

## Plugins & Tools

Conductor has **27 built-in plugins** split into five categories.

### Zero-Config Utilities

These plugins work out of the box — no API keys required.

| Plugin | What it does |
|---|---|
| `crypto` | Live cryptocurrency prices and market data |
| `weather` | Local weather forecasts and conditions |
| `system` | CPU, RAM, disk, and network hardware stats |
| `url-tools` | URL shortening, expansion, and metadata |
| `fun` | Jokes, trivia, and lighthearted content |
| `hash` | MD5, SHA-256, bcrypt hashing and comparison |
| `translate` | Text translation between languages |
| `calculator` | Math expressions and unit conversions |
| `colors` | Color format conversion (HEX, RGB, HSL) |
| `network` | IP lookup, DNS resolution, ping |
| `text-tools` | String manipulation, word counts, formatting |
| `github` | GitHub repo info, issues, and pull requests |
| `timezone` | Time conversion across world time zones |

### Memory & Scheduling

| Plugin | What it does |
|---|---|
| `memory` | Persistent key-value memory across sessions |
| `notes` | Local Markdown note creation and search |
| `cron` | Schedule recurring tasks and reminders |

### Google Services (require Google OAuth)

Run `conductor auth google` or `conductor google` to authenticate once for all Google plugins.

| Plugin | What it does |
|---|---|
| `gmail` | Read, search, send, and reply to emails |
| `gcal` | List, create, and manage calendar events |
| `gdrive` | Browse, search, and retrieve Drive files |

### Developer Tools (require API tokens)

| Plugin | What it does |
|---|---|
| `github-actions` | Trigger workflows, check run status and logs |
| `vercel` | List deployments, check build status |
| `n8n` | Execute and manage n8n automation workflows |

### Third-Party Services (require API tokens)

| Plugin | What it does |
|---|---|
| `notion` | Query databases, create and update pages |
| `x` | Post tweets, search, manage your X account |
| `spotify` | Playback control, search, playlist management |
| `homekit` | Control Apple HomeKit smart home accessories |
| `slack` | Send messages, read threads, search workspace |

### Example Prompts

Once configured, use natural language in any interface:

* *"Check my unread Slack mentions and summarize them."*
* *"Add the last song I played on Spotify to my 'Best of 2026' playlist."*
* *"What's my CPU usage? If it's over 80%, notify me on Telegram."*
* *"Draft a reply to my latest unread Gmail and send it."*
* *"Trigger the deploy workflow on my main branch and watch the logs."*
* *"What meetings do I have tomorrow? Add 30 minutes of prep time before each one."*

---

## Proactive Mode

Conductor includes an autonomous reasoning loop that runs on a schedule, monitors your systems, and notifies you when it detects issues or finds something worth your attention.

```bash
conductor proactive start               # Run every 30 minutes (default)
conductor proactive start --interval 15 # Run every 15 minutes
```

During each cycle, the AI:

1. Collects system stats (CPU, RAM, disk)
2. Checks recent activity logs
3. Scans enabled services (unread emails, upcoming calendar events, etc.)
4. Decides whether action is needed and either acts or sends you a notification

Any tool calls that could have significant side effects prompt an approval request before executing.

---

## Persona Routing

Conductor automatically selects the best AI persona based on your request:

| Persona | Triggered by | Behavior |
|---|---|---|
| **Coder** | Programming, git, bash, debugging | Writes clean code, prefers shell and file tools |
| **Social** | Twitter/X, Slack, Telegram, communications | Writes engaging, professional updates |
| **Researcher** | Web search, information lookup, summaries | Meticulous, uses search and browser tools |
| **General** | Everything else | Helpful, concise, tool-calling when needed |

---

## Security

Credentials are encrypted using **AES-256-GCM**. The master key is derived via `scrypt` from your machine's hardware ID, ensuring secrets only decrypt on the machine that created them.

* **Keychain location**: `~/.conductor/keychain/`
* **Permissions**: `0700`
* **No raw secrets** are stored in `config.json`

Report security vulnerabilities privately via [GitHub Security Advisories](https://github.com/thealxlabs/conductor/security/advisories/new). See [SECURITY.md](SECURITY.md) for the full policy.

---

## Configuration

Conductor stores all configuration in `~/.conductor/`:

```
~/.conductor/
├── config.json         # Provider, model, enabled plugins
├── keychain/           # Encrypted API keys and tokens (0700)
└── conductor.db        # Activity logs and conversation history (SQLite)
```

Key commands:

```bash
conductor status        # Show current provider, model, and enabled plugins
conductor reset         # Wipe all configuration and start fresh
conductor logs          # View the last 20 activity log entries
conductor logs -n 50    # View the last 50 entries
```

---

## Development

```bash
npm run dev    # Start in watch mode
npm run build  # Transpile TypeScript
npm start      # Run production build
npm test       # Run tests (skip auth-required plugins)
```

### Adding a Plugin

1. Create a new file in `src/plugins/builtin/` that implements the `Plugin` interface
2. Register it in `src/plugins/builtin/index.ts`

The plugin automatically appears across all interfaces (MCP, Slack, Telegram) and in `conductor plugins list`.

**Minimal plugin structure:**

```typescript
import { Plugin, PluginTool } from '../manager.js';

export class MyPlugin implements Plugin {
  name = 'myplugin';
  description = 'Does something useful';

  getTools(): PluginTool[] {
    return [
      {
        name: 'my_tool',
        description: 'Does something specific',
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Input value' }
          },
          required: ['input']
        },
        handler: async ({ input }: { input: string }) => {
          return { result: `Processed: ${input}` };
        }
      }
    ];
  }
}
```

---

## License

[MIT](LICENSE) — [Alexander Wondwossen](https://github.com/thealxlabs) / TheAlxLabs
