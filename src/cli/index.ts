#!/usr/bin/env node

import { createRequire } from 'module';
import { Command } from 'commander';
import { Conductor } from '../core/conductor.js';
import { PluginManager } from '../plugins/manager.js';
import { registerLifecycleCommands } from './commands/lifecycle.js';

const _require = createRequire(import.meta.url);
const { version: pkgVersion } = _require('../../package.json') as { version: string };

const program = new Command();
const conductor = new Conductor();

program
  .name('conductor')
  .description('The AI Tool Hub — One MCP server. 100+ tools. Every AI agent.')
  .version(pkgVersion);

registerLifecycleCommands(program, conductor);

// ── AI ───────────────────────────────────────────────────────────────
const ai = program.command('ai').description('Configure AI providers');

ai.command('setup')
  .description('Interactive AI provider setup')
  .action(async () => {
    const { setupAI } = await import('./commands/ai.js');
    await setupAI(conductor);
  });

ai.command('test')
  .description('Test current AI provider')
  .action(async () => {
    const { testAI } = await import('./commands/ai.js');
    await testAI(conductor);
  });

// ── MCP ──────────────────────────────────────────────────────────────
const mcp = program.command('mcp').description('MCP server management');

mcp
  .command('setup')
  .description('Configure MCP for Claude Desktop')
  .action(async () => {
    const { mcpSetup } = await import('./commands/mcp.js');
    await mcpSetup(conductor);
  });

mcp
  .command('status')
  .description('Show MCP server status')
  .action(async () => {
    const { mcpStatus } = await import('./commands/mcp.js');
    await mcpStatus(conductor);
  });

mcp
  .command('start')
  .description('Start MCP server (stdio)')
  .action(async () => {
    const { mcpStart } = await import('./commands/mcp.js');
    await mcpStart(conductor);
  });

mcp
  .command('remove')
  .description('Remove MCP configuration')
  .action(async () => {
    const { mcpRemove } = await import('./commands/mcp.js');
    await mcpRemove(conductor);
  });

// ── Telegram ─────────────────────────────────────────────────────────
const telegram = program.command('telegram').description('Telegram bot');

telegram
  .command('start')
  .description('Start the Telegram bot')
  .action(async () => {
    const { TelegramBot } = await import('../bot/telegram.js');
    await conductor.initialize();
    const bot = new TelegramBot(conductor);
    await bot.start();
  });

telegram
  .command('setup')
  .description('Configure Telegram bot token')
  .action(async () => {
    const { telegramSetup } = await import('./commands/telegram.js');
    await telegramSetup(conductor);
  });

// ── Plugins (register both "plugins" and "plugin") ──────────────────
function registerPluginCommands(parent: Command, cmdName: string): void {
  const cmd = parent.command(cmdName).description('Plugin management');

  cmd
    .command('list')
    .description('List all plugins')
    .action(async () => {
      await conductor.initialize();
      const pm = new PluginManager(conductor);
      await pm.loadBuiltins();

      const list = pm.listPlugins();
      const enabledNames = conductor.getConfig().get<string[]>('plugins.enabled') || [];

      console.log('');
      console.log(`  🔌 Plugins (${list.length} available)\n`);
      for (const p of list) {
        const icon = enabledNames.includes(p.name) ? '🟢' : '⚪';
        console.log(`  ${icon} ${p.name}`);
        console.log(`     ${p.description}`);
        console.log('');
      }
      if (enabledNames.length === 0) {
        console.log(`  Enable plugins with: conductor plugins enable <name>\n`);
      }
    });

  cmd
    .command('enable')
    .argument('<name>', 'Plugin name')
    .description('Enable a plugin')
    .action(async (name: string) => {
      await conductor.initialize();
      const pm = new PluginManager(conductor);
      await pm.loadBuiltins();
      try {
        await pm.enablePlugin(name);
        console.log(`  ✓ Plugin "${name}" enabled`);
      } catch (e: any) {
        console.error(`  ✗ ${e.message}`);
        process.exit(1);
      }
    });

  cmd
    .command('disable')
    .argument('<name>', 'Plugin name')
    .description('Disable a plugin')
    .action(async (name: string) => {
      await conductor.initialize();
      const pm = new PluginManager(conductor);
      await pm.loadBuiltins();
      try {
        await pm.disablePlugin(name);
        console.log(`  ✓ Plugin "${name}" disabled`);
      } catch (e: any) {
        console.error(`  ✗ ${e.message}`);
        process.exit(1);
      }
    });
}

