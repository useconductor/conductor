/**
 * conductor config — read and write configuration keys.
 *
 * Commands:
 *   conductor config list            — show all config keys and values
 *   conductor config get <key>       — get a specific key
 *   conductor config set <key> <val> — set a key
 *   conductor config path            — print config file path
 *   conductor config export          — dump config as JSON
 *   conductor config reset           — reset to defaults (with confirmation)
 *   conductor config validate        — validate config structure
 */

import type { Conductor } from '../../core/conductor.js';

function flattenConfig(obj: unknown, prefix = ''): Array<[string, unknown]> {
  if (typeof obj !== 'object' || obj === null) {
    return [[prefix, obj]];
  }
  const result: Array<[string, unknown]> = [];
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      result.push(...flattenConfig(val, fullKey));
    } else {
      result.push([fullKey, val]);
    }
  }
  return result;
}

function maskSecret(key: string, value: unknown): unknown {
  if (/token|secret|password|api_key|key_stored/i.test(key)) {
    if (typeof value === 'string' && value.length > 0) return '***';
  }
  return value;
}

export async function configList(
  conductor: Conductor,
  opts: { json?: boolean; show_secrets?: boolean },
): Promise<void> {
  await conductor.initialize();
  const config = conductor.getConfig().getConfig();

  if (opts.json) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  const pairs = flattenConfig(config);

  console.log('');
  console.log('  ⚙️  Configuration\n');
  console.log(`  ${'KEY'.padEnd(40)} VALUE`);
  console.log('  ' + '─'.repeat(70));
  for (const [key, val] of pairs) {
    const display = opts.show_secrets ? val : maskSecret(key, val);
    const str = Array.isArray(val) ? `[${(val as unknown[]).join(', ')}]` : String(display ?? '');
    console.log(`  ${key.padEnd(40)} ${str}`);
  }
  console.log('');
  console.log(`  Config file: ${conductor.getConfig().getConfigDir()}/config.json\n`);
}

export async function configGet(conductor: Conductor, key: string, opts: { json?: boolean }): Promise<void> {
  await conductor.initialize();
  const value = conductor.getConfig().get(key);

  if (value === undefined) {
    console.error(`\n  ❌ Key "${key}" not found.\n`);
    console.log('  Run: conductor config list  to see all keys.\n');
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify({ key, value }));
    return;
  }

  console.log(`\n  ${key}: ${JSON.stringify(value)}\n`);
}

export async function configSet(conductor: Conductor, key: string, value: string): Promise<void> {
  await conductor.initialize();

  // Try to parse as JSON, fall back to string
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = value;
  }

  await conductor.getConfig().set(key, parsed);
  console.log(`\n  ✅ Set ${key} = ${JSON.stringify(parsed)}\n`);
}

export async function configPath(conductor: Conductor): Promise<void> {
  await conductor.initialize();
  const dir = conductor.getConfig().getConfigDir();
  console.log(`\n  ${dir}/config.json\n`);
}

export async function configExport(conductor: Conductor, opts: { output?: string; pretty?: boolean }): Promise<void> {
  await conductor.initialize();
  const config = conductor.getConfig().getConfig();
  const content = opts.pretty === false ? JSON.stringify(config) : JSON.stringify(config, null, 2);

  if (opts.output) {
    const { writeFile } = await import('fs/promises');
    await writeFile(opts.output, content + '\n', 'utf-8');
    console.log(`\n  ✅ Config exported to: ${opts.output}\n`);
  } else {
    console.log(content);
  }
}

export async function configReset(conductor: Conductor, opts: { yes?: boolean }): Promise<void> {
  if (!opts.yes) {
    const { default: inquirer } = await import('inquirer');
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Reset configuration to defaults? This cannot be undone.',
        default: false,
      },
    ]);
    if (!confirm) {
      console.log('\n  Cancelled.\n');
      return;
    }
  }

  await conductor.initialize();
  const dir = conductor.getConfig().getConfigDir();

  // Write an empty config to trigger re-initialization to defaults
  const { writeFile } = await import('fs/promises');
  await writeFile(`${dir}/config.json`, '{}', 'utf-8');

  console.log('\n  ✅ Configuration reset to defaults.\n');
  console.log('  Run: conductor init  to set up from scratch.\n');
}

export async function configValidate(conductor: Conductor): Promise<void> {
  await conductor.initialize();
  const config = conductor.getConfig().getConfig();
  const issues: string[] = [];

  // Basic structural checks
  if (config.ai?.provider && !['claude', 'openai', 'gemini', 'ollama'].includes(config.ai.provider)) {
    issues.push(`ai.provider "${config.ai.provider}" is not a recognized provider`);
  }

  if (config.plugins?.enabled && !Array.isArray(config.plugins.enabled)) {
    issues.push('plugins.enabled must be an array');
  }

  if (config.plugins?.installed && !Array.isArray(config.plugins.installed)) {
    issues.push('plugins.installed must be an array');
  }

  console.log('');
  if (issues.length === 0) {
    console.log('  ✅ Configuration is valid.\n');
  } else {
    console.log('  ❌ Configuration issues found:\n');
    for (const issue of issues) {
      console.log(`    • ${issue}`);
    }
    console.log('');
    process.exit(1);
  }
}
