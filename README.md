# Conductor

**One MCP server. 100+ tools. Every AI agent.**

[![CI](https://github.com/useconductor/conductor/actions/workflows/ci.yml/badge.svg)](https://github.com/useconductor/conductor/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@useconductor/conductor)](https://www.npmjs.com/package/@useconductor/conductor)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)

Conductor is a single [Model Context Protocol](https://modelcontextprotocol.io) server that gives any AI agent — Claude, Cursor, Cline, Copilot, Gemini, and more — access to your entire toolkit through one connection.

```bash
npm install -g @useconductor/conductor
conductor init
```

---

## What it does

Connect once, get everything:

| Category | Tools |
|---|---|
| Developer | GitHub (20 tools), Docker, Shell, Vercel, n8n, GitHub Actions |
| Productivity | Gmail, Google Calendar, Google Drive, Notion, Todoist |
| Project management | Linear, Jira |
| Communication | Slack, Telegram |
| Finance | Stripe |
| Media | Spotify, X (Twitter) |
| Smart home | HomeKit, Lumen |
| Utilities | Calculator, timezone, weather, crypto, colors, URL tools, system info, and 15+ more |

---

## Quick start

```bash
# Install globally
npm install -g @useconductor/conductor

# First-run wizard — picks AI provider, enables plugins, wires up your MCP client
conductor init
```

### Add to Claude Desktop

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

Config file:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Or auto-configure: `conductor mcp setup`

### Add to Cursor

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

Config file: `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global)

### No global install? Use npx

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

## CLI reference

```
conductor init                     First-run wizard
conductor mcp setup                Auto-configure Claude Desktop, Cursor, etc.
conductor mcp start                Start the MCP server (stdio)
conductor mcp status               Show MCP server status
conductor plugins list             List all available plugins
conductor plugins enable <name>    Enable a plugin
conductor plugins disable <name>   Disable a plugin
conductor onboard                  Interactive plugin picker TUI
conductor install <plugin>         Install a marketplace plugin
conductor marketplace              Browse the plugin marketplace
conductor google                   Set up Google (Gmail, Calendar, Drive)
conductor auth google              Same as above
conductor slack setup              Configure Slack tokens
conductor slack start              Start the Slack bot
conductor telegram setup           Configure Telegram bot token
conductor telegram start           Start the Telegram bot
conductor ai setup                 Configure AI provider (Claude, OpenAI, Gemini, Ollama)
conductor ai test                  Test current AI provider
conductor proactive start          Start autonomous agent loop
conductor doctor                   Diagnose issues
conductor health                   System health report (--json for machine output)
conductor dashboard                Open the web dashboard (--port <n>)
conductor plugin create <name>     Scaffold a new plugin with tests
conductor release                  Bump version and publish to npm
```

---

## Plugin setup

### GitHub

```bash
conductor plugins enable github
# Set GITHUB_TOKEN in your environment or ~/.conductor/config.json
```

### Google (Gmail, Calendar, Drive)

```bash
conductor google
# Opens browser for OAuth — no manual token copying
```

### Slack

```bash
conductor slack setup
# Prompts for xoxb- bot token and xapp- app-level token
conductor slack start
```

### Linear

```bash
conductor plugins enable linear
# Prompts for API key on first use
```

### Jira

```bash
conductor plugins enable jira
# Prompts for domain, email, and API token
```

### Stripe

```bash
conductor plugins enable stripe
# Prompts for secret key
```

---

## Zero-config plugins

These work immediately with no setup:

| Plugin | What it does |
|---|---|
| `calculator` | Evaluate math expressions |
| `timezone` | Convert between timezones |
| `weather` | Current conditions by city |
| `crypto` | Encrypt, decrypt, hash |
| `colors` | Convert between color formats |
| `text-tools` | Transform, count, encode/decode text |
| `url-tools` | Parse and inspect URLs |
| `network` | Ping, DNS lookup, port check |
| `system` | CPU, memory, disk info |
| `hash` | SHA-256, MD5, bcrypt |
| `translate` | Translate text |
| `fun` | Jokes, facts, quotes |
| `notes` | Local markdown notes |
| `memory` | Persistent key-value memory |
| `cron` | Schedule tasks |

---

## Writing plugins

Drop a compiled `.js` file into `~/.conductor/plugins/`. It must export a default object implementing the `Plugin` interface.

Install the SDK for full TypeScript types:

```bash
npm install @useconductor/sdk
```

```typescript
import { Plugin, PluginTool, IConfig } from '@useconductor/sdk';

class MyPlugin implements Plugin {
  name = 'my-plugin';
  description = 'Does something useful';
  version = '1.0.0';

  async initialize(_config: IConfig): Promise<void> {}
  isConfigured(): boolean { return true; }

  getTools(): PluginTool[] {
    return [{
      name: 'my_tool',
      description: 'Does the thing',
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input value' },
        },
        required: ['input'],
      },
      handler: async (args) => `Result: ${args.input}`,
    }];
  }
}

export default new MyPlugin();
```

Scaffold with tests:

```bash
conductor plugin create my-plugin
```

---

## Programmatic use

Use `@useconductor/sdk` to connect and call tools from your own code:

```bash
npm install @useconductor/sdk
```

```typescript
import { ConductorClient } from '@useconductor/sdk';

const client = new ConductorClient({ transport: 'stdio' });
await client.connect();

const tools = await client.listTools();
console.log(`${tools.length} tools available`);

const result = await client.callText('calculator_evaluate', { expression: '2 + 2' });
console.log(result); // "4"

await client.disconnect();
```

Remote (HTTP/SSE):

```typescript
const client = new ConductorClient({
  transport: 'http',
  url: 'http://localhost:3000',
});
```

---

## Architecture

```
src/
├── cli/           Commander CLI + commands
├── core/          Conductor orchestrator, config, database, interfaces
├── mcp/           MCP server — stdio + HTTP/SSE transport
├── plugins/       Plugin manager + 35 builtin plugins
├── ai/            Multi-provider AI (Claude, OpenAI, Gemini, Ollama, OpenRouter)
├── bot/           Telegram + Slack bot runtimes
├── dashboard/     Express web dashboard
└── security/      Keychain, RBAC, audit log
```

Every tool call goes through:

1. Zod input validation
2. RBAC permission check
3. Circuit breaker (opens after repeated failures)
4. Retry with exponential backoff
5. Tamper-evident audit logging (SHA-256 chained)
6. In-memory latency metrics

---

## Security

- **Secrets** — stored in OS keychain (macOS Keychain, Linux Secret Service, Windows Credential Manager), never in config files
- **Shell plugin** — allowlist-based, no `eval()` or unrestricted `exec()`
- **Dangerous tools** — `requiresApproval: true` requires explicit confirmation before execution
- **Audit log** — SHA-256 chained append-only JSONL at `~/.conductor/audit.log`
- **Rate limiting** — all HTTP endpoints behind `express-rate-limit`
- **Encryption** — secrets AES-256-GCM encrypted at rest, key derived from machine ID

---

## Supported MCP clients

Works with any client that supports MCP stdio transport:

- [Claude Desktop](https://claude.ai/download)
- [Cursor](https://cursor.com)
- [Cline (VS Code)](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev)
- [Continue.dev](https://continue.dev)
- [Windsurf (Codeium)](https://codeium.com/windsurf)
- [Zed](https://zed.dev)
- [Neovim (mcphub.nvim)](https://github.com/ravitemer/mcphub.nvim)
- [Aider](https://aider.chat)
- [OpenAI Desktop](https://openai.com/chatgpt/desktop)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- VS Code (GitHub Copilot)

Full setup instructions: [useconductor.com/docs/mcp-compatibility](https://useconductor.com/docs/mcp-compatibility)

---

## Config storage

Everything lives under `~/.conductor/`:

| Path | Contents |
|---|---|
| `config.json` | Non-secret settings |
| `conductor.db` | SQLite conversation history + activity log |
| `audit.log` | Tamper-evident audit chain (JSONL) |
| `plugins/` | External plugin `.js` files |
| `.key` | Machine-bound encryption key |

---

## License

Apache 2.0 — see [LICENSE](./LICENSE)

Built by [Alexander Wondwossen](https://github.com/thealxlabs) and contributors.
