#!/usr/bin/env node

/**
 * Conductor Interactive Installer
 *
 * Step-by-step setup with plugin selection TUI.
 * Guides users through:
 *   1. Prerequisites check
 *   2. AI provider setup
 *   3. Plugin selection (interactive picker)
 *   4. Plugin configuration (credentials)
 *   5. MCP server setup
 *   6. Zero-config mode enablement
 */

import { createRequire } from 'module';
import { Conductor } from '../../core/conductor.js';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';

const _require = createRequire(import.meta.url);
const { version } = _require('../../package.json') as { version: string };

interface PluginInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  requiresAuth: boolean;
  authType?: string;
  tools: string[];
  icon: string;
}

const PLUGIN_CATALOG: PluginInfo[] = [
  // Zero-config (no auth required)
  {
    id: 'calculator',
    name: 'Calculator',
    description: 'Math expressions, unit conversions, date calculations',
    category: 'utilities',
    requiresAuth: false,
    tools: ['calc_math', 'calc_convert', 'calc_date'],
    icon: '🔢',
  },
  {
    id: 'weather',
    name: 'Weather',
    description: 'Current weather and forecasts (free, no API key)',
    category: 'utilities',
    requiresAuth: false,
    tools: ['weather_current', 'weather_forecast'],
    icon: '🌤️',
  },
  {
    id: 'crypto',
    name: 'Crypto',
    description: 'Cryptocurrency prices and market data',
    category: 'utilities',
    requiresAuth: false,
    tools: ['crypto_price', 'crypto_search'],
    icon: '₿',
  },
  {
    id: 'hash',
    name: 'Hash',
    description: 'Hashing, base64 encoding/decoding',
    category: 'utilities',
    requiresAuth: false,
    tools: ['hash_text', 'base64_encode', 'base64_decode'],
    icon: '#️⃣',
  },
  {
    id: 'text-tools',
    name: 'Text Tools',
    description: 'JSON formatting, word count, text transformations',
    category: 'utilities',
    requiresAuth: false,
    tools: ['format_json', 'word_count', 'text_transform'],
    icon: '📝',
  },
  {
    id: 'timezone',
    name: 'Timezone',
    description: 'Timezone conversion and lookup',
    category: 'utilities',
    requiresAuth: false,
    tools: ['timezone_convert', 'timezone_list'],
    icon: '🕐',
  },
  {
    id: 'network',
    name: 'Network',
    description: 'DNS lookup, IP geolocation, reverse DNS',
    category: 'utilities',
    requiresAuth: false,
    tools: ['dns_lookup', 'ip_info', 'reverse_dns'],
    icon: '🌐',
  },
  {
    id: 'url-tools',
    name: 'URL Tools',
    description: 'URL expansion, QR code generation, URL parsing',
    category: 'utilities',
    requiresAuth: false,
    tools: ['expand_url', 'url_parse'],
    icon: '🔗',
  },
  {
    id: 'colors',
    name: 'Colors',
    description: 'Color format conversion, contrast checking, palette generation',
    category: 'utilities',
    requiresAuth: false,
    tools: ['colors_convert', 'colors_contrast', 'colors_palette'],
    icon: '🎨',
  },
  {
    id: 'fun',
    name: 'Fun',
    description: 'Random jokes and facts',
    category: 'utilities',
    requiresAuth: false,
    tools: ['random_joke', 'random_fact'],
    icon: '🎉',
  },
  {
    id: 'system',
    name: 'System',
    description: 'System stats, process management, clipboard',
    category: 'utilities',
    requiresAuth: false,
    tools: ['system_info', 'list_processes', 'kill_process', 'clipboard_read', 'clipboard_write'],
    icon: '🖥️',
  },

  // Productivity (local only)
  {
    id: 'notes',
    name: 'Notes',
    description: 'Local markdown note management',
    category: 'productivity',
    requiresAuth: false,
    tools: ['notes_create', 'notes_list', 'notes_read', 'notes_update', 'notes_delete', 'notes_search'],
    icon: '📓',
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Long-term memory storage and recall',
    category: 'productivity',
    requiresAuth: false,
    tools: ['memory_recall', 'memory_store', 'memory_forget', 'memory_list'],
    icon: '🧠',
  },
  {
    id: 'cron',
    name: 'Cron',
    description: 'Cron expression parser and scheduler',
    category: 'productivity',
    requiresAuth: false,
    tools: ['cron_parse', 'cron_next'],
    icon: '⏰',
  },

  // Developer tools (require auth)
  {
    id: 'github',
    name: 'GitHub',
    description: 'Public repos, user info, trending (no auth for public data)',
    category: 'developer',
    requiresAuth: false,
    tools: ['github_user', 'github_repo', 'github_repos', 'github_trending'],
    icon: '🐙',
  },
  {
    id: 'github-actions',
    name: 'GitHub Actions',
    description: 'Full CI/CD, PRs, issues, releases, notifications',
    category: 'developer',
    requiresAuth: true,
    authType: 'GitHub PAT',
    tools: [
      'gh_my_repos',
      'gh_workflow_runs',
      'gh_trigger_workflow',
      'gh_list_prs',
      'gh_create_pr',
      'gh_list_issues',
      'gh_create_issue',
      'gh_releases',
      'gh_notifications',
      'gh_code_search',
    ],
    icon: '⚙️',
  },
  {
    id: 'shell',
    name: 'Shell',
    description: 'Safe shell command execution with approval workflow',
    category: 'developer',
    requiresAuth: false,
    tools: [
      'shell_run',
      'shell_read_file',
      'shell_write_file',
      'shell_list_dir',
      'shell_search_files',
      'shell_search_content',
    ],
    icon: '💻',
  },
  {
    id: 'docker',
    name: 'Docker',
    description: 'Container, image, volume, and network management',
    category: 'developer',
    requiresAuth: false,
    tools: ['docker_containers', 'docker_images', 'docker_run', 'docker_pull', 'docker_stats'],
    icon: '🐳',
  },
  {
    id: 'database',
    name: 'Databases',
    description: 'Query PostgreSQL, MySQL, MongoDB, Redis',
    category: 'developer',
    requiresAuth: true,
    authType: 'Database URL',
    tools: ['db_postgres_query', 'db_mysql_query', 'db_mongo_find', 'db_redis_command'],
    icon: '🗄️',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    description: 'Deploy and manage Vercel projects',
    category: 'developer',
    requiresAuth: true,
    authType: 'Vercel Token',
    tools: ['vercel_projects', 'vercel_deployments', 'vercel_deploy', 'vercel_logs', 'vercel_env_list'],
    icon: '▲',
  },
  {
    id: 'n8n',
    name: 'n8n',
    description: 'Trigger and manage n8n automation workflows',
    category: 'developer',
    requiresAuth: true,
    authType: 'n8n API Key + Base URL',
    tools: ['n8n_workflows', 'n8n_trigger', 'n8n_executions', 'n8n_health'],
    icon: '🔄',
  },

  // Google services
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read, search, send, and manage Gmail',
    category: 'google',
    requiresAuth: true,
    authType: 'Google OAuth',
    tools: ['gmail_list', 'gmail_read', 'gmail_search', 'gmail_send', 'gmail_reply'],
    icon: '📧',
  },
  {
    id: 'gcal',
    name: 'Google Calendar',
    description: 'Manage calendar events',
    category: 'google',
    requiresAuth: true,
    authType: 'Google OAuth',
    tools: ['gcal_list_calendars', 'gcal_list_events', 'gcal_create_event', 'gcal_update_event'],
    icon: '📅',
  },
  {
    id: 'gdrive',
    name: 'Google Drive',
    description: 'Browse, read, create, upload files',
    category: 'google',
    requiresAuth: true,
    authType: 'Google OAuth',
    tools: ['gdrive_list', 'gdrive_search', 'gdrive_read', 'gdrive_upload_text'],
    icon: '📁',
  },

  // Third-party services
  {
    id: 'notion',
    name: 'Notion',
    description: 'Read, search, create Notion pages',
    category: 'services',
    requiresAuth: true,
    authType: 'Notion Integration Token',
    tools: ['notion_search', 'notion_get_page', 'notion_create_page', 'notion_query_database'],
    icon: '📋',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Send messages, read channels, search, manage workspace',
    category: 'messaging',
    requiresAuth: true,
    authType: 'Slack Bot Token',
    tools: ['slack_send_message', 'slack_channels', 'slack_read_channel', 'slack_search', 'slack_users'],
    icon: '💬',
  },
  {
    id: 'spotify',
    name: 'Spotify',
    description: 'Control playback, search music, manage playlists',
    category: 'media',
    requiresAuth: true,
    authType: 'Spotify OAuth',
    tools: ['spotify_search', 'spotify_play', 'spotify_pause', 'spotify_now_playing', 'spotify_playlists'],
    icon: '🎵',
  },
  {
    id: 'x',
    name: 'X (Twitter)',
    description: 'Post tweets, search, manage account',
    category: 'social',
    requiresAuth: true,
    authType: 'X API Credentials',
    tools: ['x_search', 'x_post_tweet', 'x_get_timeline', 'x_get_user'],
    icon: '𝕏',
  },
  {
    id: 'homekit',
    name: 'HomeKit',
    description: 'Control HomeKit accessories via Homebridge',
    category: 'smart-home',
    requiresAuth: true,
    authType: 'Homebridge URL + Credentials',
    tools: ['homekit_status', 'homekit_accessories', 'homekit_set', 'homekit_toggle'],
    icon: '🏠',
  },
  {
    id: 'todoist',
    name: 'Todoist',
    description: 'Manage tasks, projects, and comments',
    category: 'productivity',
    requiresAuth: true,
    authType: 'Todoist API Token',
    tools: ['todoist_list_tasks', 'todoist_create_task', 'todoist_complete_task', 'todoist_search_tasks'],
    icon: '✅',
  },
];

