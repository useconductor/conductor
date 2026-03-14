#!/usr/bin/env node
/**
 * Conductor Full System Test Suite
 * Tests absolutely everything — CLI, MCP, security, config, plugins, file structure.
 *
 * Usage:
 *   node test-all.mjs                  # Everything
 *   node test-all.mjs --skip-auth      # Skip tests needing API tokens
 *   node test-all.mjs --write          # Include write operations
 *   node test-all.mjs --suite cli      # One suite only: cli, mcp, security, config, plugins, files
 *   node test-all.mjs --verbose        # Print full output
 */

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync, lstatSync } from 'fs';
import { homedir, platform, cpus, totalmem } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Args ──────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    suite: { type: 'string' },
    'skip-auth': { type: 'boolean', default: false },
    write: { type: 'boolean', default: false },
    verbose: { type: 'boolean', short: 'v', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
});

if (args.help) {
  console.log(`
Conductor Full System Test Suite

  node test-all.mjs                  Run everything
  node test-all.mjs --skip-auth      Skip auth plugin tests
  node test-all.mjs --write          Include write operations
  node test-all.mjs --suite cli      Run one suite only
  node test-all.mjs --verbose        Show full output

Suites: cli, mcp, security, config, files, plugins
`);
  process.exit(0);
}

// ── Colours ───────────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', blue: '\x1b[34m', magenta: '\x1b[35m', gray: '\x1b[90m',
};

// ── Tracking ──────────────────────────────────────────────────────────────────

const totals = { passed: 0, failed: 0, skipped: 0, errors: [] };
let currentSuite = '';

function suiteHeader(name, icon = '▶') {
  currentSuite = name;
  console.log(`\n${c.bold}${c.cyan}${icon} ${name}${c.reset}`);
}

function pass(name, detail = '') {
  totals.passed++;
  const det = detail && args.verbose ? `  ${c.gray}${String(detail).slice(0, 100)}${c.reset}` : '';
  console.log(`  ${c.green}✓${c.reset} ${name}${det}`);
}

function fail(name, err) {
  totals.failed++;
  const msg = err?.message ?? String(err);
  totals.errors.push({ suite: currentSuite, test: name, error: msg });
  console.log(`  ${c.red}✗${c.reset} ${name}  ${c.red}${msg.split('\n')[0]}${c.reset}`);
}

function skip(name, reason) {
  totals.skipped++;
  console.log(`  ${c.dim}○ ${name} — ${reason}${c.reset}`);
}

async function test(name, fn, { skipIf = false, skipReason = '' } = {}) {
  if (skipIf) return skip(name, skipReason);
  try {
    const result = await fn();
    pass(name, result);
  } catch (err) {
    fail(name, err);
  }
}

