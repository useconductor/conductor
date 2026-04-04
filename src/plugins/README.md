# src/plugins

Plugin system for Conductor. Every capability is a plugin implementing the `Plugin` interface.

## Contents

- `manager.ts` - `PluginManager` that handles registration, lazy initialization, and lifecycle
- `validation.ts` - Input validation for plugin tool calls
- `builtin/` - Built-in plugins shipped with Conductor

## Architecture

Plugins implement the `Plugin` interface:

```typescript
interface Plugin {
  name: string;
  description: string;
  version: string;
  initialize(conductor: Conductor): Promise<void>;
  isConfigured(): boolean;
  getTools(): PluginTool[];
  configSchema?: PluginConfigSchema;
  getContext?(): Promise<string | null>;
}
```

Plugins are **lazily initialized** — `PluginManager.getPlugin(name)` initializes on first call. Built-in plugins live in `builtin/`; external plugins are loaded from `~/.conductor/plugins/` as `.js` files.
