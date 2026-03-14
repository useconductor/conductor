# Contributing to Conductor

## Adding a New Plugin

Conductor plugins live in `src/plugins/builtin/`. Each plugin is a single TypeScript file
that exports a class implementing the `Plugin` interface.

### 1. Create the plugin file

```typescript
// src/plugins/builtin/myplugin.ts

import { Plugin, PluginTool, PluginConfigSchema } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

export class MyPlugin implements Plugin {
  name = 'myplugin';
  description = 'Short description shown in the dashboard';
  version = '1.0.0';

  // Required credentials, shown in dashboard Settings
  configSchema: PluginConfigSchema = {
    fields: [
      {
        key: 'api_key',
        label: 'API Key',
        type: 'password',
        required: true,
        secret: true,        // Store in encrypted keychain
        service: 'myplugin', // Keychain service name
        description: 'Your MyPlugin API key from https://myplugin.com/settings',
      },
    ],
    setupInstructions: '1. Go to myplugin.com/settings. 2. Copy your API key.',
  };

  private keychain!: Keychain;

  async initialize(conductor: Conductor): Promise<void> {
    this.keychain = new Keychain(conductor.getConfig().getConfigDir());
  }

  isConfigured(): boolean {
    // Return true to allow lazy validation in tool handlers.
    // The dashboard checks configSchema.fields against the keychain.
    return true;
  }

  // Optional: provide context for the proactive reasoning cycle
  async getContext(): Promise<string | null> {
    try {
      // Return a short summary string or null if nothing to report
      const apiKey = await this.keychain.get('myplugin', 'api_key');
      if (!apiKey) return null;
      // ... fetch data ...
      return '[MYPLUGIN] 3 pending items';
    } catch {
      return null;
    }
  }

  getTools(): PluginTool[] {
    return [
      {
        name: 'myplugin_do_thing',
        description: 'Do something with MyPlugin',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What to do' },
          },
          required: ['query'],
        },
        handler: async (input: { query: string }) => {
          try {
            const apiKey = await this.keychain.get('myplugin', 'api_key');
            if (!apiKey) {
              return 'MyPlugin not configured. Set your API key in the dashboard.';
            }
            // ... call the API ...
            return `Result: done`;
          } catch (err: any) {
            return `Error: ${err.message}`;
          }
        },
      },
    ];
  }
}
```

### 2. Register in the plugin index

Edit `src/plugins/builtin/index.ts`:

```typescript
import { MyPlugin } from './myplugin.js';

export function getAllBuiltinPlugins(): Plugin[] {
  return [
    // ... existing plugins ...
    new MyPlugin(),
  ];
}
```

### 3. Register credentials in the dashboard server

Edit `src/dashboard/server.ts`:

Add to `PLUGIN_REQUIRED_CREDS`:
```typescript
'myplugin': [{ service: 'myplugin', key: 'api_key' }],
```

Add to `KNOWN_CREDENTIALS`:
```typescript
{ service: 'myplugin', key: 'api_key' },
```

Add to `ALL_PLUGINS`:
```typescript
const ALL_PLUGINS: readonly string[] = [
  // ... existing ...
  'myplugin',
] as const;
```

### 4. Build and test

```bash
npm run build
node test-all.mjs --skip-auth
```

---

## Plugin Design Guidelines

### Tool handlers
- Always wrap the entire handler body in `try { ... } catch (err: any) { return \`Error: ${err.message}\`; }`
- Never `throw` from a handler — always return an error string
- Return either a plain string or a `Record<string, unknown>` object
- For destructive operations (delete, shell exec), add `requiresApproval: true`

### Credentials
- All secrets must go through `Keychain.set/get()` — never store raw secrets in config
- `configSchema` must describe every credential field with `secret: true` and `service: 'yourservice'`
- `isConfigured()` is synchronous — use it only as a hint; do real validation in the handler

### Zod validation (for new plugins)
Use Zod to validate handler inputs for robust error messages:

```typescript
import { z, ZodError } from 'zod';

handler: async (rawInput: Record<string, unknown>) => {
  try {
    const schema = z.object({
      query: z.string().min(1, 'query is required'),
      limit: z.number().int().min(1).max(100).optional().default(10),
    });
    const { query, limit } = schema.parse(rawInput);
    // ... use validated inputs ...
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      return `Validation error: ${err.issues.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')}`;
    }
    return `Error: ${(err as Error).message}`;
  }
},
```

---

## Credential Patterns

| Type | Keychain service | Key | Notes |
|------|-----------------|-----|-------|
| API key | plugin name | `api_key` | Standard |
| OAuth access token | `google` | `access_token` | Shared across Google plugins |
| OAuth refresh token | `google` | `refresh_token` | Auto-refreshed |
| Bot token | plugin name | `bot_token` | Telegram, Slack |
| Personal access token | `github` | `token` | GitHub |

---

## Tool Schema Format

Tool `inputSchema` uses JSON Schema:

```typescript
inputSchema: {
  type: 'object',
  properties: {
    required_string:  { type: 'string', description: '...' },
    optional_number:  { type: 'number', description: '...' },
    optional_boolean: { type: 'boolean', description: '...' },
    string_array:     { type: 'array', items: { type: 'string' } },
  },
  required: ['required_string'],
},
```

---

## TypeScript

- Run `npm run build` to compile
- Run `./node_modules/.bin/tsc --noEmit` to type-check without emitting
- All new code must compile without TypeScript errors before merging
- Use `// eslint-disable-next-line @typescript-eslint/no-explicit-any` only when necessary

---

## Testing

```bash
# Full suite
node test-all.mjs

# Skip tests requiring auth tokens
node test-all.mjs --skip-auth

# Run only new plugin tests
node test-all.mjs --suite newplugins

# Performance benchmarks
node test-all.mjs --suite bench
```
