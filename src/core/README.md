# src/core

Core orchestration layer for Conductor. Contains the central `Conductor` class and its dependencies.

## Contents

- `conductor.ts` - Main orchestrator that owns ConfigManager, DatabaseManager, PluginManager, and AIManager
- `interfaces.ts` - Narrow interfaces (`IConfig`, `IDatabase`, `IPluginRegistry`) for dependency injection
- `config.ts` - Reads/writes `~/.conductor/config.json`
- `database.ts` - SQLite database via `sql.js` at `~/.conductor/conductor.db`
- `audit.ts` - SHA-256 chained append-only audit log at `~/.conductor/audit.log`
- `circuit-breaker.ts` - Per-tool circuit breaker for fault tolerance
- `retry.ts` - Exponential backoff retry logic
- `health.ts` - System health monitoring
- `webhooks.ts` - Webhook event handling
- `logger.ts` - Structured logging
- `errors.ts` - Custom error types
- `zero-config.ts` - Zero-configuration defaults

## Architecture

`Conductor` is the central hub. Consumers should depend on the interfaces in `interfaces.ts` rather than concrete classes. The core layer is initialized once and shared across the MCP server, CLI, bot, and dashboard.
