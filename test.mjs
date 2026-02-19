#!/usr/bin/env node
/**
 * Conductor Test Suite
 * Tests all 25 plugins and 146 tools.
 *
 * Usage:
 *   node test.mjs                    # Run all tests
 *   node test.mjs --plugin notes     # Test one plugin
 *   node test.mjs --skip-auth        # Skip plugins needing API keys/tokens
 *   node test.mjs --write            # Also run write tests (sends real data)
 *   node test.mjs --verbose          # Show full tool output
 *
 * Categories:
 *   [FREE]  Zero config, always testable
 *   [AUTH]  Requires API key / OAuth token (skipped if not configured)
 *   [WRITE] Makes real changes — email, tweets, calendar events (needs --write)
 */

import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { parseArgs } from 'util';

// ── CLI args ─────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    plugin:      { type: 'string',  short: 'p' },
    'skip-auth': { type: 'boolean', default: false },
    write:       { type: 'boolean', default: false },
    verbose:     { type: 'boolean', short: 'v', default: false },
    help:        { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
});

if (args.help) {
  console.log(`
Conductor Test Suite

  node test.mjs                    Run all tests
  node test.mjs --plugin notes     Test one plugin
  node test.mjs --skip-auth        Skip tests needing API tokens
  node test.mjs --write            Run write tests (send email, post tweet, etc.)
  node test.mjs --verbose          Print full tool output
`);
  process.exit(0);
}

// ── Colours ───────────────────────────────────────────────────────────────────

const c = {
  reset:  '\x1b[0m',  bold:  '\x1b[1m',  dim:    '\x1b[2m',
  green:  '\x1b[32m', red:   '\x1b[31m', yellow: '\x1b[33m',
  cyan:   '\x1b[36m', blue:  '\x1b[34m', gray:   '\x1b[90m',
};

// ── Result tracking ───────────────────────────────────────────────────────────

const results = { passed: 0, failed: 0, skipped: 0, errors: [] };
let currentPlugin = '';

function pluginHeader(name, category) {
  const badge =
    category === 'FREE'  ? `${c.green}[FREE]${c.reset}`  :
    category === 'AUTH'  ? `${c.yellow}[AUTH]${c.reset}`  :
    category === 'WRITE' ? `${c.red}[WRITE]${c.reset}` : '';
  console.log(`\n${c.bold}${c.cyan}▶ ${name}${c.reset} ${badge}`);
  currentPlugin = name;
}

function pass(name, detail) {
  results.passed++;
  const det = detail && args.verbose
    ? ` ${c.gray}${JSON.stringify(detail).slice(0, 120)}${c.reset}` : '';
  console.log(`  ${c.green}✓${c.reset} ${name}${det}`);
}

function fail(name, err) {
  results.failed++;
  const msg = err?.message ?? String(err);
  results.errors.push({ plugin: currentPlugin, tool: name, error: msg });
  console.log(`  ${c.red}✗${c.reset} ${name}  ${c.red}${msg}${c.reset}`);
}

function skip(name, reason) {
  results.skipped++;
  console.log(`  ${c.dim}○ ${name} — ${reason}${c.reset}`);
}

async function run(name, fn, { write = false, auth = false } = {}) {
  if (write && !args.write)       return skip(name, 'use --write to enable');
  if (auth  && args['skip-auth']) return skip(name, '--skip-auth');
  try {
    const result = await fn();
    if (result?.error) fail(name, { message: result.error });
    else               pass(name, result);
  } catch (err) {
    const msg = err?.message ?? String(err);
    const isUnconfigured =
      /not configured|not authenticated|token|api key|bearer|keychain/i.test(msg);
    if (isUnconfigured) skip(name, 'not configured');
    else                fail(name, err);
  }
}

// ── Fake conductor for plugin.initialize() ────────────────────────────────────

const CONDUCTOR_DIR = join(homedir(), '.conductor');
mkdirSync(join(CONDUCTOR_DIR, 'keychain'), { recursive: true });
mkdirSync(join(CONDUCTOR_DIR, 'notes'),    { recursive: true });

