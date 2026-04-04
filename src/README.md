# src

Root source directory for the Conductor MCP server. Contains all application modules organized by concern.

## Contents

- `core/` - Central orchestration, config, database, and plugin management
- `mcp/` - Model Context Protocol server implementation
- `plugins/` - Plugin system with builtin and external plugin support
- `cli/` - Command-line interface built with Commander
- `dashboard/` - Web dashboard (Express + single-page app)
- `ai/` - Multi-provider AI manager (Claude, OpenAI, Gemini, Ollama)
- `bot/` - Telegram bot and Slack Bolt integrations
- `security/` - Authentication, keychain, and encryption utilities
- `config/` - OAuth and configuration helpers
- `utils/` - Shared utility functions

## Architecture

This is the top-level source tree. All modules are imported from here and compiled to `dist/` via `tsx`. The codebase uses ESM (`"type": "module"`) with `Node16` module resolution — all imports must use `.js` extensions even for `.ts` source files.
