# Conductor

> Your AI integration hub — 25+ plugins, 150+ tools, one installer. Now with Slack and Telegram.

Conductor is a TypeScript-based AI engine that bridges the gap between LLMs (Claude, GPT-4o, Gemini, Ollama) and your digital workflow. It exposes a massive library of tools—including Gmail, Spotify, GitHub, and Slack—as an **MCP server**, **Telegram bot**, or **Slack bot**.

---

## 🚀 New in this Update

* **Slack Integration**: Deploy Conductor as a Slack bot to bring AI tool-calling to your workspace.
* **Enhanced Google OAuth**: Streamlined authentication flow shared across Gemini, Gmail, Calendar, and Drive.
* **Advanced Tool Calling**: Improved logic for AI-driven multi-step execution.
* **Hardened Security**: Enhanced AES-256-GCM keychain encryption tied to hardware IDs.

---

## 📦 Install

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/thealxlabs/conductor/main/install.sh | bash

```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/thealxlabs/conductor/main/install.ps1 | iex

```

The 14-step interactive installer configures AI providers, Google OAuth, Slack/Telegram tokens, and Claude Desktop MCP. Every step is optional and skippable.

---

## 🛠️ Interface Options

```
┌─────────────────────────────────────────────────────┐
│                   Your AI Provider                  │
│    Claude · GPT-4o · Gemini · Ollama · OpenRouter   │
└──────────────────────┬──────────────────────────────┘
                       │
              ┌────────▼────────┐
              │    Conductor    │
              │  25+ Plugins    │
              │  150+ Tools     │
              └──┬─────┬─────┬──┘
                 │     │     │
      ┌──────────▼─┐ ┌─▼─────▼──┐ ┌──────────▼──┐
      │  Slack Bot │ │ Telegram │ │  MCP Server │
      └────────────┘ └──────────┘ └─────────────┘

```

---

## ⚡ Quick Start

```bash
conductor status              # Check setup and plugin health
conductor slack start         # Launch the Slack bot
conductor telegram start      # Launch the Telegram bot
conductor mcp setup           # Auto-configure Claude Desktop
conductor ai switch gemini    # Swap your primary AI model

```

---

## 🔌 Plugins & Tools

### Featured Integrations

| Category | Plugins | Key Tools |
| --- | --- | --- |
| **Communication** | `slack`, `gmail`, `telegram` | Send messages, search threads, reply to emails |
| **Productivity** | `gcal`, `notion`, `notes` | Manage events, query databases, local MD notes |
| **Development** | `github_actions`, `vercel`, `n8n` | Trigger CI/CD, check logs, execute workflows |
| **Media** | `spotify`, `x` | Playback control, recommendations, post tweets |
| **Utilities** | `system`, `crypto`, `weather` | Hardware stats, live prices, local forecasts |

### 🤖 Slack & Telegram Bots

Run `conductor slack setup` or `conductor telegram setup` to link your bots. Once active, the AI has full access to your enabled plugins. Use natural language to:

* *"Check my unread Slack mentions and summarize them."*
* *"Add the last song I played on Spotify to my 'Best of 2026' playlist."*
* *"What's my CPU usage? If it's over 80%, notify me on Telegram."*

---

## 🔐 Security

Credentials are encrypted using **AES-256-GCM**. The master key is derived via `scrypt` from your machine's hardware ID, ensuring secrets only decrypt on the machine that created them.

* **Keychain Location**: `~/.conductor/keychain/`
* **Permissions**: `0700`
* **Note**: No raw secrets are stored in the main `config.json`.

---

## 🛠️ Development

```bash
npm run dev    # Start in watch mode
npm run build  # Transpile TypeScript
npm start      # Run production build

```

To add a tool, implement the `Plugin` interface in `src/plugins/builtin/` and register it in `src/plugins/builtin/index.ts`. It will automatically appear across all interfaces (MCP, Slack, Telegram).

---

## 📄 License

[MIT](https://www.google.com/search?q=LICENSE) — [Alexander Wondwossen](https://github.com/thealxlabs) / TheAlxLabs