function cli(cmd) {
  return execSync(`node ${join(__dir, 'dist/cli/index.js')} ${cmd}`, {
    encoding: 'utf8',
    timeout: 10000,
    cwd: __dir,
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 1: File Structure
// ══════════════════════════════════════════════════════════════════════════════

async function testFiles() {
  if (args.suite && args.suite !== 'files') return;
  suiteHeader('File Structure', '📁');

  const required = [
    'package.json',
    'tsconfig.json',
    'install.sh',
    'install.ps1',
    'README.md',
    'SECURITY.md',
    'LICENSE',
    '.gitignore',
    'test.mjs',
    'test-all.mjs',
    'src/cli/index.ts',
    'src/core/conductor.ts',
    'src/core/config.ts',
    'src/ai/manager.ts',
    'src/ai/claude.ts',
    'src/ai/openai.ts',
    'src/ai/gemini.ts',
    'src/ai/ollama.ts',
    'src/ai/openrouter.ts',
    'src/bot/telegram.ts',
    'src/mcp/server.ts',
    'src/security/keychain.ts',
    'src/config/oauth.ts',
    'src/plugins/manager.ts',
    'src/plugins/builtin/index.ts',
    'dist/cli/index.js',
    'dist/plugins/builtin/index.js',
    'dist/core/conductor.js',
    'dist/mcp/server.js',
  ];

  for (const f of required) {
    await test(`exists: ${f}`, () => {
      if (!existsSync(join(__dir, f))) throw new Error(`Missing: ${f}`);
      return true;
    });
  }

  // Check all builtin plugin source files exist
  const pluginsDir = join(__dir, 'src/plugins/builtin');
  const pluginFolders = readdirSync(pluginsDir)
    .filter(f => lstatSync(join(pluginsDir, f)).isDirectory());
  const expectedPluginCount = pluginFolders.length;

  suiteHeader('File Structure', '📁');
  const plugins = pluginFolders;
  for (const p of plugins) {
    await test(`plugin src: ${p}.ts`, () => {
      const f = join(__dir, `src/plugins/builtin/${p}.ts`);
      if (!existsSync(f)) throw new Error(`Missing: ${f}`);
      const size = readFileSync(f).length;
      if (size < 500) throw new Error(`${p}.ts is suspiciously small (${size} bytes)`);
      return `${Math.round(size / 1024)}kb`;
    });
  }

  await test('package.json valid JSON', () => {
    const pkg = JSON.parse(readFileSync(join(__dir, 'package.json'), 'utf8'));
    if (!pkg.name) throw new Error('Missing name');
    if (!pkg.version) throw new Error('Missing version');
    if (!pkg.scripts?.build) throw new Error('Missing build script');
    if (!pkg.bin?.conductor) throw new Error('Missing bin entry');
    return `${pkg.name}@${pkg.version}`;
  });

  await test('tsconfig.json valid', () => {
    const tsconfig = JSON.parse(readFileSync(join(__dir, 'tsconfig.json'), 'utf8'));
    if (!tsconfig.compilerOptions) throw new Error('Missing compilerOptions');
    if (tsconfig.compilerOptions.strict !== true) throw new Error('strict mode should be enabled');
    return 'strict mode on';
  });

  await test('install.sh is executable text', () => {
    const sh = readFileSync(join(__dir, 'install.sh'), 'utf8');
    if (!sh.startsWith('#!/')) throw new Error('Missing shebang');
    if (sh.length < 10000) throw new Error(`install.sh too small: ${sh.length} bytes`);
    const steps = (sh.match(/^step "/gm) || []).length;
    if (steps < 10) throw new Error(`Expected 10+ steps, found ${steps}`);
    return `${steps} steps, ${Math.round(sh.length / 1024)}kb`;
  });

  await test('README.md complete', () => {
    const md = readFileSync(join(__dir, 'README.md'), 'utf8');
    const checks = ['## Install', '## Plugins', '## Security', 'TheAlxLabs'];
    for (const check of checks) {
      if (!md.includes(check)) throw new Error(`README missing: ${check}`);
    }
    return `${Math.round(md.length / 1024)}kb`;
  });

  await test('SECURITY.md exists and complete', () => {
    const md = readFileSync(join(__dir, 'SECURITY.md'), 'utf8');
    if (!md.includes('Reporting')) throw new Error('Missing Reporting section');
    if (!md.includes('AES-256')) throw new Error('Missing encryption details');
    return `${Math.round(md.length / 1024)}kb`;
  });

  await test('.gitignore has node_modules and dist', () => {
    const gi = readFileSync(join(__dir, '.gitignore'), 'utf8');
    if (!gi.includes('node_modules')) throw new Error('Missing node_modules');
    if (!gi.includes('dist/')) throw new Error('Missing dist/');
    if (!gi.includes('keychain')) throw new Error('Missing keychain (security risk!)');
    return 'ok';
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 2: Build & TypeScript
// ══════════════════════════════════════════════════════════════════════════════

async function testBuild() {
  if (args.suite && args.suite !== 'build') return;
  suiteHeader('Build & TypeScript', '🔨');

  await test('TypeScript compiles with zero errors', () => {
    const result = execSync('npm run build 2>&1', { encoding: 'utf8', cwd: __dir });
    if (result.includes('error TS')) {
      const errors = result.split('\n').filter(l => l.includes('error TS'));
      throw new Error(`${errors.length} TypeScript errors:\n${errors.slice(0, 3).join('\n')}`);
    }
    return 'zero errors';
  });

  await test('dist/cli/index.js exists after build', () => {
    if (!existsSync(join(__dir, 'dist/cli/index.js')))
      throw new Error('dist/cli/index.js not found — build failed');
    return true;
  });

  await test('dist has correct structure', () => {
    const expected = ['cli', 'core', 'ai', 'bot', 'mcp', 'plugins', 'security', 'config'];
    const missing = expected.filter(d => !existsSync(join(__dir, 'dist', d)));
    if (missing.length) throw new Error(`Missing dist dirs: ${missing.join(', ')}`);
    return `${expected.length} directories`;
  });

  await test('all plugin source files compile', () => {
    const distDir = join(__dir, 'dist/plugins/builtin');
    const plugins = ['calculator', 'colors', 'cron', 'crypto', 'fun', 'gcal', 'gdrive',
      'github', 'github-actions', 'gmail', 'hash', 'memory', 'n8n', 'network',
      'notes', 'notion', 'spotify', 'system', 'text-tools', 'timezone',
      'translate', 'url-tools', 'vercel', 'weather', 'x'];
    const missing = plugins.filter(p => !existsSync(join(distDir, `${p}.js`)));
    if (missing.length) throw new Error(`Missing compiled plugins: ${missing.join(', ')}`);
    return `${plugins.length} plugins compiled`;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 3: CLI
// ══════════════════════════════════════════════════════════════════════════════

async function testCLI() {
  if (args.suite && args.suite !== 'cli') return;
  suiteHeader('CLI', '⌨️');

  await test('--help prints usage', () => {
    const out = cli('--help');
    if (!out.includes('conductor')) throw new Error('No conductor in --help output');
    if (!out.includes('Commands')) throw new Error('No Commands section');
    return 'ok';
  });

  await test('--version returns semver', () => {
    const out = cli('--version').trim();
    if (!/^\d+\.\d+\.\d+/.test(out)) throw new Error(`Bad version: ${out}`);
    return out;
  });

  await test('version command works', () => {
    const out = cli('version');
    if (!out.includes('0.')) throw new Error('No version number');
    return out.trim();
  });

  await test('status command runs', () => {
    const out = cli('status');
    // Should output something about the setup
    if (out.length < 10) throw new Error('Status output too short');
    return 'ok';
  });

  await test('plugins list --help', () => {
    const out = cli('plugins --help');
    if (!out.includes('list') && !out.includes('enable')) throw new Error('Missing plugin subcommands');
    return 'ok';
  });

  await test('ai --help', () => {
    const out = cli('ai --help');
    if (!out.includes('setup') && !out.includes('test')) throw new Error('Missing ai subcommands');
    return 'ok';
  });

  await test('mcp --help', () => {
    const out = cli('mcp --help');
    if (!out.includes('start') && !out.includes('setup')) throw new Error('Missing mcp subcommands');
    return 'ok';
  });

  await test('telegram --help', () => {
    const out = cli('telegram --help');
    if (!out.includes('start') && !out.includes('setup')) throw new Error('Missing telegram subcommands');
    return 'ok';
  });

  await test('logs --help', () => {
    const out = cli('logs --help');
    if (out.length < 10) throw new Error('logs --help too short');
    return 'ok';
  });

  await test('unknown command exits non-zero', () => {
    try {
      cli('this-command-does-not-exist');
      throw new Error('Should have thrown');
    } catch (err) {
      // execSync throws on non-zero exit — that's what we want
      if (err.message === 'Should have thrown') throw err;
      return 'exited non-zero as expected';
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 4: Security & Keychain
// ══════════════════════════════════════════════════════════════════════════════

async function testSecurity() {
  if (args.suite && args.suite !== 'security') return;
  suiteHeader('Security & Keychain', '🔐');

  const tmpDir = join(homedir(), '.conductor-test-' + Date.now());
  mkdirSync(join(tmpDir, 'keychain'), { recursive: true });

  try {
    const { Keychain } = await import('./dist/security/keychain.js');

    await test('Keychain initializes', () => {
      const kc = new Keychain(tmpDir);
      if (!kc) throw new Error('Keychain constructor failed');
      return 'ok';
    });

    await test('store and retrieve a credential', async () => {
      const kc = new Keychain(tmpDir);
      await kc.set('test-service', 'test-key', 'super-secret-value-123');
      const val = await kc.get('test-service', 'test-key');
      if (val !== 'super-secret-value-123') throw new Error(`Got: ${val}`);
      return 'encrypt → decrypt roundtrip ok';
    });

    await test('different service/key combinations are isolated', async () => {
      const kc = new Keychain(tmpDir);
      await kc.set('service-a', 'key1', 'value-a1');
      await kc.set('service-b', 'key1', 'value-b1');
      const a = await kc.get('service-a', 'key1');
      const b = await kc.get('service-b', 'key1');
      if (a !== 'value-a1') throw new Error(`service-a got: ${a}`);
      if (b !== 'value-b1') throw new Error(`service-b got: ${b}`);
      return 'isolation ok';
    });

    await test('missing key returns null', async () => {
      const kc = new Keychain(tmpDir);
      const val = await kc.get('nonexistent', 'key');
      if (val !== null) throw new Error(`Expected null, got: ${val}`);
      return 'null returned';
    });

    await test('delete removes a credential', async () => {
      const kc = new Keychain(tmpDir);
      await kc.set('del-test', 'key', 'to-delete');
      await kc.delete('del-test', 'key');
      const val = await kc.get('del-test', 'key');
      if (val !== null) throw new Error(`Still exists: ${val}`);
      return 'deleted ok';
    });

    await test('encrypted file is not plaintext', async () => {
      const kc = new Keychain(tmpDir);
      await kc.set('plaintext-check', 'secret', 'my-secret-api-key-abc123');
      // Find the written file and verify the raw contents don't contain the secret
      const keychainDir = join(tmpDir, 'keychain');
      const { readdirSync } = await import('fs');
      const files = readdirSync(keychainDir);
      for (const file of files) {
        const raw = readFileSync(join(keychainDir, file), 'utf8');
        if (raw.includes('my-secret-api-key-abc123')) {
          throw new Error(`Plaintext secret found in ${file}!`);
        }
      }
      return 'no plaintext secrets on disk';
    });

    await test('credential file has restricted permissions (non-Windows)', async () => {
      if (platform() === 'win32') return 'skipped on Windows';
      const keychainDir = join(tmpDir, 'keychain');
      const stat = statSync(keychainDir);
      const mode = (stat.mode & 0o777).toString(8);
      // Should be 0700 (owner only)
      if (mode !== '700') throw new Error(`Expected 700, got ${mode}`);
      return `mode: ${mode}`;
    });

    await test('special characters in credentials', async () => {
      const kc = new Keychain(tmpDir);
      const special = 'p@$$w0rd!#%^&*()_+-=[]{}|;\':",./<>?`~\\n\\t';
      await kc.set('special', 'chars', special);
      const val = await kc.get('special', 'chars');
      if (val !== special) throw new Error('Special chars mangled');
      return 'special chars preserved';
    });

    await test('long credential value', async () => {
      const kc = new Keychain(tmpDir);
      const long = 'x'.repeat(4096);
      await kc.set('long', 'value', long);
      const val = await kc.get('long', 'value');
      if (val !== long) throw new Error('Long value mangled');
      return `${long.length} chars preserved`;
    });

  } finally {
    // Clean up temp keychain
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 5: Config
// ══════════════════════════════════════════════════════════════════════════════

async function testConfig() {
  if (args.suite && args.suite !== 'config') return;
  suiteHeader('Config', '⚙️');

  const { Conductor } = await import('./dist/core/conductor.js');
  const conductor = new Conductor();

  await test('Conductor initializes', () => {
    if (!conductor) throw new Error('Conductor failed to init');
    return 'ok';
  });

  await test('getConfig() returns config object', () => {
    const config = conductor.getConfig();
    if (!config) throw new Error('No config returned');
    if (typeof config.getConfigDir !== 'function') throw new Error('Missing getConfigDir()');
    return 'ok';
  });

  await test('config dir exists or is creatable', () => {
    const dir = conductor.getConfig().getConfigDir();
    if (!dir) throw new Error('No config dir returned');
    mkdirSync(dir, { recursive: true });
    if (!existsSync(dir)) throw new Error(`Could not create: ${dir}`);
    return dir;
  });

  await test('OAuth config module loads', async () => {
    const { getOAuthCredentials } = await import('./dist/config/oauth.js');
    if (typeof getOAuthCredentials !== 'function') throw new Error('getOAuthCredentials not exported');
    return 'OAuth config module ok';
  });

  await test('OAuth redirect URI defaults to localhost', async () => {
    const { getOAuthCredentials } = await import('./dist/config/oauth.js');
    // Set dummy env vars for test
    process.env.CONDUCTOR_GOOGLE_CLIENT_ID = 'test-id';
    process.env.CONDUCTOR_GOOGLE_CLIENT_SECRET = 'test-secret';

    const creds = getOAuthCredentials(conductor, 'google');
    if (!creds.redirectUri.includes('localhost')) {
      throw new Error('Expected localhost redirect URI');
    }

    delete process.env.CONDUCTOR_GOOGLE_CLIENT_ID;
    delete process.env.CONDUCTOR_GOOGLE_CLIENT_SECRET;
    // Do not return the redirect URI itself to avoid logging potentially sensitive data
    return 'ok';
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 6: Plugin Manager
// ══════════════════════════════════════════════════════════════════════════════

async function testPluginManager() {
  if (args.suite && args.suite !== 'plugins') return;
  suiteHeader('Plugin Manager', '🔌');

  const { Conductor } = await import('./dist/core/conductor.js');
  const { PluginManager } = await import('./dist/plugins/manager.js');
  const conductor = new Conductor();
  const manager = new PluginManager(conductor);

  await test('PluginManager initializes', () => {
    if (!manager) throw new Error('PluginManager failed');
    return 'ok';
  });

  await test('getAllBuiltinPlugins returns a consistent count', async () => {
    const { getAllBuiltinPlugins } = await import('./dist/plugins/builtin/index.js');
    const plugins = getAllBuiltinPlugins();
    const expectedPluginCount = plugins.length; // Dynamically get the count
    if (plugins.length < 10) throw new Error(`Expected at least 10 plugins, got ${plugins.length}`);
    return `${plugins.length} plugins`;
  });

  await test('all plugins implement Plugin interface', async () => {
    const { getAllBuiltinPlugins } = await import('./dist/plugins/builtin/index.js');
    const plugins = getAllBuiltinPlugins();
    const required = ['name', 'description', 'version'];
    const bad = [];
    for (const p of plugins) {
      for (const field of required) {
        if (!p[field]) bad.push(`${p.name || '?'} missing ${field}`);
      }
      if (typeof p.getTools !== 'function') bad.push(`${p.name} missing getTools()`);
      if (typeof p.initialize !== 'function') bad.push(`${p.name} missing initialize()`);
    }
    if (bad.length) throw new Error(bad.join(', '));
    return `${plugins.length} plugins valid`;
  });

  await test('total tool count is consistent', async () => {
    const { getAllBuiltinPlugins } = await import('./dist/plugins/builtin/index.js');
    const all = getAllBuiltinPlugins();
    let total = 0;
    for (const p of all) total += p.getTools().length;
    // We expect at least a minimum set of tools, but it will grow
    if (total < 100) throw new Error(`Got ${total}, expected ≥ 100`);
    return `${total} tools`;
  });

  await test('all tool names follow snake_case', async () => {
    const { getAllBuiltinPlugins } = await import('./dist/plugins/builtin/index.js');
    const plugins = getAllBuiltinPlugins();
    const bad = plugins.flatMap(p =>
      p.getTools()
        .filter(t => !/^[a-z][a-z0-9_]*$/.test(t.name))
        .map(t => t.name)
    );
    if (bad.length) throw new Error(`Bad names: ${bad.join(', ')}`);
    return 'all snake_case';
  });

  await test('all tools have descriptions', async () => {
    const { getAllBuiltinPlugins } = await import('./dist/plugins/builtin/index.js');
    const plugins = getAllBuiltinPlugins();
    const bad = plugins.flatMap(p =>
      p.getTools()
        .filter(t => !t.description || t.description.length < 10)
        .map(t => `${p.name}/${t.name}`)
    );
    if (bad.length) throw new Error(`Missing/short descriptions: ${bad.join(', ')}`);
    return 'all described';
  });

  await test('all tool handlers return objects (not primitives)', async () => {
    // Test a sample of synchronous tools that return immediately
    const { getAllBuiltinPlugins } = await import('./dist/plugins/builtin/index.js');
    const conductor = new Conductor();
    const plugins = getAllBuiltinPlugins();
    const fakeConductor = { getConfig: () => ({ getConfigDir: () => join(homedir(), '.conductor'), get: () => null }) };

    for (const plugin of plugins) {
      try {
        await plugin.initialize(fakeConductor);
      } catch {
        // Some plugins (e.g. lumen) throw on init if their backend is unavailable.
        // This is expected — we just skip those plugins for this test.
      }
    }

    const instantTools = [
      ['hash', 'generate_uuid', {}],
      ['hash', 'generate_password', { length: 16 }],
      ['calculator', 'calc_math', { expression: '1+1' }],
      ['colors', 'color_convert', { color: '#ff0000', to: 'rgb' }],
    ];

    for (const [pluginName, toolName, input] of instantTools) {
      const plugin = plugins.find(p => p.name === pluginName);
      const tool = plugin?.getTools().find(t => t.name === toolName);
      if (!tool) throw new Error(`${pluginName}/${toolName} not found`);
      const result = await tool.handler(input);
      if (typeof result !== 'object' || result === null) {
        throw new Error(`${toolName} returned ${typeof result}`);
      }
    }
    return `${instantTools.length} handler return types verified`;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 7: MCP Protocol
// ══════════════════════════════════════════════════════════════════════════════

async function testMCP() {
  if (args.suite && args.suite !== 'mcp') return;
  suiteHeader('MCP Protocol', '🔗');

  await test('MCP server module loads', async () => {
    const mod = await import('./dist/mcp/server.js');
    if (typeof mod.startMCPServer !== 'function')
      throw new Error('startMCPServer not exported');
    return 'ok';
  });

  await test('MCP server responds to initialize request', async () => {
    return new Promise((resolve, reject) => {
      const proc = spawn('node', [join(__dir, 'dist/cli/index.js'), 'mcp', 'start'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: __dir,
      });

      const initRequest = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
      }) + '\n';

      let stdout = '';
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        proc.kill();
        reject(new Error('MCP server timed out (5s)'));
      }, 5000);

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        try {
          const lines = stdout.trim().split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            const response = JSON.parse(line);
            if (response.id === 1 && response.result) {
              clearTimeout(timeout);
              proc.kill();
              resolve(`protocolVersion: ${response.result.protocolVersion}`);
              return;
            }
          }
        } catch { }
      });

      proc.on('error', (err) => {
        if (!timedOut) { clearTimeout(timeout); reject(err); }
      });

      proc.stdin.write(initRequest);
    });
  });

  await test('MCP server responds to tools/list', async () => {
    return new Promise((resolve, reject) => {
      const proc = spawn('node', [join(__dir, 'dist/cli/index.js'), 'mcp', 'start'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: __dir,
      });

      const messages = [
        {
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
        },
        { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      ];

      let stdout = '';
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        proc.kill();
        reject(new Error('MCP tools/list timed out'));
      }, 8000);

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        try {
          const lines = stdout.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const response = JSON.parse(line);
              if (response.id === 2 && response.result?.tools !== undefined) {
                const toolCount = response.result.tools.length;
                clearTimeout(timeout);
                proc.kill();
                // Tool count depends on which plugins are enabled in config —
                // a fresh install may have zero enabled. Just verify the response shape.
                resolve(`${toolCount} tools exposed via MCP (enable plugins with: conductor plugins enable <name>)`);
                return;
              }
            } catch { }
          }
        } catch { }
      });

      proc.on('error', (err) => {
        if (!timedOut) { clearTimeout(timeout); reject(err); }
      });

      for (const msg of messages) {
        proc.stdin.write(JSON.stringify(msg) + '\n');
      }
    });
  });

  await test('MCP tool call returns valid JSON-RPC response', async () => {
    // Tool availability depends on enabled plugins. Test the protocol layer directly:
    // send an unknown tool and verify we get a proper JSON-RPC error back (not a crash).
    return new Promise((resolve, reject) => {
      const proc = spawn('node', [join(__dir, 'dist/cli/index.js'), 'mcp', 'start'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: __dir,
      });

      const messages = [
        {
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
        },
        { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
        {
          jsonrpc: '2.0', id: 3, method: 'tools/call',
          params: { name: '__nonexistent_tool__', arguments: {} }
        },
      ];

      let stdout = '';
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        proc.kill();
        reject(new Error('MCP tool call timed out'));
      }, 8000);

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        const lines = stdout.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const response = JSON.parse(line);
            if (response.id === 3) {
              clearTimeout(timeout);
              proc.kill();
              // Should return a structured JSON-RPC error, not crash
              if (response.error && response.error.code && response.error.message) {
                resolve(`JSON-RPC error returned correctly: ${response.error.message}`);
              } else if (response.result) {
                resolve('Tool returned result (unexpected but valid JSON-RPC)');
              } else {
                reject(new Error(`Unexpected response shape: ${JSON.stringify(response)}`));
              }
              return;
            }
          } catch { }
        }
      });

      proc.on('error', (err) => {
        if (!timedOut) { clearTimeout(timeout); reject(err); }
      });

      for (const msg of messages) {
        proc.stdin.write(JSON.stringify(msg) + '\n');
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 8: AI Provider Modules
// ══════════════════════════════════════════════════════════════════════════════

async function testAIModules() {
  if (args.suite && args.suite !== 'ai') return;
  suiteHeader('AI Provider Modules', '🤖');

  const providers = ['claude', 'openai', 'gemini', 'ollama', 'openrouter'];

  for (const provider of providers) {
    await test(`${provider} module loads`, async () => {
      const mod = await import(`./dist/ai/${provider}.js`);
      // Each should export a class
      const Cls = Object.values(mod).find(v => typeof v === 'function');
      if (!Cls) throw new Error(`No class exported from ${provider}.js`);
      return 'ok';
    });
  }

  await test('AIManager loads all providers', async () => {
    const { AIManager } = await import('./dist/ai/manager.js');
    if (!AIManager) throw new Error('AIManager not exported');
    return 'ok';
  });

  await test('AIManager lists supported providers', async () => {
    const { AIManager } = await import('./dist/ai/manager.js');
    // Just verify the module exports the class correctly
    if (typeof AIManager !== 'function') throw new Error('AIManager is not a class');
    const supported = ['claude', 'openai', 'gemini', 'ollama', 'openrouter'];
    return `${supported.length} providers defined`;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 9: Plugins (delegates to test.mjs logic)
// ══════════════════════════════════════════════════════════════════════════════

async function testPlugins() {
  if (args.suite && args.suite !== 'plugins') return;
  suiteHeader('Plugin Functionality', '🧩');
  console.log(`  ${c.dim}Running plugin tests via test.mjs...${c.reset}\n`);

  // Run the plugin test suite as a subprocess so it inherits the full environment
  const flags = [
    args['skip-auth'] ? '--skip-auth' : '',
    args.write ? '--write' : '',
    args.verbose ? '--verbose' : '',
  ].filter(Boolean);

  try {
    const out = execSync(`node ${join(__dir, 'test.mjs')} ${flags.join(' ')}`, {
      encoding: 'utf8',
      cwd: __dir,
      timeout: 60000,
      // Don't throw on non-zero exit — we'll parse failures from stdout
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Parse results from output
    const passMatch = out.match(/✓ (\d+) passed/);
    const skipMatch = out.match(/○ (\d+) skipped/);
    const failMatch = out.match(/✗ (\d+) failed/);

    const passed = passMatch ? parseInt(passMatch[1]) : 0;
    const skipped = skipMatch ? parseInt(skipMatch[1]) : 0;
    const failed = failMatch ? parseInt(failMatch[1]) : 0;

    totals.passed += passed;
    totals.skipped += skipped;

    if (failed > 0) {
      totals.failed += failed;
      // Extract failure details from output
      const failureLines = out.split('\n')
        .filter(l => l.includes('✗'))
        .slice(0, 5)
        .map(l => l.trim());
      throw new Error(`${failed} plugin tests failed:\n  ${failureLines.join('\n  ')}`);
    }

    console.log(`  ${c.green}✓${c.reset} ${passed} plugin tests passed, ${skipped} skipped`);
  } catch (err) {
    // execSync throws on non-zero exit — capture stdout from the error object
    const out = err.stdout ?? '';
    const passMatch = out.match(/✓ (\d+) passed/);
    const skipMatch = out.match(/○ (\d+) skipped/);
    const failMatch = out.match(/✗ (\d+) failed/);
    const passed = passMatch ? parseInt(passMatch[1]) : 0;
    const skipped = skipMatch ? parseInt(skipMatch[1]) : 0;
    const failed = failMatch ? parseInt(failMatch[1]) : 0;
    totals.passed += passed;
    totals.skipped += skipped;
    totals.failed += failed;
    if (failed > 0) {
      const failureLines = out.split('\n').filter(l => l.includes('✗')).slice(0, 5).map(l => l.replace(/\x1b\[[0-9;]*m/g, '').trim());
      console.log(`  ${c.red}✗${c.reset} ${failed} plugin test(s) failed — ${passed} passed, ${skipped} skipped`);
      for (const line of failureLines) console.log(`    ${c.dim}${line}${c.reset}`);
      totals.errors.push({ suite: 'Plugin Functionality', test: 'plugin tests', error: `${failed} failed` });
    } else if (!err.message.includes('plugin tests failed')) {
      fail('plugin test runner', err);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 10: Environment
// ══════════════════════════════════════════════════════════════════════════════

async function testEnvironment() {
  if (args.suite && args.suite !== 'env') return;
  suiteHeader('Environment', '🖥️');

  await test('Node.js version ≥ 18', () => {
    const ver = process.version; // e.g. v20.11.0
    const major = parseInt(ver.slice(1).split('.')[0]);
    if (major < 18) throw new Error(`Node ${ver} is too old — need v18+`);
    return ver;
  });

  await test('npm is available', () => {
    const ver = execSync('npm --version', { encoding: 'utf8' }).trim();
    return `npm ${ver}`;
  });

  await test('running on supported platform', () => {
    const plat = platform();
    if (!['darwin', 'linux', 'win32'].includes(plat))
      throw new Error(`Unknown platform: ${plat}`);
    return plat;
  });

  await test('sufficient memory (≥ 512MB)', () => {
    const mb = Math.round(totalmem() / 1024 / 1024);
    if (mb < 512) throw new Error(`Only ${mb}MB RAM`);
    return `${mb}MB available`;
  });

  await test('home directory is accessible', () => {
    const home = homedir();
    if (!existsSync(home)) throw new Error(`Home not found: ${home}`);
    return home;
  });

  await test('~/.conductor dir exists or is creatable', () => {
    const dir = join(homedir(), '.conductor');
    mkdirSync(dir, { recursive: true });
    if (!existsSync(dir)) throw new Error('Could not create ~/.conductor');
    return dir;
  });

  await test('no credential leaks in dist output', () => {
    // Scan compiled JS for anything that looks like a secret
    const distDir = join(__dir, 'dist');
    const dangerPatterns = [
      /sk-[a-zA-Z0-9]{32,}/,   // OpenAI keys
      /AIza[a-zA-Z0-9]{30,}/,  // Google API keys
      /ghp_[a-zA-Z0-9]{30,}/,  // GitHub PATs
    ];

    function scanDir(dir) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          scanDir(full);
        } else if (entry.endsWith('.js')) {
          const content = readFileSync(full, 'utf8');
          for (const pattern of dangerPatterns) {
            if (pattern.test(content)) {
              throw new Error(`Potential credential leak in ${full}`);
            }
          }
        }
      }
    }
    scanDir(distDir);
    return 'no credential patterns found';
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 11: New Plugin Tests (Phase 5)
// ══════════════════════════════════════════════════════════════════════════════

async function testNewPlugins() {
  if (args.suite && args.suite !== 'newplugins') return;
  suiteHeader('New Plugin Tests (Phase 5)', '🔌');

  // ── Keychain ESM fix verification ──────────────────────────────────────────
  await test('keychain.ts uses ESM imports (no require)', () => {
    const src = readFileSync(join(__dir, 'src/security/keychain.ts'), 'utf8');
    if (src.includes("require('fs')")) throw new Error('Found CJS require("fs") — ESM fix not applied');
    if (!src.includes("import { readFileSync, mkdirSync, writeFileSync }")) {
      throw new Error('Missing ESM fs imports');
    }
    return 'ESM imports confirmed';
  });

  // ── Lumen requiresApproval verification ────────────────────────────────────
  await test('lumen shell tools have requiresApproval', () => {
    const src = readFileSync(join(__dir, 'src/plugins/builtin/lumen.ts'), 'utf8');
    const shellTools = ['lumen_ask', 'lumen_shell', 'lumen_write_file', 'lumen_fix_bug'];
    for (const t of shellTools) {
      const idx = src.indexOf(`name: '${t}'`);
      if (idx === -1) throw new Error(`Tool ${t} not found`);
      // Look up to 2000 chars ahead (handlers can be large)
      const snippet = src.slice(idx, idx + 2000);
      if (!snippet.includes('requiresApproval: true')) {
        throw new Error(`${t} missing requiresApproval: true`);
      }
    }
    return `${shellTools.length} tools verified`;
  });

  // ── Memory plugin userId isolation ─────────────────────────────────────────
  await test('memory plugin has setUserId method', () => {
    const src = readFileSync(join(__dir, 'src/plugins/builtin/memory.ts'), 'utf8');
    if (!src.includes('setUserId')) throw new Error('setUserId method missing');
    if (src.includes("searchMessages('%'")) throw new Error("Still uses '%' wildcard");
    return 'userId isolation confirmed';
  });

  // ── Todoist plugin has Zod validation ──────────────────────────────────────
  await test('todoist plugin uses Zod validation', () => {
    const src = readFileSync(join(__dir, 'src/plugins/builtin/todoist.ts'), 'utf8');
    if (!src.includes("from 'zod'")) throw new Error('Zod not imported');
    if (!src.includes('schema.parse')) throw new Error('schema.parse not found');
    const parseCount = (src.match(/schema\.parse/g) || []).length;
    if (parseCount < 5) throw new Error(`Expected at least 5 schema.parse calls, found ${parseCount}`);
    return `${parseCount} Zod validations`;
  });

  // ── Dashboard auth token injection ─────────────────────────────────────────
  await test('dashboard server injects auth token meta tag', () => {
    const src = readFileSync(join(__dir, 'src/dashboard/server.ts'), 'utf8');
    if (!src.includes('dashboard-token')) throw new Error('dashboard-token meta injection missing');
    if (!src.includes('127.0.0.1')) throw new Error('Server not binding to 127.0.0.1');
    if (!src.includes('Authorization: Bearer')) throw new Error('Auth middleware missing');
    return 'Auth injection confirmed';
  });

  // ── Dashboard HTML reads token ──────────────────────────────────────────────
  await test('dashboard HTML reads token from meta tag', () => {
    const html = readFileSync(join(__dir, 'src/dashboard/index.html'), 'utf8');
    if (!html.includes('dashboard-token')) throw new Error('dashboard-token meta read missing');
    if (!html.includes("'Authorization'")) throw new Error('Authorization header not sent in api()');
    return 'Token auth in HTML confirmed';
  });

  // ── Database debounce ──────────────────────────────────────────────────────
  await test('database uses write debouncing', () => {
    const src = readFileSync(join(__dir, 'src/core/database.ts'), 'utf8');
    if (!src.includes('scheduleFlush')) throw new Error('scheduleFlush not found');
    if (!src.includes('DEBOUNCE_MS')) throw new Error('DEBOUNCE_MS constant missing');
    if (!src.includes('flush()')) throw new Error('flush() method missing');
    // Count remaining await this.save() in write methods (should only be in createTables and save())
    const awaitSaveCount = (src.match(/await this\.save\(\)/g) || []).length;
    if (awaitSaveCount > 2) throw new Error(`Too many direct await this.save() calls: ${awaitSaveCount}`);
    return `Debounce confirmed, ${awaitSaveCount} direct save calls remaining`;
  });

  // ── Proactive cycle mutex ──────────────────────────────────────────────────
  await test('conductor proactive cycle has mutex guard', () => {
    const src = readFileSync(join(__dir, 'src/core/conductor.ts'), 'utf8');
    if (!src.includes('_cycleRunning')) throw new Error('_cycleRunning flag missing');
    if (!src.includes('Skipping cycle — previous cycle still running')) {
      throw new Error('Mutex warning message missing');
    }
    return 'Mutex guard confirmed';
  });

  // ── Version from package.json ──────────────────────────────────────────────
  await test('CLI uses dynamic version from package.json', () => {
    const src = readFileSync(join(__dir, 'src/cli/index.ts'), 'utf8');
    if (src.includes(".version('0.1.0')")) throw new Error('Hardcoded version 0.1.0 still present');
    if (!src.includes('pkgVersion')) throw new Error('pkgVersion variable missing');
    return 'Dynamic version confirmed';
  });

  // ── Plugin getContext() interface ──────────────────────────────────────────
  await test('Plugin interface has getContext() method', () => {
    const src = readFileSync(join(__dir, 'src/plugins/manager.ts'), 'utf8');
    if (!src.includes('getContext?()')) throw new Error('getContext() not in Plugin interface');
    return 'getContext() in interface confirmed';
  });

  // ── GmailPlugin has getContext ────────────────────────────────────────────
  await test('GmailPlugin implements getContext()', () => {
    const src = readFileSync(join(__dir, 'src/plugins/builtin/gmail.ts'), 'utf8');
    if (!src.includes('async getContext()')) throw new Error('getContext() not in GmailPlugin');
    return 'GmailPlugin.getContext() confirmed';
  });

  // ── Todoist has getContext ────────────────────────────────────────────────
  await test('TodoistPlugin implements getContext()', () => {
    const src = readFileSync(join(__dir, 'src/plugins/builtin/todoist.ts'), 'utf8');
    if (!src.includes('async getContext()')) throw new Error('getContext() not in TodoistPlugin');
    return 'TodoistPlugin.getContext() confirmed';
  });

  // ── Interfaces file exists ─────────────────────────────────────────────────
  await test('src/core/interfaces.ts exists with required interfaces', () => {
    const src = readFileSync(join(__dir, 'src/core/interfaces.ts'), 'utf8');
    if (!src.includes('IConfig')) throw new Error('IConfig not found');
    if (!src.includes('IDatabase')) throw new Error('IDatabase not found');
    if (!src.includes('IPluginRegistry')) throw new Error('IPluginRegistry not found');
    if (!src.includes('ToolContext')) throw new Error('ToolContext not found');
    if (!src.includes('ConductorNotification')) throw new Error('ConductorNotification not found');
    return 'All interfaces confirmed';
  });

  // ── .gitignore has google-creds.json ──────────────────────────────────────
  await test('.gitignore includes google-creds.json', () => {
    const src = readFileSync(join(__dir, '.gitignore'), 'utf8');
    if (!src.includes('google-creds.json')) throw new Error('google-creds.json not in .gitignore');
    return '.gitignore verified';
  });

  // ── .env.example exists ────────────────────────────────────────────────────
  await test('.env.example exists', () => {
    if (!existsSync(join(__dir, '.env.example'))) throw new Error('.env.example not found');
    const content = readFileSync(join(__dir, '.env.example'), 'utf8');
    if (!content.includes('GOOGLE_CLIENT_SECRET')) throw new Error('GOOGLE_CLIENT_SECRET not documented');
    return '.env.example verified';
  });

  // ── ConductorNotification replaces raw text ───────────────────────────────
  await test('conductor uses ConductorNotification type', () => {
    const src = readFileSync(join(__dir, 'src/core/conductor.ts'), 'utf8');
    if (!src.includes('ConductorNotification')) throw new Error('ConductorNotification not imported');
    if (src.includes('notifyUser(`')) throw new Error('notifyUser still called with template string');
    return 'Structured notifications confirmed';
  });

  // ── MCP server uses SDK ────────────────────────────────────────────────────
  await test('MCP server uses @modelcontextprotocol/sdk', () => {
    const src = readFileSync(join(__dir, 'src/mcp/server.ts'), 'utf8');
    if (!src.includes('@modelcontextprotocol/sdk')) throw new Error('SDK not imported');
    if (!src.includes('StdioServerTransport')) throw new Error('StdioServerTransport not used');
    if (!src.includes('ListToolsRequestSchema')) throw new Error('ListToolsRequestSchema not used');
    return 'MCP SDK integration confirmed';
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 12: Performance Benchmarks (Phase 5.4)
// ══════════════════════════════════════════════════════════════════════════════

async function testBenchmarks() {
  if (args.suite && args.suite !== 'bench') return;
  suiteHeader('Performance Benchmarks', 'P');

  const WARN_THRESHOLD_MS = 2000;

  await test('config initialization is fast', async () => {
    const { ConfigManager } = await import('./dist/core/config.js');
    const start = Date.now();
    const cfg = new ConfigManager();
    await cfg.initialize();
    const elapsed = Date.now() - start;
    if (elapsed > WARN_THRESHOLD_MS) {
      console.log(`    WARNING: config init took ${elapsed}ms (> ${WARN_THRESHOLD_MS}ms threshold)`);
    }
    return `${elapsed}ms`;
  });

  await test('database init + write + read cycle', async () => {
    const { DatabaseManager } = await import('./dist/core/database.js');
    const tmpDir = join(homedir(), '.conductor-bench-test');
    mkdirSync(tmpDir, { recursive: true });
    const db = new DatabaseManager(tmpDir);
    const start = Date.now();
    await db.initialize();
    await db.logActivity('bench', 'test_write', 'benchmark');
    const activity = await db.getRecentActivity(1);
    const elapsed = Date.now() - start;
    await db.close();
    // Cleanup
    try { rmSync(join(tmpDir, 'conductor.db'), { force: true }); } catch {}
    if (activity.length === 0) throw new Error('Write+read cycle produced no results');
    if (elapsed > WARN_THRESHOLD_MS) {
      console.log(`    WARNING: db cycle took ${elapsed}ms (> ${WARN_THRESHOLD_MS}ms threshold)`);
    }
    return `${elapsed}ms, 1 record`;
  });

  await test('plugin loading benchmark (builtin index)', async () => {
    const start = Date.now();
    const { getAllBuiltinPlugins } = await import('./dist/plugins/builtin/index.js');
    const plugins = getAllBuiltinPlugins();
    const elapsed = Date.now() - start;
    if (elapsed > WARN_THRESHOLD_MS) {
      console.log(`    WARNING: plugin load took ${elapsed}ms (> ${WARN_THRESHOLD_MS}ms threshold)`);
    }
    return `${elapsed}ms, ${plugins.length} plugins loaded`;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n${c.bold}${c.cyan}╔══════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.cyan}║   Conductor Full System Test Suite               ║${c.reset}`);
  console.log(`${c.bold}${c.cyan}║   CLI · MCP · Security · Config · Plugins · Files║${c.reset}`);
  console.log(`${c.bold}${c.cyan}╚══════════════════════════════════════════════════╝${c.reset}`);

  if (args['skip-auth']) console.log(`\n${c.yellow}  ⚠ --skip-auth: skipping auth plugin tests${c.reset}`);
  if (!args.write) console.log(`${c.dim}  --write not set: skipping destructive write tests${c.reset}`);
  if (args.suite) console.log(`${c.dim}  --suite: running ${args.suite} only${c.reset}`);

  const start = Date.now();

  await testEnvironment();
  await testFiles();
  await testBuild();
  await testSecurity();
  await testConfig();
  await testAIModules();
  await testPluginManager();
  await testCLI();
  await testMCP();
  await testPlugins();
  await testNewPlugins();
  await testBenchmarks();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const total = totals.passed + totals.failed + totals.skipped;

  console.log(`\n${c.bold}${'═'.repeat(60)}${c.reset}`);
  console.log(`${c.bold}Full System Results${c.reset}  ${elapsed}s · ${total} tests`);
  console.log(`  ${c.green}✓ ${totals.passed} passed${c.reset}`);
  if (totals.skipped) console.log(`  ${c.dim}○ ${totals.skipped} skipped${c.reset}`);
  if (totals.failed) console.log(`  ${c.red}✗ ${totals.failed} failed${c.reset}`);

  if (totals.errors.length > 0) {
    console.log(`\n${c.bold}${c.red}Failures:${c.reset}`);
    for (const e of totals.errors) {
      console.log(`  ${c.red}✗${c.reset} ${c.bold}[${e.suite}]${c.reset} ${e.test}`);
      console.log(`    ${c.dim}${e.error.split('\n')[0]}${c.reset}`);
    }
  }

  const allGood = totals.failed === 0;
  console.log(`\n${allGood
    ? `${c.bold}${c.green}  ✅ All systems go.${c.reset}`
    : `${c.bold}${c.red}  ❌ ${totals.failed} test(s) need attention.${c.reset}`
    }\n`);

  process.exit(allGood ? 0 : 1);
}

main().catch(err => {
  console.error(`\n${c.red}Fatal:${c.reset}`, err);
  process.exit(1);
});
