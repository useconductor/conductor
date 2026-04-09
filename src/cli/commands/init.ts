/**
 * conductor init — First-run setup wizard
 *
 * Gets a new user to a working MCP server in under 2 minutes:
 *   1. Zero-config MCP setup (no API keys needed)
 *   2. Plugin onboard (optional)
 *   3. AI client config (Claude Desktop / Cursor / Cline)
 *
 * The key insight: Conductor provides tools TO your AI, it doesn't need its own AI.
 * Most users just need MCP + their existing Claude Desktop/Cursor.
 */

import inquirer from 'inquirer';
import { Conductor } from '../../core/conductor.js';
import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';

// ── Terminal helpers (b/w only) ────────────────────────────────────────────

const B = '\x1b[1m';
const D = '\x1b[2m';
const R = '\x1b[0m';
const G = '\x1b[32m';

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
  console.log(dim('One MCP server. 255 tools. Any AI agent.'));
  console.log(dim('Connect Claude Desktop, Cursor, Cline to 255+ tools.'));
  console.log(blank);
  console.log(bot);
  console.log('');
}

// ── Step 1: Quick Start vs Custom ─────────────────────────────────────────

async function chooseSetupMode(): Promise<'quick' | 'custom'> {
  console.log(`  ${B}How would you like to set up Conductor?${R}`);
  console.log('');

  const { mode } = await inquirer.prompt<{ mode: string }>([
    {
      type: 'list',
      name: 'mode',
      message: 'Select an option:',
      choices: [
        { name: 'Quick Start (recommended) — MCP server only, no API keys needed', value: 'quick' },
        { name: 'Custom — Configure AI provider, plugins, and more', value: 'custom' },
      ],
    },
  ]);

  return mode as 'quick' | 'custom';
}

// ── Quick Start: Just MCP ─────────────────────────────────────────────────

async function quickStart(conductor: Conductor): Promise<void> {
  console.log('');
  console.log(`  ${G}✓ Quick Start mode selected${R}`);
  console.log('');
  console.log(`  ${D}This sets up Conductor as an MCP server that your AI client${R}`);
  console.log(`  ${D}(Claude Desktop, Cursor, Cline) can connect to.${R}`);
  console.log('');
  console.log(`  ${D}No API keys needed — Conductor provides TOOLS to your AI,${R}`);
  console.log(`  ${D}it doesn't need its own AI key.${R}`);
  console.log('');

  await setupMCPClient(conductor);

  console.log('');
  console.log(`  ${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}`);
  console.log(`  ${B}  You're ready to use Conductor!${R}`);
  console.log(`  ${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}`);
  console.log('');
  console.log(`  ${B}Next steps:${R}`);
  console.log(`    1. Start the MCP server: ${B}conductor mcp start${R}`);
  console.log(`    2. Restart your AI client (Claude Desktop, Cursor, etc.)`);
  console.log(`    3. Conductor will appear as a connected MCP server`);
  console.log(`    4. Ask your AI: "What tools do you have access to?"`);
  console.log('');
  console.log(`  ${D}Need help? Run: conductor doctor${R}`);
  console.log('');
}

// ── Custom Setup: AI Provider ───────────────────────────────────────────────

async function setupAIProvider(conductor: Conductor): Promise<void> {
  stepHeader(1, 4, 'AI Provider (Optional)');

  console.log(`  ${D}This is only needed if you want Conductor to use AI for its own${R}`);
  console.log(`  ${D}reasoning (e.g., proactive alerts, context-aware suggestions).${R}`);
  console.log(`  ${D}Most users can skip this — your AI client already has its own key.${R}`);
  console.log('');

  const { enableAI } = await inquirer.prompt<{ enableAI: boolean }>([
    {
      type: 'confirm',
      name: 'enableAI',
      message: 'Configure an AI provider for Conductor?',
      default: false,
    },
  ]);

  if (!enableAI) {
    console.log('');
    console.log(`  ${D}Skipped. You can enable this later with: conductor ai setup${R}`);
    return;
  }

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
      ],
    },
  ]);

  const { AIManager } = await import('../../ai/manager.js');
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
      console.log(`  ${G}✓${R} Claude configured`);
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
      console.log(`  ${G}✓${R} OpenAI configured`);
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
      console.log(`  ${G}✓${R} Gemini configured`);
      break;
    }
    case 'ollama': {
      console.log('');
      console.log(`  ${D}Make sure Ollama is running: https://ollama.ai${R}`);
      const { model } = await inquirer.prompt<{ model: string }>([
        { type: 'input', name: 'model', message: 'Which Ollama model?', default: 'llama3.2' },
      ]);
      await aiManager.setupOllama(model.trim());
      console.log(`  ${G}✓${R} Ollama configured (${model.trim()})`);
      break;
    }
  }
}

// ── Step 2: Plugins ────────────────────────────────────────────────────────

async function setupPlugins(conductor: Conductor): Promise<void> {
  stepHeader(2, 4, 'Plugins');

  console.log(`  ${D}Conductor ships with 15 zero-config tools that work immediately:${R}`);
  console.log(`  ${D}File System, Shell, Git, Web Fetch, Database, Calculator, etc.${R}`);
  console.log('');

  const { doOnboard } = await inquirer.prompt<{ doOnboard: boolean }>([
    {
      type: 'confirm',
      name: 'doOnboard',
      message: 'Enable additional plugins (GitHub, Slack, Gmail, etc.)?',
      default: false,
    },
  ]);

  if (!doOnboard) {
    console.log('');
    console.log(`  ${D}Skipped. You can enable more plugins later with: conductor plugins${R}`);
    return;
  }

  const { onboard } = await import('./onboard.js');
  await onboard(conductor);
}

// ── Step 3: MCP client config ───────────────────────────────────────────────

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

async function setupMCPClient(_conductor: Conductor): Promise<void> {
  stepHeader(3, 4, 'Connect your AI client');

  console.log(`  ${D}Conductor needs to be added to your AI client's MCP config.${R}`);
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
        { name: "I don't see my client — skip for now", value: 'skip' },
      ],
    },
  ]);

  if (client === 'skip') {
    console.log('');
    console.log(`  ${D}Skipped. Run: conductor mcp setup${R}`);
    return;
  }

  const configPath = MCP_CONFIG_PATHS[client];

  try {
    await writeClientConfig(configPath);
    const clientName = client === 'claude' ? 'Claude Desktop' : client === 'cursor' ? 'Cursor' : 'Cline';
    console.log('');
    console.log(`  ${G}✓${R} ${clientName} configured`);
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
  console.log(`  as a connected MCP server with 255+ tools available.${R}`);
  console.log('');
  console.log(`  ${D}conductor dashboard   — web UI with metrics and audit log${R}`);
  console.log(`  ${D}conductor doctor      — diagnose issues${R}`);
  console.log(`  ${D}conductor health      — system health status${R}`);
  console.log('');
  hr(W);
  console.log('');
}

// ── Entry point ───────────────────────────────────────────────────────────

export async function init(conductor: Conductor): Promise<void> {
  await conductor.initialize();

  printBanner();

  const mode = await chooseSetupMode();

  if (mode === 'quick') {
    await quickStart(conductor);
  } else {
    await setupAIProvider(conductor);
    await setupPlugins(conductor);
    await setupMCPClient(conductor);
    printFinalInstructions();
  }
}