# Conductor

**One MCP server. Tools for every AI agent.**

[![CI](https://github.com/useconductor/conductor/actions/workflows/ci.yml/badge.svg)](https://github.com/useconductor/conductor/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@useconductor/conductor)](https://www.npmjs.com/package/@useconductor/conductor)
[![Node](https://img.shields.io/badge/node-%3E%3D20.12-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)

Conductor is a single [Model Context Protocol](https://modelcontextprotocol.io) server that gives any AI agent — Claude, Cursor, Cline, Copilot, and more — access to your tools through one connection. Install once, configure once, use everywhere.

```bash
npm install -g @useconductor/conductor
conductor init
```

---

## Why Conductor

Running one MCP server per tool means one process, one config, and one potential failure per integration. Conductor collapses all of that into a single server with a consistent security layer and one config block in your AI client.

- **Single process** — GitHub, Docker, shell, databases, and more through one connection
- **Encrypted credential storage** — secrets encrypted with a machine-derived AES-256-GCM key, never in plain config files
- **Circuit breakers + retry** on every tool call — failures don't cascade
- **SHA-256 chained audit log** — every action recorded, tamper-evident
- **One config block** in your AI client

---

## Quick start

```bash
npm install -g @useconductor/conductor
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

Same config block — drop it into `.cursor/mcp.json`, `.codeium/windsurf/mcp_config.json`, or your client's MCP config file.

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

### Core (fully tested, production-ready)

| Plugin | What it does | Setup |
|---|---|---|
| `shell` | Safe shell execution, file read/write/search | Enabled by default |
| `github` | Repos, issues, PRs, code search (23 tools) | Optional `GITHUB_TOKEN` for private repos |
| `docker` | Containers, images, volumes, networks (16 tools) | Docker daemon running |
| `database` | PostgreSQL, MySQL, MongoDB, Redis queries | Connection URL |
| `slack` | Messages, channels, search, DMs | `conductor slack setup` |

### Zero-config utilities (no setup required)

| Plugin | What it does |
|---|---|
| `calculator` | Math expressions, unit conversions, date arithmetic |
| `colors` | Convert hex/RGB/HSL, generate palettes, WCAG contrast |
| `hash` | SHA-256/MD5/SHA-512, base64, UUID, passwords |
| `text-tools` | JSON format, word count, regex test, case transform |
| `timezone` | Current time in any city, timezone conversion |
| `weather` | Current conditions and forecast by city (Open-Meteo, no key required) |
| `network` | Ping, DNS lookup, port check, IP info |
| `url-tools` | Expand short links, check status, inspect headers |
| `system` | CPU, memory, disk usage |
| `notes` | Local markdown notes |
| `memory` | Persistent key-value memory across sessions |
| `cron` | Schedule recurring tasks |
| `fun` | Jokes, trivia, quotes |

### Additional (needs setup)

| Plugin | Setup |
|---|---|
| `gmail`, `gcal`, `gdrive` | `conductor google` |
| `notion` | API key |
| `linear` | API key |
| `jira` | Domain + API token |
| `stripe` | Secret key |
| `vercel` | API token |
| `n8n` | Base URL + API key |
| `spotify` | Client ID + secret |
| `x` | API credentials |
| `homekit` | Homebridge base URL |
| `todoist` | API token |
| `github-actions` | `GITHUB_TOKEN` |

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
conductor plugins create <name>       # Scaffold a new plugin with tests
```

### Authentication

```bash
conductor google                      # Browser-based Google OAuth (Gmail, Calendar, Drive)
conductor slack setup                 # Configure Slack bot token
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

---

## Security model

Every tool call passes through this stack:

```
Request
  → Zod input validation
  → Circuit breaker              (opens after 5 failures, recovers in 30s)
  → Retry with exponential backoff
  → Handler
  → Audit log entry              (SHA-256 chained, append-only)
  → Metrics
```

**Credentials** are encrypted with AES-256-GCM using a key derived from the machine's hardware ID (IOPlatformUUID on macOS, `/etc/machine-id` on Linux). They are stored in `~/.conductor/keychain/` as encrypted files — not in `config.json`, and never in plaintext.

**Shell commands** go through a strict allowlist (~50 standard dev tools). No `eval()`, no arbitrary execution.

**Audit log** at `~/.conductor/audit/audit.log` is JSONL with a SHA-256 chain. Each entry hashes the previous entry's hash + its own content. Verify integrity anytime with `conductor audit verify`.

**Rate limiting** on all HTTP endpoints via `express-rate-limit`.

---

## Architecture

```
src/
├── cli/            Commander CLI
│   └── commands/   init, mcp, plugins, audit, config, circuit, auth, ...
├── core/           Conductor orchestrator, config, database, audit, retry, circuit-breaker
├── mcp/            MCP server — stdio + HTTP/SSE transports
├── plugins/        Plugin manager, validation, 35 builtin plugins
│   └── builtin/    shell, github, docker, database, slack, calculator, ...
├── ai/             Multi-provider AI (Claude, OpenAI, Gemini, Ollama)
├── bot/            Telegram + Slack bot runtimes
├── dashboard/      Express web dashboard + REST API
└── security/       Credential storage, auth
```

Config storage at `~/.conductor/`:

| Path | Contents |
|---|---|
| `config.json` | Non-secret settings |
| `conductor.db` | SQLite activity log and history |
| `audit/audit.log` | Tamper-evident audit chain (JSONL) |
| `keychain/` | AES-256-GCM encrypted credentials |
| `plugins/` | External plugin `.js` files |

---

## Writing plugins

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

Place compiled output at `~/.conductor/plugins/my-plugin.js`. Scaffold with tests:

```bash
conductor plugins create my-plugin
```

For plugins needing credentials, add a `configSchema` with `secret: true` fields — they get encrypted and stored automatically.

---

## Programmatic use

```typescript
import { ConductorClient } from '@useconductor/sdk';

// stdio (local)
const client = new ConductorClient({ transport: 'stdio' });
await client.connect();
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
npm run lint       # ESLint
```

Requirements: Node >= 20.12, npm >= 9.

---

## License

Apache 2.0 — see [LICENSE](./LICENSE)
