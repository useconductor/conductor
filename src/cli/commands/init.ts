/**
 * conductor init — First-run setup wizard
 *
 * Gets a new user to a working MCP server in under 2 minutes:
 *   1. AI provider setup (Claude / OpenAI / Gemini / Ollama / skip)
 *   2. Plugin onboard TUI
 *   3. MCP client config (Claude Desktop / Cursor / Cline / skip)
 *   4. Final instructions
 */

import inquirer from 'inquirer';
import { Conductor } from '../../core/conductor.js';
import { AIManager } from '../../ai/manager.js';
import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';

// ── Terminal helpers (b/w only) ────────────────────────────────────────────

const B = '\x1b[1m';
const D = '\x1b[2m';
const R = '\x1b[0m';

function hr(width = 50) {
  process.stdout.write('  ' + '─'.repeat(width) + '\n');
}

function stepHeader(n: number, total: number, label: string): void {
  console.log('');
  console.log(`  ${B}── Step ${n}/${total}: ${label}${R}`);
  console.log('');
}

// ── Banner ─────────────────────────────────────────────────────────────────

function printBanner(): void {
  const W = 50;
  const top =    '  ┌' + '─'.repeat(W) + '┐';
  const bot =    '  └' + '─'.repeat(W) + '┘';
  const blank =  '  │' + ' '.repeat(W) + '│';
  const line = (text: string) => {
    const pad = W - text.length - 1;
    return `  │ ${B}${text}${R}` + ' '.repeat(Math.max(0, pad)) + '│';
  };
  const dim = (text: string) => {
    const pad = W - text.length - 1;
    return `  │ ${D}${text}${R}` + ' '.repeat(Math.max(0, pad)) + '│';
  };

  console.log('');
  console.log(top);
  console.log(blank);
  console.log(line('Conductor — The AI Tool Hub'));
  console.log(blank);
  console.log(dim('One MCP server. 100+ tools. Any AI agent.'));
  console.log(dim('Setup takes under 2 minutes.'));
  console.log(blank);
  console.log(bot);
  console.log('');
}

// ── Step 1: AI Provider ────────────────────────────────────────────────────

async function setupAIProvider(conductor: Conductor): Promise<void> {
  stepHeader(1, 3, 'AI Provider');

  console.log(`  ${D}Pick the AI provider Conductor uses for its own reasoning.${R}`);
  console.log(`  ${D}(Separate from the AI agent that calls Conductor via MCP.)${R}`);
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
        { name: `${D}Skip — configure later with: conductor ai setup${R}`, value: 'skip' },
      ],
    },
  ]);

  if (provider === 'skip') {
    console.log('');
    console.log(`  ${D}Skipped. Run: conductor ai setup${R}`);
    return;
  }

  const aiManager = new AIManager(conductor);

  switch (provider) {
    case 'claude': {
      console.log('');
      console.log(`  ${D}Get your key at: https://console.anthropic.com${R}`);
      const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
        { type: 'password', name: 'apiKey', message: 'Anthropic API key:', mask: '*',
          validate: (v: string) => v.trim().length > 0 || 'API key is required' },
      ]);
      await aiManager.setupClaude(apiKey.trim());
      console.log(`  ✓ Claude configured`);
      break;
    }
    case 'openai': {
      console.log('');
      console.log(`  ${D}Get your key at: https://platform.openai.com/api-keys${R}`);
      const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
        { type: 'password', name: 'apiKey', message: 'OpenAI API key:', mask: '*',
          validate: (v: string) => v.trim().length > 0 || 'API key is required' },
      ]);
      await aiManager.setupOpenAI(apiKey.trim());
      console.log(`  ✓ OpenAI configured`);
      break;
    }
    case 'gemini': {
      console.log('');
      console.log(`  ${D}Get your key at: https://aistudio.google.com/app/apikey${R}`);
      const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
        { type: 'password', name: 'apiKey', message: 'Gemini API key:', mask: '*',
          validate: (v: string) => v.trim().length > 0 || 'API key is required' },
      ]);
      await aiManager.setupGemini(apiKey.trim());
      console.log(`  ✓ Gemini configured`);
      break;
    }
    case 'ollama': {
      console.log('');
      console.log(`  ${D}Make sure Ollama is running: https://ollama.ai${R}`);
      const { model } = await inquirer.prompt<{ model: string }>([
        { type: 'input', name: 'model', message: 'Which Ollama model?', default: 'llama3.2' },
      ]);
      await aiManager.setupOllama(model.trim());
      console.log(`  ✓ Ollama configured (${model.trim()})`);
      break;
    }
  }
}

// ── Step 2: Plugins ────────────────────────────────────────────────────────

async function setupPlugins(conductor: Conductor): Promise<void> {
  stepHeader(2, 3, 'Plugins');

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
    console.log(`  ${D}Skipped. Run: conductor onboard${R}`);
    return;
  }

  const { onboard } = await import('./onboard.js');
  await onboard(conductor);
}

// ── Step 3: MCP client config ──────────────────────────────────────────────

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
  // Use the conductor binary by name — robust across npm reinstalls and upgrades.
  const entry = { command: 'conductor', args: ['mcp', 'start'] };

  let config: Record<string, unknown> = {};
  try {
    const existing = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(existing) as Record<string, unknown>;
  } catch {
    // File doesn't exist — start fresh
  }

  const servers = (config['mcpServers'] ?? {}) as Record<string, unknown>;
  servers['conductor'] = entry;
  config['mcpServers'] = servers;

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

async function setupMCPClient(conductor: Conductor): Promise<void> {
  stepHeader(3, 3, 'Connect your AI client');

  console.log(`  ${D}Conductor will write the MCP server entry into your client's config.${R}`);
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
        { name: `${D}Skip — I'll configure manually${R}`, value: 'skip' },
      ],
    },
  ]);

  if (client === 'skip') {
    console.log('');
    console.log(`  ${D}Skipped. Run: conductor mcp setup${R}`);
    void conductor;
    return;
  }

  const configPath = MCP_CONFIG_PATHS[client];

  try {
    await writeClientConfig(configPath);
    const clientName = client === 'claude' ? 'Claude Desktop' : client === 'cursor' ? 'Cursor' : 'Cline';
    console.log('');
    console.log(`  ✓ ${clientName} configured`);
    console.log(`  ${D}  Config: ${configPath}${R}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('');
    console.log(`  ! Could not write config: ${msg}`);
    console.log(`  ${D}  Run: conductor mcp setup${R}`);
  }
}

// ── Final instructions ─────────────────────────────────────────────────────

function printFinalInstructions(): void {
  const W = 50;
  console.log('');
  hr(W);
  console.log('');
  console.log(`  ${B}You're all set.${R}`);
  console.log('');
  console.log(`  Start the MCP server:`);
  console.log(`    ${B}conductor mcp start${R}`);
  console.log('');
  console.log(`  ${D}Then restart your AI client — Conductor will appear`);
  console.log(`  as a connected MCP server with 100+ tools available.${R}`);
  console.log('');
  console.log(`  ${D}conductor dashboard   — web UI with metrics and audit log${R}`);
  console.log(`  ${D}conductor doctor      — diagnose issues${R}`);
  console.log(`  ${D}conductor health      — system health status${R}`);
  console.log('');
  hr(W);
  console.log('');
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function init(conductor: Conductor): Promise<void> {
  await conductor.initialize();

  printBanner();

  await setupAIProvider(conductor);
  await setupPlugins(conductor);
  await setupMCPClient(conductor);

  printFinalInstructions();
}
