# Conductor

> **One AI. Every tool. Any interface.**

Conductor is a universal AI integration hub that connects Claude, GPT-4o, Gemini, Ollama, and OpenRouter to 150+ tools across 27 plugins — exposed simultaneously as an **MCP server**, **Slack bot**, **Telegram bot**, **web dashboard with live chat**, and **HTTP API**.

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Plugins](https://img.shields.io/badge/27_Plugins-150%2B_Tools-22c55e?style=flat-square)
![Providers](https://img.shields.io/badge/6_AI_Providers-Claude_·_GPT--4o_·_Gemini_·_Ollama-a855f7?style=flat-square)
![License](https://img.shields.io/badge/License-Apache--2.0-f59e0b?style=flat-square)

---

## What makes Conductor different

Most AI wrappers give you one interface. Conductor gives you five — simultaneously. Same plugins, same tools, same conversation memory, whether you're in Slack, Telegram, Claude Desktop (MCP), or the web browser.

**Example:** Send one message: _"Find my 3 urgent emails, add them to my calendar, and notify me on Slack."_ Conductor automatically chains Gmail → Google Calendar → Slack in a single agent loop — with approval gates if any step is sensitive.

```
You: "Find my urgent emails, add them to my calendar, notify me on Slack."

Conductor:
  1. persona → "general"
  2. gmail_search() → 2 urgent emails
  3. gcal_create_event() × 2 → events created
  4. slack_send_message() → "Done: 2 events added"
```

---

## Try it in 60 seconds

```bash
# macOS / Linux
curl -fsSL https://conductor.thealxlabs.ca/install.sh | bash

# Windows (PowerShell)
irm https://conductor.thealxlabs.ca/install.ps1 | iex
```

Then open the web dashboard with live AI chat:

```bash
conductor dashboard start
# → http://localhost:4242
```

Or wire it into Claude Desktop:

```bash
conductor mcp setup    # auto-configures Claude Desktop
```

**Requirements:** Node.js ≥ 18

---

## 5 things that will impress you

### 1. Live web chat in the browser
The dashboard includes a full AI chat interface — send messages, watch tool call chips appear inline, see results in real time. No CLI needed for demos.

### 2. 6 AI providers, hot-switchable
```bash
conductor ai switch gemini    # switch without restart
conductor ai switch claude
conductor ai switch ollama    # fully local, no API key
```

### 3. Proactive autonomous mode
```bash
conductor proactive start    # runs every 30 min by default
```
Conductor gathers context (CPU, emails, calendar, activity), reasons about it, takes action, and notifies you — without you asking. Approval gates pause the loop for sensitive operations.

### 4. Hardware-tied AES-256-GCM keychain
No secrets in `config.json`. Every credential is encrypted with a key derived from your machine's hardware ID via `scrypt`. Keys cannot be transferred to other machines.

### 5. Plugin marketplace in the dashboard
Browse, enable, and configure all 27 plugins from the web UI. See which need credentials, toggle them on/off, get the right setup instructions.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Interfaces                           │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   Web    │  │  Slack   │  │Telegram  │  │   MCP    │   │
│  │Dashboard │  │   Bot    │  │   Bot    │  │ (Claude  │   │
│  │ + Chat   │  │          │  │          │  │ Desktop) │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
└───────┼─────────────┼─────────────┼──────────────┼─────────┘
        └─────────────┴──────┬──────┴──────────────┘
                             │
              ┌──────────────▼──────────────┐
              │         Conductor           │
              │  (Orchestrator + Agent Loop)│
              └──────┬───────────┬──────────┘
                     │           │
          ┌──────────▼──┐   ┌───▼──────────┐
          │  AI Manager  │   │ Plugin Manager│
          │              │   │ 27 Plugins   │
          │ Claude       │   │ 150+ Tools   │
          │ OpenAI       │   │              │
          │ Gemini       │   │ Gmail  gcal  │
          │ Ollama       │   │ GitHub Slack │
          │ OpenRouter   │   │ Spotify ...  │
          │ Maestro      │   │              │
          └──────────────┘   └──────────────┘
                     │
          ┌──────────▼──────────┐
          │   Security Layer    │
          │  AES-256-GCM        │
          │  Hardware-tied keys │
          └─────────────────────┘
```

### Agent Loop (max 15 iterations per turn)

```
1. User message → stored in SQLite conversation history
2. Persona detection (AI classifies: coder / social / researcher / general)
3. System prompt injected based on persona
4. AI provider called with full history + all enabled tools
5. If tool calls returned → execute, append results
6. If requiresApproval tool → pause, notify user via Slack/Telegram
7. Repeat until AI returns plain text
8. Final response returned to the interface
```

---

## Interfaces

| Interface | Command | What it does |
|---|---|---|
| **Web Dashboard + Chat** | `conductor dashboard start` | Browser UI with live AI chat, plugin manager, system monitor, marketplace |
| **MCP Server** | `conductor mcp setup` | Native tool integration in Claude Desktop |
| **Slack Bot** | `conductor slack start` | Respond to @conductor mentions and DMs |
| **Telegram Bot** | `conductor telegram start` | Full chat + `/approve` / `/deny` commands |
| **Lumen HTTP API** | auto-started with dashboard | `POST /api/lumen/ask` with Bearer token auth |

---

## Security

Credentials are encrypted using **AES-256-GCM** with a master key derived from your machine's hardware ID via `scrypt`. Secrets cannot be decrypted on any other machine.

- **Keychain location**: `~/.conductor/keychain/` (mode `0700`)
- **No raw secrets** in `config.json` — ever
- **Timing-safe** API key comparison
- **Approval gates** for sensitive autonomous actions
- **localhost-only** dashboard by default (bind: `127.0.0.1:4242`)

---

## Plugins

### Zero-config (no API key)

| Plugin | What it does |
|---|---|
| **calculator** | Math, unit conversions, date calculations |
| **colors** | Color conversion, palettes, contrast checking |
| **crypto** | Live cryptocurrency prices |
| **fun** | Jokes, trivia, quotes, dice |
| **hash** | SHA-256, MD5, bcrypt, UUID, password generator |
| **network** | DNS lookup, IP geolocation, port scan |
| **text-tools** | JSON format, regex, word count, string transforms |
| **timezone** | World clock, timezone conversion |
| **translate** | Translate between 100+ languages |
| **url-tools** | Expand short URLs, HTTP status, headers |
| **weather** | Current conditions + 7-day forecast |
| **system** | CPU, memory, disk, processes, shell commands |
| **memory** | Long-term memory across conversations |
| **notes** | Markdown notes in `~/.conductor/notes/` |
| **cron** | Schedule recurring tasks with natural language |

### Requires auth

| Plugin | Auth | What it does |
|---|---|---|
| **gmail** | Google OAuth | Read, search, send Gmail |
| **gcal** | Google OAuth | Google Calendar events |
| **gdrive** | Google OAuth | Browse, read, upload Drive files |
| **github** | GitHub Token | Repos, issues, PRs, gists |
| **github-actions** | GitHub Token | CI/CD, releases, code search |
| **vercel** | Vercel Token | Deployments, projects, domains |
| **n8n** | n8n API Key | Automation workflow triggers |
| **notion** | Notion Key | Read/write databases and pages |
| **spotify** | Spotify OAuth | Full playback control + library |
| **x** | X API Key | Post tweets, read timeline |
| **homekit** | HomeKit URL | Control smart home devices |
| **slack** | Slack Token | Send messages, read channels |
| **todoist** | Todoist Token | Tasks, projects, priorities |

---

## What can it do? (real prompts)

```
"What's the weather in Berlin this week?"
"Translate this paragraph to Japanese."
"Find my 3 latest unread emails and summarize them."
"Schedule a meeting with Alex tomorrow at 2pm."
"Play Discover Weekly on Spotify, queue 5 similar tracks."
"Search GitHub for trending TypeScript repos."
"Generate a UUID and a secure 20-character password."
"Show me my top CPU-consuming processes."
"Check if my website is responding."
"Remember that my AWS key expires on March 31."
"What did I work on yesterday?" (uses memory plugin)
```

---

## Proactive Mode

```bash
conductor proactive start              # Every 30 minutes
conductor proactive start --interval 10  # Every 10 minutes
```

Each cycle: gather system context → AI reasons → take action → notify via Slack/Telegram → log everything. Approval gates pause the loop for sensitive operations.

---

## Persona Routing

Conductor auto-classifies every message before routing to tools:

| Persona | Triggered by | Tool focus |
|---|---|---|
| **Coder** | code, debug, git, bash | github-actions, vercel, system, hash |
| **Social** | tweets, Slack, messages | x, slack, gmail |
| **Researcher** | search, summarize, read | weather, translate, url-tools |
| **General** | calendar, emails, everything else | gcal, gmail, memory, notes |

---

## Lumen AI HTTP API

Expose your local Ollama as an authenticated remote endpoint — for CI/CD pipelines and scripts that don't have shell access.

```bash
# Generate an API key
curl -s -X POST http://localhost:4242/api/lumen/key | jq -r .key

# Call from any machine
curl -X POST http://YOUR-IP:4242/api/lumen/ask \
  -H "Authorization: Bearer cnd_..." \
  -H "Content-Type: application/json" \
  -d '{"task": "check git status and show changed files"}'
```

---

## CLI Reference

```bash
conductor status                     # Overall health check
conductor dashboard start            # Web dashboard + chat (port 4242)
conductor ai setup                   # Configure AI provider
conductor ai switch <provider>       # Hot-switch provider
conductor mcp setup                  # Configure Claude Desktop
conductor plugins list               # List all plugins
conductor plugins enable <name>      # Enable a plugin
conductor proactive start            # Start autonomous mode
conductor slack start                # Start Slack bot
conductor telegram start             # Start Telegram bot
conductor auth google                # Google OAuth flow
```

---

## Configuration

```
~/.conductor/
├── config.json        # AI provider, enabled plugins, settings
├── conductor.db       # SQLite: conversations, memory, logs
├── keychain/          # AES-256-GCM encrypted credentials
├── notes/             # Markdown notes
└── logs/              # Activity logs
```

---

## Development

```bash
npm run dev    # Watch mode (tsx)
npm run build  # Compile TypeScript
npm test       # Run tests (skips auth plugins)
```

### Adding a plugin

Implement `Plugin` in `src/plugins/builtin/` and register it in `src/plugins/builtin/index.ts`. It immediately appears across all interfaces.

```typescript
export const myPlugin: Plugin = {
  name: 'my-plugin',
  description: 'What this plugin does',
  version: '1.0.0',
  initialize: async (conductor) => { /* setup */ },
  isConfigured: () => true,
  getTools: () => [{
    name: 'my_tool',
    description: 'What this tool does',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    handler: async ({ query }) => `Result: ${query}`,
  }],
};
```

---

## License

[Apache-2.0](LICENSE) — [Alexander Wondwossen](https://github.com/thealxlabs) / TheAlxLabs
