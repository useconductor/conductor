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
import { Conductor } from '../../core/conductor.js';
import { CloudManager } from '../../cloud/index.js';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { homedir } from 'os';
import path from 'path';
import fs from 'fs/promises';

const CLOUD_CONFIG_FILE = '.conductor/cloud.json';

interface CloudConfig {
  connected: boolean;
  userId?: string;
  email?: string;
  deviceId?: string;
  lastSync?: number;
  serverUrl?: string;
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

export function registerCloudCommands(program: Command) {
  const cloud = program
    .command('cloud')
    .description('Conductor Cloud - sync credentials across devices');

  // cloud login
  cloud
    .command('login')
    .description('Log in to Conductor Cloud and pair this device')
    .option('-s, --server <url>', 'Custom server URL')
    .action(async (opts: { server?: string }) => {
      console.log('');
      console.log(chalk.cyan('  ╔═══════════════════════════════════════════════════════╗'));
      console.log(chalk.cyan('  ║          CONDUCTOR CLOUD - LOGIN                       ║'));
      console.log(chalk.cyan('  ╚═══════════════════════════════════════════════════════╝'));
      console.log('');

      const { useCloud } = await inquirer.prompt<{ useCloud: boolean }>([
        {
          type: 'confirm',
          name: 'useCloud',
          message: 'Log in to Conductor Cloud to sync credentials?',
          default: false,
        },
      ]);

      if (!useCloud) {
        console.log(chalk.gray('  Skipped. You can use local credentials only.\n'));
        return;
      }

      // Check if using custom server or default cloud
      const serverUrl = opts.server || 'https://api.conductor.sh';
      console.log(chalk.gray(`  Server: ${serverUrl}`));
      console.log('');

      const cloudManager = new CloudManager({} as Conductor, serverUrl);

      try {
        await cloudManager.login();

        // Save connection info
        const config: CloudConfig = {
          connected: true,
          deviceId: Date.now().toString(),
          serverUrl,
          lastSync: Date.now(),
        };
        await saveCloudConfig(config);

        console.log(chalk.green('  ✓ Connected to Conductor Cloud!'));
        console.log(chalk.gray('  Run ') + chalk.white('conductor cloud sync') + chalk.gray(' to download credentials.\n'));
      } catch (error) {
        console.log(chalk.red(`  ✗ Failed: ${error}`));
        console.log(chalk.gray('  Try again or use local credentials.\n'));
      }
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

      const cloudManager = new CloudManager({} as Conductor, config.serverUrl);

      try {
        await cloudManager.sync();

        config.lastSync = Date.now();
        await saveCloudConfig(config);

        console.log(chalk.green('  ✓ Credentials synced successfully!\n'));
      } catch (error) {
        console.log(chalk.red(`  ✗ Sync failed: ${error}\n`));
      }
    });

  // cloud logout
  cloud
    .command('logout')
    .description('Log out of Conductor Cloud')
    .option('--revoke', 'Revoke this device from cloud')
    .action(async (opts: { revoke?: boolean }) => {
      const config = await loadCloudConfig();

      if (!config.connected) {
        console.log(chalk.gray('  Not connected to Conductor Cloud.\n'));
        return;
      }

      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Log out of Conductor Cloud? Credentials will remain on the server.',
          default: false,
        },
      ]);

      if (!confirm) {
        return;
      }

      const cloudManager = new CloudManager({} as Conductor, config.serverUrl);

      try {
        await cloudManager.logout();

        config.connected = false;
        config.deviceId = undefined;
        await saveCloudConfig(config);

        console.log(chalk.green('  ✓ Logged out of Conductor Cloud.\n'));
      } catch (error) {
        console.log(chalk.red(`  ✗ Logout failed: ${error}\n`));
      }
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
      
      if (config.lastSync) {
        const lastSync = new Date(config.lastSync).toLocaleString();
        console.log(chalk.gray('  Last sync: ') + chalk.white(lastSync));
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

      console.log('');
      console.log(chalk.cyan('  CONNECTED DEVICES'));
      console.log(chalk.gray('  ') + '─'.repeat(50));
      console.log(chalk.gray('  This device'));
      console.log('');
      console.log(chalk.gray('  Visit ') + chalk.white(`${config.serverUrl}/devices`) + chalk.gray(' to manage all devices.\n'));
    });

  // cloud init (auto-called during conductor init)
  cloud
    .command('init')
    .description('Initialize cloud connection during setup')
    .option('-s, --server <url>', 'Server URL')
    .action(async (opts: { server?: string }) => {
      const { enable } = await inquirer.prompt<{ enable: boolean }>([
        {
          type: 'confirm',
          name: 'enable',
          message: 'Enable Conductor Cloud to sync credentials across devices?',
          default: false,
        },
      ]);

      if (!enable) {
        return;
      }

      // Trigger login
      const cloud = program.commands.find(c => c.name() === 'cloud');
      const loginCmd = cloud?.commands.find(c => c.name() === 'login');
      if (loginCmd) {
        await (loginCmd as any).parseAsync(['node', 'conductor', 'cloud', 'login', ...(opts.server ? ['--server', opts.server] : [])]);
      }
    });
}