const CATEGORIES = [
  { id: 'utilities', name: 'Utilities', icon: '🛠️' },
  { id: 'productivity', name: 'Productivity', icon: '📈' },
  { id: 'developer', name: 'Developer', icon: '💻' },
  { id: 'google', name: 'Google', icon: '🔵' },
  { id: 'services', name: 'Services', icon: '🔧' },
  { id: 'messaging', name: 'Messaging', icon: '💬' },
  { id: 'media', name: 'Media', icon: '🎵' },
  { id: 'social', name: 'Social', icon: '🐦' },
  { id: 'smart-home', name: 'Smart Home', icon: '🏠' },
];

async function checkPrerequisites(): Promise<void> {
  const spinner = ora('Checking prerequisites...').start();

  // Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0]);
  if (major < 18) {
    spinner.fail(`Node.js 18+ required (found ${nodeVersion})`);
    console.log(chalk.red('Install Node.js: https://nodejs.org/en/download/'));
    process.exit(1);
  }

  // npm
  try {
    const { execSync } = await import('child_process');
    execSync('npm --version', { stdio: 'pipe' });
  } catch {
    spinner.fail('npm not found');
    console.log(chalk.red('Install Node.js: https://nodejs.org/en/download/'));
    process.exit(1);
  }

  spinner.succeed(`Prerequisites OK: Node.js ${nodeVersion}, npm`);
}

