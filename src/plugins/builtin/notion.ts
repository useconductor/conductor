/**
 * Notion Plugin
 *
 * Search, read, and create pages and databases in Notion.
 * Requires a Notion Integration API key.
 *
 * Setup:
 *   1. Go to https://www.notion.so/my-integrations and create an integration
 *   2. Copy the "Internal Integration Token" (starts with ntn_)
 *   3. Share each workspace page/db you want to access with your integration
 *   4. Run: conductor plugins config notion token <YOUR_TOKEN>
 *      OR set it during install when prompted
 *
 * Stored in keychain as: notion / api_key
 */

import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

const NOTION_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export class NotionPlugin implements Plugin {
  name = 'notion';
  description = 'Read, search, and create Notion pages and databases — requires Notion API key';
  version = '1.0.0';

  configSchema = {
    fields: [
      {
        key: 'api_key',
        label: 'Internal Integration Token',
        type: 'password' as const,
        required: true,
        secret: true,
        service: 'notion',
        description: 'Copy your token (starts with ntn_) from Notion Developer portal.'
      }
    ],
    setupInstructions: '1. Visit Notion Settings > My integrations. 2. Create a new "Internal Integration". 3. Copy the token. 4. Ensure you "Connect" the integration to the pages you want Conductor to access.'
  };

  private keychain!: Keychain;

  async initialize(conductor: Conductor): Promise<void> {
    this.keychain = new Keychain(conductor.getConfig().getConfigDir());
  }

  isConfigured(): boolean { return true; }

  private async getToken(): Promise<string> {
    const token = await this.keychain.get('notion', 'api_key');
    if (!token) {
      throw new Error(
        'Notion not configured. Get your integration token from https://www.notion.so/my-integrations\n' +
        'Then run: conductor plugins config notion token <YOUR_TOKEN>'
      );
    }
    return token;
  }

  private async notionFetch(path: string, options: {
    method?: string;
    body?: any;
  } = {}): Promise<any> {
    const token = await this.getToken();
    const res = await fetch(`${NOTION_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText })) as any;
      throw new Error(`Notion API ${res.status}: ${err.message ?? res.statusText}`);
    }
    return res.json();
  }

  /** Extract plain text from Notion rich_text blocks */
  private richText(blocks: any[]): string {
    return (blocks ?? []).map((b: any) => b.plain_text ?? '').join('');
  }

  /** Extract plain text from a block's content */
  private blockText(block: any): string {
    const type = block.type;
    const content = block[type];
    if (!content) return '';
    if (content.rich_text) return this.richText(content.rich_text);
    return '';
  }

  /** Format a page for clean output */
  private formatPage(page: any) {
    const props = page.properties ?? {};
    const titleProp: any =
      props.title ??
      props.Name ??
      Object.values(props).find((p: any) => p.type === 'title') ??
      {};
    const title = this.richText(titleProp.title ?? []);
    return {
      id: page.id,
      title: title || '(Untitled)',
      url: page.url ?? '',
      createdTime: page.created_time ?? '',
      lastEditedTime: page.last_edited_time ?? '',
      archived: page.archived ?? false,
      parent: page.parent?.type === 'database_id'
        ? { type: 'database', id: page.parent.database_id }
        : page.parent?.type === 'page_id'
          ? { type: 'page', id: page.parent.page_id }
          : { type: 'workspace' },
    };
  }

  getTools(): PluginTool[] {
    return [
      // ── notion_search ───────────────────────────────────────────────────────
      {
        name: 'notion_search',
        description: 'Search Notion pages and databases by title',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term' },
            filter: {
              type: 'string',
              enum: ['page', 'database'],
              description: 'Filter to only pages or only databases',
            },
            maxResults: { type: 'number', description: 'Max results (default: 10)' },
          },
          required: ['query'],
        },
        handler: async ({ query, filter, maxResults = 10 }: any) => {
          const body: any = { query, page_size: Math.min(maxResults, 100) };
          if (filter) body.filter = { value: filter, property: 'object' };

          const res = await this.notionFetch('/search', { method: 'POST', body });
          return {
            count: res.results?.length ?? 0,
            results: (res.results ?? []).map((r: any) => ({
              ...this.formatPage(r),
              type: r.object,
            })),
          };
        },
      },

      // ── notion_get_page ─────────────────────────────────────────────────────
      {
        name: 'notion_get_page',
        description: 'Get metadata and properties of a Notion page',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: {
              type: 'string',
              description: 'Notion page ID or URL',
            },
          },
          required: ['pageId'],
        },
        handler: async ({ pageId }: any) => {
          // Accept full URLs — extract ID from them
          const id = pageId.includes('notion.so')
            ? (pageId.split('/').pop()?.split('?')[0]?.replace(/-/g, '').slice(-32) ?? pageId)
            : pageId;
          const page = await this.notionFetch(`/pages/${id}`);
          return this.formatPage(page);
        },
      },

      // ── notion_read_page ────────────────────────────────────────────────────
      {
        name: 'notion_read_page',
        description: 'Read the full text content of a Notion page (blocks)',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string', description: 'Notion page ID or URL' },
            maxChars: { type: 'number', description: 'Max characters (default: 8000)' },
          },
          required: ['pageId'],
        },
        handler: async ({ pageId, maxChars = 8000 }: any) => {
          const id = pageId.includes('notion.so')
            ? (pageId.split('/').pop()?.split('?')[0]?.replace(/-/g, '').slice(-32) ?? pageId)
            : pageId;

          const [page, blocks] = await Promise.all([
            this.notionFetch(`/pages/${id}`),
            this.notionFetch(`/blocks/${id}/children?page_size=100`),
          ]);

          const lines = (blocks.results ?? [])
            .map((b: any) => {
              const text = this.blockText(b);
              const type = b.type;
              if (type === 'heading_1') return `# ${text}`;
              if (type === 'heading_2') return `## ${text}`;
              if (type === 'heading_3') return `### ${text}`;
              if (type === 'bulleted_list_item') return `• ${text}`;
              if (type === 'numbered_list_item') return `1. ${text}`;
              if (type === 'to_do') return `[${b.to_do?.checked ? 'x' : ' '}] ${text}`;
              if (type === 'divider') return '---';
              if (type === 'code') return `\`\`\`${b.code?.language ?? ''}\n${this.richText(b.code?.rich_text ?? [])}\n\`\`\``;
              return text;
            })
            .filter(Boolean)
            .join('\n');

          return {
            ...this.formatPage(page),
            content: lines.slice(0, maxChars),
            truncated: lines.length > maxChars,
            blockCount: blocks.results?.length ?? 0,
          };
        },
      },

      // ── notion_create_page ──────────────────────────────────────────────────
      {
        name: 'notion_create_page',
        description: 'Create a new Notion page',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Page title' },
            content: { type: 'string', description: 'Plain text content for the page body' },
            parentPageId: {
              type: 'string',
              description: 'Parent page ID — page will be created as a child',
            },
            parentDatabaseId: {
              type: 'string',
              description: 'Parent database ID — page will be created as a database entry',
            },
          },
          required: ['title'],
        },
        handler: async ({ title, content, parentPageId, parentDatabaseId }: any) => {
          if (!parentPageId && !parentDatabaseId) {
            throw new Error('Provide either parentPageId or parentDatabaseId.');
          }

          const parent = parentDatabaseId
            ? { database_id: parentDatabaseId }
            : { page_id: parentPageId };

          const titleProp = parentDatabaseId
            ? { Name: { title: [{ text: { content: title } }] } }
            : { title: { title: [{ text: { content: title } }] } };

          const children = content
            ? content
              .split('\n')
              .filter(Boolean)
              .map((line: string) => ({
                object: 'block',
                type: 'paragraph',
                paragraph: { rich_text: [{ text: { content: line } }] },
              }))
            : [];

          const page = await this.notionFetch('/pages', {
            method: 'POST',
            body: { parent, properties: titleProp, children },
          });

          return { created: true, ...this.formatPage(page) };
        },
      },

      // ── notion_append_to_page ───────────────────────────────────────────────
      {
        name: 'notion_append_to_page',
        description: 'Append text content to the end of an existing Notion page',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string', description: 'Page ID to append to' },
            content: { type: 'string', description: 'Text to append' },
          },
          required: ['pageId', 'content'],
        },
        handler: async ({ pageId, content }: any) => {
          const children = content
            .split('\n')
            .filter(Boolean)
            .map((line: string) => ({
              object: 'block',
              type: 'paragraph',
              paragraph: { rich_text: [{ text: { content: line } }] },
            }));

          await this.notionFetch(`/blocks/${pageId}/children`, {
            method: 'PATCH',
            body: { children },
          });

          return { appended: true, pageId, linesAdded: children.length };
        },
      },

      // ── notion_query_database ───────────────────────────────────────────────
      {
        name: 'notion_query_database',
        description: 'Query a Notion database and return its entries',
        inputSchema: {
          type: 'object',
          properties: {
            databaseId: { type: 'string', description: 'Database ID' },
            maxResults: { type: 'number', description: 'Max entries to return (default: 20)' },
            filter: {
              type: 'object',
              description: 'Notion filter object (optional)',
            },
          },
          required: ['databaseId'],
        },
        handler: async ({ databaseId, maxResults = 20, filter }: any) => {
          const body: any = { page_size: Math.min(maxResults, 100) };
          if (filter) body.filter = filter;

          const res = await this.notionFetch(`/databases/${databaseId}/query`, {
            method: 'POST',
            body,
          });

          return {
            count: res.results?.length ?? 0,
            hasMore: res.has_more ?? false,
            entries: (res.results ?? []).map(this.formatPage.bind(this)),
          };
        },
      },
    ];
  }
}
