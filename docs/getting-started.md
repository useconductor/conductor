# Getting Started

Install Conductor and connect your first AI agent in under 60 seconds.

## Prerequisites

- **Node.js 18+** (20+ recommended)
- **npm, pnpm, or yarn**

## Install

```bash
npm install -g @conductor/cli
```

## Quick Start

### Step 1: Start the MCP Server

```bash
conductor mcp start
```

That's it. The server starts with 20+ tools that work without any configuration:
- File system (read, write, list, search)
- Shell (safe commands only)
- Git (status, diff, log)
- Calculator (math, conversions, dates)
- Weather, crypto, network tools, and more

### Step 2: Connect Your AI Agent

**Claude Desktop:**
```bash
conductor mcp setup
```
Then restart Claude Desktop.

**Claude Code:**
Add to your `~/.claude/settings.json`:
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

**Cursor:**
Settings → MCP → Add Server → Command: `conductor`, Args: `mcp start`

**Cline:**
Settings → MCP Servers → Add → Command: `conductor`, Args: `mcp start`

### Step 3: Test It

Ask your AI agent:
- "What files are in the current directory?"
- "What's the weather in Tokyo?"
- "Calculate sqrt(144) + 2^8"
- "Show me the git status"

### Step 4: Enable More Plugins

```bash
# Enable GitHub integration
conductor plugins enable github
conductor config set github.token ghp_your_token

# Enable Docker integration
conductor plugins enable docker

# Enable database integration
conductor plugins enable database
conductor config set database.postgres_url postgresql://user:pass@host:5432/db
```

## Verify Everything Works

```bash
# Run the doctor command
conductor doctor

# Check health
conductor health

# List all available tools
conductor plugins list
```

## Next Steps

- [Configuration Guide](./configuration.md) — all settings explained
- [Plugin Development](./plugins.md) — build your own plugins
- [Webhook System](./webhooks.md) — event-driven integrations
- [Security](./security.md) — audit logs, RBAC, encryption
- [API Reference](./api.md) — every tool documented