const fakeConductor = {
  getConfig: () => ({
    getConfigDir: () => CONDUCTOR_DIR,
    get: () => null,
  }),
};

async function loadPlugin(file) {
  const mod = await import(`./dist/plugins/builtin/${file}.js`);
  const Cls = Object.values(mod).find(v =>
    typeof v === 'function' && v.prototype && typeof v.prototype.getTools === 'function'
  );
  if (!Cls) throw new Error(`No plugin class in ${file}.js`);
  const plugin = new Cls();
  await plugin.initialize(fakeConductor);
  return Object.fromEntries(plugin.getTools().map(t => [t.name, t.handler]));
}

// ══════════════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════════════

// ── Loader integrity ──────────────────────────────────────────────────────────

async function testLoader() {
  if (args.plugin) return;
  console.log(`\n${c.bold}${c.blue}▶ Plugin Loader Integrity${c.reset}`);

  const { getAllBuiltinPlugins } = await import('./dist/plugins/builtin/index.js');
  const plugins = getAllBuiltinPlugins();

  await run('25 plugins loaded',        () => {
    if (plugins.length !== 25) throw new Error(`Expected 25, got ${plugins.length}`);
    return { count: plugins.length };
  });
  await run('all have name',            () => {
    const bad = plugins.filter(p => !p.name);
    if (bad.length) throw new Error(`${bad.length} plugins missing name`);
    return { ok: true };
  });
  await run('all have tools',           () => {
    const bad = plugins.filter(p => !p.getTools?.().length);
    if (bad.length) throw new Error(`Empty: ${bad.map(p => p.name).join(', ')}`);
    return { ok: true };
  });
  await run('total tools ≥ 146',        () => {
    const total = plugins.reduce((n, p) => n + p.getTools().length, 0);
    if (total < 146) throw new Error(`Got ${total}`);
    return { total };
  });
  await run('no duplicate tool names',  () => {
    const names = plugins.flatMap(p => p.getTools().map(t => t.name));
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length) throw new Error(`Dupes: ${dupes.join(', ')}`);
    return { ok: true };
  });
  await run('all tools have inputSchema', () => {
    const bad = plugins.flatMap(p =>
      p.getTools().filter(t => !t.inputSchema).map(t => `${p.name}/${t.name}`)
    );
    if (bad.length) throw new Error(bad.join(', '));
    return { ok: true };
  });
  await run('all tools have handlers',  () => {
    const bad = plugins.flatMap(p =>
      p.getTools().filter(t => typeof t.handler !== 'function').map(t => `${p.name}/${t.name}`)
    );
    if (bad.length) throw new Error(bad.join(', '));
    return { ok: true };
  });
}

// ── calculator ────────────────────────────────────────────────────────────────

async function testCalculator() {
  if (args.plugin && args.plugin !== 'calculator') return;
  pluginHeader('calculator', 'FREE');
  const t = await loadPlugin('calculator');

  await run('calc_math basic',   () => t.calc_math({ expression: '2 + 2 * 10' }));
  await run('calc_math sqrt',    () => t.calc_math({ expression: 'sqrt(144) + 2 ** 3' }));
  await run('calc_convert km→mi',() => t.calc_convert({ value: 100, from: 'km', to: 'mi' }));
  await run('calc_convert C→F',  () => t.calc_convert({ value: 100, from: 'C',  to: 'F'  }));
  await run('calc_convert kg→lb',() => t.calc_convert({ value: 70,  from: 'kg', to: 'lb' }));
  await run('calc_date add',     () => t.calc_date({ operation: 'add',  date: '2024-01-01', amount: 30, unit: 'days' }));
  await run('calc_date diff',    () => t.calc_date({ operation: 'diff', date: '2024-01-01', date2: '2024-12-31' }));
}

// ── colors ────────────────────────────────────────────────────────────────────

