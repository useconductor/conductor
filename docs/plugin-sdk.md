# Plugin SDK

Create your own plugins for Conductor.

## Quick Start

```typescript
import { Plugin, PluginTool } from '@useconductor/conductor/plugins';

export class MyPlugin implements Plugin {
  name = 'my-plugin';
  description = 'My custom plugin';
  version = '1.0.0';

  async initialize(conductor) {
    // Setup - e.g., connect to API, load config
  }

  isConfigured(): boolean {
    // Return true if plugin has required credentials
    return true;
  }

  getTools(): PluginTool[] {
    return [
      {
        name: 'my_plugin_action',
        description: 'Does something useful',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Input description' }
          },
          required: ['input']
        },
        handler: async (args) => {
          const result = await this.doSomething(args.input);
          return { result };
        }
      }
    ];
  }

  // Optional: proactive context for AI
  async getContext() {
    return null;
  }
}
```

## Full Example

```typescript
import { Plugin, PluginTool, ToolContext } from '@useconductor/conductor/plugins';

export class GitHub IssuesPlugin implements Plugin {
  name = 'github-issues';
  description = 'Manage GitHub issues';
  version = '1.0.0';
  
  private apiKey?: string;
  private owner?: string;
  private repo?: string;

  async initialize(conductor) {
    const config = conductor.getConfig();
    this.apiKey = await conductor.getKeychain().get('github', 'token');
    
    const prefs = config.get('plugins.github-issues');
    this.owner = prefs?.owner;
    this.repo = prefs?.repo;
  }

  isConfigured(): boolean {
    return !!this.apiKey && !!this.owner && !!this.repo;
  }

  getTools(): PluginTool[] {
    return [
      {
        name: 'github_issues_list',
        description: 'List GitHub issues',
        inputSchema: {
          type: 'object',
          properties: {
            state: { 
              type: 'string', 
              enum: ['open', 'closed', 'all'],
              description: 'Issue state'
            },
            limit: {
              type: 'number',
              description: 'Max issues to return'
            }
          }
        },
        handler: async (args, context) => {
          return this.listIssues(args.state, args.limit);
        }
      },
      {
        name: 'github_issues_create',
        description: 'Create a GitHub issue',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            body: { type: 'string' },
            labels: { type: 'array', items: { type: 'string' } }
          },
          required: ['title']
        },
        handler: async (args) => {
          return this.createIssue(args.title, args.body, args.labels);
        }
      }
    ];
  }

  private async listIssues(state: string = 'open', limit: number = 10) {
    // Implementation
  }

  private async createIssue(title: string, body?: string, labels?: string[]) {
    // Implementation
  }
}
```

## Config Schema

For `conductor plugins setup <name>`:

```typescript
getConfigSchema() {
  return {
    fields: {
      owner: {
        label: 'GitHub Owner',
        type: 'string',
        required: true,
        description: 'Organization or username'
      },
      repo: {
        label: 'Repository',
        type: 'string', 
        required: true
      },
      token: {
        label: 'GitHub Token',
        type: 'password',
        secret: true,
        description: 'Personal access token'
      }
    }
  };
}
```

## Tool Handler Signature

```typescript
handler: async (
  args: Record<string, unknown>,  // Parsed input
  context: ToolContext            // Execution context
) => {
  // args = parsed and validated input
  // context.conductor = Conductor instance
  // context.user = user info (in multi-user mode)
  
  return { /* result */ };
}
```

## Publishing

```bash
# Build
npm run build

# Publish to npm
npm publish

# Or submit to Conductor marketplace
conductor plugins publish ./dist
```

## Types

```typescript
interface Plugin {
  name: string;
  description: string;
  version: string;
  
  initialize(conductor: Conductor): Promise<void>;
  isConfigured(): boolean;
  getTools(): PluginTool[];
  
  // Optional
  getConfigSchema?(): PluginConfigSchema;
  getContext?(): Promise<string | null>;
}

interface PluginTool {
  name: string;
  description: string;
  inputSchema: object;
  handler: (args: any, context: ToolContext) => Promise<any>;
  requiresApproval?: boolean;
}
```