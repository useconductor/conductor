/**
 * conductor onboard — interactive TUI plugin picker
 *
 * Lets users browse all available plugins by category, select which ones
 * to enable, and immediately configure credentials for any that need them.
 * Works on first install or any time via `conductor plugins onboard`.
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import { Conductor } from '../../core/conductor.js';
import { PluginManager } from '../../plugins/manager.js';

interface _PluginEntry {
  name: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  zeroConfig: boolean;
  category: string;
}

// Category groupings for the TUI picker
const CATEGORIES: Record<string, string[]> = {
  'Developer Tools': ['shell', 'docker', 'github', 'git', 'github-actions', 'vercel', 'n8n', 'linear', 'jira'],
  Communication: ['slack', 'telegram'],
  'Google Workspace': ['gmail', 'google-calendar', 'google-drive'],
  Productivity: ['notes', 'memory', 'notion', 'todoist'],
  'Finance & Commerce': ['stripe'],
  Utilities: [
    'calculator',
    'colors',
    'crypto',
    'hash',
    'text-tools',
    'timezone',
    'network',
    'url-tools',
    'fun',
    'system',
    'cron',
    'weather',
    'translate',
  ],
  'Media & Social': ['spotify', 'x'],
  'Smart Home': ['homekit'],
};

const ZERO_CONFIG_SET = new Set([
  'calculator',
  'colors',
  'hash',
  'text-tools',
  'timezone',
  'network',
  'url-tools',
  'fun',
  'system',
  'notes',
  'memory',
  'cron',
  'shell',
  'docker',
  'github',
  'translate',
  'weather',
  'crypto',
]);

function header(): void {
  console.log('');
  console.log(chalk.bold.white('  ╔══════════════════════════════════════╗'));
  console.log(chalk.bold.white('  ║') + chalk.bold('  🎼 Conductor — Plugin Setup          ') + chalk.bold.white('║'));
  console.log(chalk.bold.white('  ╚══════════════════════════════════════╝'));
  console.log('');
  console.log(chalk.dim('  Select the plugins you want to enable.'));
  console.log(
    chalk.dim('  Zero-config plugins ') + chalk.green('[free]') + chalk.dim(' work instantly — no credentials needed.'),
  );
  console.log('');
}

function categoryHeader(name: string): void {
  console.log('  ' + chalk.bold.white('─── ' + name + ' '));
}

export async function onboard(conductor: Conductor): Promise<void> {
  await conductor.initialize();
  const pm = new PluginManager(conductor);
  await pm.loadBuiltins();

  header();

  const available = pm.listPlugins();
  const availableByName = new Map(available.map((p) => [p.name, p]));
  const currentlyEnabled = new Set(available.filter((p) => p.enabled).map((p) => p.name));

  // Build choices grouped by category
  const choices: Array<{ type?: string; name?: string; value?: string; checked?: boolean; short?: string }> = [];

  for (const [catName, pluginNames] of Object.entries(CATEGORIES)) {
    categoryHeader(catName);

    const catChoices = pluginNames
      .filter((name) => availableByName.has(name))
      .map((name) => {
        const p = availableByName.get(name)!;
        const zc = ZERO_CONFIG_SET.has(name);
        const badge = zc ? ' ' + chalk.green('[zero-config]') : ' ' + chalk.yellow('[needs setup]');

        return {
          name: `${chalk.white(p.name.padEnd(22))} ${chalk.dim(p.description)}${badge}`,
          value: name,
          checked: currentlyEnabled.has(name) || zc,
          short: name,
        };
      });

    if (catChoices.length > 0) {
      choices.push({ type: 'separator', name: '' });
      choices.push(...catChoices);
    }
  }

  // Also include plugins not in any category
  const categorized = new Set(Object.values(CATEGORIES).flat());
  const uncategorized = available.filter((p) => !categorized.has(p.name));
  if (uncategorized.length > 0) {
    categoryHeader('Other Plugins');
    choices.push({ type: 'separator', name: '' });
    for (const p of uncategorized) {
      const zc = ZERO_CONFIG_SET.has(p.name);
      choices.push({
        name: `${chalk.white(p.name.padEnd(22))} ${chalk.dim(p.description)}${zc ? chalk.green(' [zero-config]') : chalk.yellow(' [needs setup]')}`,
        value: p.name,
        checked: currentlyEnabled.has(p.name) || zc,
        short: p.name,
      });
    }
  }

  console.log('');
  const { selected } = await inquirer.prompt<{ selected: string[] }>([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select plugins to enable (Space to toggle, Enter to confirm):',
      choices,
      pageSize: 24,
    },
  ]);

  if (selected.length === 0) {
    console.log('');
    console.log(chalk.yellow('  No plugins selected. Run conductor onboard again to pick plugins.'));
    console.log('');
    return;
  }

  // Determine which newly selected plugins need configuration
  const toEnable = selected;
  const needsSetup = toEnable.filter((name) => !ZERO_CONFIG_SET.has(name) && !currentlyEnabled.has(name));

  // Update enabled list
  const newEnabled = [...new Set([...Array.from(currentlyEnabled), ...toEnable])];
  await conductor.getConfig().set('plugins.enabled', newEnabled);

  console.log('');
  console.log(chalk.bold.white('  ✓ Updated plugin list'));
  console.log('');

  // Offer to configure each credentialed plugin that was just selected
  if (needsSetup.length > 0) {
    console.log(chalk.dim(`  The following plugins need credentials to work:`));
    for (const name of needsSetup) {
      console.log(`    ${chalk.yellow('⚠')} ${chalk.white(name)}`);
    }
    console.log('');

    const { configureNow } = await inquirer.prompt<{ configureNow: boolean }>([
      {
        type: 'confirm',
        name: 'configureNow',
        message: 'Configure credentials for these plugins now?',
        default: true,
      },
    ]);

    if (configureNow) {
      for (const name of needsSetup) {
        await setupPlugin(conductor, pm, name);
      }
    } else {
      console.log('');
      console.log(chalk.dim('  Configure later with:'));
      for (const name of needsSetup) {
        console.log(`    ${chalk.cyan(`conductor plugins setup ${name}`)}`);
      }
    }
  }

  // Final summary
  console.log('');
  console.log(chalk.bold.white('  ─────────────────────────────────────────'));
  console.log(chalk.bold.white(`  🎼 ${toEnable.length} plugins enabled — ready to start`));
  console.log('');
  console.log(chalk.dim('  Start the MCP server:'));
  console.log(`    ${chalk.cyan('conductor mcp start')}`);
  console.log('');
  console.log(chalk.dim('  Or connect your AI agent (auto-configures Claude Desktop):'));
  console.log(`    ${chalk.cyan('conductor mcp setup')}`);
  console.log('');
}

async function setupPlugin(conductor: Conductor, _pm: PluginManager, name: string): Promise<void> {
  console.log('');
  console.log(chalk.bold(`  ── Setting up ${chalk.white(name)} ──`));

  const pm2 = new PluginManager(conductor);
  await pm2.loadBuiltins();
  const plugins = pm2.listPlugins();
  const p = plugins.find((x) => x.name === name);

  if (!p) {
    console.log(chalk.yellow(`  Plugin "${name}" not found — skipping`));
    return;
  }

  if (!p.configSchema || p.configSchema.fields.length === 0) {
    console.log(chalk.green(`  ✓ ${name} requires no configuration`));
    return;
  }

  if (p.configSchema.setupInstructions) {
    console.log('');
    console.log(chalk.dim('  ' + p.configSchema.setupInstructions.split('\n').join('\n  ')));
    console.log('');
  }

  // Build inquirer prompts from the plugin's configSchema
  const prompts = p.configSchema.fields.map((field) => ({
    type: field.type === 'password' ? 'password' : field.type === 'boolean' ? 'confirm' : 'input',
    name: field.key,
    message: `${field.label}${field.required ? '' : ' (optional)'}:`,
    mask: field.type === 'password' ? '*' : undefined,
    validate: (input: string) => {
      if (field.required && !input) return `${field.label} is required`;
      return true;
    },
  }));

  const answers = await inquirer.prompt<Record<string, string>>(prompts);

  // Persist the values
  const { Keychain } = await import('../../security/keychain.js');
  const keychain = new Keychain(conductor.getConfig().getConfigDir());

  for (const field of p.configSchema.fields) {
    const value = answers[field.key];
    if (!value) continue;

    if (field.secret) {
      await keychain.set(field.service ?? name, field.key, value);
    } else {
      await conductor.getConfig().set(`plugins.${name}.${field.key}`, value);
    }
  }

  console.log(chalk.green(`  ✓ ${name} configured`));
}
