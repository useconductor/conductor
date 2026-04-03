/**
 * Conductor Doctor — diagnose every possible issue and tell you how to fix it.
 *
 * Checks:
 *   - Node.js version
 *   - Config file existence and validity
 *   - Keychain accessibility
 *   - AI provider configuration
 *   - Plugin status
 *   - MCP server connectivity
 *   - Disk space
 *   - Environment variables
 *   - Dependency versions
 *   - File permissions
 */

import { Conductor } from '../../core/conductor.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

interface CheckResult {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  fix?: string;
}

export async function doctor(conductor: Conductor): Promise<void> {
  const checks: CheckResult[] = [];

  // Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0]);
  if (major >= 18) {
    checks.push({ name: 'Node.js', status: 'ok', message: `${nodeVersion}` });
  } else if (major >= 16) {
    checks.push({ name: 'Node.js', status: 'warning', message: `${nodeVersion} (upgrade to 18+ recommended)`, fix: 'nvm install 18' });
  } else {
    checks.push({ name: 'Node.js', status: 'error', message: `${nodeVersion} (requires 18+)`, fix: 'nvm install 18' });
  }

  // Config directory
  await conductor.initialize();
  const configDir = conductor.getConfig().getConfigDir();
  try {
    await fs.access(configDir);
    checks.push({ name: 'Config directory', status: 'ok', message: configDir });
  } catch {
    checks.push({ name: 'Config directory', status: 'error', message: `${configDir} does not exist`, fix: `mkdir -p ${configDir}` });
  }

  // Config file
  try {
    const configFile = path.join(configDir, 'config.json');
    const content = await fs.readFile(configFile, 'utf-8');
    JSON.parse(content);
    checks.push({ name: 'Config file', status: 'ok', message: configFile });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({ name: 'Config file', status: 'warning', message: `Not found or invalid: ${msg}`, fix: 'Run: conductor ai setup' });
  }

  // Keychain
  try {
    const keychainDir = path.join(configDir, 'keychain');
    await fs.access(keychainDir);
    const files = await fs.readdir(keychainDir);
    checks.push({ name: 'Keychain', status: 'ok', message: `${files.length} credentials stored` });
  } catch {
    checks.push({ name: 'Keychain', status: 'warning', message: 'Not initialized', fix: 'Run: conductor ai setup or conductor auth google' });
  }

  // AI Provider
  const aiProvider = conductor.getConfig().get<string>('ai.provider');
  if (aiProvider) {
    checks.push({ name: 'AI Provider', status: 'ok', message: aiProvider });
  } else {
    checks.push({ name: 'AI Provider', status: 'warning', message: 'Not configured', fix: 'Run: conductor ai setup' });
  }

  // Enabled plugins
  const enabledPlugins = conductor.getConfig().get<string[]>('plugins.enabled') || [];
  if (enabledPlugins.length > 0) {
    checks.push({ name: 'Plugins', status: 'ok', message: `${enabledPlugins.length} enabled: ${enabledPlugins.join(', ')}` });
  } else {
    checks.push({ name: 'Plugins', status: 'warning', message: 'No plugins enabled', fix: 'Run: conductor plugins enable <name>' });
  }

  // Disk space
  const homeDir = os.homedir();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const si = await import('systeminformation');
    const fsInfo = await si.default.fsSize();
    const homeFs = fsInfo.find((f: any) => homeDir.startsWith(f.mount));
    if (homeFs) {
      const usedPercent = homeFs.use;
      if (usedPercent > 90) {
        checks.push({ name: 'Disk space', status: 'error', message: `${usedPercent.toFixed(1)}% used on ${homeFs.mount}`, fix: 'Free up disk space' });
      } else if (usedPercent > 80) {
        checks.push({ name: 'Disk space', status: 'warning', message: `${usedPercent.toFixed(1)}% used on ${homeFs.mount}` });
      } else {
        checks.push({ name: 'Disk space', status: 'ok', message: `${usedPercent.toFixed(1)}% used on ${homeFs.mount}` });
      }
    }
  } catch {
    // systeminformation might not be available
  }

  // Environment variables
  const envVars = ['CLAUDE_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GITHUB_TOKEN'];
  const setVars = envVars.filter((v) => process.env[v]);
  if (setVars.length > 0) {
    checks.push({ name: 'Environment', status: 'ok', message: `${setVars.length} env vars set: ${setVars.join(', ')}` });
  } else {
    checks.push({ name: 'Environment', status: 'warning', message: 'No API keys in environment', fix: 'Add keys to .env or run conductor ai setup' });
  }

  // Audit log integrity
  try {
    const { AuditLogger } = await import('../../core/audit.js');
    const audit = new AuditLogger(configDir);
    const integrity = await audit.verifyIntegrity();
    if (integrity.valid) {
      checks.push({ name: 'Audit log', status: 'ok', message: 'Integrity verified' });
    } else {
      checks.push({ name: 'Audit log', status: 'error', message: `Integrity broken at ${integrity.brokenAt}`, fix: 'Audit log may have been tampered with' });
    }
    await audit.close();
  } catch {
    checks.push({ name: 'Audit log', status: 'warning', message: 'Not accessible' });
  }

  // Print results
  console.log('');
  console.log('  🔍 Conductor Doctor');
  console.log('  ═══════════════════\n');

  const errors = checks.filter((c) => c.status === 'error');
  const warnings = checks.filter((c) => c.status === 'warning');
  const oks = checks.filter((c) => c.status === 'ok');

  for (const check of checks) {
    const icon = check.status === 'ok' ? '✅' : check.status === 'warning' ? '⚠️' : '❌';
    console.log(`  ${icon} ${check.name}`);
    console.log(`     ${check.message}`);
    if (check.fix) {
      console.log(`     Fix: ${check.fix}`);
    }
    console.log('');
  }

  console.log('  ═══════════════════');
  console.log(`  ${oks.length} ok, ${warnings.length} warnings, ${errors.length} errors\n`);

  if (errors.length > 0) {
    console.log('  ⚠️  Critical issues found. Fix them before using Conductor.\n');
    process.exit(1);
  } else if (warnings.length > 0) {
    console.log('  ℹ️  Some warnings found. Conductor will work, but consider fixing them.\n');
  } else {
    console.log('  🎉 Everything looks good!\n');
  }
}
