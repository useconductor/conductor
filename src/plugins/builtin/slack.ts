/**
 * Slack Plugin — TheAlxLabs / Conductor
 *
 * Send messages, read channels, search, and manage Slack workspaces.
 * Uses Slack Web API with a Bot User OAuth Token.
 *
 * Setup:
 *   1. Go to https://api.slack.com/apps and create an app
 *   2. Under "OAuth & Permissions", add these bot scopes:
 *      chat:write, channels:read, channels:history, users:read,
 *      search:read, files:write, reactions:write, im:write
 *   3. Install the app to your workspace and copy the Bot User OAuth Token
 *   4. Run: conductor slack setup
 *      (or: conductor plugins config slack bot_token xoxb-...)
 *
 * Keychain entry: slack/bot_token
 */

import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

export class SlackPlugin implements Plugin {
  name = 'slack';
  description = 'Send messages, read channels, search, and manage Slack workspaces';
  version = '1.0.0';

  private keychain!: Keychain;
  private hasToken = false;

  async initialize(conductor: Conductor): Promise<void> {
    this.keychain = new Keychain(conductor.getConfig().getConfigDir());
    try {
      const t = await this.keychain.get('slack', 'bot_token');
      this.hasToken = !!t;
    } catch {
      this.hasToken = false;
    }
  }

  isConfigured(): boolean {
    return this.hasToken || !!process.env['SLACK_BOT_TOKEN'];
  }

  private async getToken(): Promise<string> {
    const token = await this.keychain.get('slack', 'bot_token');
    if (!token) {
      throw new Error('Slack bot token not configured.\nRun: conductor slack setup');
    }
    return token;
  }

