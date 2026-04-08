import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LinearPlugin } from '../src/plugins/builtin/linear.js';
import { Keychain } from '../src/security/keychain.js';

// Helper: get a tool's handler by name
function tool(plugin: LinearPlugin, name: string) {
  const t = plugin.getTools().find((t) => t.name === name);
  if (!t) throw new Error(`Tool not found: ${name}`);
  return t.handler as (args: Record<string, unknown>) => Promise<unknown>;
}

// Minimal conductor mock
function makeConductor(configDir = '/tmp/conductor-test-linear') {
  return {
    getConfig: () => ({
      getConfigDir: () => configDir,
    }),
  } as any;
}

let plugin: LinearPlugin;

beforeEach(async () => {
  plugin = new LinearPlugin();
  await plugin.initialize(makeConductor());
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Structure ────────────────────────────────────────────────────────────────

describe('LinearPlugin structure', () => {
  it('has correct name and version', () => {
    expect(plugin.name).toBe('linear');
    expect(plugin.version).toBeTruthy();
  });

  it('registers expected tools', () => {
    const names = plugin.getTools().map((t) => t.name);
    expect(names).toContain('linear_me');
    expect(names).toContain('linear_teams');
    expect(names).toContain('linear_issues');
    expect(names).toContain('linear_issue');
    expect(names).toContain('linear_create_issue');
    expect(names).toContain('linear_update_issue');
    expect(names).toContain('linear_comment');
    expect(names).toContain('linear_projects');
    expect(names).toContain('linear_cycles');
  });

  it('marks write operations as requiresApproval', () => {
    const writeTools = ['linear_create_issue', 'linear_update_issue', 'linear_comment'];
    for (const name of writeTools) {
      const t = plugin.getTools().find((t) => t.name === name);
      expect(t?.requiresApproval).toBe(true);
    }
  });
});

// ── isConfigured ─────────────────────────────────────────────────────────────

// Note: isConfigured() returns true by design - real check at tool invocation

// ── Unconfigured error messages ───────────────────────────────────────────────

describe('Linear tools — unconfigured', () => {
  beforeEach(() => {
    vi.spyOn(Keychain.prototype, 'get').mockResolvedValue(null);
  });

  it('linear_me throws with actionable message when not configured', async () => {
    await expect(tool(plugin, 'linear_me')({})).rejects.toThrow(/linear/i);
  });

  it('linear_teams throws with actionable message when not configured', async () => {
    await expect(tool(plugin, 'linear_teams')({})).rejects.toThrow(/linear/i);
  });

  it('linear_issues throws with actionable message when not configured', async () => {
    await expect(tool(plugin, 'linear_issues')({})).rejects.toThrow(/linear/i);
  });
});

// ── Configured — mocked fetch calls ──────────────────────────────────────────

describe('Linear tools — configured', () => {
  beforeEach(async () => {
    vi.spyOn(Keychain.prototype, 'get').mockResolvedValue('lin_api_fake_key_1234567890');
    plugin = new LinearPlugin();
    await plugin.initialize(makeConductor());
  });

  it('linear_me returns current user info', async () => {
    const mockData = {
      data: {
        viewer: {
          id: 'user-uuid-1',
          name: 'Alice Dev',
          email: 'alice@example.com',
          displayName: 'alice',
          avatarUrl: 'https://example.com/avatar.png',
          createdAt: '2022-01-01T00:00:00Z',
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    }));

    const result = await tool(plugin, 'linear_me')({}) as any;
    expect(result.name).toBe('Alice Dev');
    expect(result.email).toBe('alice@example.com');
    expect(result.id).toBe('user-uuid-1');
  });

  it('linear_teams returns team list', async () => {
    const mockData = {
      data: {
        teams: {
          nodes: [
            { id: 'team-1', key: 'ENG', name: 'Engineering', description: 'Eng team', memberCount: 10, createdAt: '2022-01-01T00:00:00Z' },
            { id: 'team-2', key: 'DESIGN', name: 'Design', description: 'Design team', memberCount: 5, createdAt: '2022-01-01T00:00:00Z' },
          ],
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    }));

    const result = await tool(plugin, 'linear_teams')({}) as any;
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('ENG');
    expect(result[1].key).toBe('DESIGN');
  });

  it('linear_issues returns issue list with filters applied', async () => {
    const mockData = {
      data: {
        issues: {
          nodes: [
            {
              id: 'issue-1',
              identifier: 'ENG-42',
              title: 'Fix the bug',
              state: { name: 'In Progress', color: '#f5a623' },
              priority: 2,
              priorityLabel: 'High',
              assignee: { name: 'Alice', displayName: 'alice' },
              team: { key: 'ENG', name: 'Engineering' },
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-06-01T00:00:00Z',
              url: 'https://linear.app/team/issue/ENG-42',
            },
          ],
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    }));

    const result = await tool(plugin, 'linear_issues')({ team_key: 'ENG', state: 'In Progress' }) as any;
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].identifier).toBe('ENG-42');
    expect(result[0].title).toBe('Fix the bug');
    expect(result[0].state).toBe('In Progress');
    expect(result[0].priority).toBe('High');
    expect(result[0].assignee).toBe('alice');
    expect(result[0].team).toBe('ENG');
  });

  it('linear_issue returns detailed issue info', async () => {
    const mockData = {
      data: {
        issue: {
          id: 'issue-uuid-1',
          identifier: 'ENG-10',
          title: 'Important feature',
          description: 'We need this feature',
          state: { name: 'Todo' },
          priority: 3,
          priorityLabel: 'Medium',
          assignee: { name: 'Bob', displayName: 'bob' },
          team: { key: 'ENG', name: 'Engineering' },
          labels: { nodes: [{ name: 'feature', color: '#00c' }] },
          comments: {
            nodes: [
              {
                body: 'Looks good!',
                user: { name: 'Alice' },
                createdAt: '2024-06-01T00:00:00Z',
              },
            ],
          },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-06-01T00:00:00Z',
          dueDate: null,
          url: 'https://linear.app/team/issue/ENG-10',
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    }));

    const result = await tool(plugin, 'linear_issue')({ id: 'ENG-10' }) as any;
    expect(result.identifier).toBe('ENG-10');
    expect(result.title).toBe('Important feature');
    expect(result.description).toBe('We need this feature');
    expect(result.labels).toEqual(['feature']);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].body).toBe('Looks good!');
    expect(result.comments[0].author).toBe('Alice');
  });

  it('linear_create_issue creates an issue in the given team', async () => {
    // First call: teams query
    const teamsData = {
      data: {
        teams: {
          nodes: [
            { id: 'team-uuid-1', key: 'ENG' },
          ],
        },
      },
    };
    // Second call: issue mutation
    const issueData = {
      data: {
        issueCreate: {
          success: true,
          issue: {
            id: 'new-issue-uuid',
            identifier: 'ENG-99',
            title: 'New feature request',
            url: 'https://linear.app/team/issue/ENG-99',
          },
        },
      },
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(teamsData) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(issueData) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await tool(plugin, 'linear_create_issue')({
      title: 'New feature request',
      team_key: 'ENG',
      priority: 2,
    }) as any;

    expect(result.identifier).toBe('ENG-99');
    expect(result.title).toBe('New feature request');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('linear_create_issue throws when team not found', async () => {
    const teamsData = {
      data: {
        teams: {
          nodes: [{ id: 'team-uuid-1', key: 'ENG' }],
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(teamsData),
    }));

    await expect(
      tool(plugin, 'linear_create_issue')({ title: 'Test', team_key: 'NONEXISTENT' }),
    ).rejects.toThrow(/Team.*NONEXISTENT.*not found/);
  });

  it('linear_projects returns project list', async () => {
    const mockData = {
      data: {
        projects: {
          nodes: [
            {
              id: 'proj-1',
              name: 'Q3 Roadmap',
              description: 'Q3 work',
              state: 'started',
              progress: 0.45,
              startDate: '2024-07-01',
              targetDate: '2024-09-30',
              teams: { nodes: [{ key: 'ENG', name: 'Engineering' }] },
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-06-01T00:00:00Z',
              url: 'https://linear.app/team/project/proj-1',
            },
          ],
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    }));

    const result = await tool(plugin, 'linear_projects')({}) as any;
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].name).toBe('Q3 Roadmap');
    expect(result[0].progress).toBe(0.45);
    expect(result[0].teams).toEqual(['ENG']);
  });

  it('uses Authorization header with API key', async () => {
    const mockData = {
      data: { teams: { nodes: [] } },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });
    vi.stubGlobal('fetch', fetchMock);

    await tool(plugin, 'linear_teams')({});

    const callInit = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = callInit.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('lin_api_fake_key_1234567890');
  });

  it('throws when Linear GraphQL returns errors', async () => {
    const mockData = {
      errors: [{ message: 'You are not authenticated' }],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    }));

    await expect(tool(plugin, 'linear_teams')({})).rejects.toThrow(/You are not authenticated/);
  });

  it('throws when Linear API returns non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    }));

    await expect(tool(plugin, 'linear_me')({})).rejects.toThrow(/401/);
  });
});
