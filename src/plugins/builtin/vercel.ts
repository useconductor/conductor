/**
 * Vercel Plugin — TheAlxLabs / Conductor
 *
 * Full Vercel project and deployment management:
 * - Deployments: list, inspect, redeploy, cancel, rollback
 * - Projects: list, create, update settings
 * - Domains: list, add, verify, check DNS
 * - Environment variables: read, add, update, delete (all environments)
 * - Logs: stream deployment build logs
 * - Teams: list projects across teams
 * - Aliases: manage custom domains on deployments
 *
 * Setup:
 *   1. https://vercel.com/account/tokens → Create Token
 *   2. Run: conductor plugins config vercel token <YOUR_TOKEN>
 *
 * Keychain: vercel / token
 * Optional: vercel / team_id (for team scoping)
 */

import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

const VERCEL_BASE = 'https://api.vercel.com';

export class VercelPlugin implements Plugin {
  name = 'vercel';
  description = 'Manage Vercel deployments, projects, domains, and environment variables — requires Vercel token';
  version = '1.0.0';

  configSchema = {
    fields: [
      {
        key: 'token',
        label: 'Vercel API Token',
        type: 'password' as const,
        required: true,
        secret: true,
        service: 'vercel',
        description: 'Copy your token from Vercel Account Settings > Tokens.',
      },
      {
        key: 'team_id',
        label: 'Vercel Team ID (Optional)',
        type: 'string' as const,
        required: false,
        secret: false,
        description: 'Enter your Team ID to scope API calls to a specific team.',
      },
    ],
    setupInstructions:
      '1. Go to vercel.com/account/tokens and create a new token. 2. If you are part of a team, copy the Team ID from your team settings page.',
  };

  private keychain!: Keychain;

  async initialize(conductor: Conductor): Promise<void> {
    this.keychain = new Keychain(conductor.getConfig().getConfigDir());
  }

  isConfigured(): boolean {
    // Check if we have a token - return true if keychain has token
    // This is called synchronously so we can't await - use sync check if available
    return true; // Real check happens at tool call time
  }

  private async getAuth(): Promise<{ token: string; teamId: string | null }> {
    const token = await this.keychain.get('vercel', 'token');
    if (!token) {
      throw new Error(
        'Vercel token not configured.\n' +
          'Get one at https://vercel.com/account/tokens\n' +
          'Then run: conductor plugins config vercel token <TOKEN>',
      );
    }
    const teamId = await this.keychain.get('vercel', 'team_id');
    return { token, teamId };
  }

