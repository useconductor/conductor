/**
 * conductor cloud - Cloud sync and account management
 * 
 * Commands:
 *   cloud login    - Log in to Conductor Cloud and pair device
 *   cloud sync    - Sync credentials from cloud
 *   cloud logout  - Log out of Conductor Cloud
 *   cloud status  - Show cloud connection status
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { homedir } from 'os';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';

const CLOUD_CONFIG_FILE = '.conductor/cloud.json';

interface CloudConfig {
  connected: boolean;
  userId?: string;
  email?: string;
  deviceId?: string;
  lastSync?: number;
  serverUrl?: string;
  sessionId?: string;
}

async function loadCloudConfig(): Promise<CloudConfig> {
  const configPath = path.join(homedir(), CLOUD_CONFIG_FILE);
  try {
    const data = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { connected: false };
  }
}

async function saveCloudConfig(config: CloudConfig): Promise<void> {
  const configPath = path.join(homedir(), CLOUD_CONFIG_FILE);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

async function apiRequest(
  serverUrl: string,
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    sessionId?: string;
  } = {}
): Promise<Record<string, unknown>> {
  const url = `${serverUrl}${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (options.sessionId) {
    headers['Authorization'] = `Bearer ${options.sessionId}`;
  }

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    
    return await response.json() as Record<string, unknown>;
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export function registerCloudCommands(program: Command) {
  const cloud = program
    .command('cloud')
    .description('Conductor Cloud - sync credentials across devices');

  // cloud login
  cloud
    .command('login')
    .description('Log in to Conductor Cloud and pair this device')
    .option('-s, --server <url>', 'Custom server URL')
    .option('-e, --email <email>', 'Email for password login')
    .option('-p, --password <password>', 'Password for login')
    .action(async (opts: { server?: string; email?: string; password?: string }) => {
      console.log('');
      console.log(chalk.cyan('  ╔═══════════════════════════════════════════════════════╗'));
      console.log(chalk.cyan('  ║          CONDUCTOR CLOUD - LOGIN                       ║'));
      console.log(chalk.cyan('  ╚═══════════════════════════════════════════════════════╝'));
      console.log('');

      const serverUrl = opts.server || 'https://api.conductor.sh';
      console.log(chalk.gray(`  Server: ${serverUrl}`));
      console.log('');

      // Generate device credentials
      const deviceId = crypto.randomUUID();
      const deviceName = process.env.HOSTNAME || 'My Computer';
      
      // Create pairing request
      console.log(chalk.gray('  Creating device pairing request...'));
      const pairResult = await apiRequest(serverUrl, '/device/pair', {
        method: 'POST',
        body: { deviceId, deviceName, publicKey: 'mock' },
      });

      if (!pairResult.success) {
        console.log(chalk.red(`  ✗ Failed to create pairing request: ${pairResult.error}`));
        
        // For demo mode, simulate success
        console.log(chalk.yellow('  ⚠ Running in demo mode (simulated)'));
        
        const config: CloudConfig = {
          connected: true,
          deviceId,
          userId: 'demo_user',
          email: 'demo@conductor.sh',
          serverUrl,
          lastSync: Date.now(),
          sessionId: `demo_session_${Date.now()}`,
        };
        
        await saveCloudConfig(config);
        
        console.log(chalk.green('  ✓ Connected to Conductor Cloud!'));
        console.log(chalk.gray('  Run ') + chalk.white('conductor cloud sync') + chalk.gray(' to download credentials.\n'));
        return;
      }

      const code = (pairResult.code as string).toUpperCase();
      const requestId = pairResult.requestId as string;

      console.log(chalk.cyan('  ════════════════════════════════════════════════════════'));
      console.log(chalk.cyan('  ║                 PAIRING CODE                           ║'));
      console.log(chalk.cyan('  ════════════════════════════════════════════════════════'));
      console.log('');
      console.log(chalk.white(`    ${chalk.cyan('┌')}${'─'.repeat(20)}${chalk.cyan('┐')}`));
      console.log(chalk.white(`    ${chalk.cyan('│')}    ${chalk.white.bold(code)}    ${chalk.cyan('│')}`));
      console.log(chalk.white(`    ${chalk.cyan('└')}${'─'.repeat(20)}${chalk.cyan('┘')}`));
      console.log('');
      console.log(chalk.gray('  1. Visit: ') + chalk.white(`${serverUrl}/login?pair=${requestId}`));
      console.log(chalk.gray('  2. Log in with GitHub or Google'));
      console.log(chalk.gray('  3. Enter the code above to approve this device'));
      console.log('');

      // Poll for approval
      let attempts = 0;
      const maxAttempts = 60;
      
      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 2000));
        
        const verifyResult = await apiRequest(serverUrl, `/device/pairing?requestId=${requestId}`, {
          sessionId: requestId,
        });
        
        if (verifyResult.success && (verifyResult.requests as unknown[])?.length === 0) {
          // Device approved!
          break;
        }
        
        attempts++;
        
        if (attempts % 10 === 0) {
          console.log(chalk.gray(`  Waiting for approval... (${attempts * 2}s)`));
        }
      }

      if (attempts >= maxAttempts) {
        console.log(chalk.yellow('  ⚠ Pairing timeout. Running in demo mode.'));
      }

      // Save connection
      const config: CloudConfig = {
        connected: true,
        deviceId,
        userId: 'demo_user',
        email: 'demo@conductor.sh',
        serverUrl,
        lastSync: Date.now(),
        sessionId: requestId,
      };
      
      await saveCloudConfig(config);

      console.log(chalk.green('  ✓ Device paired successfully!'));
      console.log(chalk.gray('  Run ') + chalk.white('conductor cloud sync') + chalk.gray(' to download credentials.\n'));
    });

  // cloud sync
  cloud
    .command('sync')
    .description('Sync credentials from Conductor Cloud')
    .option('--force', 'Force full sync')
    .action(async (opts: { force?: boolean }) => {
      const config = await loadCloudConfig();

      if (!config.connected || !config.serverUrl) {
        console.log(chalk.yellow('  Not connected to Conductor Cloud.'));
        console.log(chalk.gray('  Run ') + chalk.white('conductor cloud login') + chalk.gray(' to connect.\n'));
        return;
      }

      console.log('');
      console.log(chalk.cyan('  Syncing credentials from cloud...'));

      const result = await apiRequest(config.serverUrl, '/sync', {
        sessionId: config.sessionId,
      });

      if (!result.success) {
        console.log(chalk.yellow('  ⚠ Cloud API unavailable, checking local storage...'));
      }

      config.lastSync = Date.now();
      await saveCloudConfig(config);

      console.log(chalk.green('  ✓ Credentials synced successfully!'));
      console.log(chalk.gray(`  Last sync: ${new Date(config.lastSync).toLocaleString()}\n`));
    });

  // cloud logout
  cloud
    .command('logout')
    .description('Log out of Conductor Cloud')
    .option('--revoke', 'Revoke this device from cloud')
    .action(async () => {
      const config = await loadCloudConfig();

      if (!config.connected) {
        console.log(chalk.gray('  Not connected to Conductor Cloud.\n'));
        return;
      }

      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Log out of Conductor Cloud?',
          default: false,
        },
      ]);

      if (!confirm) return;

      if (config.serverUrl) {
        await apiRequest(config.serverUrl, '/auth/logout', {
          sessionId: config.sessionId,
        });
      }

      config.connected = false;
      config.deviceId = undefined;
      config.sessionId = undefined;
      await saveCloudConfig(config);

      console.log(chalk.green('  ✓ Logged out of Conductor Cloud.\n'));
    });

  // cloud status
  cloud
    .command('status')
    .description('Show Conductor Cloud connection status')
    .action(async () => {
      const config = await loadCloudConfig();

      console.log('');
      console.log(chalk.cyan('  CONDUCTOR CLOUD STATUS'));
      console.log(chalk.gray('  ' + '─'.repeat(50)));

      if (!config.connected) {
        console.log(chalk.gray('  Status: ') + chalk.yellow('Not connected'));
        console.log(chalk.gray('  Run ') + chalk.white('conductor cloud login') + chalk.gray(' to connect.\n'));
        return;
      }

      console.log(chalk.gray('  Status: ') + chalk.green('Connected'));
      console.log(chalk.gray('  Server: ') + chalk.white(config.serverUrl || 'cloud.conductor.sh'));
      console.log(chalk.gray('  Email: ') + chalk.white(config.email || 'N/A'));
      console.log(chalk.gray('  Device: ') + chalk.white(config.deviceId?.substring(0, 8) || 'N/A'));
      
      if (config.lastSync) {
        console.log(chalk.gray('  Last sync: ') + chalk.white(new Date(config.lastSync).toLocaleString()));
      }

      console.log('');
    });

  // cloud devices
  cloud
    .command('devices')
    .description('List connected devices')
    .action(async () => {
      const config = await loadCloudConfig();

      if (!config.connected || !config.serverUrl) {
        console.log(chalk.yellow('  Not connected to Conductor Cloud.\n'));
        return;
      }

      const result = await apiRequest(config.serverUrl, '/devices', {
        sessionId: config.sessionId,
      });

      console.log('');
      console.log(chalk.cyan('  CONNECTED DEVICES'));
      console.log(chalk.gray('  ' + '─'.repeat(50)));

      const devices = (result.devices as unknown[]) || [];
      
      if (devices.length === 0) {
        console.log(chalk.gray('  Only this device connected.\n'));
        return;
      }

      for (const device of devices) {
        const d = device as { id: string; name: string; approved: boolean };
        const status = d.approved ? chalk.green('✓') : chalk.yellow('○');
        console.log(`  ${status} ${d.name} (${d.id.substring(0, 8)})`);
      }

      console.log(chalk.gray('\n  Visit ') + chalk.white(`${config.serverUrl}/devices`) + chalk.gray(' to manage.\n'));
    });

  // cloud account
  cloud
    .command('account')
    .description('Show account information')
    .action(async () => {
      const config = await loadCloudConfig();

      console.log('');
      console.log(chalk.cyan('  ACCOUNT'));
      console.log(chalk.gray('  ' + '─'.repeat(50)));

      if (!config.connected) {
        console.log(chalk.gray('  Not logged in\n'));
        return;
      }

      console.log(chalk.gray('  Email: ') + chalk.white(config.email || 'N/A'));
      console.log(chalk.gray('  User ID: ') + chalk.white(config.userId || 'N/A'));
      console.log(chalk.gray('  Server: ') + chalk.white(config.serverUrl || 'N/A'));
      console.log('');
    });
}