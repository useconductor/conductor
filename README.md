# Conductor

**The AI Tool Hub.** One MCP server. 100+ tools. Every AI agent.

[![CI](https://github.com/conductor/conductor/actions/workflows/ci.yml/badge.svg)](https://github.com/conductor/conductor/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@conductor/cli)](https://www.npmjs.com/package/@conductor/cli)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

## One Connection. Every Tool.

Conductor is the single MCP server that gives **any AI agent** access to 100+ real-world tools. No more configuring 10 different MCP servers. No more managing 10 different auth flows. One line of config, everything works.

Add this to your AI agent's MCP config:

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

Now **Claude Code**, **Cursor**, **Cline**, **Aider**, and every other MCP-compatible AI agent instantly gets access to:

| Category | Tools |
|----------|-------|
| **GitHub** | repos, issues, PRs, stars, trending, actions |
| **Docker** | containers, images, volumes, networks, stats, run |
| **Databases** | PostgreSQL, MySQL, MongoDB, Redis queries |
| **File System** | read, write, list, search, grep |
| **Shell** | safe command execution with approval workflow |
| **Git** | status, diff, log, branch operations |
| **Calculator** | math expressions, unit conversions, date math |
| **Web** | search, scrape, URL tools, translate |
| **System** | info, network, crypto, hash, colors |
| **Google** | Gmail, Calendar, Drive |
| **Productivity** | Notion, Todoist, Slack, notes, cron |
| **And more** | Vercel, n8n, weather, timezone, memory |

## Install

```bash
npm install -g @conductor/cli
```

## Quick Start

```bash
# Start the MCP server
conductor mcp start

# Enable plugins
conductor plugins enable github
conductor plugins enable docker
conductor plugins enable shell

# Configure credentials
conductor config set github.token ghp_your_token_here

# Check status
conductor plugins list
```

## Works With Every AI Agent

Conductor connects to any MCP-compatible client:

- **Claude Desktop** — `conductor mcp setup`
- **Claude Code** — add to `claude.json` MCP config
- **Cursor** — add to Cursor MCP settings
- **Cline** — add to Cline MCP servers
- **Aider** — configure as external tool
- **Any MCP client** — stdio or HTTP transport

## Architecture

```
┌─────────────────────────────────────────────────┐
│              AI Agent (any MCP client)          │
│  Claude Code  │  Cursor  │  Cline  │  Aider     │
└──────────────────────┬──────────────────────────┘
                       │ MCP Protocol (stdio/HTTP)
                       ▼
┌─────────────────────────────────────────────────┐
│              Conductor MCP Server               │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │  GitHub   │  │  Docker   │  │  Databases    │ │
│  │  Plugin   │  │  Plugin   │  │   Plugin      │ │
│  └──────────┘  └──────────┘  └───────────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │   Shell   │  │    Git    │  │  Calculator   │ │
│  │  Plugin   │  │  Plugin   │  │   Plugin      │ │
│  └──────────┘  └──────────┘  └───────────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │  Google   │  │  Slack    │  │  + 90 more    │ │
│  │  Plugin   │  │  Plugin   │  │   plugins     │ │
│  └──────────┘  └──────────┘  └───────────────┘ │
│                                                 │
│  Encrypted Keychain │ Zod Validation │ Metrics  │
└─────────────────────────────────────────────────┘
```

## Security

- **Encrypted keychain** — AES-256-GCM with machine-bound key derivation
- **Zod validation** — every plugin input is validated before execution
- **Safe shell** — whitelist-based command filtering, no `eval()`, no `exec()`
- **Plugin sandboxing** — plugins run with minimal permissions
- **Approval workflow** — dangerous operations require explicit user approval
- **Rate limiting** — all endpoints protected against abuse

## Plugin System

Build your own plugins. Drop a `.js` file in `~/.conductor/plugins/` and it's available via MCP.

```typescript
import { Plugin, PluginTool } from '@conductor/cli';

export class MyPlugin implements Plugin {
  name = 'my-plugin';
  description = 'My awesome plugin';
  version = '1.0.0';

  async initialize() {}
  isConfigured() { return true; }

  getTools(): PluginTool[] {
    return [{
      name: 'my_tool',
      description: 'Does something awesome',
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Your input' },
        },
        required: ['input'],
      },
      handler: async (input: { input: string }) => {
        return { result: `You said: ${input.input}` };
      },
    }];
  }
}
```

## Development

```bash
git clone https://github.com/conductor/conductor.git
cd conductor
npm install
npm run build
npm run dev          # Watch mode
npm test             # Run tests
npm run test:coverage # With coverage
npm run lint         # ESLint
npm run format       # Prettier
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `conductor mcp start` | Start MCP server (stdio) |
| `conductor mcp setup` | Configure for Claude Desktop |
| `conductor mcp status` | Show MCP status |
| `conductor plugins list` | List all plugins |
| `conductor plugins enable <name>` | Enable a plugin |
| `conductor plugins disable <name>` | Disable a plugin |
| `conductor ai setup` | Configure AI providers |
| `conductor ai test` | Test AI provider |

## License

Apache-2.0