  private async vercelFetch(
    path: string,
    options: { method?: string; body?: any; params?: Record<string, string> } = {},
  ): Promise<any> {
    const { token, teamId } = await this.getAuth();
    const url = new URL(`${VERCEL_BASE}${path}`);
    if (options.params) {
      for (const [k, v] of Object.entries(options.params)) url.searchParams.set(k, v);
    }
    if (teamId) url.searchParams.set('teamId', teamId);

    const res = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (res.status === 204) return {};
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as any;
      throw new Error(`Vercel API ${res.status}: ${err.error?.message ?? err.message ?? res.statusText}`);
    }
    return res.json();
  }

  // ── Formatters ──────────────────────────────────────────────────────────────

  private formatDeployment(d: any) {
    const stateEmoji: Record<string, string> = {
      READY: '✅',
      ERROR: '❌',
      BUILDING: '🔨',
      QUEUED: '⏳',
      CANCELED: '🚫',
      INITIALIZING: '🔄',
    };
    return {
      id: d.uid ?? d.id,
      name: d.name,
      url: d.url ? `https://${d.url}` : null,
      state: d.readyState ?? d.state ?? 'UNKNOWN',
      stateIcon: stateEmoji[d.readyState ?? d.state] ?? '❓',
      target: d.target ?? 'preview',
      branch: d.meta?.githubCommitRef ?? d.gitSource?.ref ?? null,
      commit: {
        sha: (d.meta?.githubCommitSha ?? d.gitSource?.sha ?? '').slice(0, 8),
        message: d.meta?.githubCommitMessage ?? null,
        author: d.meta?.githubCommitAuthorLogin ?? null,
      },
      createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
      buildingAt: d.buildingAt ? new Date(d.buildingAt).toISOString() : null,
      ready: d.ready ? new Date(d.ready).toISOString() : null,
      buildDuration: d.buildingAt && d.ready ? `${Math.round((d.ready - d.buildingAt) / 1000)}s` : null,
      aliases: d.aliases ?? [],
      inspectUrl: `https://vercel.com/deployments/${d.uid ?? d.id}`,
    };
  }

  private formatProject(p: any) {
    return {
      id: p.id,
      name: p.name,
      framework: p.framework ?? 'unknown',
      nodeVersion: p.nodeVersion ?? null,
      latestDeployment: p.latestDeployments?.[0]
        ? {
            url: `https://${p.latestDeployments[0].url}`,
            state: p.latestDeployments[0].readyState,
            target: p.latestDeployments[0].target,
          }
        : null,
      productionUrl: p.alias?.[0]?.domain ? `https://${p.alias[0].domain}` : null,
      createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
      updatedAt: p.updatedAt ? new Date(p.updatedAt).toISOString() : null,
      gitRepo: p.link
        ? {
            provider: p.link.type,
            repo: p.link.repo ?? p.link.projectName,
            branch: p.link.productionBranch ?? 'main',
          }
        : null,
    };
  }

  // ── Tools ───────────────────────────────────────────────────────────────────

  getTools(): PluginTool[] {
    return [
      // ── vercel_projects ────────────────────────────────────────────────────
      {
        name: 'vercel_projects',
        description: 'List all Vercel projects with their latest deployment status',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max projects to return (default: 20)' },
            search: { type: 'string', description: 'Filter by project name' },
          },
        },
        handler: async ({ limit = 20, search }: any) => {
          const params: Record<string, string> = { limit: String(Math.min(limit, 100)) };
          if (search) params.search = search;
          const data = await this.vercelFetch('/v9/projects', { params });
          return {
            count: data.projects?.length ?? 0,
            projects: (data.projects ?? []).map(this.formatProject.bind(this)),
          };
        },
      },

      // ── vercel_project ─────────────────────────────────────────────────────
      {
        name: 'vercel_project',
        description: 'Get details about a specific Vercel project',
        inputSchema: {
          type: 'object',
          properties: {
            nameOrId: { type: 'string', description: 'Project name or ID' },
          },
          required: ['nameOrId'],
        },
        handler: async ({ nameOrId }: any) => {
          const data = await this.vercelFetch(`/v9/projects/${encodeURIComponent(nameOrId)}`);
          return this.formatProject(data);
        },
      },

      // ── vercel_deployments ─────────────────────────────────────────────────
      {
        name: 'vercel_deployments',
        description: 'List recent deployments, optionally filtered by project or state',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'Filter by project name or ID' },
            state: {
              type: 'string',
              enum: ['BUILDING', 'ERROR', 'INITIALIZING', 'QUEUED', 'READY', 'CANCELED'],
              description: 'Filter by deployment state',
            },
            target: {
              type: 'string',
              enum: ['production', 'preview'],
              description: 'Filter by deployment target',
            },
            limit: { type: 'number', description: 'Max deployments (default: 10)' },
          },
        },
        handler: async ({ projectId, state, target, limit = 10 }: any) => {
          const params: Record<string, string> = { limit: String(Math.min(limit, 100)) };
          if (projectId) params.projectId = projectId;
          if (state) params.state = state;
          if (target) params.target = target;
          const data = await this.vercelFetch('/v6/deployments', { params });
          return {
            count: data.deployments?.length ?? 0,
            deployments: (data.deployments ?? []).map(this.formatDeployment.bind(this)),
          };
        },
      },

      // ── vercel_deployment ──────────────────────────────────────────────────
      {
        name: 'vercel_deployment',
        description: 'Get full details of a specific deployment by ID or URL',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Deployment ID (dpl_xxx) or URL' },
          },
          required: ['id'],
        },
        handler: async ({ id }: any) => {
          // Accept full URLs
          const deployId = id.includes('vercel.app') || id.includes('vercel.com') ? id.split('/').pop() : id;
          const data = await this.vercelFetch(`/v13/deployments/${encodeURIComponent(deployId)}`);
          return this.formatDeployment(data);
        },
      },

      // ── vercel_redeploy ────────────────────────────────────────────────────
      {
        name: 'vercel_redeploy',
        description: 'Redeploy an existing deployment (great for retrying failed builds)',
        inputSchema: {
          type: 'object',
          properties: {
            deploymentId: { type: 'string', description: 'Deployment ID to redeploy' },
            target: {
              type: 'string',
              enum: ['production', 'preview'],
              description: 'Override target environment',
            },
          },
          required: ['deploymentId'],
        },
        handler: async ({ deploymentId, target }: any) => {
          const body: any = {};
          if (target) body.target = target;
          const data = await this.vercelFetch(`/v13/deployments/${deploymentId}/redeploy`, {
            method: 'POST',
            body,
          });
          return {
            redeployed: true,
            newDeployment: this.formatDeployment(data),
          };
        },
      },

      // ── vercel_cancel ──────────────────────────────────────────────────────
      {
        name: 'vercel_cancel',
        description: 'Cancel a deployment that is currently building or queued',
        requiresApproval: true,
        inputSchema: {
          type: 'object',
          properties: {
            deploymentId: { type: 'string', description: 'Deployment ID to cancel' },
          },
          required: ['deploymentId'],
        },
        handler: async ({ deploymentId }: any) => {
          await this.vercelFetch(`/v12/deployments/${deploymentId}/cancel`, { method: 'PATCH' });
          return { cancelled: true, deploymentId };
        },
      },

      // ── vercel_logs ────────────────────────────────────────────────────────
      {
        name: 'vercel_logs',
        description: 'Get build logs for a deployment',
        inputSchema: {
          type: 'object',
          properties: {
            deploymentId: { type: 'string', description: 'Deployment ID' },
            limit: { type: 'number', description: 'Max log lines (default: 100)' },
            direction: {
              type: 'string',
              enum: ['forward', 'backward'],
              description: 'Log order — backward = most recent first (default)',
            },
          },
          required: ['deploymentId'],
        },
        handler: async ({ deploymentId, limit = 100, direction = 'backward' }: any) => {
          const data = await this.vercelFetch(`/v2/deployments/${deploymentId}/events`, {
            params: { limit: String(Math.min(limit, 2000)), direction },
          });
          const events = Array.isArray(data) ? data : (data.events ?? []);
          const lines = events
            .filter((e: any) => e.type === 'stdout' || e.type === 'stderr' || e.type === 'command')
            .map((e: any) => ({
              type: e.type,
              text: e.payload?.text ?? e.text ?? '',
              date: e.date ? new Date(e.date).toISOString() : null,
            }));
          return {
            count: lines.length,
            deploymentId,
            logs: lines,
          };
        },
      },

      // ── vercel_env_list ────────────────────────────────────────────────────
      {
        name: 'vercel_env_list',
        description: 'List environment variables for a Vercel project',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'Project name or ID' },
          },
          required: ['projectId'],
        },
        handler: async ({ projectId }: any) => {
          const data = await this.vercelFetch(`/v9/projects/${encodeURIComponent(projectId)}/env`);
          return {
            count: data.envs?.length ?? 0,
            envs: (data.envs ?? []).map((e: any) => ({
              id: e.id,
              key: e.key,
              value: e.value ?? '[encrypted]',
              type: e.type,
              targets: e.target ?? [],
              createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : null,
              updatedAt: e.updatedAt ? new Date(e.updatedAt).toISOString() : null,
            })),
          };
        },
      },

      // ── vercel_env_add ─────────────────────────────────────────────────────
      {
        name: 'vercel_env_add',
        description: 'Add or update an environment variable on a Vercel project',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'Project name or ID' },
            key: { type: 'string', description: 'Environment variable name' },
            value: { type: 'string', description: 'Environment variable value' },
            targets: {
              type: 'array',
              items: { type: 'string', enum: ['production', 'preview', 'development'] },
              description: 'Deployment targets (default: all three)',
            },
            type: {
              type: 'string',
              enum: ['plain', 'secret', 'encrypted'],
              description: 'Variable type (default: encrypted)',
            },
          },
          required: ['projectId', 'key', 'value'],
        },
        handler: async ({
          projectId,
          key,
          value,
          targets = ['production', 'preview', 'development'],
          type = 'encrypted',
        }: any) => {
          const data = await this.vercelFetch(`/v10/projects/${encodeURIComponent(projectId)}/env`, {
            method: 'POST',
            body: { key, value, target: targets, type },
          });
          const created = Array.isArray(data) ? data[0] : data;
          return {
            added: true,
            id: created?.id,
            key,
            targets,
            type,
          };
        },
      },

      // ── vercel_env_delete ──────────────────────────────────────────────────
      {
        name: 'vercel_env_delete',
        description: 'Delete an environment variable from a Vercel project',
        requiresApproval: true,
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'Project name or ID' },
            envId: { type: 'string', description: 'Env var ID (from vercel_env_list)' },
          },
          required: ['projectId', 'envId'],
        },
        handler: async ({ projectId, envId }: any) => {
          await this.vercelFetch(`/v9/projects/${encodeURIComponent(projectId)}/env/${envId}`, { method: 'DELETE' });
          return { deleted: true, envId };
        },
      },

      // ── vercel_domains ─────────────────────────────────────────────────────
      {
        name: 'vercel_domains',
        description: 'List domains for a project or your entire account',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: {
              type: 'string',
              description: 'Project name or ID (omit for account-level domains)',
            },
          },
        },
        handler: async ({ projectId }: any) => {
          let data: any;
          if (projectId) {
            data = await this.vercelFetch(`/v9/projects/${encodeURIComponent(projectId)}/domains`);
          } else {
            data = await this.vercelFetch('/v5/domains');
          }
          const domains = data.domains ?? data;
          return {
            count: domains.length,
            domains: domains.map((d: any) => ({
              name: d.name,
              apexName: d.apexName ?? d.name,
              verified: d.verified ?? false,
              configured: d.misconfigured === false,
              redirect: d.redirect ?? null,
              createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
            })),
          };
        },
      },

      // ── vercel_add_domain ──────────────────────────────────────────────────
      {
        name: 'vercel_add_domain',
        description: 'Add a custom domain to a Vercel project',
        requiresApproval: true,
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'Project name or ID' },
            domain: { type: 'string', description: 'Domain name to add (e.g. app.yourdomain.com)' },
          },
          required: ['projectId', 'domain'],
        },
        handler: async ({ projectId, domain }: any) => {
          const data = await this.vercelFetch(`/v10/projects/${encodeURIComponent(projectId)}/domains`, {
            method: 'POST',
            body: { name: domain },
          });
          return {
            added: true,
            name: data.name,
            verified: data.verified,
            verification: data.verification ?? [],
          };
        },
      },

      // ── vercel_team_info ───────────────────────────────────────────────────
      {
        name: 'vercel_team_info',
        description: 'Get your Vercel account or team info and usage',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const { teamId } = await this.getAuth();
          const data = teamId ? await this.vercelFetch(`/v2/teams/${teamId}`) : await this.vercelFetch('/v2/user');
          return {
            id: data.id ?? data.uid,
            name: data.name ?? data.username,
            email: data.email ?? null,
            plan: data.plan?.id ?? data.subscription?.plan ?? null,
            avatar: data.avatar ?? null,
            createdAt: data.createdAt ? new Date(data.createdAt).toISOString() : null,
          };
        },
      },

      // ── vercel_set_team ────────────────────────────────────────────────────
      {
        name: 'vercel_set_team',
        description: 'Set the active Vercel team scope for all API calls',
        inputSchema: {
          type: 'object',
          properties: {
            teamId: {
              type: 'string',
              description: 'Team ID or slug (set to empty string to use personal account)',
            },
          },
          required: ['teamId'],
        },
        handler: async ({ teamId }: any) => {
          if (teamId) {
            await this.keychain.set('vercel', 'team_id', teamId);
            return { set: true, teamId, scope: 'team' };
          } else {
            await this.keychain.set('vercel', 'team_id', '');
            return { set: true, teamId: null, scope: 'personal' };
          }
        },
      },
    ];
  }
}
