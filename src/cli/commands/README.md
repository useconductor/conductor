# src/cli/commands

Individual CLI command implementations for Conductor.

## Contents

- `plugins.ts` - Enable/disable/list/install plugins
- `mcp.ts` - Start/setup MCP server
- `lifecycle.ts` - Start/stop/status for Conductor services
- `doctor.ts` - System health diagnostics
- `marketplace.ts` - Plugin marketplace operations
- `plugin-create.ts` - Scaffold new plugins
- `ai.ts` - AI provider configuration
- `init.ts` / `onboard.ts` - Initial setup and onboarding
- `install.ts` - Installation utilities
- `telegram.ts` - Telegram bot configuration

## Architecture

Each command is a Commander subcommand registered in `src/cli/index.ts`. Commands interact with the `Conductor` instance to manage plugins, configure AI providers, control service lifecycle, and perform diagnostics.
