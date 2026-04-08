import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JiraPlugin } from '../src/plugins/builtin/jira.js';
import { Keychain } from '../src/security/keychain.js';

// Helper: get a tool's handler by name
function tool(plugin: JiraPlugin, name: string) {
  const t = plugin.getTools().find((t) => t.name === name);
  if (!t) throw new Error(`Tool not found: ${name}`);
  return t.handler as (args: Record<string, unknown>) => Promise<unknown>;
}

// Minimal conductor mock — with config support for domain/email
function makeConductor(opts: {
  configDir?: string;
  domain?: string;
  email?: string;
} = {}) {
  const { configDir = '/tmp/conductor-test-jira', domain, email } = opts;
  return {
    getConfig: () => ({
      getConfigDir: () => configDir,
      get: (key: string) => {
        if (key === 'plugins.jira.domain') return domain ?? null;
        if (key === 'plugins.jira.email') return email ?? null;
        return null;
      },
    }),
  } as any;
}

let plugin: JiraPlugin;

beforeEach(async () => {
  plugin = new JiraPlugin();
  await plugin.initialize(makeConductor());
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Structure ────────────────────────────────────────────────────────────────

describe('JiraPlugin structure', () => {
  it('has correct name and version', () => {
    expect(plugin.name).toBe('jira');
    expect(plugin.version).toBeTruthy();
  });

  it('registers expected tools', () => {
    const names = plugin.getTools().map((t) => t.name);
    expect(names).toContain('jira_issues');
    expect(names).toContain('jira_my_issues');
    expect(names).toContain('jira_issue');
    expect(names).toContain('jira_create_issue');
    expect(names).toContain('jira_update_issue');
    expect(names).toContain('jira_comment');
    expect(names).toContain('jira_projects');
    expect(names).toContain('jira_transitions');
    expect(names).toContain('jira_transition_issue');
  });

  it('marks write operations as requiresApproval', () => {
    const writeTools = ['jira_create_issue', 'jira_update_issue', 'jira_comment', 'jira_transition_issue'];
    for (const name of writeTools) {
      const t = plugin.getTools().find((t) => t.name === name);
      expect(t?.requiresApproval).toBe(true);
    }
  });
});

// ── isConfigured ─────────────────────────────────────────────────────────────

// Note: isConfigured() returns true by design - real check at tool invocation

// ── Unconfigured error messages ───────────────────────────────────────────────

describe('Jira tools — unconfigured', () => {
  beforeEach(async () => {
    // No token, no domain, no email
    vi.spyOn(Keychain.prototype, 'get').mockResolvedValue(null);
    plugin = new JiraPlugin();
    await plugin.initialize(makeConductor());
  });

  it('jira_issues throws with actionable message when not configured', async () => {
    await expect(
      tool(plugin, 'jira_issues')({ jql: 'project = ENG' }),
    ).rejects.toThrow(/jira/i);
  });

  it('jira_projects throws with actionable message when not configured', async () => {
    await expect(tool(plugin, 'jira_projects')({})).rejects.toThrow(/jira/i);
  });

  it('jira_my_issues throws with actionable message when not configured', async () => {
    await expect(tool(plugin, 'jira_my_issues')({})).rejects.toThrow(/jira/i);
  });
});

// ── Configured — mocked fetch calls ──────────────────────────────────────────

describe('Jira tools — configured', () => {
  beforeEach(async () => {
    vi.spyOn(Keychain.prototype, 'get').mockResolvedValue('fake_jira_api_token');
    plugin = new JiraPlugin();
    await plugin.initialize(makeConductor({
      domain: 'mycompany',
      email: 'user@mycompany.com',
    }));
  });

  it('jira_issues returns search results', async () => {
    const mockResponse = {
      total: 2,
      issues: [
        {
          id: '10001',
          key: 'ENG-1',
          self: 'https://mycompany.atlassian.net/rest/api/3/issue/10001',
          fields: {
            summary: 'Fix the login bug',
            status: { name: 'In Progress', statusCategory: { name: 'In Progress' } },
            priority: { name: 'High' },
            assignee: { displayName: 'Alice Smith' },
            reporter: { displayName: 'Bob Jones' },
            issuetype: { name: 'Bug' },
            project: { key: 'ENG' },
            created: '2024-01-01T00:00:00Z',
            updated: '2024-06-01T00:00:00Z',
            labels: ['frontend'],
          },
        },
        {
          id: '10002',
          key: 'ENG-2',
          self: 'https://mycompany.atlassian.net/rest/api/3/issue/10002',
          fields: {
            summary: 'Add dark mode',
            status: { name: 'Todo', statusCategory: { name: 'To Do' } },
            priority: { name: 'Medium' },
            assignee: null,
            reporter: { displayName: 'Bob Jones' },
            issuetype: { name: 'Story' },
            project: { key: 'ENG' },
            created: '2024-02-01T00:00:00Z',
            updated: '2024-06-01T00:00:00Z',
            labels: [],
          },
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await tool(plugin, 'jira_issues')({ jql: 'project = ENG' }) as any;
    expect(result.total).toBe(2);
    expect(result.count).toBe(2);
    expect(result.issues[0].key).toBe('ENG-1');
    expect(result.issues[0].summary).toBe('Fix the login bug');
    expect(result.issues[0].status).toBe('In Progress');
    expect(result.issues[0].assignee).toBe('Alice Smith');
    expect(result.issues[1].key).toBe('ENG-2');
    expect(result.issues[1].assignee).toBeNull();
  });

  it('jira_issue fetches a single issue by key', async () => {
    const mockIssue = {
      id: '10001',
      key: 'ENG-42',
      self: 'https://mycompany.atlassian.net/rest/api/3/issue/10001',
      fields: {
        summary: 'Critical auth bug',
        status: { name: 'In Progress', statusCategory: { name: 'In Progress' } },
        priority: { name: 'Highest' },
        assignee: { displayName: 'Charlie Dev' },
        reporter: { displayName: 'Manager' },
        issuetype: { name: 'Bug' },
        project: { key: 'ENG' },
        created: '2024-01-01T00:00:00Z',
        updated: '2024-06-01T00:00:00Z',
        labels: ['critical'],
        comment: {
          comments: [
            {
              author: { displayName: 'Alice' },
              created: '2024-06-01T00:00:00Z',
              body: {
                content: [{ content: [{ text: 'Working on it' }] }],
              },
            },
          ],
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockIssue),
    }));

    const result = await tool(plugin, 'jira_issue')({ key: 'ENG-42' }) as any;
    expect(result.key).toBe('ENG-42');
    expect(result.summary).toBe('Critical auth bug');
    expect(result.priority).toBe('Highest');
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].author).toBe('Alice');
    expect(result.comments[0].body).toBe('Working on it');
  });

  it('jira_projects returns project list', async () => {
    const mockResponse = {
      values: [
        { id: '1', key: 'ENG', name: 'Engineering', projectTypeKey: 'software', lead: { displayName: 'Alice' } },
        { id: '2', key: 'MKTG', name: 'Marketing', projectTypeKey: 'business', lead: null },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await tool(plugin, 'jira_projects')({}) as any;
    expect(result.count).toBe(2);
    expect(result.projects[0].key).toBe('ENG');
    expect(result.projects[0].name).toBe('Engineering');
    expect(result.projects[1].key).toBe('MKTG');
  });

  it('jira_create_issue creates an issue and returns key', async () => {
    const mockResponse = {
      id: '10099',
      key: 'ENG-99',
      self: 'https://mycompany.atlassian.net/rest/api/3/issue/10099',
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await tool(plugin, 'jira_create_issue')({
      project: 'ENG',
      summary: 'New task',
      description: 'Do the thing',
      issue_type: 'Task',
    }) as any;

    expect(result.key).toBe('ENG-99');
    expect(result.id).toBe('10099');
  });

  it('jira uses Basic auth header', async () => {
    const mockResponse = { values: [] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });
    vi.stubGlobal('fetch', fetchMock);

    await tool(plugin, 'jira_projects')({});

    const callInit = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = callInit.headers as Record<string, string>;
    const expectedAuth = Buffer.from('user@mycompany.com:fake_jira_api_token').toString('base64');
    expect(headers['Authorization']).toBe(`Basic ${expectedAuth}`);
  });

  it('jira_transitions returns available transitions', async () => {
    const mockResponse = {
      transitions: [
        { id: '11', name: 'To Do', to: { name: 'To Do', statusCategory: { name: 'To Do' } } },
        { id: '21', name: 'In Progress', to: { name: 'In Progress', statusCategory: { name: 'In Progress' } } },
        { id: '31', name: 'Done', to: { name: 'Done', statusCategory: { name: 'Done' } } },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await tool(plugin, 'jira_transitions')({ key: 'ENG-1' }) as any;
    expect(result.issue).toBe('ENG-1');
    expect(result.transitions).toHaveLength(3);
    expect(result.transitions[1].name).toBe('In Progress');
    expect(result.transitions[1].id).toBe('21');
  });

  it('jira throws when API returns error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    }));

    await expect(tool(plugin, 'jira_projects')({})).rejects.toThrow(/401/);
  });
});