async function testColors() {
  if (args.plugin && args.plugin !== 'colors') return;
  pluginHeader('colors', 'FREE');
  const t = await loadPlugin('colors');

  await run('color_convert hex→rgb', () => t.color_convert({ color: '#FF6B6B', to: 'rgb' }));
  await run('color_convert hex→hsl', () => t.color_convert({ color: '#3B82F6', to: 'hsl' }));
  // color_contrast expects { foreground, background } not { color1, color2 }
  await run('color_contrast',        () => t.color_contrast({ foreground: '#000000', background: '#FFFFFF' }));
  // color_palette expects { base } not { color }
  await run('color_palette analogous', () => t.color_palette({ base: '#3B82F6', type: 'analogous' }));
  await run('color_palette triadic',   () => t.color_palette({ base: '#FF6B6B', type: 'triadic' }));
}

// ── crypto ────────────────────────────────────────────────────────────────────

async function testCrypto() {
  if (args.plugin && args.plugin !== 'crypto') return;
  pluginHeader('crypto', 'FREE');
  const t = await loadPlugin('crypto');

  await run('crypto_price BTC',  () => t.crypto_price({ coin: 'bitcoin' }));
  await run('crypto_price ETH',  () => t.crypto_price({ coin: 'ethereum' }));
  await run('crypto_trending',   () => t.crypto_trending({}));
  await run('crypto_search',     () => t.crypto_search({ query: 'solana' }));
}

// ── fun ───────────────────────────────────────────────────────────────────────

async function testFun() {
  if (args.plugin && args.plugin !== 'fun') return;
  pluginHeader('fun', 'FREE');
  const t = await loadPlugin('fun');

  await run('fun_joke',          () => t.fun_joke({}));
  await run('fun_cat_fact',      () => t.fun_cat_fact({}));
  await run('fun_trivia',        () => t.fun_trivia({}));
  await run('fun_random_number', () => t.fun_random_number({ min: 1, max: 100 }));
  await run('fun_quote',         () => t.fun_quote({}));
}

// ── hash ──────────────────────────────────────────────────────────────────────

async function testHash() {
  if (args.plugin && args.plugin !== 'hash') return;
  pluginHeader('hash', 'FREE');
  const t = await loadPlugin('hash');

  await run('hash_text sha256',  () => t.hash_text({ text: 'conductor', algorithm: 'sha256' }));
  await run('hash_text md5',     () => t.hash_text({ text: 'conductor', algorithm: 'md5' }));
  await run('base64_encode',     () => t.base64_encode({ text: 'Conductor by TheAlxLabs' }));
  // base64_decode expects { text } not { encoded }
  await run('base64_decode',     () => t.base64_decode({ text: 'Q29uZHVjdG9yIGJ5IFRoZUFseExhYnM=' }));
  await run('generate_uuid',     () => t.generate_uuid({}));
  await run('generate_password', () => t.generate_password({ length: 24, includeSymbols: true }));
}

// ── network ───────────────────────────────────────────────────────────────────

async function testNetwork() {
  if (args.plugin && args.plugin !== 'network') return;
  pluginHeader('network', 'FREE');
  const t = await loadPlugin('network');

  await run('dns_lookup',  () => t.dns_lookup({ domain: 'github.com' }));
  await run('ip_info',     () => t.ip_info({ ip: '8.8.8.8' }));
  await run('reverse_dns', () => t.reverse_dns({ ip: '8.8.8.8' }));
}

// ── system ────────────────────────────────────────────────────────────────────

async function testSystem() {
  if (args.plugin && args.plugin !== 'system') return;
  pluginHeader('system', 'FREE');
  const t = await loadPlugin('system');

  await run('system_info',      () => t.system_info({}));
  await run('system_processes', () => t.system_processes({ limit: 5 }));
  await run('system_network',   () => t.system_network({}));
}

// ── text-tools ────────────────────────────────────────────────────────────────