registerPluginCommands(program, 'plugins');
registerPluginCommands(program, 'plugin');

// ── Proactive (Autonomous) ──────────────────────────────────────────
const proactive = program.command('proactive').description('Autonomous agent management');

proactive
  .command('start')
  .description('Start the proactive autonomous loop')
  .option('-i, --interval <minutes>', 'Interval between cycles', '30')
  .action(async (options: { interval: string }) => {
    await conductor.initialize();
    await conductor.startProactiveMode(parseInt(options.interval));

    // Keep process alive
    console.log(`\n  🤖 Proactive mode active (every ${options.interval}m). Press Ctrl+C to stop.\n`);
    process.on('SIGINT', async () => {
      await conductor.stopProactiveMode();
      process.exit(0);
    });
  });

// ── Google (Convenience Alias) ──────────────────────────────────────
program
  .command('google')
  .description('Alias for "auth google" — browser-based setup')
  .option('-f, --file <path>', 'Import credentials from Google JSON file')
  .action(async (options: { file?: string }) => {
    const { GoogleAuthManager } = await import('../utils/google-auth.js');
    await conductor.initialize();
    const authManager = new GoogleAuthManager(conductor);

    if (options.file) {
      try {
        await authManager.importFromJson(options.file);
      } catch (error: any) {
        console.error(`\n  ❌ ${error.message}\n`);
        process.exit(1);
      }
    }

    const scopes = [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/drive',
    ];

    try {
      await authManager.login({ scopes });
      console.log('\n  ✅ Google authentication successful!');
      console.log('  🔌 Gmail, Calendar, Drive, and Gemini are now ready.\n');
    } catch (error: any) {
      console.error(`\n  ❌ Authentication failed: ${error.message}\n`);
      process.exit(1);
    }
  });

// ── Slack ──────────────────────────────────────────────────────────
const slack = program.command('slack').description('Slack bot management');

slack
  .command('setup')
  .description('Configure Slack Bot and App tokens')
  .action(async () => {
    const { Keychain } = await import('../security/keychain.js');
    const { default: inquirer } = await import('inquirer');
    await conductor.initialize();
    const keychain = new Keychain(conductor.getConfig().getConfigDir());

    console.log('\n  🤖 Slack Setup');
    console.log('  To get these, create an app at: https://api.slack.com/apps');
    console.log('  1. Bot User OAuth Token (xoxb-...) in "OAuth & Permissions"');
    console.log('  2. App-Level Token (xapp-...) in "Basic Information"\n');

    const answers = await inquirer.prompt([
      {
        type: 'password',
        name: 'botToken',
        message: 'Enter Slack Bot User OAuth Token (xoxb-):',
        mask: '*',
        validate: (input) => input.startsWith('xoxb-') || 'Must start with xoxb-',
      },
      {
        type: 'password',
        name: 'appToken',
        message: 'Enter Slack App-Level Token (xapp-):',
        mask: '*',
        validate: (input) => input.startsWith('xapp-') || 'Must start with xapp-',
      },
    ]);

    await keychain.set('slack', 'bot_token', answers.botToken);
    await keychain.set('slack', 'app_token', answers.appToken);

    console.log('\n  ✅ Slack tokens saved to keychain.\n');
  });

slack
  .command('start')
  .description('Start the Slack bot')
  .action(async () => {
    const { SlackBot } = await import('../bot/slack.js');
    await conductor.initialize();
    const bot = new SlackBot(conductor);
    try {
      await bot.start();
    } catch (error: any) {
      console.error(`\n  ❌ ${error.message}\n`);
      process.exit(1);
    }
  });

// ── Auth ───────────────────────────────────────────────────────────
const auth = program.command('auth').description('Authentication management');

