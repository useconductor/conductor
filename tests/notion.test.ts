import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotionPlugin } from '../src/plugins/builtin/notion.js';
import { Keychain } from '../src/security/keychain.js';

// Helper: get a tool's handler by name
function tool(plugin: NotionPlugin, name: string) {
  const t = plugin.getTools().find((t) => t.name === name);
  if (!t) throw new Error(`Tool not found: ${name}`);
  return t.handler as (args: Record<string, unknown>) => Promise<unknown>;
}

// Minimal conductor mock
function makeConductor(configDir = '/tmp/conductor-test-notion') {
  return {
    getConfig: () => ({
      getConfigDir: () => configDir,
    }),
  } as any;
}

let plugin: NotionPlugin;

beforeEach(async () => {
  plugin = new NotionPlugin();
  await plugin.initialize(makeConductor());
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Structure ────────────────────────────────────────────────────────────────

describe('NotionPlugin structure', () => {
  it('has correct name and version', () => {
    expect(plugin.name).toBe('notion');
    expect(plugin.version).toBeTruthy();
  });

  it('registers expected tools', () => {
    const names = plugin.getTools().map((t) => t.name);
    expect(names).toContain('notion_search');
    expect(names).toContain('notion_get_page');
    expect(names).toContain('notion_read_page');
    expect(names).toContain('notion_create_page');
    expect(names).toContain('notion_append_to_page');
    expect(names).toContain('notion_query_database');
  });
});

// ── isConfigured ─────────────────────────────────────────────────────────────

// Note: isConfigured() returns true by design - real check at tool invocation

// ── Unconfigured error messages ───────────────────────────────────────────────

describe('Notion tools — unconfigured', () => {
  beforeEach(() => {
    vi.spyOn(Keychain.prototype, 'get').mockResolvedValue(null);
  });

  it('notion_search throws with actionable message when not configured', async () => {
    await expect(tool(plugin, 'notion_search')({ query: 'test' })).rejects.toThrow(/notion/i);
  });

  it('notion_get_page throws with actionable message when not configured', async () => {
    await expect(tool(plugin, 'notion_get_page')({ pageId: 'abc123' })).rejects.toThrow(/notion/i);
  });

  it('notion_query_database throws with actionable message when not configured', async () => {
    await expect(
      tool(plugin, 'notion_query_database')({ databaseId: 'db123' }),
    ).rejects.toThrow(/notion/i);
  });
});

// ── Configured — mocked fetch calls ──────────────────────────────────────────

describe('Notion tools — configured', () => {
  beforeEach(async () => {
    vi.spyOn(Keychain.prototype, 'get').mockResolvedValue('ntn_fake_notion_token');
    plugin = new NotionPlugin();
    await plugin.initialize(makeConductor());
  });

  it('notion_search returns search results', async () => {
    const mockResponse = {
      results: [
        {
          id: 'page-id-1',
          object: 'page',
          url: 'https://notion.so/page-1',
          created_time: '2024-01-01T00:00:00Z',
          last_edited_time: '2024-06-01T00:00:00Z',
          archived: false,
          parent: { type: 'workspace' },
          properties: {
            title: {
              type: 'title',
              title: [{ plain_text: 'My Page' }],
            },
          },
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await tool(plugin, 'notion_search')({ query: 'My Page' }) as any;
    expect(result.count).toBe(1);
    expect(result.results[0].id).toBe('page-id-1');
    expect(result.results[0].title).toBe('My Page');
    expect(result.results[0].type).toBe('page');
  });

  it('notion_search passes filter parameter', async () => {
    const mockResponse = { results: [] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    vi.stubGlobal('fetch', fetchMock);

    await tool(plugin, 'notion_search')({ query: 'test', filter: 'database' });

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(callBody.filter).toEqual({ value: 'database', property: 'object' });
  });

  it('notion_get_page returns page metadata', async () => {
    const mockPage = {
      id: 'page-abc',
      url: 'https://notion.so/page-abc',
      created_time: '2024-01-01T00:00:00Z',
      last_edited_time: '2024-06-01T00:00:00Z',
      archived: false,
      parent: { type: 'workspace' },
      properties: {
        title: {
          type: 'title',
          title: [{ plain_text: 'A Test Page' }],
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPage),
    }));

    const result = await tool(plugin, 'notion_get_page')({ pageId: 'page-abc' }) as any;
    expect(result.id).toBe('page-abc');
    expect(result.title).toBe('A Test Page');
    expect(result.archived).toBe(false);
  });

  it('notion_query_database returns database entries', async () => {
    const mockResponse = {
      results: [
        {
          id: 'entry-1',
          object: 'page',
          url: 'https://notion.so/entry-1',
          created_time: '2024-01-01T00:00:00Z',
          last_edited_time: '2024-06-01T00:00:00Z',
          archived: false,
          parent: { type: 'database_id', database_id: 'db123' },
          properties: {
            Name: {
              type: 'title',
              title: [{ plain_text: 'Entry One' }],
            },
          },
        },
      ],
      has_more: false,
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await tool(plugin, 'notion_query_database')({ databaseId: 'db123' }) as any;
    expect(result.count).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(result.entries[0].id).toBe('entry-1');
    expect(result.entries[0].title).toBe('Entry One');
  });

  it('notion_create_page creates a page and returns metadata', async () => {
    const mockPage = {
      id: 'new-page-id',
      url: 'https://notion.so/new-page',
      created_time: '2024-01-01T00:00:00Z',
      last_edited_time: '2024-01-01T00:00:00Z',
      archived: false,
      parent: { type: 'page_id', page_id: 'parent-123' },
      properties: {
        title: {
          type: 'title',
          title: [{ plain_text: 'New Page' }],
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPage),
    }));

    const result = await tool(plugin, 'notion_create_page')({
      title: 'New Page',
      parentPageId: 'parent-123',
      content: 'Hello world',
    }) as any;

    expect(result.created).toBe(true);
    expect(result.id).toBe('new-page-id');
  });

  it('notion_create_page throws when no parent is provided', async () => {
    await expect(
      tool(plugin, 'notion_create_page')({ title: 'No Parent' }),
    ).rejects.toThrow(/parentPageId|parentDatabaseId/);
  });

  it('notion throws when API returns error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ message: 'API token is invalid' }),
    }));

    await expect(tool(plugin, 'notion_search')({ query: 'test' })).rejects.toThrow(/401/);
  });

  it('uses correct Notion-Version header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await tool(plugin, 'notion_search')({ query: 'test' });

    const callInit = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = callInit.headers as Record<string, string>;
    expect(headers['Notion-Version']).toBe('2022-06-28');
    expect(headers['Authorization']).toBe('Bearer ntn_fake_notion_token');
  });
});
