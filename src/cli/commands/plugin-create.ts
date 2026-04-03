/**
 * Conductor Plugin Create — scaffold a new plugin with tests.
 *
 * Usage: conductor plugin create my-plugin
 *
 * Generates:
 *   plugins/my-plugin/
 *   ├── index.ts       — Plugin source
 *   ├── index.test.ts  — Tests
 *   └── package.json   — Plugin metadata
 */

import fs from 'fs/promises';
import path from 'path';

export async function pluginCreate(name: string): Promise<void> {
  const pluginDir = path.join(process.cwd(), 'plugins', name);

  // Check if plugin already exists
  try {
    await fs.access(pluginDir);
    console.error(`\n  ❌ Plugin "${name}" already exists at ${pluginDir}\n`);
    process.exit(1);
  } catch {
    // Directory doesn't exist — good
  }

  // Create directory structure
  await fs.mkdir(pluginDir, { recursive: true });

  // Generate plugin source
  const pluginSource = `/**
 * ${name} — Auto-generated Conductor plugin
 *
 * Edit this file to add your tools.
 * Run: conductor plugins enable ${name}
 */

import { Plugin, PluginTool } from '../../src/plugins/manager.js';
import { Conductor } from '../../src/core/conductor.js';

export class ${pascalCase(name)}Plugin implements Plugin {
  name = '${name}';
  description = 'TODO: Describe your plugin';
  version = '1.0.0';

  async initialize(_conductor: Conductor): Promise<void> {}
  isConfigured(): boolean { return true; }

  getTools(): PluginTool[] {
    return [
      {
        name: '${name}_hello',
        description: 'Say hello',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name to greet' },
          },
          required: ['name'],
        },
        handler: async (input: { name: string }) => {
          return { message: \`Hello, \${input.name}!\` };
        },
      },
    ];
  }
}
`;

  // Generate test file
  const testSource = `import { describe, it, expect } from 'vitest';
import { ${pascalCase(name)}Plugin } from './index.js';

describe('${pascalCase(name)}Plugin', () => {
  it('defines tools correctly', () => {
    const plugin = new ${pascalCase(name)}Plugin();
    const tools = plugin.getTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  it('hello tool works', async () => {
    const plugin = new ${pascalCase(name)}Plugin();
    const tools = plugin.getTools();
    const helloTool = tools.find(t => t.name === '${name}_hello');
    expect(helloTool).toBeDefined();

    const result = await helloTool!.handler({ name: 'World' });
    expect(result).toEqual({ message: 'Hello, World!' });
  });
});
`;

  // Generate package.json
  const pkgJson = {
    name: `@conductor/plugin-${name}`,
    version: '1.0.0',
    description: `Conductor plugin: ${name}`,
    type: 'module',
    main: 'index.ts',
  };

  // Write files
  await fs.writeFile(path.join(pluginDir, 'index.ts'), pluginSource);
  await fs.writeFile(path.join(pluginDir, 'index.test.ts'), testSource);
  await fs.writeFile(path.join(pluginDir, 'package.json'), JSON.stringify(pkgJson, null, 2));

  console.log('');
  console.log(`  ✅ Plugin "${name}" created at ${pluginDir}`);
  console.log('');
  console.log('  📁 Files created:');
  console.log(`     ├── index.ts          — Plugin source`);
  console.log(`     ├── index.test.ts     — Tests`);
  console.log(`     └── package.json      — Metadata`);
  console.log('');
  console.log('  🚀 Next steps:');
  console.log(`     1. Edit plugins/${name}/index.ts to add your tools`);
  console.log(`     2. Run: npm test`);
  console.log(`     3. Run: conductor plugins enable ${name}`);
  console.log('');
}

function pascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}
