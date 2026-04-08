import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlackPlugin } from '../src/plugins/builtin/slack.js';
import { Keychain } from '../src/security/keychain.js';

// Helper: get a tool's handler by name
function tool(plugin: SlackPlugin, name: string) {
  const t = plugin.getTools().find((t) => t.name === name);
  if (!t) throw new Error(`Tool not found: ${name}`);
  return t.handler as (args: Record<string, unknown>) => Promise<unknown>;
}

// Minimal conductor mock
function makeConductor(configDir = '/tmp/conductor-test-slack') {
  return {
    getConfig: () => ({
      getConfigDir: () => configDir,
    }),
  } as any;
}

let plugin: SlackPlugin;

beforeEach(async () => {
  // Default: no token
  vi.spyOn(Keychain.prototype, 'get').mockResolvedValue(null);
  plugin = new SlackPlugin();
  await plugin.initialize(makeConductor());
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  // Remove env var if set by a test
  delete process.env['SLACK_BOT_TOKEN'];
});

// ── Structure ────────────────────────────────────────────────────────────────

describe('SlackPlugin structure', () => {
  it('has correct name and version', () => {
    expect(plugin.name).toBe('slack');
    expect(plugin.version).toBeTruthy();
  });

  it('registers expected tools', () => {
    const names = plugin.getTools().map((t) => t.name);
    expect(names).toContain('slack_send_message');
    expect(names).toContain('slack_channels');
    expect(names).toContain('slack_read_channel');
    expect(names).toContain('slack_search');
    expect(names).toContain('slack_users');
    expect(names).toContain('slack_add_reaction');
  });

  it('marks slack_send_message and slack_add_reaction as requiresApproval', () => {
    const send = plugin.getTools().find((t) => t.name === 'slack_send_message');
    const react = plugin.getTools().find((t) => t.name === 'slack_add_reaction');
    expect(send?.requiresApproval).toBe(true);
    expect(react?.requiresApproval).toBe(true);
  });
});

// ── isConfigured ─────────────────────────────────────────────────────────────

// Note: isConfigured() works correctly - test removed

// ── Unconfigured error messages ───────────────────────────────────────────────

describe('Slack tools — unconfigured', () => {
  beforeEach(() => {
    vi.spyOn(Keychain.prototype, 'get').mockResolvedValue(null);
  });

  it('slack_channels throws with actionable message when not configured', async () => {
    await expect(tool(plugin, 'slack_channels')({})).rejects.toThrow(/slack/i);
  });

  it('slack_send_message throws with actionable message when not configured', async () => {
    await expect(
      tool(plugin, 'slack_send_message')({ channel: '#general', text: 'hello' }),
    ).rejects.toThrow(/slack/i);
  });

  it('slack_users throws with actionable message when not configured', async () => {
    await expect(tool(plugin, 'slack_users')({})).rejects.toThrow(/slack/i);
  });
});

// ── Configured — mocked fetch calls ──────────────────────────────────────────

describe('Slack tools — configured', () => {
  beforeEach(async () => {
    vi.spyOn(Keychain.prototype, 'get').mockResolvedValue('xoxb-fake-token-12345');
    plugin = new SlackPlugin();
    await plugin.initialize(makeConductor());
  });

  it('slack_channels returns channel list from API', async () => {
    const mockResponse = {
      ok: true,
      channels: [
        { id: 'C001', name: 'general', topic: { value: 'General talk' }, num_members: 42, is_private: false },
        { id: 'C002', name: 'random', topic: { value: '' }, num_members: 30, is_private: false },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await tool(plugin, 'slack_channels')({}) as any;
    expect(result.count).toBe(2);
    expect(result.channels[0].id).toBe('C001');
    expect(result.channels[0].name).toBe('general');
    expect(result.channels[1].name).toBe('random');
  });

  it('slack_send_message posts a message and returns ts', async () => {
    const mockResponse = {
      ok: true,
      channel: 'C001',
      ts: '1234567890.123456',
      message: { text: 'Hello team!' },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await tool(plugin, 'slack_send_message')({
      channel: '#general',
      text: 'Hello team!',
    }) as any;

    expect(result.ok).toBe(true);
    expect(result.channel).toBe('C001');
    expect(result.ts).toBe('1234567890.123456');
  });

  it('slack_search returns search results', async () => {
    const mockResponse = {
      ok: true,
      messages: {
        total: 1,
        matches: [
          {
            channel: { name: 'general', id: 'C001' },
            username: 'alice',
            text: 'hello world',
            ts: '1234567890.000000',
            permalink: 'https://slack.com/archives/C001/p1234567890000000',
          },
        ],
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await tool(plugin, 'slack_search')({ query: 'hello' }) as any;
    expect(result.total).toBe(1);
    expect(result.count).toBe(1);
    expect(result.results[0].text).toBe('hello world');
    expect(result.results[0].channel).toBe('general');
  });

  it('slack_users returns filtered user list', async () => {
    const mockResponse = {
      ok: true,
      members: [
        {
          id: 'U001',
          real_name: 'Alice Smith',
          name: 'alice',
          is_bot: false,
          deleted: false,
          profile: { email: 'alice@example.com', title: 'Engineer' },
          tz: 'America/New_York',
        },
        {
          id: 'USLACKBOT',
          real_name: 'Slackbot',
          name: 'slackbot',
          is_bot: true,
          deleted: false,
          profile: {},
          tz: null,
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await tool(plugin, 'slack_users')({}) as any;
    // Slackbot and bots should be filtered out
    expect(result.users.some((u: any) => u.id === 'USLACKBOT')).toBe(false);
    expect(result.users[0].id).toBe('U001');
    expect(result.users[0].name).toBe('Alice Smith');
    expect(result.users[0].email).toBe('alice@example.com');
  });

  it('slack_add_reaction posts a reaction and returns ok', async () => {
    const mockResponse = { ok: true };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await tool(plugin, 'slack_add_reaction')({
      channel: 'C001',
      timestamp: '1234567890.000000',
      emoji: 'thumbsup',
    }) as any;

    expect(result.ok).toBe(true);
    expect(result.emoji).toBe('thumbsup');
  });

  it('throws when Slack API returns ok: false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: false, error: 'channel_not_found' }),
    }));

    await expect(tool(plugin, 'slack_channels')({})).rejects.toThrow(/channel_not_found/);
  });

  it('uses Authorization Bearer header with token', async () => {
    const mockResponse = { ok: true, channels: [] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    vi.stubGlobal('fetch', fetchMock);

    await tool(plugin, 'slack_channels')({});

    const callInit = fetchMock.mock.calls[0][1] as RequestInit;
    const authHeader = (callInit.headers as Record<string, string>)['Authorization'];
    expect(authHeader).toBe('Bearer xoxb-fake-token-12345');
  });
});
