# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # Compile TypeScript → dist/
npm run dev            # Watch mode (tsx watch)
npm test               # Run all tests (vitest)
npm run test:watch     # Watch mode tests
npm run test:coverage  # Coverage report
npm run typecheck      # Type-check without emit
npm run lint           # ESLint
npm run lint:fix       # ESLint with auto-fix
npm run format         # Prettier
```

**Run a single test file:**
```bash
npx vitest run tests/calculator.test.ts
```

**Run the CLI locally (without building):**
```bash
npx tsx src/cli/index.ts <command>
```

**After building, run the CLI:**
```bash
node dist/cli/index.js <command>
# or if globally linked:
conductor <command>
```

Tests live in `tests/` and match `**/*.test.ts`. The `postbuild` script copies `src/dashboard/index.html` to `dist/dashboard/index.html` — if you add other static assets to `src/dashboard/`, add them to the postbuild script too.

## Architecture

Conductor is an **MCP (Model Context Protocol) server** that exposes a plugin system as tools to AI agents. The codebase is ESM TypeScript (`"type": "module"`, `Node16` module resolution). All imports must use `.js` extensions even for `.ts` source files.

### Core Object Model

`Conductor` (`src/core/conductor.ts`) is the central orchestrator. It owns:
- `ConfigManager` — reads/writes `~/.conductor/config.json`
- `DatabaseManager` — SQLite via `sql.js` at `~/.conductor/conductor.db`
- `PluginManager` — lazy-initializes plugins on first use
- `AIManager` — multi-provider AI (Claude, OpenAI, Gemini, Ollama)

Consumers should depend on the narrow interfaces in `src/core/interfaces.ts` (`IConfig`, `IDatabase`, `IPluginRegistry`) rather than the concrete classes.

### Plugin System

Every capability is a plugin implementing the `Plugin` interface (`src/plugins/manager.ts`):

```typescript
interface Plugin {
  name: string; description: string; version: string;
  initialize(conductor: Conductor): Promise<void>;
  isConfigured(): boolean;
  getTools(): PluginTool[];
  configSchema?: PluginConfigSchema;  // for `conductor config setup <plugin>`
  getContext?(): Promise<string | null>; // proactive reasoning cycle
}
```

Plugins are **lazily initialized** — `PluginManager.getPlugin(name)` initializes on first call. All builtins are in `src/plugins/builtin/` and registered via `src/plugins/builtin/index.ts`. External plugins drop `.js` files into `~/.conductor/plugins/`. Current builtin count: ~35 plugins including github (20 tools), slack, gmail, notion, gcal, gdrive, docker, shell, vercel, n8n, github-actions, linear, jira, stripe, spotify, x, homekit, todoist, lumen, and 15+ zero-config utilities.

Secret credentials use `configSchema.fields[].secret = true` and are stored in the OS keychain, not `config.json`.

### MCP Server (`src/mcp/server.ts`)

The MCP server wraps every plugin tool with:
1. **Circuit breaker** per tool (`src/core/circuit-breaker.ts`) — opens after repeated failures
2. **Retry with exponential backoff** (`src/core/retry.ts`)
3. **Audit logging** (`src/core/audit.ts`) — SHA-256 chained append-only log at `~/.conductor/audit.log`
4. **Metrics** — in-memory call counts and latency per tool
5. **Zod validation** (`src/plugins/validation.ts`) — validates inputs before handler invocation

Transport: `StdioServerTransport` for AI agent integration; HTTP/SSE for the dashboard.

### Dashboard (`src/dashboard/`)

Express server (`server.ts`) serving a single-page app (`index.html`). The CLI (`cli.ts`) in the same directory exposes dashboard commands. The dashboard consumes metrics, audit, health, and webhook data from the MCP server's shared state.

### CLI (`src/cli/`)

Built with `commander`. Entry point: `src/cli/index.ts`. Commands live in `src/cli/commands/`:
- `init.ts` — first-run wizard (AI provider + plugin picker + client config)
- `plugins.ts` — enable/disable/list/install
- `onboard.ts` — interactive TUI plugin picker (also accessible as `plugins onboard`)
- `mcp.ts` — start/setup MCP server
- `lifecycle.ts` — start/stop/status
- `doctor.ts` — system health diagnostics
- `marketplace.ts` — plugin marketplace (`conductor plugins install <id>` downloads from GitHub raw)
- `plugin-create.ts` — scaffold new plugins

`install.sh` in root: one-line bash installer (`curl -fsSL .../install.sh | bash`). Checks Node ≥ 18, installs `@conductor/cli` globally, prompts to run `conductor init`.

### Config Storage

All state lives under `~/.conductor/`:
- `config.json` — non-secret settings
- `conductor.db` — SQLite conversation history + activity log
- `audit.log` — tamper-evident audit chain (JSONL)
- `plugins/` — external plugin `.js` files
- `.key` — machine-bound encryption key (AES-256-GCM)

### Security Model

- Shell plugin uses a whitelist allowlist — no `eval()` or `exec()`
- Dangerous tools set `requiresApproval: true` on `PluginTool`
- Secrets are AES-256-GCM encrypted, key derived from machine ID
- All HTTP endpoints behind `express-rate-limit`

### Bot Runtime (`src/bot/`)

Telegram bot and Slack bolt integration share the same `Conductor` instance. The proactive reasoning cycle runs on a timer, calling `plugin.getContext()` on each enabled plugin and feeding results to the AI manager.