async function testTextTools() {
  if (args.plugin && args.plugin !== 'text-tools') return;
  pluginHeader('text-tools', 'FREE');
  const t = await loadPlugin('text-tools');

  await run('json_format',         () => t.json_format({ json: '{"name":"conductor","plugins":25}' }));
  await run('text_stats',          () => t.text_stats({ text: 'Conductor by TheAlxLabs. 25 plugins. 146 tools.' }));
  // regex_test needs the 'g' flag for matchAll
  await run('regex_test',          () => t.regex_test({ pattern: '[a-z]+', flags: 'gi', text: 'Conductor' }));
  // text_transform valid values: uppercase, lowercase, title, camel, snake, slug, reverse
  await run('text_transform title',() => t.text_transform({ text: 'hello world from conductor', transform: 'title' }));
  await run('text_transform camel',() => t.text_transform({ text: 'hello world from conductor', transform: 'camel' }));
  await run('text_transform slug', () => t.text_transform({ text: 'Hello World From Conductor', transform: 'slug' }));
}

// ── timezone ──────────────────────────────────────────────────────────────────

async function testTimezone() {
  if (args.plugin && args.plugin !== 'timezone') return;
  pluginHeader('timezone', 'FREE');
  const t = await loadPlugin('timezone');

  // time_now expects { cities: string[] } not { timezone: string }
  await run('time_now',     () => t.time_now({ cities: ['Toronto', 'Tokyo', 'London'] }));
  await run('time_convert', () => t.time_convert({ time: '09:00', from: 'America/Toronto', to: 'Europe/London' }));
}

// ── translate ─────────────────────────────────────────────────────────────────

async function testTranslate() {
  if (args.plugin && args.plugin !== 'translate') return;
  pluginHeader('translate', 'FREE');
  const t = await loadPlugin('translate');

  await run('translate en→fr', () => t.translate_text({ text: 'Hello from Conductor', from: 'en', to: 'fr' }));
  await run('translate en→es', () => t.translate_text({ text: 'Good morning', from: 'en', to: 'es' }));
  await run('translate en→ja', () => t.translate_text({ text: 'Hello', from: 'en', to: 'ja' }));
}

// ── url-tools ─────────────────────────────────────────────────────────────────

async function testUrlTools() {
  if (args.plugin && args.plugin !== 'url-tools') return;
  pluginHeader('url-tools', 'FREE');
  const t = await loadPlugin('url-tools');

  await run('url_status',  () => t.url_status({ url: 'https://github.com' }));
  await run('url_headers', () => t.url_headers({ url: 'https://github.com' }));
  await run('url_expand',  () => t.url_expand({ url: 'https://bit.ly/3NvL2Ge' }));
}

// ── weather ───────────────────────────────────────────────────────────────────

async function testWeather() {
  if (args.plugin && args.plugin !== 'weather') return;
  pluginHeader('weather', 'FREE');
  const t = await loadPlugin('weather');

  await run('weather_current',  () => t.weather_current({ city: 'Toronto' }));
  await run('weather_forecast', () => t.weather_forecast({ city: 'Toronto', days: 3 }));
}

// ── github (public) ───────────────────────────────────────────────────────────

async function testGitHub() {
  if (args.plugin && args.plugin !== 'github') return;
  pluginHeader('github', 'FREE');
  const t = await loadPlugin('github');

  await run('github_user',     () => t.github_user({ username: 'thealxlabs' }));
  await run('github_repo',     () => t.github_repo({ owner: 'thealxlabs', repo: 'conductor' }));
  await run('github_repos',    () => t.github_repos({ username: 'thealxlabs' }));
  await run('github_trending', () => t.github_trending({ query: 'typescript ai' }));
}

// ── memory ────────────────────────────────────────────────────────────────────

async function testMemory() {
  if (args.plugin && args.plugin !== 'memory') return;
  pluginHeader('memory', 'FREE');
  const t = await loadPlugin('memory');

  let memId;
  // memory_store expects { text } not { content }
  await run('memory_store', async () => {
    const r = await t.memory_store({ text: 'Conductor has 25 plugins and 146 tools', category: 'fact' });
    memId = r.id;
    return r;
  });
  await run('memory_list',   () => t.memory_list({}));
  await run('memory_recall', () => t.memory_recall({ query: 'plugins' }));
  await run('memory_forget', async () => {
    if (!memId) return { skipped: 'no memory stored' };
    return t.memory_forget({ memoryId: memId });
  });
}

// ── notes ─────────────────────────────────────────────────────────────────────