async function selectPlugins(): Promise<string[]> {
  console.log('\n' + chalk.bold('🧩 Plugin Selection'));
  console.log(chalk.gray('Select plugins to enable (space to toggle, enter to confirm)\n'));

  // Group plugins by category
  const byCategory = new Map<string, PluginInfo[]>();
  for (const plugin of PLUGIN_CATALOG) {
    const list = byCategory.get(plugin.category) ?? [];
    list.push(plugin);
    byCategory.set(plugin.category, list);
  }

  // Print categories and plugins
  for (const [catId, plugins] of byCategory) {
    const cat = CATEGORIES.find((c) => c.id === catId);
    if (!cat) continue;

    console.log(chalk.bold(`\n${cat.icon} ${cat.name}`));
    for (const plugin of plugins) {
      const authBadge = plugin.requiresAuth ? chalk.yellow(` [${plugin.authType}]`) : chalk.green(' [free]');
      console.log(`  ${plugin.icon} ${plugin.name}${authBadge}`);
      console.log(`    ${chalk.gray(plugin.description)}`);
    }
  }

  // Ask which plugins to enable
  const choices = PLUGIN_CATALOG.map((p) => ({
    name: `${p.icon} ${p.name}${p.requiresAuth ? chalk.yellow(` [${p.authType}]`) : chalk.green(' [free]')}`,
    value: p.id,
    checked: !p.requiresAuth, // Auto-select free plugins
  }));

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select plugins to enable:',
      choices,
      pageSize: 30,
    },
  ]);

  return selected as string[];
}

