import { Telegraf } from 'telegraf';
import { Conductor } from '../core/conductor.js';
import { Keychain } from '../security/keychain.js';
import { AIManager } from '../ai/manager.js';
import type { ConductorNotification } from '../core/interfaces.js';

export class TelegramBot {
  private conductor: Conductor;
  private keychain: Keychain;
  private bot: Telegraf | null = null;
  private aiManager: AIManager;
  private authorizedUserId: number | null = null;

  constructor(conductor: Conductor) {
    this.conductor = conductor;
    this.keychain = new Keychain(conductor.getConfig().getConfigDir());
    this.aiManager = new AIManager(conductor);
  }

  /** Start the Telegram bot. */
  async start(): Promise<void> {
    // Bug fix: install.sh saves token to keychain, NOT to config.
    // Read from keychain first, fall back to config for backward compat.
    let token = await this.keychain.get('telegram', 'bot_token');
    if (!token) {
      // Legacy fallback: some users may have set it in config
      token = this.conductor.getConfig().get<string>('telegram.token') ?? null;
    }

    if (!token) {
      throw new Error('Telegram bot token not found. Run the installer or set it with: conductor telegram setup');
    }

    // Load authorized user ID from config (set during install verification)
    this.authorizedUserId = this.conductor.getConfig().get<number>('telegram.user_id') ?? null;

    this.bot = new Telegraf(token);

    this.registerHandlers();

    // Graceful shutdown
    process.once('SIGINT', () => this.bot?.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot?.stop('SIGTERM'));

    process.stderr.write('Telegram bot starting...\n');
    await this.bot.launch();

    // Register this bot as the notification handler for Conductor
    this.conductor.setNotificationHandler(this.sendMessage.bind(this));

    // Start the proactive loop (every 30 mins default)
    await this.conductor.startProactiveMode(30);
  }

  /** Register message handlers. */
  private registerHandlers(): void {
    if (!this.bot) return;

    // Auth middleware — only respond to the verified owner
    this.bot.use(async (ctx, next) => {
      if (this.authorizedUserId && ctx.from?.id !== this.authorizedUserId) {
        await ctx.reply('⛔ Unauthorized. This bot is private.');
        return;
      }
      return next();
    });

    this.bot.command('start', async (ctx) => {
      await ctx.reply("👋 Conductor is online.\n\nSend me a message and I'll route it through your AI provider.");
    });

    this.bot.command('status', async (ctx) => {
      const config = this.conductor.getConfig();
      const provider = config.get<string>('ai.provider') || 'none';
      const plugins = config.get<string[]>('plugins.enabled') || [];

      await ctx.reply(
        `📊 Status:\n` +
          `AI: ${provider}\n` +
          `Plugins: ${plugins.length > 0 ? plugins.join(', ') : 'none'}\n` +
          `User: ${config.get<string>('user.name') || 'not set'}`,
      );
    });

    // Default: route text messages through AI
    this.bot.on('text', async (ctx) => {
      const message = ctx.message.text;

      try {
        const provider = await this.aiManager.getCurrentProvider();
        if (!provider) {
          await ctx.reply('No AI provider configured. Run: conductor ai');
          return;
        }

        // Send typing indicator
        await ctx.sendChatAction('typing');

        const userId = String(ctx.from.id);
        const agentResponse = await this.aiManager.handleConversation(userId, message);

        await this.sendAgentResponse(ctx, agentResponse);
      } catch (error: any) {
        process.stderr.write(`Telegram AI error: ${error.message}\n`);
        await ctx.reply(`❌ Error: ${error.message}`);
      }
    });

    this.bot.action(/^approve:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.editMessageReplyMarkup(undefined); // remove buttons

      const toolCallId = ctx.match[1];
      const userId = String(ctx.from?.id);

      try {
        await ctx.reply('⏳ Executing approved action...');
        await ctx.sendChatAction('typing');
        const agentResponse = await this.aiManager.executeApprovedTool(userId, toolCallId);
        await this.sendAgentResponse(ctx, agentResponse);
      } catch (error: any) {
        process.stderr.write(`Telegram execute error: ${error.message}\n`);
        await ctx.reply(`❌ Error: ${error.message}`);
      }
    });

    this.bot.action(/^deny:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.editMessageReplyMarkup(undefined); // remove buttons

      const toolCallId = ctx.match[1];
      const userId = String(ctx.from?.id);

      try {
        await ctx.reply('🛑 Action denied. Informing AI...');
        await ctx.sendChatAction('typing');
        const agentResponse = await this.aiManager.denyTool(userId, toolCallId);
        await this.sendAgentResponse(ctx, agentResponse);
      } catch (error: any) {
        process.stderr.write(`Telegram deny error: ${error.message}\n`);
        await ctx.reply(`❌ Error: ${error.message}`);
      }
    });
  }

  private async sendAgentResponse(ctx: any, res: any): Promise<void> {
    if (res.approvalRequired) {
      const { toolCallId, toolName, arguments: args } = res.approvalRequired;
      const text = `*⚠️ Action Requires Approval*\n\nThe AI wants to use the \`${toolName}\` tool.\n\n*Arguments:*\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\`\n\n${res.text || 'Do you approve?'}`;

      await ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve', callback_data: `approve:${toolCallId}` },
              { text: '❌ Deny', callback_data: `deny:${toolCallId}` },
            ],
          ],
        },
      });
    } else {
      await ctx.reply(res.text);
    }
  }

  async stop(): Promise<void> {
    this.bot?.stop();
  }

  /** Send a proactive notification to the authorized user. */
  async sendMessage(notification: ConductorNotification): Promise<void> {
    if (!this.bot) throw new Error('Bot not started');
    if (!this.authorizedUserId) {
      process.stderr.write('  [Telegram] Cannot send proactive message: No authorizedUserId set.\n');
      return;
    }
    // Format as Telegram Markdown
    let text = `*${notification.title}*\n\n${notification.body}`;
    if (notification.codeBlock) {
      text += `\n\n\`\`\`json\n${notification.codeBlock}\n\`\`\``;
    }
    await this.bot.telegram.sendMessage(this.authorizedUserId, text, { parse_mode: 'Markdown' });
  }
}