auth
  .command('google')
  .description('Browser-based Google authentication')
  .option('-f, --file <path>', 'Import credentials from Google JSON file')
  .action(async (options: { file?: string }) => {
    const { GoogleAuthManager } = await import('../utils/google-auth.js');
    await conductor.initialize();
    const authManager = new GoogleAuthManager(conductor);

    if (options.file) {
      try {
        await authManager.importFromJson(options.file);
      } catch (error: any) {
        console.error(`\n  ❌ ${error.message}\n`);
        process.exit(1);
      }
    }

    const scopes = [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/drive',
    ];

    try {
      await authManager.login({ scopes });
      console.log('\n  ✅ Google authentication successful!');
      console.log('  🔌 Gmail, Calendar, Drive, and Gemini are now ready.\n');
    } catch (error: any) {
      console.error(`\n  ❌ Authentication failed: ${error.message}\n`);
      process.exit(1);
    }
  });

// ── Marketplace ───────────────────────────────────────────────────────────────
program
  .command('install')
  .argument('<plugin>', 'Plugin ID to install (e.g. gmail, github, slack)')
  .description('Install a plugin from the Conductor marketplace')
  .action(async (pluginId: string) => {
    const { installPlugin } = await import('./commands/marketplace.js');
    await conductor.initialize();
    await installPlugin(conductor, pluginId);
  });

program
  .command('uninstall')
  .argument('<plugin>', 'Plugin ID to uninstall')
  .description('Uninstall a marketplace plugin')
  .action(async (pluginId: string) => {
    const { uninstallPlugin } = await import('./commands/marketplace.js');
    await conductor.initialize();
    await uninstallPlugin(conductor, pluginId);
  });

const marketplace = program.command('marketplace').description('Browse the Conductor plugin marketplace');

marketplace
  .option('-s, --search <query>', 'Search plugins')
  .option('-c, --category <category>', 'Filter by category')
  .action(async (opts: { search?: string; category?: string }) => {
    const { listMarketplace } = await import('./commands/marketplace.js');
    await conductor.initialize();
    await listMarketplace(conductor, opts);
  });

marketplace
  .command('info')
  .argument('<plugin>', 'Plugin ID')
  .description('Show details about a plugin')
  .action(async (pluginId: string) => {
    const { pluginInfo } = await import('./commands/marketplace.js');
    await conductor.initialize();
    await pluginInfo(conductor, pluginId);
  });

// ── Dashboard ─────────────────────────────────────────────────────────
program
  .command('dashboard')
  .description('Open the Conductor web dashboard')
  .option('-p, --port <port>', 'Port to run on', '4242')
  .option('--no-open', 'Do not auto-open browser')
  .action(async (opts: { port?: string; open?: boolean }) => {
    const { dashboardCommand } = await import('../dashboard/cli.js');
    await dashboardCommand(conductor, opts);
  });

// ── Doctor ────────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('Diagnose issues and check system health')
  .action(async () => {
    const { doctor } = await import('./commands/doctor.js');
    await doctor(conductor);
  });

// ── Plugin Create ─────────────────────────────────────────────────────
program
  .command('plugin create')
  .argument('<name>', 'Plugin name')
  .description('Scaffold a new plugin with tests')
  .action(async (name: string) => {
    const { pluginCreate } = await import('./commands/plugin-create.js');
    await pluginCreate(name);
  });

// ── Health ────────────────────────────────────────────────────────────
program
  .command('health')
  .description('Show system health status')
  .option('--json', 'Output as JSON')
  .action(async (opts: { json?: boolean }) => {
    await conductor.initialize();
    const { HealthChecker } = await import('../core/health.js');
    const checker = new HealthChecker();
    const report = await checker.detailed(pkgVersion);

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('');
      console.log(`  🏥 Conductor Health — ${report.status.toUpperCase()}`);
      console.log(`  Version: ${report.version} | Uptime: ${report.uptime}s`);
      console.log('');
      for (const c of report.components) {
        const icon = c.status === 'ok' ? '✅' : c.status === 'degraded' ? '⚠️' : '❌';
        console.log(`  ${icon} ${c.name}: ${c.status}${c.message ? ` — ${c.message}` : ''}`);
      }
      if (report.metrics) {
        console.log('');
        console.log(`  📊 Metrics:`);
        console.log(`     Tool calls: ${report.metrics.totalToolCalls} (${report.metrics.failedToolCalls} failed)`);
        console.log(`     Avg latency: ${report.metrics.avgLatencyMs}ms`);
        console.log(`     Active webhooks: ${report.metrics.activeWebhooks}`);
        console.log(`     Open circuits: ${report.metrics.openCircuits}`);
      }
      console.log('');
    }
  });

// ── Run ──────────────────────────────────────────────────────────────
program.parse();
