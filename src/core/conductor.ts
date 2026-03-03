import { ConfigManager } from './config.js';
import { DatabaseManager } from './database.js';
import { PluginManager } from '../plugins/manager.js';
import { AIManager } from '../ai/manager.js';

export interface ConductorOptions {
  /** Suppress stdout output (required for MCP mode where stdout is protocol). */
  quiet?: boolean;
}

export class Conductor {
  private config: ConfigManager;
  private db: DatabaseManager;
  private plugins: PluginManager;
  private ai: AIManager;
  private initialized: boolean = false;
  private quiet: boolean;
  private proactiveTimer?: NodeJS.Timeout;
  private notificationHandler?: (text: string) => Promise<void>;

  constructor(configPath?: string, options?: ConductorOptions) {
    this.config = new ConfigManager(configPath);
    this.db = new DatabaseManager(this.config.getConfigDir());
    this.plugins = new PluginManager(this);
    this.ai = new AIManager(this);
    this.quiet = options?.quiet ?? false;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!this.quiet) {
      process.stderr.write('Initializing Conductor...\n');
    }

    await this.config.initialize();
    await this.db.initialize();
    await this.plugins.loadBuiltins();

    this.initialized = true;

    await this.db.logActivity('system', 'conductor_initialized');
  }

  getConfig(): ConfigManager {
    return this.config;
  }

  getDatabase(): DatabaseManager {
    return this.db;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async shutdown(): Promise<void> {
    if (this.initialized) {
      await this.db.logActivity('system', 'conductor_shutdown');
      await this.db.close();
    }
  }

  // Quick access methods
  async getUserInfo() {
    return this.config.get('user');
  }

  async getTelegramConfig() {
    return this.config.get('telegram');
  }

  async getAIConfig() {
    return this.config.get('ai');
  }

  async getPlugins() {
    return this.db.getPlugins();
  }

  async getRecentActivity(limit: number = 20) {
    return this.db.getRecentActivity(limit);
  }

  getPluginsManager(): PluginManager {
    return this.plugins;
  }

  getAIManager(): AIManager {
    return this.ai;
  }

  /** Set a handler for proactive notifications (e.g. from the heartbeat loop). */
  setNotificationHandler(handler: (text: string) => Promise<void>): void {
    this.notificationHandler = handler;
  }

  /** Send a proactive notification to the user. */
  async notifyUser(text: string): Promise<void> {
    if (this.notificationHandler) {
      await this.notificationHandler(text);
    } else {
      process.stderr.write(`  ⚠ No notification handler set. Message: ${text}\n`);
    }
  }

  /** Start the proactive autonomous loop. */
  async startProactiveMode(intervalMinutes: number = 30): Promise<void> {
    if (this.proactiveTimer) return;

    if (!this.quiet) {
      process.stderr.write(`Starting proactive mode (every ${intervalMinutes}m)...\n`);
    }

    // Run once immediately
    this.runReasoningCycle().catch(err => {
      process.stderr.write(`Proactive cycle error: ${err.message}\n`);
    });

    this.proactiveTimer = setInterval(() => {
      this.runReasoningCycle().catch(err => {
        process.stderr.write(`Proactive cycle error: ${err.message}\n`);
      });
    }, intervalMinutes * 60 * 1000);
  }

  async stopProactiveMode(): Promise<void> {
    if (this.proactiveTimer) {
      clearInterval(this.proactiveTimer);
      this.proactiveTimer = undefined;
    }
  }

  private async gatherContext(): Promise<string> {
    const contextLines: string[] = [];

    // System Info
    try {
      const sysPlugin = await this.plugins.getPlugin('system');
      if (sysPlugin) {
        const infoTool = sysPlugin.getTools().find(t => t.name === 'system_info');
        if (infoTool) {
          const stats = await infoTool.handler({});
          contextLines.push(`[SYSTEM] CPU: ${stats.cpu?.load || 'unknown'}%, RAM: ${stats.memory?.usedPercent || 'unknown'}%, Disk: ${stats.disk?.usedPercent || 'unknown'}%`);
        }
      }
    } catch { /* plugin might be disabled */ }

    // Recent Activity
    const activity = await this.getRecentActivity(5);
    if (activity.length > 0) {
      contextLines.push('[RECENT ACTIVITY]');
      activity.forEach(a => contextLines.push(`- ${a.timestamp}: ${a.event_type} (${a.service})`));
    }

    // enabled plugins
    const enabled = this.config.get<string[]>('plugins.enabled') || [];
    contextLines.push(`[PLUGINS] Enabled: ${enabled.join(', ')}`);

    // Gmail: Unread count
    if (enabled.includes('gmail')) {
      try {
        const gmail = await this.plugins.getPlugin('gmail');
        if (gmail) {
          const listTool = gmail.getTools().find(t => t.name === 'gmail_list');
          if (listTool) {
            const unread = await listTool.handler({ labelIds: ['UNREAD'], maxResults: 5 });
            if (unread.messages?.length > 0) {
              contextLines.push(`[GMAIL] You have ${unread.messages.length} unread messages.`);
            }
          }
        }
      } catch { /* ignore */ }
    }

    // Calendar: Upcoming
    if (enabled.includes('gcal')) {
      try {
        const gcal = await this.plugins.getPlugin('gcal');
        if (gcal) {
          const calendarList = gcal.getTools().find(t => t.name === 'gcal_list_calendars');
          const listEvents = gcal.getTools().find(t => t.name === 'gcal_list_events');
          if (calendarList && listEvents) {
            const calendars = await calendarList.handler({});
            const primary = calendars.calendars?.find((c: any) => c.primary) || calendars.calendars?.[0];
            if (primary) {
              const now = new Date();
              const events = await listEvents.handler({
                calendarId: primary.id,
                timeMin: now.toISOString(),
                maxResults: 3
              });
              if (events.events?.length > 0) {
                contextLines.push('[CALENDAR] Upcoming events:');
                events.events.forEach((e: any) => contextLines.push(`- ${e.summary} (${e.start.dateTime || e.start.date})`));
              }
            }
          }
        }
      } catch { /* ignore */ }
    }

    return contextLines.join('\n');
  }

  public async runReasoningCycle(): Promise<void> {
    if (!this.initialized) return;

    await this.db.logActivity('system', 'proactive_cycle_start');

    try {
      const context = await this.gatherContext();
      const provider = await this.ai.getCurrentProvider();

      if (provider) {
        const prompt = `You are running your autonomous periodic reasoning cycle.
Examine the context below. If there is a problem (like high CPU, or important unread emails), use your tools to take action or investigate further. 
If everything is perfectly normal and no action is required, respond exactly with "No action needed."

CONTEXT:
${context}`;

        const systemUserId = 'system-proactive';
        const agentResponse = await this.ai.handleConversation(systemUserId, prompt);

        await this.db.logActivity('system', 'proactive_reasoning_complete', agentResponse.text);

        if (!this.quiet) {
          process.stderr.write(`  🤖 [Proactive] ${agentResponse.text}\n`);
        }

        if (agentResponse.approvalRequired) {
          const { toolName, arguments: args } = agentResponse.approvalRequired;
          const alert = `🔔 *Autonomous Proactive Action Requires Approval*\n\nThe AI attempted to use \`${toolName}\` autonomously.\n\n*Arguments:*\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\`\n\nTo approve this, please reply in this chat with the tool approval.`;
          await this.notifyUser(alert);
        } else if (agentResponse.text && !agentResponse.text.toLowerCase().includes('no action needed')) {
          await this.notifyUser(`🔔 *Autonomous Proactive Action*\n\n${agentResponse.text}`);
        }
      }
    } catch (err: any) {
      process.stderr.write(`  ✗ [Proactive Error] ${err.message}\n`);
    }

    await this.db.logActivity('system', 'proactive_cycle_end');
  }
}