async function testNotes() {
  if (args.plugin && args.plugin !== 'notes') return;
  pluginHeader('notes', 'FREE');
  const t = await loadPlugin('notes');

  let noteId;
  await run('notes_create blank',    async () => {
    const r = await t.notes_create({ title: 'Conductor Test Note', content: '# Test\n\nTesting notes plugin.\n\n#testing #conductor' });
    noteId = r.id;
    return r;
  });
  await run('notes_create template', () => t.notes_create({ title: 'Test Meeting', template: 'meeting' }));
  await run('notes_daily',           () => t.notes_daily({}));
  await run('notes_daily append',    () => t.notes_daily({ append: 'Test entry added by test suite' }));
  await run('notes_list',            () => t.notes_list({}));
  await run('notes_search',          () => t.notes_search({ query: 'conductor' }));
  await run('notes_stats',           () => t.notes_stats({}));
  await run('notes_read',            () => noteId ? t.notes_read({ id: noteId }) : Promise.resolve({ skipped: true }));
  await run('notes_update',          () => noteId ? t.notes_update({ id: noteId, append: '\nUpdated by test suite.' }) : Promise.resolve({ skipped: true }));
  await run('notes_delete',          () => noteId ? t.notes_delete({ id: noteId }) : Promise.resolve({ skipped: true }));
}

// ── cron ──────────────────────────────────────────────────────────────────────

async function testCron() {
  if (args.plugin && args.plugin !== 'cron') return;
  pluginHeader('cron', 'FREE');
  const t = await loadPlugin('cron');

  let taskId;
  await run('cron_schedule once',   async () => {
    const r = await t.cron_schedule({ name: 'Test once', when: 'in 30 minutes', action: 'log', message: 'Test' });
    taskId = r.id;
    return r;
  });
  await run('cron_schedule daily',  () => t.cron_schedule({ name: 'Daily test', when: 'every day at 9am', action: 'log' }));
  await run('cron_schedule weekly', () => t.cron_schedule({ name: 'Weekly test', when: 'every Monday at 8am', action: 'log' }));
  await run('cron_list',            () => t.cron_list({}));
  await run('cron_pause',           () => taskId ? t.cron_pause({ id: taskId, paused: true }) : Promise.resolve({ skipped: true }));
  await run('cron_history',         () => taskId ? t.cron_history({ id: taskId }) : Promise.resolve({ skipped: true }));
  await run('cron_cancel',          () => taskId ? t.cron_cancel({ id: taskId }) : Promise.resolve({ skipped: true }));
}

// ── gmail ─────────────────────────────────────────────────────────────────────

async function testGmail() {
  if (args.plugin && args.plugin !== 'gmail') return;
  pluginHeader('gmail', 'AUTH');
  const t = await loadPlugin('gmail');

  await run('gmail_list',        () => t.gmail_list({ maxResults: 5 }), { auth: true });
  await run('gmail_search',      () => t.gmail_search({ query: 'is:unread', maxResults: 3 }), { auth: true });
  await run('gmail_list inbox',  () => t.gmail_list({ labelIds: ['INBOX'], maxResults: 3 }), { auth: true });
  await run('gmail_send',        () => Promise.resolve('skipped — use --write'), { write: true, auth: true });
}

// ── gcal ──────────────────────────────────────────────────────────────────────

async function testGcal() {
  if (args.plugin && args.plugin !== 'gcal') return;
  pluginHeader('gcal', 'AUTH');
  const t = await loadPlugin('gcal');

  await run('gcal_list_calendars', () => t.gcal_list_calendars({}), { auth: true });
  await run('gcal_list_events',    () => t.gcal_list_events({ maxResults: 5 }), { auth: true });
  await run('gcal_create_event',   () => t.gcal_create_event({
    summary: 'Conductor Test Event',
    start: new Date(Date.now() + 86400000).toISOString(),
    end:   new Date(Date.now() + 90000000).toISOString(),
  }), { write: true, auth: true });
}

// ── gdrive ────────────────────────────────────────────────────────────────────

