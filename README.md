# Conductor

**One MCP server. 100+ tools. Every AI agent.**

[![CI](https://github.com/useconductor/conductor/actions/workflows/ci.yml/badge.svg)](https://github.com/useconductor/conductor/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@useconductor/conductor)](https://www.npmjs.com/package/@useconductor/conductor)
[![Node](https://img.shields.io/badge/node-%3E%3D20.12-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)

Conductor is a single [Model Context Protocol](https://modelcontextprotocol.io) server that gives any AI agent — Claude, Cursor, Cline, Copilot, and more — instant access to your entire toolkit through one connection. Install once, configure once, use everywhere.

```bash
npm install -g @useconductor/conductor
conductor init
```

---

## Why Conductor

Most MCP setups mean one server per tool — one for GitHub, one for Slack, one for your database. That's a dozen processes, a dozen configs, and a dozen things to break.

Conductor collapses all of that into a single server with a plugin system, security built in from the start, and a CLI that actually works.

- **100+ tools** across 35+ plugins, all in one process
- **Zero-config plugins** work instantly — no API keys, no setup
- **Secrets in the OS keychain** — never stored in config files
- **Circuit breakers + retry** on every tool call — failures don't cascade
- **SHA-256 chained audit log** — every action recorded, tamper-evident
- **One config block** in your AI client — that's the whole integration

---

## Quick start

```bash
# Install
npm install -g @useconductor/conductor

# First-run wizard — AI provider, plugins, client config
conductor init
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "conductor": {
      "command": "conductor",
      "args": ["mcp", "start"]
    }
  }
}
```

Or skip the manual editing: `conductor mcp setup`

### Cursor / Windsurf / Cline / Continue

Same config block — drop it in `.cursor/mcp.json`, `.codeium/windsurf/mcp_config.json`, or your client's MCP config file.

### No global install

```json
{
  "mcpServers": {
    "conductor": {
      "command": "npx",
      "args": ["-y", "@useconductor/conductor", "mcp", "start"]
    }
  }
}
```

---

## Plugins

### Needs setup

| Plugin | What it does | Setup |
|---|---|---|
| `github` | Repos, issues, PRs, code search (20 tools) | `GITHUB_TOKEN` env var |
| `gmail` | Read, compose, send, search, label email | `conductor google` |
| `gcal` | Events, availability, scheduling | `conductor google` |
| `gdrive` | Search, read, upload files | `conductor google` |
| `notion` | Pages, databases, blocks, search | API key |
| `slack` | Messages, channels, search | `conductor slack setup` |
| `linear` | Issues, projects, cycles | API key |
| `jira` | Issues, projects, sprints | Domain + API token |
| `stripe` | Payments, customers, invoices | Secret key |
| `docker` | Containers, images, volumes, networks | Local Docker socket |
| `database` | Postgres, MySQL queries | Connection URL |
| `github-actions` | Trigger and monitor CI workflows | `GITHUB_TOKEN` |
| `vercel` | Deployments, logs, projects | API token |
| `n8n` | Trigger workflows, list executions | Base URL + API key |
| `spotify` | Playback, search, playlists | Client ID + secret |
| `x` | Post, search, timeline | API credentials |
| `homekit` | Lights, locks, thermostats via Homebridge | Base URL |
| `lumen` | Smart lighting control | Local setup |
| `todoist` | Tasks, projects, labels | API token |
| `shell` | Run allowlisted shell commands | Enabled by default |

### Zero-config (works instantly)

| Plugin | What it does |
|---|---|
| `calculator` | Math expressions, unit conversions, date arithmetic |
| `colors` | Convert hex/RGB/HSL, generate palettes, WCAG contrast |
| `crypto` | Encrypt, decrypt, sign, verify |
| `hash` | SHA-256/MD5/SHA-512, base64, UUID, passwords |
| `text-tools` | JSON format, word count, regex test, case transform |
| `timezone` | Current time in any city, timezone conversion |
| `url-tools` | Expand short links, check status, inspect headers |
| `network` | Ping, DNS lookup, port check, IP info |
| `system` | CPU, memory, disk usage |
| `weather` | Current conditions and forecast by city |
| `translate` | Translate text between languages |
| `fun` | Jokes, trivia, quotes |
| `notes` | Local markdown notes |
| `memory` | Persistent key-value memory across sessions |
| `cron` | Schedule recurring tasks |

---

## CLI reference

### Setup

```bash
conductor init                        # First-run wizard
conductor mcp setup                   # Auto-configure Claude Desktop / Cursor
conductor mcp start                   # Start MCP server (stdio)
conductor mcp status                  # Show MCP server status
conductor doctor                      # Diagnose common issues
conductor health                      # System health report
conductor health --json               # Machine-readable health output
```

### Plugins

```bash
conductor plugins list                # List all plugins (enabled/disabled)
conductor plugins enable <name>       # Enable a plugin
conductor plugins disable <name>      # Disable a plugin
conductor onboard                     # Interactive TUI plugin picker
conductor install <plugin>            # Install from marketplace
conductor marketplace                 # Browse marketplace
conductor marketplace info <plugin>   # Plugin details
conductor plugin create <name>        # Scaffold a new plugin with tests
```

### Authentication

```bash
conductor google                      # Browser-based Google OAuth (Gmail, Calendar, Drive)
conductor slack setup                 # Configure Slack bot + app tokens
conductor slack start                 # Start the Slack bot
conductor telegram setup              # Configure Telegram bot token
conductor telegram start              # Start the Telegram bot
conductor ai setup                    # Configure AI provider
conductor ai test                     # Test current AI provider
```

### Configuration

```bash
conductor config list                 # Show all config keys and values
conductor config get <key>            # Get a specific key (e.g. ai.provider)
conductor config set <key> <value>    # Set a key (JSON or string)
conductor config path                 # Print config file path
conductor config export               # Dump config as JSON
conductor config validate             # Check config structure
conductor config reset                # Reset to defaults
```

### Audit log

```bash
conductor audit list                  # List recent entries
conductor audit list --actor user1    # Filter by actor
conductor audit list --result failure # Filter by result
conductor audit verify                # Verify SHA-256 chain integrity
conductor audit tail                  # Stream in real time
conductor audit stats                 # Summary statistics
conductor audit export -o out.json    # Export to file
conductor audit rotate                # Manually rotate log file
```

### Circuit breakers

```bash
conductor circuit list                # Show state of all circuit breakers
conductor circuit reset <tool>        # Reset a specific circuit to closed
```

### Autonomous + other

```bash
conductor proactive start             # Start autonomous reasoning loop
conductor dashboard                   # Open web dashboard (--port <n>)
conductor release                     # Bump version and publish to npm
```

---

## Security model

Every tool call passes through a stack before reaching the handler:

```
Request
  → Zod input validation        (schema-level type safety)
  → RBAC permission check        (role-based access control)
  → Circuit breaker              (opens after 5 failures, recovers in 30s)
  → Retry with exponential backoff
  → Handler
  → Audit log entry              (SHA-256 chained, append-only)
  → Metrics
```

**Secrets** are stored in the OS keychain (macOS Keychain, Linux Secret Service, Windows Credential Manager) via `@useconductor/conductor`'s keychain module — never in `config.json`.

**Shell commands** go through a strict allowlist. No `eval()`, no `exec()` with arbitrary input, no wildcards. The list covers standard dev tools: git, docker, node, npm, curl, psql, and ~50 others.

**Destructive tools** set `requiresApproval: true` — the AI agent must explicitly confirm before execution.

**Audit log** at `~/.conductor/audit/audit.log` is JSONL with a SHA-256 chain. Each entry hashes the previous entry's hash + its own content. Verify integrity anytime with `conductor audit verify`.

**Rate limiting** on all HTTP endpoints via `express-rate-limit`.

---

## Architecture

```
src/
├── cli/            Commander CLI — commands in src/cli/commands/
│   └── commands/   init, mcp, plugins, audit, config, circuit, auth, ...
├── core/           Conductor orchestrator, config, database, audit, retry, circuit-breaker
├── mcp/            MCP server — stdio + HTTP/SSE transports
├── plugins/        Plugin manager, validation, 35 builtin plugins
│   └── builtin/    calculator, github, slack, gmail, docker, shell, ...
├── ai/             Multi-provider AI (Claude, OpenAI, Gemini, Ollama, OpenRouter)
├── bot/            Telegram + Slack bot runtimes
├── dashboard/      Express web dashboard + REST API
└── security/       Keychain, RBAC, auth
```

Config storage at `~/.conductor/`:

| Path | Contents |
|---|---|
| `config.json` | Non-secret settings |
| `conductor.db` | SQLite history + activity log |
| `audit/audit.log` | Tamper-evident audit chain (JSONL) |
| `plugins/` | External plugin `.js` files |
| `.key` | Machine-bound AES-256-GCM encryption key |

---

## Writing plugins

Install the SDK for types:

```bash
npm install @useconductor/sdk
```

```typescript
import type { Plugin, PluginTool } from '@useconductor/sdk';

class MyPlugin implements Plugin {
  name = 'my-plugin';
  description = 'Does something useful';
  version = '1.0.0';

  async initialize(): Promise<void> {}
  isConfigured(): boolean { return true; }

  getTools(): PluginTool[] {
    return [
      {
        name: 'my_tool',
        description: 'Explain what this does in one sentence',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The query to process' },
          },
          required: ['query'],
        },
        handler: async ({ query }) => {
          return { result: `Processed: ${query}` };
        },
      },
    ];
  }
}

export default new MyPlugin();
```

Compile to `~/.conductor/plugins/my-plugin.js` and it's immediately available.

Scaffold with tests:

```bash
conductor plugin create my-plugin
```

For plugins needing secrets, add a `configSchema` with `secret: true` fields — they get stored in the OS keychain automatically.

---

## Programmatic use

```typescript
import { ConductorClient } from '@useconductor/sdk';

// stdio (local)
const client = new ConductorClient({ transport: 'stdio' });
await client.connect();

const tools = await client.listTools();
const result = await client.callText('calc_math', { expression: 'sqrt(144) + 8' });
console.log(result); // "20"

await client.disconnect();

// HTTP/SSE (remote)
const remote = new ConductorClient({
  transport: 'http',
  url: 'http://your-conductor-host:3000',
});
```

---

## Supported clients

Works with any MCP-compatible client:

- [Claude Desktop](https://claude.ai/download)
- [Cursor](https://cursor.com)
- [Cline (VS Code)](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev)
- [Windsurf](https://codeium.com/windsurf)
- [Continue.dev](https://continue.dev)
- [Zed](https://zed.dev)
- [Aider](https://aider.chat)
- [Roo Code](https://roocode.com)
- VS Code (GitHub Copilot)
- Any client supporting MCP stdio transport

---

## Contributing

```bash
git clone https://github.com/useconductor/conductor
cd conductor
npm install
npm run dev        # Watch mode
npm test           # Run tests (Vitest)
npm run typecheck  # Type check
npm run lint       # ESLint (requires Node >= 20.12)
```

Requirements: Node >= 20.12, npm >= 9.

---

## License

Apache 2.0 — see [LICENSE](./LICENSE)

Built by [Alexander Wondwossen](https://github.com/thealxlabs) and contributors.
