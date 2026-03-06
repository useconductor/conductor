import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

export async function telegramSetup(conductor: Conductor): Promise<void> {
  await conductor.initialize();

  const { default: inquirer } = await import('inquirer');
  const keychain = new Keychain(conductor.getConfig().getConfigDir());

  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: 'Enter your Telegram bot token (from @BotFather):',
      mask: '*',
    },
  ]);

  // Store in keychain (matching install.sh convention)
  await keychain.set('telegram', 'bot_token', token);
  await conductor.getConfig().set('telegram.enabled', true);

  console.log('✅ Telegram bot token saved.');
  console.log('   Start the bot with: conductor telegram start');
}
