import bolt from '@slack/bolt';
const { App } = bolt;
import { Conductor } from '../core/conductor.js';
import { Keychain } from '../security/keychain.js';
import { AIManager } from '../ai/manager.js';

export class SlackBot {
    private conductor: Conductor;
    private keychain: Keychain;
    private app: bolt.App | null = null;
    private aiManager: AIManager;

    constructor(conductor: Conductor) {
        this.conductor = conductor;
        this.keychain = new Keychain(conductor.getConfig().getConfigDir());
        this.aiManager = new AIManager(conductor);
    }

    /** Start the Slack bot. */
    async start(): Promise<void> {
        const botToken = await this.keychain.get('slack', 'bot_token');
        const appToken = await this.keychain.get('slack', 'app_token');

        if (!botToken || !appToken) {
            throw new Error(
                'Slack tokens not found. Set them in keychain (slack.bot_token, slack.app_token) or run installer.'
            );
        }

        this.app = new App({
            token: botToken,
            appToken: appToken,
            socketMode: true,
        });

        this.registerHandlers();

        process.stderr.write('Slack bot starting (Socket Mode)...\n');
        await this.app.start();
    }

    /** Register message handlers. */
    private registerHandlers(): void {
        if (!this.app) return;

        // Default: route text messages through AI
        this.app.message(async ({ message, say }) => {
            // Only respond to text messages
            if (!('text' in message) || !message.text) return;

            try {
                const userId = 'user' in message ? String(message.user) : 'unknown-slack-user';
                const agentResponse = await this.aiManager.handleConversation(userId, message.text);

                await this.sendAgentResponse(say, agentResponse);
            } catch (error: any) {
                process.stderr.write(`Slack AI error: ${error.message}\n`);
                await say(`❌ Error: ${error.message}`);
            }
        });

        // Handle approvals
        this.app.action('approve_action', async ({ body, ack, say, respond }: any) => {
            await ack();
            await respond({ text: "⏳ Executing approved action...", blocks: [] });

            const action = (body as any).actions[0];
            const toolCallId = action.value;
            const userId = body.user.id;

            try {
                const agentResponse = await this.aiManager.executeApprovedTool(userId, toolCallId);
                await this.sendAgentResponse(say, agentResponse);
            } catch (error: any) {
                process.stderr.write(`Slack execute error: ${error.message}\n`);
                await say(`❌ Error: ${error.message}`);
            }
        });

        // Handle denials
        this.app.action('deny_action', async ({ body, ack, say, respond }: any) => {
            await ack();
            await respond({ text: "🛑 Action denied. Informing AI...", blocks: [] });

            const action = (body as any).actions[0];
            const toolCallId = action.value;
            const userId = body.user.id;

            try {
                const agentResponse = await this.aiManager.denyTool(userId, toolCallId);
                await this.sendAgentResponse(say, agentResponse);
            } catch (error: any) {
                process.stderr.write(`Slack deny error: ${error.message}\n`);
                await say(`❌ Error: ${error.message}`);
            }
        });

        // Handle commands (Slash commands can be added here)
        this.app.command('/conductor-status', async ({ command: _command, ack, say }) => {
            await ack();
            const config = this.conductor.getConfig();
            const provider = config.get<string>('ai.provider') || 'none';
            const plugins = config.get<string[]>('plugins.enabled') || [];

            await say(
                `📊 Status:\n` +
                `AI: ${provider}\n` +
                `Plugins: ${plugins.length > 0 ? plugins.join(', ') : 'none'}\n` +
                `User: ${config.get<string>('user.name') || 'not set'}`
            );
        });
    }

    private async sendAgentResponse(say: any, res: any): Promise<void> {
        if (res.approvalRequired) {
            const { toolCallId, toolName, arguments: args } = res.approvalRequired;
            const text = `*⚠️ Action Requires Approval*\n\nThe AI wants to use the \`${toolName}\` tool.\n\n*Arguments:*\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\`\n\n${res.text || 'Do you approve?'}`;

            await say({
                text: "Action Requires Approval",
                blocks: [
                    {
                        type: "section",
                        text: { type: "mrkdwn", text }
                    },
                    {
                        type: "actions",
                        elements: [
                            {
                                type: "button",
                                text: { type: "plain_text", text: "✅ Approve" },
                                style: "primary",
                                value: toolCallId,
                                action_id: "approve_action"
                            },
                            {
                                type: "button",
                                text: { type: "plain_text", text: "❌ Deny" },
                                style: "danger",
                                value: toolCallId,
                                action_id: "deny_action"
                            }
                        ]
                    }
                ]
            });
        } else {
            await say(res.text);
        }
    }

    /** Send a proactive message to a specific channel or user. */
    async sendMessage(channelId: string, text: string): Promise<void> {
        if (!this.app) throw new Error('Slack app not started');
        await this.app.client.chat.postMessage({
            channel: channelId,
            text: text
        });
    }

    async stop(): Promise<void> {
        await this.app?.stop();
    }
}
