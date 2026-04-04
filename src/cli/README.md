# src/cli

Command-line interface for Conductor, built with Commander.

## Contents

- `index.ts` - CLI entry point, command registration
- `commands/` - Individual CLI command implementations

## Architecture

The CLI is the primary user interface for managing Conductor. Entry point is `src/cli/index.ts`. Commands live in `commands/` and cover plugin management, MCP server setup, lifecycle control, diagnostics, and plugin scaffolding.

Run locally without building:

```bash
npx tsx src/cli/index.ts <command>
```

After building:

```bash
node dist/cli/index.js <command>
```