async function configurePlugins(selectedPlugins: string[], conductor: Conductor): Promise<void> {
  const pluginsToConfigure = selectedPlugins.filter((id) => {
    const plugin = PLUGIN_CATALOG.find((p) => p.id === id);
    return plugin?.requiresAuth;
  });

  if (pluginsToConfigure.length === 0) {
    console.log(chalk.green('\n✅ No plugins require configuration. All set!'));
    return;
  }

  console.log('\n' + chalk.bold('🔐 Plugin Configuration'));
  console.log(chalk.gray('Configure credentials for selected plugins\n'));

  for (const pluginId of pluginsToConfigure) {
    const plugin = PLUGIN_CATALOG.find((p) => p.id === pluginId);
    if (!plugin) continue;

    console.log(`\n${plugin.icon} ${chalk.bold(plugin.name)} (${plugin.authType})`);
    console.log(chalk.gray(plugin.description));

    if (pluginId === 'github-actions') {
      const { token } = await inquirer.prompt([
        {
          type: 'password',
          name: 'token',
          message: 'GitHub PAT (https://github.com/settings/tokens):',
          mask: '*',
        },
      ]);
      if (token) {
        const { Keychain } = await import('../../security/keychain.js');
        const keychain = new Keychain(conductor.getConfig().getConfigDir());
        await keychain.set('github', 'token', token);
        console.log(chalk.green('  ✅ GitHub token saved (encrypted)'));
      }
    } else if (pluginId === 'database') {
      const { postgresUrl } = await inquirer.prompt([
        {
          type: 'input',
          name: 'postgresUrl',
          message: 'PostgreSQL URL (postgresql://user:pass@host:5432/db):',
        },
      ]);
      if (postgresUrl) {
        const { Keychain } = await import('../../security/keychain.js');
        const keychain = new Keychain(conductor.getConfig().getConfigDir());
        await keychain.set('database', 'postgres_url', postgresUrl);
        console.log(chalk.green('  ✅ Database URL saved (encrypted)'));
      }
    } else if (pluginId === 'vercel') {
      const { token } = await inquirer.prompt([
        {
          type: 'password',
          name: 'token',
          message: 'Vercel API Token (https://vercel.com/account/tokens):',
          mask: '*',
        },
      ]);
      if (token) {
        const { Keychain } = await import('../../security/keychain.js');
        const keychain = new Keychain(conductor.getConfig().getConfigDir());
        await keychain.set('vercel', 'token', token);
        console.log(chalk.green('  ✅ Vercel token saved (encrypted)'));
      }
    } else if (pluginId === 'notion') {
      const { apiKey } = await inquirer.prompt([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Notion Integration Token (https://www.notion.so/my-integrations):',
          mask: '*',
        },
      ]);
      if (apiKey) {
        const { Keychain } = await import('../../security/keychain.js');
        const keychain = new Keychain(conductor.getConfig().getConfigDir());
        await keychain.set('notion', 'api_key', apiKey);
        console.log(chalk.green('  ✅ Notion API key saved (encrypted)'));
      }
    } else if (pluginId === 'slack') {
      const { botToken } = await inquirer.prompt([
        {
          type: 'password',
          name: 'botToken',
          message: 'Slack Bot Token (xoxb-...):',
          mask: '*',
        },
      ]);
      if (botToken) {
        const { Keychain } = await import('../../security/keychain.js');
        const keychain = new Keychain(conductor.getConfig().getConfigDir());
        await keychain.set('slack', 'bot_token', botToken);
        console.log(chalk.green('  ✅ Slack bot token saved (encrypted)'));
      }
    } else if (pluginId === 'n8n') {
      const { apiKey, baseUrl } = await inquirer.prompt([
        {
          type: 'password',
          name: 'apiKey',
          message: 'n8n API Key:',
          mask: '*',
        },
        {
          type: 'input',
          name: 'baseUrl',
          message: 'n8n Base URL (https://your-n8n.com):',
        },
      ]);
      if (apiKey && baseUrl) {
        const { Keychain } = await import('../../security/keychain.js');
        const keychain = new Keychain(conductor.getConfig().getConfigDir());
        await keychain.set('n8n', 'api_key', apiKey);
        await keychain.set('n8n', 'base_url', baseUrl);
        console.log(chalk.green('  ✅ n8n credentials saved (encrypted)'));
      }
    } else if (pluginId === 'spotify') {
      const { clientId, clientSecret } = await inquirer.prompt([
        {
          type: 'input',
          name: 'clientId',
          message: 'Spotify Client ID:',
        },
        {
          type: 'password',
          name: 'clientSecret',
          message: 'Spotify Client Secret:',
          mask: '*',
        },
      ]);
      if (clientId && clientSecret) {
        const { Keychain } = await import('../../security/keychain.js');
        const keychain = new Keychain(conductor.getConfig().getConfigDir());
        await keychain.set('spotify', 'client_id', clientId);
        await keychain.set('spotify', 'client_secret', clientSecret);
        console.log(chalk.green('  ✅ Spotify credentials saved (encrypted)'));
      }
    } else if (pluginId === 'x') {
      const { apiKey } = await inquirer.prompt([
        {
          type: 'password',
          name: 'apiKey',
          message: 'X API Bearer Token:',
          mask: '*',
        },
      ]);
      if (apiKey) {
        const { Keychain } = await import('../../security/keychain.js');
        const keychain = new Keychain(conductor.getConfig().getConfigDir());
        await keychain.set('x', 'api_key', apiKey);
        console.log(chalk.green('  ✅ X API key saved (encrypted)'));
      }
    } else if (pluginId === 'homekit') {
      const { baseUrl, username, password } = await inquirer.prompt([
        {
          type: 'input',
          name: 'baseUrl',
          message: 'Homebridge URL (http://homebridge.local:8581):',
        },
        {
          type: 'input',
          name: 'username',
          message: 'Username:',
        },
        {
          type: 'password',
          name: 'password',
          message: 'Password:',
          mask: '*',
        },
      ]);
      if (baseUrl && username && password) {
        const { Keychain } = await import('../../security/keychain.js');
        const keychain = new Keychain(conductor.getConfig().getConfigDir());
        await keychain.set('homekit', 'base_url', baseUrl);
        await keychain.set('homekit', 'username', username);
        await keychain.set('homekit', 'password', password);
        console.log(chalk.green('  ✅ HomeKit credentials saved (encrypted)'));
      }
    } else if (pluginId === 'todoist') {
      const { apiToken } = await inquirer.prompt([
        {
          type: 'password',
          name: 'apiToken',
          message: 'Todoist API Token:',
          mask: '*',
        },
      ]);
      if (apiToken) {
        const { Keychain } = await import('../../security/keychain.js');
        const keychain = new Keychain(conductor.getConfig().getConfigDir());
        await keychain.set('todoist', 'api_token', apiToken);
        console.log(chalk.green('  ✅ Todoist API token saved (encrypted)'));
      }
    } else if (pluginId === 'gmail' || pluginId === 'gcal' || pluginId === 'gdrive') {
      console.log(chalk.yellow('  ℹ️  Google OAuth requires browser authentication.'));
      console.log(chalk.yellow('  Run: conductor auth google'));
    }
  }
}

