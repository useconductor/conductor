import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Conductor } from '../../core/conductor.js';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function registerLifecycleCommands(program: Command, conductor: Conductor): void {
  program
    .command('version')
    .description('Show Conductor version')
    .action(async () => {
      try {
        // Walk up from dist/cli/commands/ to find package.json
        const packagePath = path.resolve(__dirname, '..', '..', '..', 'package.json');
        const pkg = JSON.parse(await fs.readFile(packagePath, 'utf-8'));
        console.log(`Conductor v${pkg.version}`);
      } catch {
        console.log('Conductor (version unknown)');
      }
    });

  program
    .command('status')
    .description('Show Conductor status')
    .action(async () => {
      await conductor.initialize();

      const config = conductor.getConfig();
      const user = config.get<any>('user');
      const ai = config.get<any>('ai');
      const telegram = config.get<any>('telegram');
      const plugins = config.get<string[]>('plugins.enabled') || [];

      console.log('═══ Conductor Status ═══\n');
      console.log(`User: ${user?.name || 'not configured'}`);
      console.log(`AI Provider: ${ai?.provider || 'none'}`);
      console.log(`AI Model: ${ai?.model || 'default'}`);
      console.log(`Telegram: ${telegram?.enabled ? '✅ enabled' : '❌ disabled'}`);
      console.log(`Plugins: ${plugins.length > 0 ? plugins.join(', ') : 'none'}`);
    });

  program
    .command('reset')
    .description('Reset Conductor configuration')
    .option('--confirm', 'Skip confirmation prompt')
    .action(async (opts) => {
      if (!opts.confirm) {
        const { default: inquirer } = await import('inquirer');
        const { proceed } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'proceed',
            message: 'This will reset all Conductor configuration. Are you sure?',
            default: false,
          },
        ]);
        if (!proceed) {
          console.log('Cancelled.');
          return;
        }
      }

      const configDir = conductor.getConfig().getConfigDir();
      await fs.rm(configDir, { recursive: true, force: true });
      console.log('Conductor has been reset. Run the installer again to set up.');
    });

  program
    .command('logs')
    .description('Show recent activity logs')
    .option('-n, --count <number>', 'Number of entries', '20')
    .action(async (opts) => {
      await conductor.initialize();

      const count = parseInt(opts.count, 10);
      const activities = await conductor.getRecentActivity(count);

      if (activities.length === 0) {
        console.log('No activity logged yet.');
        return;
      }

      for (const entry of activities) {
        const time = new Date(entry.timestamp).toLocaleString();
        console.log(`[${time}] ${entry.user_id ?? 'system'}: ${entry.action}`);
        if (entry.details) {
          console.log(`  ${entry.details}`);
        }
      }
    });
}
