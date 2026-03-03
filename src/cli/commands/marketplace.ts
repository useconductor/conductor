import fs from 'fs/promises';
import path from 'path';
import { Conductor } from '../../core/conductor.js';

const REGISTRY_URL = 'https://conductor.thealxlabs.ca/registry.json';
const GITHUB_RAW   = 'https://raw.githubusercontent.com';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RegistryPlugin {
  id: string;
  name: string;
  description: string;
  longDescription: string;
  category: string;
  author: string;
  version: string;
  repo: string;
  path: string;
  asset: string;
  credentials: { service: string; key: string; label: string; setup: string }[];
  tools: string[];
  tags: string[];
  icon: string;
}

interface Registry {
  version: string;
  plugins: RegistryPlugin[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchRegistry(): Promise<Registry> {
  let res: Response;
  try {
    res = await fetch(REGISTRY_URL);
  } catch {
    throw new Error(`Cannot reach registry at ${REGISTRY_URL}. Check your internet connection.`);
  }
  if (!res.ok) throw new Error(`Registry returned ${res.status}`);
  return res.json() as Promise<Registry>;
}

function pluginsDir(conductor: Conductor): string {
  return path.join(conductor.getConfig().getConfigDir(), 'plugins');
}

function dim(s: string)    { return `\x1b[2m${s}\x1b[0m`; }
function green(s: string)  { return `\x1b[32m${s}\x1b[0m`; }
function red(s: string)    { return `\x1b[31m${s}\x1b[0m`; }
function cyan(s: string)   { return `\x1b[36m${s}\x1b[0m`; }
function bold(s: string)   { return `\x1b[1m${s}\x1b[0m`; }
function yellow(s: string) { return `\x1b[33m${s}\x1b[0m`; }

// ── Commands ──────────────────────────────────────────────────────────────────

/** conductor install <plugin> */
export async function installPlugin(conductor: Conductor, pluginId: string): Promise<void> {
  console.log('');
  console.log(`  ${cyan('▶')} Fetching registry…`);

  const registry = await fetchRegistry();
  const plugin   = registry.plugins.find(p => p.id === pluginId);

  if (!plugin) {
    const ids = registry.plugins.map(p => p.id).join(', ');
    console.error(`  ${red('✗')} Plugin "${pluginId}" not found in registry.`);
    console.error(`  ${dim('Available:')} ${ids}`);
    console.error(`  ${dim('Browse:')} conductor marketplace`);
    process.exit(1);
  }

  // Check if already installed
  const dir = pluginsDir(conductor);
  const dest = path.join(dir, `${plugin.id}.js`);
  try {
    await fs.access(dest);
    console.log(`  ${yellow('⚠')}  ${bold(plugin.name)} is already installed. Reinstalling…`);
  } catch { /* not installed, continue */ }

  // Download from GitHub
  const url = `${GITHUB_RAW}/${plugin.repo}/main/${plugin.path}/${plugin.asset}`;
  console.log(`  ${cyan('▶')} Downloading ${bold(plugin.name)} ${dim(`v${plugin.version}`)}…`);

  let source: string;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${url}`);
    source = await res.text();
  } catch (e: any) {
    console.error(`  ${red('✗')} Download failed: ${e.message}`);
    console.error(`  ${dim('Expected asset at:')} ${url}`);
    process.exit(1);
  }

  // Save to plugins dir
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(dest, source, 'utf-8');

  // Mark as installed in config
  const installed = conductor.getConfig().get<string[]>('plugins.installed') ?? [];
  if (!installed.includes(plugin.id)) {
    await conductor.getConfig().set('plugins.installed', [...installed, plugin.id]);
  }

  console.log(`  ${green('✓')} ${bold(plugin.name)} installed`);
  console.log('');

  // Show credential setup instructions
  if (plugin.credentials.length > 0) {
    console.log(`  ${bold('Setup required:')} ${plugin.name} needs credentials to work.`);
    for (const cred of plugin.credentials) {
      console.log(`  ${dim('→')} ${cred.label}`);
      console.log(`     ${cyan(cred.setup)}`);
    }
    console.log('');
  }

  console.log(`  ${dim('Enable it:')} ${cyan(`conductor plugins enable ${plugin.id}`)}`);
  console.log(`  ${dim('Dashboard:')} ${cyan('conductor dashboard')}`);
  console.log('');
}

/** conductor uninstall <plugin> */
export async function uninstallPlugin(conductor: Conductor, pluginId: string): Promise<void> {
  console.log('');
  const dir  = pluginsDir(conductor);
  const dest = path.join(dir, `${pluginId}.js`);

  try {
    await fs.access(dest);
  } catch {
    console.error(`  ${red('✗')} Plugin "${pluginId}" is not installed.`);
    process.exit(1);
  }

  await fs.unlink(dest);

  // Remove from installed + enabled lists
  const cfg       = conductor.getConfig();
  const installed = (cfg.get<string[]>('plugins.installed') ?? []).filter(p => p !== pluginId);
  const enabled   = (cfg.get<string[]>('plugins.enabled')   ?? []).filter(p => p !== pluginId);
  await cfg.set('plugins.installed', installed);
  await cfg.set('plugins.enabled', enabled);

  console.log(`  ${green('✓')} ${bold(pluginId)} uninstalled`);
  console.log('');
}

/** conductor marketplace (list) */
export async function listMarketplace(_conductor: Conductor, opts: { category?: string; search?: string }): Promise<void> {
  console.log('');
  console.log(`  ${bold(cyan('Conductor Marketplace'))}`);
  console.log(`  ${dim('Browse at: https://conductor.thealxlabs.ca/marketplace')}`);
  console.log('');

  let registry: Registry;
  try {
    registry = await fetchRegistry();
  } catch (e: any) {
    console.error(`  ${red('✗')} ${e.message}`);
    process.exit(1);
  }

  let plugins = registry.plugins;

  if (opts.category) {
    plugins = plugins.filter(p => p.category === opts.category);
  }
  if (opts.search) {
    const q = opts.search.toLowerCase();
    plugins = plugins.filter(p =>
      p.id.includes(q) || p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) || p.tags.includes(q)
    );
  }

  // Group by category
  const categories = [...new Set(plugins.map(p => p.category))];
  for (const cat of categories) {
    const group = plugins.filter(p => p.category === cat);
    console.log(`  ${bold(cat.toUpperCase())}`);
    for (const p of group) {
      console.log(`    ${p.icon}  ${bold(p.name.padEnd(20))} ${dim(p.id.padEnd(18))} ${p.description.slice(0, 55)}…`);
    }
    console.log('');
  }

  console.log(`  ${dim('Install:')}  ${cyan('conductor install <id>')}`);
  console.log(`  ${dim('Details:')}  ${cyan('conductor marketplace info <id>')}`);
  console.log(`  ${dim('Search:')}   ${cyan('conductor marketplace --search <query>')}`);
  console.log('');
}

/** conductor marketplace info <plugin> */
export async function pluginInfo(_conductor: Conductor, pluginId: string): Promise<void> {
  console.log('');
  const registry = await fetchRegistry();
  const plugin   = registry.plugins.find(p => p.id === pluginId);

  if (!plugin) {
    console.error(`  ${red('✗')} Plugin "${pluginId}" not found.`);
    process.exit(1);
  }

  console.log(`  ${plugin.icon}  ${bold(plugin.name)}  ${dim(`v${plugin.version} by ${plugin.author}`)}`);
  console.log('');
  console.log(`  ${plugin.longDescription}`);
  console.log('');
  console.log(`  ${bold('Tools:')} ${plugin.tools.join(', ')}`);
  console.log(`  ${bold('Tags:')}  ${plugin.tags.join(', ')}`);
  console.log('');

  if (plugin.credentials.length > 0) {
    console.log(`  ${bold('Credentials needed:')}`);
    for (const c of plugin.credentials) {
      console.log(`    ${dim('→')} ${c.label}`);
    }
    console.log('');
  }

  console.log(`  ${bold('Source:')} https://github.com/${plugin.repo}/tree/main/${plugin.path}`);
  console.log('');
  console.log(`  ${cyan(`conductor install ${plugin.id}`)}`);
  console.log('');
}