  private async slackFetch(
    method: string,
    params: Record<string, any> = {},
    httpMethod: 'GET' | 'POST' = 'GET',
  ): Promise<any> {
    const token = await this.getToken();
    const base = 'https://slack.com/api';

    let url: string;
    let init: RequestInit;

    if (httpMethod === 'POST') {
      url = `${base}/${method}`;
      init = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(params),
      };
    } else {
      const qs = new URLSearchParams(
        Object.fromEntries(
          Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => [k, String(v)]),
        ),
      ).toString();
      url = `${base}/${method}${qs ? '?' + qs : ''}`;
      init = {
        headers: { Authorization: `Bearer ${token}` },
      };
    }

    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`Slack HTTP ${res.status}: ${res.statusText}`);

    const data = (await res.json()) as any;
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error ?? JSON.stringify(data)}`);
    }
    return data;
  }

  getTools(): PluginTool[] {
    return [
      // ── slack_send_message ─────────────────────────────────────────────────
      {
        name: 'slack_send_message',
        description: 'Send a message to a Slack channel or user (DM)',
        inputSchema: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'Channel name (e.g. #general), channel ID, or user ID for DM',
            },
            text: {
              type: 'string',
              description: 'Message text (supports Slack markdown)',
            },
            thread_ts: {
              type: 'string',
              description: 'Thread timestamp to reply to (optional)',
            },
          },
          required: ['channel', 'text'],
        },
        requiresApproval: true,
        handler: async ({ channel, text, thread_ts }: any) => {
          const data = await this.slackFetch(
            'chat.postMessage',
            { channel, text, ...(thread_ts ? { thread_ts } : {}) },
            'POST',
          );
          return {
            ok: true,
            channel: data.channel,
            ts: data.ts,
            message: data.message?.text,
          };
        },
      },

      // ── slack_channels ─────────────────────────────────────────────────────
      {
        name: 'slack_channels',
        description: 'List all public channels in the workspace',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Max channels to return (default 50)',
            },
          },
        },
        handler: async ({ limit = 50 }: any) => {
          const data = await this.slackFetch('conversations.list', {
            limit,
            types: 'public_channel',
            exclude_archived: true,
          });
          return {
            count: data.channels.length,
            channels: data.channels.map((c: any) => ({
              id: c.id,
              name: c.name,
              topic: c.topic?.value || '',
              memberCount: c.num_members,
              isPrivate: c.is_private,
            })),
          };
        },
      },

      // ── slack_read_channel ─────────────────────────────────────────────────
      {
        name: 'slack_read_channel',
        description: 'Read recent messages from a Slack channel',
        inputSchema: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'Channel ID or name (e.g. C01234 or general)',
            },
            limit: {
              type: 'number',
              description: 'Number of messages to fetch (default 20)',
            },
          },
          required: ['channel'],
        },
        handler: async ({ channel, limit = 20 }: any) => {
          // Resolve name to ID if needed
          let channelId = channel;
          if (!channel.startsWith('C') && !channel.startsWith('D')) {
            const list = await this.slackFetch('conversations.list', {
              limit: 200,
              types: 'public_channel,private_channel',
            });
            const name = channel.replace(/^#/, '');
            const found = list.channels.find((c: any) => c.name === name);
            if (!found) throw new Error(`Channel "${channel}" not found`);
            channelId = found.id;
          }

          const data = await this.slackFetch('conversations.history', {
            channel: channelId,
            limit,
          });

          return {
            channel: channelId,
            count: data.messages.length,
            messages: data.messages.map((m: any) => ({
              ts: m.ts,
              user: m.user ?? m.bot_id ?? 'unknown',
              text: m.text,
              threadReplies: m.reply_count ?? 0,
              reactions: (m.reactions ?? []).map((r: any) => `${r.name}×${r.count}`),
            })),
          };
        },
      },

      // ── slack_search ───────────────────────────────────────────────────────
      {
        name: 'slack_search',
        description: 'Search messages across all Slack channels',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query (supports Slack modifiers like in:#channel, from:@user)',
            },
            limit: {
              type: 'number',
              description: 'Max results (default 10)',
            },
          },
          required: ['query'],
        },
        handler: async ({ query, limit = 10 }: any) => {
          const data = await this.slackFetch('search.messages', {
            query,
            count: limit,
            sort: 'timestamp',
            sort_dir: 'desc',
          });
          const messages = data.messages?.matches ?? [];
          return {
            total: data.messages?.total ?? 0,
            count: messages.length,
            results: messages.map((m: any) => ({
              channel: m.channel?.name ?? m.channel?.id,
              user: m.username ?? m.user,
              text: m.text,
              ts: m.ts,
              permalink: m.permalink,
            })),
          };
        },
      },

      // ── slack_users ────────────────────────────────────────────────────────
      {
        name: 'slack_users',
        description: 'List workspace members or look up a specific user',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Filter by name or email (optional)',
            },
            limit: {
              type: 'number',
              description: 'Max users to return (default 50)',
            },
          },
        },
        handler: async ({ query, limit = 50 }: any) => {
          const data = await this.slackFetch('users.list', { limit: 200 });
          let members = (data.members as any[]).filter((u: any) => !u.is_bot && !u.deleted && u.id !== 'USLACKBOT');
          if (query) {
            const q = query.toLowerCase();
            members = members.filter(
              (u: any) =>
                (u.real_name ?? '').toLowerCase().includes(q) ||
                (u.name ?? '').toLowerCase().includes(q) ||
                (u.profile?.email ?? '').toLowerCase().includes(q),
            );
          }
          return {
            count: Math.min(members.length, limit),
            users: members.slice(0, limit).map((u: any) => ({
              id: u.id,
              name: u.real_name ?? u.name,
              username: u.name,
              email: u.profile?.email ?? null,
              title: u.profile?.title ?? null,
              timezone: u.tz ?? null,
            })),
          };
        },
      },

      // ── slack_add_reaction ─────────────────────────────────────────────────
      {
        name: 'slack_add_reaction',
        description: 'Add an emoji reaction to a Slack message',
        inputSchema: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'Channel ID containing the message',
            },
            timestamp: {
              type: 'string',
              description: 'Message timestamp (ts field)',
            },
            emoji: {
              type: 'string',
              description: 'Emoji name without colons (e.g. "thumbsup", "white_check_mark")',
            },
          },
          required: ['channel', 'timestamp', 'emoji'],
        },
        requiresApproval: true,
        handler: async ({ channel, timestamp, emoji }: any) => {
          await this.slackFetch('reactions.add', { channel, timestamp, name: emoji.replace(/:/g, '') }, 'POST');
          return { ok: true, emoji, channel, timestamp };
        },
      },
    ];
  }
}
