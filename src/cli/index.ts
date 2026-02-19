#!/usr/bin/env node

import { Command } from 'commander';
import { Conductor } from '../core/conductor.js';
import { PluginManager } from '../plugins/manager.js';
import { registerLifecycleCommands } from './commands/lifecycle.js';

const program = new Command();
const conductor = new Conductor();

program
  .name('conductor')
  .description('Universal integration hub — Connect AI and services through conversation')
  .version('0.1.0');

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

mcp.command('setup').description('Configure MCP for Claude Desktop').action(async () => {
  const { mcpSetup } = await import('./commands/mcp.js');
  await mcpSetup(conductor);
});

mcp.command('status').description('Show MCP server status').action(async () => {
  const { mcpStatus } = await import('./commands/mcp.js');
  await mcpStatus(conductor);
});

mcp.command('start').description('Start MCP server (stdio)').action(async () => {
  const { mcpStart } = await import('./commands/mcp.js');
  await mcpStart(conductor);
});

mcp.command('remove').description('Remove MCP configuration').action(async () => {
  const { mcpRemove } = await import('./commands/mcp.js');
  await mcpRemove(conductor);
});

// ── Telegram ─────────────────────────────────────────────────────────
const telegram = program.command('telegram').description('Telegram bot');

telegram.command('start').description('Start the Telegram bot').action(async () => {
  const { TelegramBot } = await import('../bot/telegram.js');
  await conductor.initialize();
  const bot = new TelegramBot(conductor);
  await bot.start();
});

telegram.command('setup').description('Configure Telegram bot token').action(async () => {
  const { telegramSetup } = await import('./commands/telegram.js');
  await telegramSetup(conductor);
});

// ── Plugins (register both "plugins" and "plugin") ──────────────────
function registerPluginCommands(parent: Command, cmdName: string): void {
  const cmd = parent.command(cmdName).description('Plugin management');

  cmd.command('list').description('List all plugins').action(async () => {
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

  cmd.command('enable').argument('<name>', 'Plugin name').description('Enable a plugin').action(async (name: string) => {
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

  cmd.command('disable').argument('<name>', 'Plugin name').description('Disable a plugin').action(async (name: string) => {
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

// ── Run ──────────────────────────────────────────────────────────────
program.parse();
