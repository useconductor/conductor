# src/plugins/builtin

Built-in plugins shipped with Conductor. Each file implements a `Plugin` for a specific capability.

## Contents

- `index.ts` - Registry of all builtin plugins
- `shell.ts` - Shell command execution with whitelist allowlist
- `github.ts` / `github-actions.ts` - GitHub repository and CI/CD operations
- `gcal.ts` / `gdrive.ts` / `gmail.ts` - Google Workspace integrations
- `slack.ts` - Slack messaging and channel management
- `linear.ts` / `notion.ts` / `todoist.ts` - Project management tools
- `docker.ts` - Docker container management
- `database.ts` - Database query operations
- `calculator.ts` / `crypto.ts` / `hash.ts` - Math and crypto utilities
- `text-tools.ts` / `url-tools.ts` / `translate.ts` - Text manipulation
- `weather.ts` / `timezone.ts` / `system.ts` - System and info tools
- `n8n.ts` / `vercel.ts` / `spotify.ts` / `x.ts` - Third-party service integrations
- `cron.ts` / `memory.ts` / `notes.ts` / `fun.ts` / `colors.ts` / `network.ts` / `homekit.ts` / `lumen.ts` - Utility plugins

## Architecture

Each plugin is auto-registered via `index.ts` and lazily initialized by `PluginManager`. Plugins declare their tools via `getTools()` and can provide config schemas for `conductor config setup <plugin>`. Secret credentials use `secret: true` fields stored in the OS keychain.