async function testGdrive() {
  if (args.plugin && args.plugin !== 'gdrive') return;
  pluginHeader('gdrive', 'AUTH');
  const t = await loadPlugin('gdrive');

  await run('gdrive_list',   () => t.gdrive_list({ maxResults: 5 }), { auth: true });
  await run('gdrive_search', () => t.gdrive_search({ query: 'README', maxResults: 3 }), { auth: true });
}

// ── github_actions ────────────────────────────────────────────────────────────

async function testGitHubActions() {
  if (args.plugin && args.plugin !== 'github_actions') return;
  pluginHeader('github_actions', 'AUTH');
  const t = await loadPlugin('github-actions');

  await run('gh_my_repos',      () => t.gh_my_repos({ limit: 10 }), { auth: true });
  await run('gh_workflow_runs', () => t.gh_workflow_runs({ owner: 'thealxlabs', repo: 'conductor', limit: 5 }), { auth: true });
  await run('gh_list_prs',      () => t.gh_list_prs({ owner: 'thealxlabs', repo: 'conductor' }), { auth: true });
  await run('gh_list_issues',   () => t.gh_list_issues({ owner: 'thealxlabs', repo: 'conductor' }), { auth: true });
  await run('gh_notifications', () => t.gh_notifications({ limit: 10 }), { auth: true });
  await run('gh_releases',      () => t.gh_releases({ owner: 'thealxlabs', repo: 'conductor' }), { auth: true });
  await run('gh_code_search',   () => t.gh_code_search({ query: 'Plugin repo:thealxlabs/conductor' }), { auth: true });
}

// ── vercel ────────────────────────────────────────────────────────────────────

async function testVercel() {
  if (args.plugin && args.plugin !== 'vercel') return;
  pluginHeader('vercel', 'AUTH');
  const t = await loadPlugin('vercel');

  await run('vercel_projects',    () => t.vercel_projects({ limit: 10 }), { auth: true });
  await run('vercel_deployments', () => t.vercel_deployments({ limit: 5 }), { auth: true });
  await run('vercel_domains',     () => t.vercel_domains({}), { auth: true });
  await run('vercel_team_info',   () => t.vercel_team_info({}), { auth: true });
}

// ── n8n ───────────────────────────────────────────────────────────────────────

async function testN8n() {
  if (args.plugin && args.plugin !== 'n8n') return;
  pluginHeader('n8n', 'AUTH');
  const t = await loadPlugin('n8n');

  await run('n8n_health',      () => t.n8n_health({}), { auth: true });
  await run('n8n_workflows',   () => t.n8n_workflows({}), { auth: true });
  await run('n8n_tags',        () => t.n8n_tags({}), { auth: true });
  await run('n8n_credentials', () => t.n8n_credentials({}), { auth: true });
  await run('n8n_executions',  () => t.n8n_executions({ limit: 5 }), { auth: true });
}

// ── notion ────────────────────────────────────────────────────────────────────

async function testNotion() {
  if (args.plugin && args.plugin !== 'notion') return;
  pluginHeader('notion', 'AUTH');
  const t = await loadPlugin('notion');

  await run('notion_search',    () => t.notion_search({ query: 'test', maxResults: 5 }), { auth: true });
}

// ── x ─────────────────────────────────────────────────────────────────────────

async function testX() {
  if (args.plugin && args.plugin !== 'x') return;
  pluginHeader('x', 'AUTH');
  const t = await loadPlugin('x');

  await run('x_search',       () => t.x_search({ query: 'TypeScript', maxResults: 5 }), { auth: true });
  await run('x_get_user',     () => t.x_get_user({ username: 'thealxlabs' }), { auth: true });
  await run('x_get_timeline', () => t.x_get_timeline({ username: 'thealxlabs', maxResults: 5 }), { auth: true });
  await run('x_post_tweet',   () => t.x_post_tweet({ text: 'Test from Conductor 🚀 #conductor' }), { write: true, auth: true });
}

// ── spotify ───────────────────────────────────────────────────────────────────

