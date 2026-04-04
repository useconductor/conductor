/**
 * conductor init — First-run setup wizard
 *
 * Takes a brand-new user from zero to a fully working MCP server
 * in under 2 minutes. Orchestrates all other setup flows in sequence:
 *
 *   1. Welcome banner + ask user name
 *   2. AI provider setup (Claude / OpenAI / Gemini / Ollama / skip)
 *   3. Plugin onboard TUI (calls the existing onboard() function)
 *   4. MCP client config (Claude Desktop / Cursor / Cline / skip)
 *   5. Final instructions
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import { Conductor } from '../../core/conductor.js';
import { AIManager } from '../../ai/manager.js';
import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';

// ── Banner ─────────────────────────────────────────────────────────────────

function printBanner(): void {
  console.log('');
  console.log(chalk.bold.white('  ╔══════════════════════════════════════════════╗'));
  console.log(
    chalk.bold.white('  ║') +
      chalk.bold.hex('#FF8C00')('  ♦  Conductor — The AI Tool Hub             ') +
      chalk.bold.white('║'),
  );
  console.log(
    chalk.bold.white('  ║') + chalk.dim('     One MCP server. 100+ tools. Any AI.    ') + chalk.bold.white('║'),
  );
  console.log(chalk.bold.white('  ╚══════════════════════════════════════════════╝'));
  console.log('');
  console.log(chalk.dim('  This wizard will get you up and running in under 2 minutes.'));
  console.log(chalk.dim('  Press Ctrl+C at any time to exit.'));
  console.log('');
}

// ── Step header ────────────────────────────────────────────────────────────

function stepHeader(n: number, total: number, label: string): void {
  console.log('');
  console.log(
    chalk.bold.white(`  ── Step ${n}/${total}: ${label} `) + chalk.dim('─'.repeat(Math.max(0, 38 - label.length))),
  );
  console.log('');
}

// ── Step 1: User name ──────────────────────────────────────────────────────

async function setupUserName(conductor: Conductor): Promise<void> {
  stepHeader(1, 4, 'Your name');

  const existing = conductor.getConfig().get<string>('user.name') || '';

  const { name } = await inquirer.prompt<{ name: string }>([
    {
      type: 'input',
      name: 'name',
      message: 'What should I call you?',
      default: existing || undefined,
      validate: (v: string) => (v.trim().length > 0 ? true : 'Name cannot be empty'),
    },
  ]);

  await conductor.getConfig().set('user.name', name.trim());
  console.log('');
  console.log(chalk.green(`  ✓ Hi, ${name.trim()}!`));
}

// ── Step 2: AI Provider ────────────────────────────────────────────────────

async function setupAIProvider(conductor: Conductor): Promise<void> {
  stepHeader(2, 4, 'AI Provider');

  console.log(chalk.dim('  Pick the AI provider Conductor will use for its own reasoning.'));
  console.log(chalk.dim('  (This is separate from the AI agent that calls Conductor via MCP.)'));
  console.log('');

  const { provider } = await inquirer.prompt<{ provider: string }>([
    {
      type: 'list',
      name: 'provider',
      message: 'Select an AI provider:',
      choices: [
        { name: 'Claude (Anthropic)        — best overall', value: 'claude' },
        { name: 'OpenAI (GPT-4o)           — popular & capable', value: 'openai' },
        { name: 'Gemini (Google)           — fast & free tier', value: 'gemini' },
        { name: 'Ollama (local, private)   — no API key needed', value: 'ollama' },
        { name: chalk.dim('Skip — configure later with: conductor ai setup'), value: 'skip' },
      ],
    },
  ]);

  if (provider === 'skip') {
    console.log('');
    console.log(chalk.dim('  Skipped. Run: conductor ai setup'));
    return;
  }

  const aiManager = new AIManager(conductor);

  switch (provider) {
    case 'claude': {
      console.log('');
      console.log(chalk.dim('  Get your key at: https://console.anthropic.com'));
      const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Anthropic API key:',
          mask: '*',
          validate: (v: string) => v.trim().length > 0 || 'API key is required',
        },
      ]);
      await aiManager.setupClaude(apiKey.trim());
      console.log(chalk.green('  ✓ Claude configured'));
      break;
    }

    case 'openai': {
      console.log('');
      console.log(chalk.dim('  Get your key at: https://platform.openai.com/api-keys'));
      const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
        {
          type: 'password',
          name: 'apiKey',
          message: 'OpenAI API key:',
          mask: '*',
          validate: (v: string) => v.trim().length > 0 || 'API key is required',
        },
      ]);
      await aiManager.setupOpenAI(apiKey.trim());
      console.log(chalk.green('  ✓ OpenAI configured'));
      break;
    }

    case 'gemini': {
      console.log('');
      console.log(chalk.dim('  Get your key at: https://aistudio.google.com/app/apikey'));
      const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Gemini API key:',
          mask: '*',
          validate: (v: string) => v.trim().length > 0 || 'API key is required',
        },
      ]);
      await aiManager.setupGemini(apiKey.trim());
      console.log(chalk.green('  ✓ Gemini configured'));
      break;
    }

    case 'ollama': {
      console.log('');
      console.log(chalk.dim('  Make sure Ollama is running: https://ollama.ai'));
      const { model } = await inquirer.prompt<{ model: string }>([
        {
          type: 'input',
          name: 'model',
          message: 'Which Ollama model?',
          default: 'llama3.2',
        },
      ]);
      await aiManager.setupOllama(model.trim());
      console.log(chalk.green(`  ✓ Ollama configured (${model.trim()})`));
      break;
    }
  }
}

// ── Step 3: Plugins ────────────────────────────────────────────────────────

async function setupPlugins(conductor: Conductor): Promise<void> {
  stepHeader(3, 4, 'Plugins');

  const { doOnboard } = await inquirer.prompt<{ doOnboard: boolean }>([
    {
      type: 'confirm',
      name: 'doOnboard',
      message: 'Pick which plugins to enable (recommended)?',
      default: true,
    },
  ]);

  if (!doOnboard) {
    console.log('');
    console.log(chalk.dim('  Skipped. Run: conductor onboard'));
    return;
  }

  // Dynamically import onboard to avoid circular deps
  const { onboard } = await import('./onboard.js');
  await onboard(conductor);
}

// ── Step 4: MCP client config ──────────────────────────────────────────────

// Config file paths per client
const MCP_CONFIG_PATHS: Record<string, string> = {
  claude: path.join(
    homedir(),
    process.platform === 'darwin'
      ? 'Library/Application Support/Claude/claude_desktop_config.json'
      : process.platform === 'win32'
        ? 'AppData/Roaming/Claude/claude_desktop_config.json'
        : '.config/Claude/claude_desktop_config.json',
  ),
  cursor: path.join(
    homedir(),
    process.platform === 'darwin' || process.platform === 'linux'
      ? '.cursor/mcp.json'
      : 'AppData/Roaming/Cursor/mcp.json',
  ),
  cline: path.join(
    homedir(),
    process.platform === 'darwin'
      ? 'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'
      : process.platform === 'win32'
        ? 'AppData/Roaming/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'
        : '.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
  ),
};

async function writeClientConfig(configPath: string): Promise<void> {
  const conductorBin = process.argv[1];
  const entry = { command: 'node', args: [conductorBin, 'mcp', 'start'] };

  let config: Record<string, unknown> = {};
  try {
    const existing = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(existing) as Record<string, unknown>;
  } catch {
    // File doesn't exist — start fresh
  }

  // Both Claude Desktop and Cursor use mcpServers; Cline too
  const servers = (config['mcpServers'] ?? {}) as Record<string, unknown>;
  servers['conductor'] = entry;
  config['mcpServers'] = servers;

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

async function setupMCPClient(conductor: Conductor): Promise<void> {
  stepHeader(4, 4, 'Connect your AI client');

  console.log(chalk.dim('  Conductor will auto-write the MCP server config for your chosen client.'));
  console.log('');

  const { client } = await inquirer.prompt<{ client: string }>([
    {
      type: 'list',
      name: 'client',
      message: 'Which AI client do you use?',
      choices: [
        { name: 'Claude Desktop', value: 'claude' },
        { name: 'Cursor', value: 'cursor' },
        { name: 'Cline (VS Code extension)', value: 'cline' },
        { name: chalk.dim("Skip — I'll configure manually"), value: 'skip' },
      ],
    },
  ]);

  if (client === 'skip') {
    console.log('');
    console.log(chalk.dim('  Skipped. Run: conductor mcp setup'));
    return;
  }

  const configPath = MCP_CONFIG_PATHS[client];

  try {
    await writeClientConfig(configPath);
    console.log('');
    console.log(
      chalk.green(
        `  ✓ ${client === 'claude' ? 'Claude Desktop' : client === 'cursor' ? 'Cursor' : 'Cline'} configured`,
      ),
    );
    console.log(chalk.dim(`    Config: ${configPath}`));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('');
    console.log(chalk.yellow(`  ⚠ Could not write config: ${msg}`));
    console.log(chalk.dim('  Run: conductor mcp setup'));
  }

  // Silence the conductor parameter — used for future expansion
  void conductor;
}

// ── Final instructions ─────────────────────────────────────────────────────

function printFinalInstructions(userName: string): void {
  console.log('');
  console.log(chalk.bold.white('  ╔══════════════════════════════════════════════╗'));
  console.log(
    chalk.bold.white('  ║') +
      chalk.bold.green("  ✓ You're all set, " + (userName || 'there') + '!') +
      ' '.repeat(Math.max(0, 24 - (userName || 'there').length)) +
      chalk.bold.white('║'),
  );
  console.log(chalk.bold.white('  ╚══════════════════════════════════════════════╝'));
  console.log('');
  console.log(chalk.dim('  Start the MCP server:'));
  console.log(`    ${chalk.cyan('conductor mcp start')}`);
  console.log('');
  console.log(chalk.dim('  Then restart your AI client (Claude Desktop / Cursor / Cline)'));
  console.log(chalk.dim('  and Conductor will appear as a connected MCP server.'));
  console.log('');
  console.log(chalk.dim('  Explore:'));
  console.log(`    ${chalk.cyan('conductor dashboard')}   ${chalk.dim('— web UI with metrics and audit log')}`);
  console.log(`    ${chalk.cyan('conductor doctor')}      ${chalk.dim('— diagnose issues')}`);
  console.log(`    ${chalk.cyan('conductor health')}      ${chalk.dim('— system health status')}`);
  console.log('');
  console.log(chalk.dim('  Docs & support: https://conductor.thealxlabs.ca'));
  console.log('');
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function init(conductor: Conductor): Promise<void> {
  await conductor.initialize();

  printBanner();

  // Step 1 — user name
  await setupUserName(conductor);

  // Step 2 — AI provider
  await setupAIProvider(conductor);

  // Step 3 — plugins
  await setupPlugins(conductor);

  // Step 4 — MCP client
  await setupMCPClient(conductor);

  // Done!
  const userName = conductor.getConfig().get<string>('user.name') || '';
  printFinalInstructions(userName);
}
