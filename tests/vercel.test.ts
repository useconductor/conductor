import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VercelPlugin } from '../src/plugins/builtin/vercel.js';
import { Keychain } from '../src/security/keychain.js';

// Helper: get a tool's handler by name
function tool(plugin: VercelPlugin, name: string) {
  const t = plugin.getTools().find((t) => t.name === name);
  if (!t) throw new Error(`Tool not found: ${name}`);
  return t.handler as (args: Record<string, unknown>) => Promise<unknown>;
}

// Minimal conductor mock
function makeConductor(configDir = '/tmp/conductor-test-vercel') {
  return {
    getConfig: () => ({
      getConfigDir: () => configDir,
    }),
  } as any;
}

let plugin: VercelPlugin;

beforeEach(async () => {
  plugin = new VercelPlugin();
  await plugin.initialize(makeConductor());
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Structure ────────────────────────────────────────────────────────────────

describe('VercelPlugin structure', () => {
  it('has correct name and version', () => {
    expect(plugin.name).toBe('vercel');
    expect(plugin.version).toBeTruthy();
  });

  it('registers expected tools', () => {
    const names = plugin.getTools().map((t) => t.name);
    expect(names).toContain('vercel_projects');
    expect(names).toContain('vercel_project');
    expect(names).toContain('vercel_deployments');
    expect(names).toContain('vercel_deployment');
    expect(names).toContain('vercel_redeploy');
    expect(names).toContain('vercel_cancel');
    expect(names).toContain('vercel_logs');
    expect(names).toContain('vercel_env_list');
    expect(names).toContain('vercel_env_add');
    expect(names).toContain('vercel_env_delete');
    expect(names).toContain('vercel_domains');
    expect(names).toContain('vercel_add_domain');
    expect(names).toContain('vercel_team_info');
    expect(names).toContain('vercel_set_team');
  });

  it('marks destructive operations as requiresApproval', () => {
    const approvalTools = ['vercel_cancel', 'vercel_env_delete', 'vercel_add_domain'];
    for (const name of approvalTools) {
      const t = plugin.getTools().find((t) => t.name === name);
      expect(t?.requiresApproval).toBe(true);
    }
  });
});

// Note: isConfigured() returns true by design - real check happens at tool invocation

// ── Unconfigured error messages ───────────────────────────────────────────────

describe('Vercel tools — unconfigured', () => {
  beforeEach(() => {
    vi.spyOn(Keychain.prototype, 'get').mockResolvedValue(null);
  });

  it('vercel_projects throws with actionable message when not configured', async () => {
    await expect(tool(plugin, 'vercel_projects')({})).rejects.toThrow(/vercel/i);
  });

  it('vercel_deployments throws with actionable message when not configured', async () => {
    await expect(tool(plugin, 'vercel_deployments')({})).rejects.toThrow(/vercel/i);
  });

  it('vercel_team_info throws with actionable message when not configured', async () => {
    await expect(tool(plugin, 'vercel_team_info')({})).rejects.toThrow(/vercel/i);
  });
});

// ── Configured — mocked fetch calls ──────────────────────────────────────────

describe('Vercel tools — configured (no team)', () => {
  beforeEach(async () => {
    // First call for 'token', second for 'team_id' (returns null = personal account)
    vi.spyOn(Keychain.prototype, 'get')
      .mockImplementation(async (service: string, key: string) => {
        if (service === 'vercel' && key === 'token') return 'fake_vercel_token_xyz';
        if (service === 'vercel' && key === 'team_id') return null;
        return null;
      });
    plugin = new VercelPlugin();
    await plugin.initialize(makeConductor());
  });

  it('vercel_projects returns project list', async () => {
    const mockResponse = {
      projects: [
        {
          id: 'prj_abc',
          name: 'my-app',
          framework: 'nextjs',
          nodeVersion: '18',
          latestDeployments: [{ url: 'my-app.vercel.app', readyState: 'READY', target: 'production' }],
          alias: [{ domain: 'my-app.com' }],
          createdAt: 1700000000000,
          updatedAt: 1720000000000,
          link: null,
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await tool(plugin, 'vercel_projects')({}) as any;
    expect(result.count).toBe(1);
    expect(result.projects[0].name).toBe('my-app');
    expect(result.projects[0].framework).toBe('nextjs');
    expect(result.projects[0].productionUrl).toBe('https://my-app.com');
  });

  it('vercel_deployments returns deployment list', async () => {
    const mockResponse = {
      deployments: [
        {
          uid: 'dpl_abc123',
          name: 'my-app',
          url: 'my-app-abc.vercel.app',
          readyState: 'READY',
          target: 'production',
          meta: {
            githubCommitRef: 'main',
            githubCommitSha: 'abc123def456',
            githubCommitMessage: 'feat: add new feature',
            githubCommitAuthorLogin: 'alice',
          },
          createdAt: 1700000000000,
          buildingAt: 1700000060000,
          ready: 1700000120000,
          aliases: [],
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await tool(plugin, 'vercel_deployments')({}) as any;
    expect(result.count).toBe(1);
    expect(result.deployments[0].id).toBe('dpl_abc123');
    expect(result.deployments[0].state).toBe('READY');
    expect(result.deployments[0].url).toBe('https://my-app-abc.vercel.app');
    expect(result.deployments[0].branch).toBe('main');
    expect(result.deployments[0].commit.message).toBe('feat: add new feature');
  });

  it('vercel_deployment returns single deployment detail', async () => {
    const mockDeployment = {
      uid: 'dpl_xyz789',
      name: 'my-app',
      url: 'my-app-xyz.vercel.app',
      readyState: 'ERROR',
      target: 'preview',
      meta: {},
      createdAt: 1700000000000,
      buildingAt: null,
      ready: null,
      aliases: [],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDeployment),
    }));

    const result = await tool(plugin, 'vercel_deployment')({ id: 'dpl_xyz789' }) as any;
    expect(result.id).toBe('dpl_xyz789');
    expect(result.state).toBe('ERROR');
    expect(result.target).toBe('preview');
  });

  it('vercel_env_list returns environment variables', async () => {
    const mockResponse = {
      envs: [
        {
          id: 'env-1',
          key: 'DATABASE_URL',
          value: '[encrypted]',
          type: 'encrypted',
          target: ['production'],
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        },
        {
          id: 'env-2',
          key: 'API_KEY',
          value: '[encrypted]',
          type: 'encrypted',
          target: ['production', 'preview'],
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await tool(plugin, 'vercel_env_list')({ projectId: 'my-app' }) as any;
    expect(result.count).toBe(2);
    expect(result.envs[0].key).toBe('DATABASE_URL');
    expect(result.envs[1].key).toBe('API_KEY');
  });

  it('vercel_domains returns domain list', async () => {
    const mockResponse = {
      domains: [
        {
          name: 'my-app.com',
          apexName: 'my-app.com',
          verified: true,
          misconfigured: false,
          redirect: null,
          createdAt: 1700000000000,
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await tool(plugin, 'vercel_domains')({ projectId: 'my-app' }) as any;
    expect(result.count).toBe(1);
    expect(result.domains[0].name).toBe('my-app.com');
    expect(result.domains[0].verified).toBe(true);
    expect(result.domains[0].configured).toBe(true);
  });

  it('vercel_team_info returns personal account info', async () => {
    const mockUser = {
      uid: 'user-123',
      username: 'alice',
      email: 'alice@example.com',
      subscription: { plan: 'pro' },
      avatar: 'https://vercel.com/api/www/avatar/abc',
      createdAt: 1600000000000,
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockUser),
    }));

    const result = await tool(plugin, 'vercel_team_info')({}) as any;
    expect(result.name).toBe('alice');
    expect(result.email).toBe('alice@example.com');
    expect(result.plan).toBe('pro');
  });

  it('uses Authorization Bearer header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ projects: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await tool(plugin, 'vercel_projects')({});

    const callInit = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = callInit.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer fake_vercel_token_xyz');
  });

  it('vercel_logs returns build log lines', async () => {
    const mockEvents = [
      { type: 'stdout', payload: { text: 'Building...' }, date: 1700000001000 },
      { type: 'command', payload: { text: 'npm run build' }, date: 1700000002000 },
      { type: 'stdout', payload: { text: 'Build complete' }, date: 1700000060000 },
    ];

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockEvents),
    }));

    const result = await tool(plugin, 'vercel_logs')({ deploymentId: 'dpl_abc' }) as any;
    expect(result.count).toBe(3);
    expect(result.logs[0].text).toBe('Building...');
    expect(result.logs[1].type).toBe('command');
  });

  it('vercel throws when API returns error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: { message: 'Forbidden' } }),
    }));

    await expect(tool(plugin, 'vercel_projects')({})).rejects.toThrow(/Forbidden/);
  });
});

// ── Configured with team ID ───────────────────────────────────────────────────

describe('Vercel tools — configured (with team)', () => {
  beforeEach(async () => {
    vi.spyOn(Keychain.prototype, 'get')
      .mockImplementation(async (service: string, key: string) => {
        if (service === 'vercel' && key === 'token') return 'fake_vercel_token_xyz';
        if (service === 'vercel' && key === 'team_id') return 'team_abc123';
        return null;
      });
    plugin = new VercelPlugin();
    await plugin.initialize(makeConductor());
  });

  it('includes teamId in request URL when team is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ projects: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await tool(plugin, 'vercel_projects')({});

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('teamId=team_abc123');
  });

  it('vercel_team_info fetches team info when team is set', async () => {
    const mockTeam = {
      id: 'team_abc123',
      name: 'Acme Corp',
      email: null,
      plan: { id: 'enterprise' },
      avatar: null,
      createdAt: 1600000000000,
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockTeam),
    }));

    const result = await tool(plugin, 'vercel_team_info')({}) as any;
    expect(result.id).toBe('team_abc123');
    expect(result.name).toBe('Acme Corp');
    expect(result.plan).toBe('enterprise');
  });
});