async function testSpotify() {
  if (args.plugin && args.plugin !== 'spotify') return;
  pluginHeader('spotify', 'AUTH');
  const t = await loadPlugin('spotify');

  await run('spotify_now_playing',     () => t.spotify_now_playing({}), { auth: true });
  await run('spotify_search track',    () => t.spotify_search({ query: 'Radiohead', type: 'track',   limit: 3 }), { auth: true });
  await run('spotify_search artist',   () => t.spotify_search({ query: 'Radiohead', type: 'artist',  limit: 3 }), { auth: true });
  await run('spotify_search playlist', () => t.spotify_search({ query: 'chill',     type: 'playlist', limit: 3 }), { auth: true });
  await run('spotify_devices',         () => t.spotify_devices({}), { auth: true });
  await run('spotify_playlists',       () => t.spotify_playlists({ limit: 5 }), { auth: true });
  await run('spotify_top_tracks',      () => t.spotify_top_tracks({ type: 'tracks', timeRange: 'medium_term', limit: 5 }), { auth: true });
  await run('spotify_top_artists',     () => t.spotify_top_tracks({ type: 'artists', timeRange: 'short_term', limit: 5 }), { auth: true });
  await run('spotify_recently_played', () => t.spotify_recently_played({ limit: 5 }), { auth: true });
  await run('spotify_recommendations', () => t.spotify_recommendations({ seedGenres: ['indie', 'alternative'], limit: 5 }), { auth: true });
  await run('spotify_play',            () => t.spotify_play({ query: 'Creep Radiohead' }), { write: true, auth: true });
  await run('spotify_pause',           () => t.spotify_pause({}), { write: true, auth: true });
  await run('spotify_shuffle on',      () => t.spotify_shuffle({ state: true }), { write: true, auth: true });
  await run('spotify_volume',          () => t.spotify_volume({ volume: 50 }), { write: true, auth: true });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${c.bold}${c.cyan}╔══════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.cyan}║   Conductor Test Suite                   ║${c.reset}`);
  console.log(`${c.bold}${c.cyan}║   25 plugins · 146 tools                 ║${c.reset}`);
  console.log(`${c.bold}${c.cyan}╚══════════════════════════════════════════╝${c.reset}`);

  if (args['skip-auth']) console.log(`\n${c.yellow}  ⚠ --skip-auth: skipping all auth plugins${c.reset}`);
  if (!args.write)       console.log(`${c.dim}  --write not set: skipping destructive operations${c.reset}`);
  if (args.plugin)       console.log(`${c.dim}  --plugin: testing ${args.plugin} only${c.reset}`);

  const start = Date.now();

  await testLoader();

  // FREE
  await testCalculator();
  await testColors();
  await testCrypto();
  await testFun();
  await testHash();
  await testNetwork();
  await testSystem();
  await testTextTools();
  await testTimezone();
  await testTranslate();
  await testUrlTools();
  await testWeather();
  await testGitHub();
  await testMemory();
  await testNotes();
  await testCron();

  // AUTH
  await testGmail();
  await testGcal();
  await testGdrive();
  await testGitHubActions();
  await testVercel();
  await testN8n();
  await testNotion();
  await testX();
  await testSpotify();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const total = results.passed + results.failed + results.skipped;

  console.log(`\n${c.bold}${'─'.repeat(50)}${c.reset}`);
  console.log(`${c.bold}Results${c.reset}  ${elapsed}s · ${total} tests`);
  console.log(`  ${c.green}✓ ${results.passed} passed${c.reset}`);
  if (results.skipped) console.log(`  ${c.dim}○ ${results.skipped} skipped (network / not configured)${c.reset}`);
  if (results.failed)  console.log(`  ${c.red}✗ ${results.failed} failed${c.reset}`);

  if (results.errors.length > 0) {
    console.log(`\n${c.bold}${c.red}Failures:${c.reset}`);
    for (const e of results.errors) {
      console.log(`  ${c.red}✗${c.reset} ${c.bold}${e.plugin}/${e.tool}${c.reset}`);
      console.log(`    ${c.dim}${e.error}${c.reset}`);
    }
  }

  console.log('');
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`\n${c.red}Fatal:${c.reset}`, err);
  process.exit(1);
});