async function setupMCP(_conductor: Conductor): Promise<void> {
  console.log('\n' + chalk.bold('🔌 MCP Server Setup'));
  console.log(chalk.gray('Configure Conductor as an MCP server for your AI agents\n'));

  const { setupMCP } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'setupMCP',
      message: 'Set up Conductor as an MCP server for your AI agents?',
      default: true,
    },
  ]);

  if (!setupMCP) return;

  const { agents } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'agents',
      message: 'Which AI agents do you use?',
      choices: [
        { name: 'Claude Desktop', value: 'claude-desktop', checked: true },
        { name: 'Claude Code', value: 'claude-code' },
        { name: 'Cursor', value: 'cursor' },
        { name: 'Cline', value: 'cline' },
        { name: 'Aider', value: 'aider' },
      ],
    },
  ]);

  const mcpConfig = {
    command: 'conductor',
    args: ['mcp', 'start'],
  };

  for (const agent of agents) {
    if (agent === 'claude-desktop') {
      try {
        const { execSync } = await import('child_process');
        const claudeConfigPath =
          process.platform === 'darwin'
            ? `${process.env.HOME}/Library/Application Support/Claude/claude_desktop_config.json`
            : `${process.env.HOME}/.config/Claude/claude_desktop_config.json`;

        let config = {};
        try {
          const content = execSync(`cat "${claudeConfigPath}"`, { encoding: 'utf-8' });
          config = JSON.parse(content);
        } catch {
          // Config doesn't exist yet
        }

        const newConfig = {
          ...config,
          mcpServers: {
            ...((config as any).mcpServers || {}),
            conductor: mcpConfig,
          },
        };

        const fs = await import('fs/promises');
        const path = await import('path');
        await fs.mkdir(path.dirname(claudeConfigPath), { recursive: true });
        await fs.writeFile(claudeConfigPath, JSON.stringify(newConfig, null, 2));

        console.log(chalk.green(`  ✅ Claude Desktop configured at ${claudeConfigPath}`));
      } catch (err) {
        console.log(
          chalk.yellow(`  ⚠️  Could not configure Claude Desktop: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    } else if (agent === 'claude-code') {
      console.log(chalk.yellow('  ℹ️  Add to ~/.claude/settings.json:'));
      console.log(chalk.gray(JSON.stringify({ mcpServers: { conductor: mcpConfig } }, null, 2)));
    } else if (agent === 'cursor') {
      console.log(chalk.yellow('  ℹ️  In Cursor: Settings → MCP → Add Server →'));
      console.log(chalk.gray(`Command: conductor\nArgs: mcp start`));
    } else if (agent === 'cline') {
      console.log(chalk.yellow('  ℹ️  In Cline: Settings → MCP Servers → Add →'));
      console.log(chalk.gray(`Command: conductor\nArgs: mcp start`));
    } else if (agent === 'aider') {
      console.log(chalk.yellow('  ℹ️  In Aider: Configure as external tool with:'));
      console.log(chalk.gray(`conductor mcp start`));
    }
  }
}

export async function install(conductor: Conductor): Promise<void> {
  console.log('\n' + chalk.bold.blue('🎵 Conductor v' + version + ' — The AI Tool Hub'));
  console.log(chalk.gray('One MCP server. 100+ tools. Every AI agent.\n'));

  // Step 1: Prerequisites
  await checkPrerequisites();

  // Step 2: AI Provider Setup
  console.log('\n' + chalk.bold('🤖 AI Provider Setup'));
  const { aiProvider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'aiProvider',
      message: 'Which AI provider do you want to use?',
      choices: [
        { name: 'Anthropic Claude', value: 'claude' },
        { name: 'OpenAI', value: 'openai' },
        { name: 'Google Gemini', value: 'gemini' },
        { name: 'OpenRouter', value: 'openrouter' },
        { name: 'Ollama (local)', value: 'ollama' },
        { name: 'Skip (configure later)', value: 'skip' },
      ],
    },
  ]);

  if (aiProvider !== 'skip') {
    const { apiKey } = await inquirer.prompt([
      {
        type: 'password',
        name: 'apiKey',
        message: `${aiProvider.charAt(0).toUpperCase() + aiProvider.slice(1)} API Key:`,
        mask: '*',
      },
    ]);

    if (apiKey) {
      await conductor.getConfig().set('ai.provider', aiProvider);
      await conductor.getConfig().set('ai.apiKey', apiKey);
      console.log(chalk.green('  ✅ AI provider configured'));
    }
  }

  // Step 3: Plugin Selection
  const selectedPlugins = await selectPlugins();

  // Step 4: Enable Plugins
  const spinner = ora('Enabling plugins...').start();
  await conductor.getConfig().set('plugins.enabled', selectedPlugins);
  spinner.succeed(`Enabled ${selectedPlugins.length} plugins`);

  // Step 5: Configure Plugins
  await configurePlugins(selectedPlugins, conductor);

  // Step 6: MCP Setup
  await setupMCP(conductor);

  // Step 7: Summary
  console.log('\n' + chalk.bold.green('🎉 Installation Complete!'));
  console.log(chalk.gray('\nYour AI agent can now access these tools:\n'));

  const enabledPlugins = selectedPlugins.map((id) => {
    const plugin = PLUGIN_CATALOG.find((p) => p.id === id);
    return plugin ? `${plugin.icon} ${plugin.name}` : id;
  });

  console.log(enabledPlugins.join('\n'));
  console.log(chalk.gray('\nTo start the MCP server:'));
  console.log(chalk.bold('  conductor mcp start'));
  console.log(chalk.gray('\nTo add more plugins later:'));
  console.log(chalk.bold('  conductor plugin install'));
  console.log(chalk.gray('\nTo check system health:'));
  console.log(chalk.bold('  conductor doctor'));
  console.log('');
}
