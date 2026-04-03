# Changelog

All notable changes to Conductor will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-04-03

### The AI Tool Hub Release

Conductor is now the single MCP server that gives any AI agent access to 100+ tools.

#### Added
- **MCP Server v2** — Rewritten from scratch with metrics, dual transport (stdio + HTTP/SSE), auto-discovery
- **Zod Validation** — Every tool input validated before execution, zero `any` type leaks
- **Audit Logging** — Tamper-evident SHA-256 chained logs for every tool call, config change, auth event
- **Circuit Breakers** — Per-tool circuit breakers prevent cascading failures (closed → open → half_open)
- **Automatic Retries** — Exponential backoff with jitter on all transient failures
- **Health Check System** — `/health`, `/health/detailed`, `/health/ready` endpoints with per-plugin status
- **Webhook System** — Event-driven plugin communication with HMAC signatures, retry, failure tracking
- **Plugin SDK** — `@conductor/plugin-sdk` with type-safe plugin creation, Zod validation, testing utilities
- **SDKs for 8 Languages** — TypeScript, Python (complete), Go (complete), Rust, Java, Ruby, PHP, C#, Swift
- **CLI Enhancements** — `conductor doctor` (full system diagnosis), `conductor plugin create` (scaffold), `conductor health`
- **New Plugins** — Docker (9 tools), Databases (PostgreSQL/MySQL/MongoDB/Redis), Shell (safe execution with approval)
- **Gemini Tool Support** — Implemented function calling (was chat-only)
- **Ollama Tool Support** — Implemented tool calling via `/api/chat` tools parameter (was chat-only)
- **Rate Limiting** — All HTTP endpoints protected with `express-rate-limit`
- **Structured Logging** — Pino with pretty-print in dev, JSON in production
- **ESLint + Prettier** — Configured and passing
- **Vitest** — Real test framework with coverage reporting
- **CI Pipeline** — GitHub Actions: typecheck, lint, format, test, build across Node 18/20/22
- **Documentation** — Getting started, plugin development, webhook system, security, SDKs
- **CHANGELOG.md** — This file
- **SECURITY.md** — Updated with v1.0.0 positioning
- **`.env.example`** — All environment variables documented

#### Changed
- **Package renamed** — `@thealxlabs/conductor` → `@conductor/cli`
- **Version bumped** — 0.1.0 → 1.0.0
- **README rewritten** — "The AI Tool Hub" positioning
- **Calculator** — Replaced `new Function()` with `mathjs` (zero RCE risk)
- **Dashboard shell endpoint** — Removed (410 Gone), replaced `exec()` with `execFile()` whitelist
- **Plugin imports** — All 13 external plugins integrated with adapted imports
- **`ToolInput` type** — Changed from `Record<string, any>` to `Record<string, unknown>`

#### Fixed
- **Security** — Removed shell endpoint, replaced eval patterns, added rate limiting
- **Calculator** — No more `new Function()` execution
- **n8n plugin** — Removed personal URL from source comments
- **Spotify plugin** — Removed dead imports (crypto, fs/promises, http, path)
- **Plugin READMEs** — All 13 updated with correct tool names
- **Destructive operations** — Added `requiresApproval: true` to delete/merge/cancel tools
- **TypeScript errors** — All resolved, clean compilation

#### Removed
- Dashboard shell endpoint (`POST /api/system/shell` → 410 Gone)
- Process listing endpoint (`GET /api/system/processes` → 410 Gone)
- `new Function()` from calculator plugin
- `exec()` from dashboard (replaced with `execFile()`)
- Hand-rolled test scripts (replaced with Vitest)

---

## [0.1.0] — 2026-03-01

### Initial Release

- Universal AI integration hub
- 6 AI providers (Claude, OpenAI, Gemini, Ollama, OpenRouter, Maestro)
- 27 plugins, 150+ tools
- MCP server, Slack bot, Telegram bot, web dashboard, HTTP API
- Google OAuth, encrypted keychain (AES-256-GCM)
- Proactive autonomous mode
