/**
 * Gmail Plugin
 *
 * Read, search, send, and manage Gmail via the Gmail REST API.
 * Requires a Google OAuth access token stored in keychain as
 *   google / access_token
 *
 * Run `conductor ai setup google` or the OAuth flow to authenticate.
 *
 * Scopes needed:
 *   https://www.googleapis.com/auth/gmail.readonly
 *   https://www.googleapis.com/auth/gmail.send
 *   https://www.googleapis.com/auth/gmail.modify
 */

import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GmailPlugin implements Plugin {
  name = 'gmail';
  description = 'Read, search, send, and manage Gmail — requires Google OAuth';
  version = '1.0.0';

  configSchema = {
    fields: [
      {
        key: 'access_token',
        label: 'Google Access Token',
        type: 'password' as const,
        required: true,
        secret: true,
        service: 'google',
        description: 'Run "conductor auth google" to obtain this automatically.'
      }
    ],
    setupInstructions: 'Authentication for Google services is best handled via the CLI command `conductor auth google` which manages OAuth flows securely.'
  };

  private keychain!: Keychain;
  private configDir!: string;

  async initialize(conductor: Conductor): Promise<void> {
    this.configDir = conductor.getConfig().getConfigDir();
    this.keychain = new Keychain(this.configDir);
  }

  isConfigured(): boolean {
    return true; // checked at tool call time
  }

  private async getToken(): Promise<string> {
    const token = await this.keychain.get('google', 'access_token');
    if (!token) {
      throw new Error(
        'Google not authenticated. Run: conductor auth google'
      );
    }
    return token;
  }

  private async gmailFetch(
    path: string,
    options: { method?: string; body?: any } = {}
  ): Promise<any> {
    const token = await this.getToken();
    const res = await fetch(`${GMAIL_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      if (res.status === 401) {
        throw new Error('Google token expired. Re-authenticate: conductor auth google');
      }
      throw new Error(`Gmail API ${res.status}: ${err}`);
    }
    return res.json();
  }

  /** Decode base64url to string */
  private b64decode(s: string): string {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(b64, 'base64').toString('utf-8');
  }

  /** Extract plain text body from a message payload */
  private extractBody(payload: any): string {
    if (!payload) return '';
    if (payload.body?.data) return this.b64decode(payload.body.data);
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return this.b64decode(part.body.data);
        }
      }
      // Fallback: first part with data
      for (const part of payload.parts) {
        const body = this.extractBody(part);
        if (body) return body;
      }
    }
    return '';
  }

  /** Get header value from message headers */
  private getHeader(headers: any[], name: string): string {
    return headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  }

  /** Encode email as RFC 2822 base64url for Gmail API */
  private encodeEmail(opts: {
    to: string;
    subject: string;
    body: string;
    from?: string;
    cc?: string;
    inReplyTo?: string;
    threadId?: string;
  }): string {
    const lines = [
      `To: ${opts.to}`,
      `Subject: ${opts.subject}`,
      opts.cc ? `Cc: ${opts.cc}` : null,
      opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : null,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      opts.body,
    ]
      .filter((l) => l !== null)
      .join('\r\n');

    return Buffer.from(lines).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  }

  getTools(): PluginTool[] {
    return [
      // ── gmail_list ──────────────────────────────────────────────────────────
      {
        name: 'gmail_list',
        description: 'List recent emails from Gmail inbox',
        inputSchema: {
          type: 'object',
          properties: {
            maxResults: { type: 'number', description: 'Number of emails to return (default: 10, max: 50)' },
            labelIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by labels e.g. ["INBOX","UNREAD"]',
            },
            q: { type: 'string', description: 'Gmail search query e.g. "from:alex is:unread"' },
          },
        },
        handler: async ({ maxResults = 10, labelIds, q }: any) => {
          const params = new URLSearchParams({
            maxResults: String(Math.min(maxResults, 50)),
          });
          if (labelIds?.length) params.set('labelIds', labelIds.join(','));
          if (q) params.set('q', q);

          const list = await this.gmailFetch(`/messages?${params}`);
          if (!list.messages?.length) return { count: 0, emails: [] };

          // Fetch minimal metadata for each message in parallel
          const emails = await Promise.all(
            list.messages.map(async (msg: any) => {
              const m = await this.gmailFetch(
                `/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
              );
              const h = m.payload?.headers ?? [];
              return {
                id: m.id,
                threadId: m.threadId,
                from: this.getHeader(h, 'From'),
                subject: this.getHeader(h, 'Subject'),
                date: this.getHeader(h, 'Date'),
                snippet: m.snippet,
                unread: m.labelIds?.includes('UNREAD') ?? false,
              };
            })
          );

          return { count: emails.length, emails };
        },
      },

      // ── gmail_read ──────────────────────────────────────────────────────────
      {
        name: 'gmail_read',
        description: 'Read the full content of a Gmail message by ID',
        inputSchema: {
          type: 'object',
          properties: {
            messageId: { type: 'string', description: 'Gmail message ID from gmail_list' },
          },
          required: ['messageId'],
        },
        handler: async ({ messageId }: any) => {
          const m = await this.gmailFetch(`/messages/${messageId}?format=full`);
          const h = m.payload?.headers ?? [];
          const body = this.extractBody(m.payload);

          return {
            id: m.id,
            threadId: m.threadId,
            from: this.getHeader(h, 'From'),
            to: this.getHeader(h, 'To'),
            subject: this.getHeader(h, 'Subject'),
            date: this.getHeader(h, 'Date'),
            body: body.slice(0, 8000), // cap to avoid huge context
            snippet: m.snippet,
            labels: m.labelIds ?? [],
          };
        },
      },

      // ── gmail_search ────────────────────────────────────────────────────────
      {
        name: 'gmail_search',
        description:
          'Search Gmail using Gmail search operators — e.g. "from:boss@company.com is:unread", "subject:invoice after:2024/01/01"',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Gmail search query string' },
            maxResults: { type: 'number', description: 'Max results (default: 10)' },
          },
          required: ['query'],
        },
        handler: async ({ query, maxResults = 10 }: any) => {
          const params = new URLSearchParams({
            q: query,
            maxResults: String(Math.min(maxResults, 50)),
          });
          const list = await this.gmailFetch(`/messages?${params}`);
          if (!list.messages?.length) return { count: 0, emails: [] };

          const emails = await Promise.all(
            list.messages.map(async (msg: any) => {
              const m = await this.gmailFetch(
                `/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
              );
              const h = m.payload?.headers ?? [];
              return {
                id: m.id,
                threadId: m.threadId,
                from: this.getHeader(h, 'From'),
                subject: this.getHeader(h, 'Subject'),
                date: this.getHeader(h, 'Date'),
                snippet: m.snippet,
                unread: m.labelIds?.includes('UNREAD') ?? false,
              };
            })
          );

          return { count: emails.length, emails };
        },
      },

      // ── gmail_send ──────────────────────────────────────────────────────────
      {
        name: 'gmail_send',
        description: 'Send an email via Gmail',
        inputSchema: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'Email subject' },
            body: { type: 'string', description: 'Plain text email body' },
            cc: { type: 'string', description: 'CC email addresses (comma-separated)' },
          },
          required: ['to', 'subject', 'body'],
        },
        handler: async ({ to, subject, body, cc }: any) => {
          const raw = this.encodeEmail({ to, subject, body, cc });
          const result = await this.gmailFetch('/messages/send', {
            method: 'POST',
            body: { raw },
          });
          return { sent: true, messageId: result.id, threadId: result.threadId };
        },
      },

      // ── gmail_reply ─────────────────────────────────────────────────────────
      {
        name: 'gmail_reply',
        description: 'Reply to an existing Gmail message/thread',
        inputSchema: {
          type: 'object',
          properties: {
            messageId: { type: 'string', description: 'Message ID to reply to' },
            body: { type: 'string', description: 'Reply body text' },
          },
          required: ['messageId', 'body'],
        },
        handler: async ({ messageId, body }: any) => {
          // Fetch original to get headers for reply
          const orig = await this.gmailFetch(
            `/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID`
          );
          const h = orig.payload?.headers ?? [];
          const to = this.getHeader(h, 'From');
          const subject = `Re: ${this.getHeader(h, 'Subject').replace(/^Re:\s*/i, '')}`;
          const inReplyTo = this.getHeader(h, 'Message-ID');

          const raw = this.encodeEmail({ to, subject, body, inReplyTo });
          const result = await this.gmailFetch('/messages/send', {
            method: 'POST',
            body: { raw, threadId: orig.threadId },
          });
          return { sent: true, messageId: result.id, threadId: result.threadId };
        },
      },

      // ── gmail_mark_read ─────────────────────────────────────────────────────
      {
        name: 'gmail_mark_read',
        description: 'Mark Gmail messages as read or unread',
        inputSchema: {
          type: 'object',
          properties: {
            messageId: { type: 'string', description: 'Message ID to modify' },
            read: { type: 'boolean', description: 'true = mark read, false = mark unread' },
          },
          required: ['messageId', 'read'],
        },
        handler: async ({ messageId, read }: any) => {
          await this.gmailFetch(`/messages/${messageId}/modify`, {
            method: 'POST',
            body: read
              ? { removeLabelIds: ['UNREAD'] }
              : { addLabelIds: ['UNREAD'] },
          });
          return { success: true, messageId, read };
        },
      },

      // ── gmail_trash ─────────────────────────────────────────────────────────
      {
        name: 'gmail_trash',
        description: 'Move a Gmail message to trash',
        inputSchema: {
          type: 'object',
          properties: {
            messageId: { type: 'string', description: 'Message ID to trash' },
          },
          required: ['messageId'],
        },
        handler: async ({ messageId }: any) => {
          await this.gmailFetch(`/messages/${messageId}/trash`, { method: 'POST' });
          return { trashed: true, messageId };
        },
      },
    ];
  }
}
