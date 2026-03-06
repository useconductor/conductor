/**
 * GitHub Actions Plugin — TheAlxLabs / Conductor
 *
 * Full GitHub CI/CD and project management:
 * - Workflow runs: trigger, monitor, cancel, get logs
 * - Pull requests: list, create, review, merge
 * - Issues: create, update, comment, assign, label
 * - Releases: list, create, publish
 * - Notifications: check what needs attention
 * - Code search across your repos
 *
 * Extends the existing github plugin (which handles public data).
 * This plugin focuses on authenticated, write, and Actions operations.
 *
 * Setup:
 *   1. https://github.com/settings/tokens → Fine-grained or classic PAT
 *   2. Scopes needed: repo, workflow, read:user, notifications
 *   3. Run: conductor plugins config github_actions token <YOUR_TOKEN>
 *
 * Keychain: github / token
 */

import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

const GH_BASE = 'https://api.github.com';
const GH_ACCEPT = 'application/vnd.github+json';
const GH_API_VERSION = '2022-11-28';

export class GitHubActionsPlugin implements Plugin {
  name = 'github_actions';
  description =
    'GitHub CI/CD, PRs, issues, releases, notifications — full write access, requires PAT';
  version = '1.0.0';

  private keychain!: Keychain;

  async initialize(conductor: Conductor): Promise<void> {
    this.keychain = new Keychain(conductor.getConfig().getConfigDir());
  }

  isConfigured(): boolean {
    return true;
  }

  private async getToken(): Promise<string> {
    const token = await this.keychain.get('github', 'token');
    if (!token) {
      throw new Error(
        'GitHub token not configured.\n' +
          'Create a PAT at https://github.com/settings/tokens\n' +
          'Then run: conductor plugins config github_actions token <TOKEN>'
      );
    }
    return token;
  }

  private async ghFetch(
    path: string,
    options: { method?: string; body?: any; params?: Record<string, string> } = {}
  ): Promise<any> {
    const token = await this.getToken();
    const url = new URL(`${GH_BASE}${path}`);
    if (options.params) {
      for (const [k, v] of Object.entries(options.params)) url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: GH_ACCEPT,
        'X-GitHub-Api-Version': GH_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (res.status === 204) return {};
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: res.statusText }))) as any;
      throw new Error(`GitHub API ${res.status}: ${err.message ?? res.statusText}`);
    }
    return res.json();
  }

  // ── Formatters ──────────────────────────────────────────────────────────────

  private formatRun(r: any) {
    return {
      id: r.id,
      name: r.name,
      workflow: r.workflow_id,
      status: r.status,
      conclusion: r.conclusion ?? 'pending',
      branch: r.head_branch,
      commit: r.head_sha?.slice(0, 8),
      triggeredBy: r.triggering_actor?.login ?? r.actor?.login ?? '',
      event: r.event,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      duration: r.updated_at && r.created_at
        ? `${Math.round((new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()) / 1000)}s`
        : null,
      url: r.html_url,
    };
  }

  private formatPR(pr: any) {
    return {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      draft: pr.draft ?? false,
      author: pr.user?.login ?? '',
      base: pr.base?.ref ?? '',
      head: pr.head?.ref ?? '',
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
      changedFiles: pr.changed_files ?? 0,
      mergeable: pr.mergeable,
      labels: (pr.labels ?? []).map((l: any) => l.name),
      reviewers: (pr.requested_reviewers ?? []).map((r: any) => r.login),
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      url: pr.html_url,
      body: pr.body?.slice(0, 500) ?? '',
    };
  }

  private formatIssue(i: any) {
    return {
      number: i.number,
      title: i.title,
      state: i.state,
      author: i.user?.login ?? '',
      assignees: (i.assignees ?? []).map((a: any) => a.login),
      labels: (i.labels ?? []).map((l: any) => l.name),
      comments: i.comments ?? 0,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
      url: i.html_url,
      body: i.body?.slice(0, 500) ?? '',
    };
  }

  // ── Tools ───────────────────────────────────────────────────────────────────

  getTools(): PluginTool[] {
    return [
      // ── gh_my_repos ────────────────────────────────────────────────────────
      {
        name: 'gh_my_repos',
        description: "List the authenticated user's own repositories",
        inputSchema: {
          type: 'object',
          properties: {
            sort: {
              type: 'string',
              enum: ['updated', 'created', 'pushed', 'full_name'],
              description: 'Sort order (default: pushed)',
            },
            limit: { type: 'number', description: 'Max repos (default: 30)' },
            visibility: {
              type: 'string',
              enum: ['all', 'public', 'private'],
              description: 'Filter by visibility (default: all)',
            },
          },
        },
        handler: async ({ sort = 'pushed', limit = 30, visibility = 'all' }: any) => {
          const data = await this.ghFetch('/user/repos', {
            params: {
              sort,
              per_page: String(Math.min(limit, 100)),
              visibility,
              affiliation: 'owner',
            },
          });
          return {
            count: data.length,
            repos: data.map((r: any) => ({
              name: r.name,
              fullName: r.full_name,
              description: r.description ?? '',
              language: r.language ?? '',
              private: r.private,
              stars: r.stargazers_count,
              openIssues: r.open_issues_count,
              defaultBranch: r.default_branch,
              pushedAt: r.pushed_at,
              url: r.html_url,
            })),
          };
        },
      },

      // ── gh_workflow_runs ───────────────────────────────────────────────────
      {
        name: 'gh_workflow_runs',
        description: 'List recent workflow runs for a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repo owner' },
            repo: { type: 'string', description: 'Repo name' },
            status: {
              type: 'string',
              enum: ['completed', 'in_progress', 'queued', 'failure', 'success'],
              description: 'Filter by status',
            },
            branch: { type: 'string', description: 'Filter by branch name' },
            limit: { type: 'number', description: 'Max runs (default: 10)' },
          },
          required: ['owner', 'repo'],
        },
        handler: async ({ owner, repo, status, branch, limit = 10 }: any) => {
          const params: Record<string, string> = { per_page: String(Math.min(limit, 100)) };
          if (status) params.status = status;
          if (branch) params.branch = branch;
          const data = await this.ghFetch(`/repos/${owner}/${repo}/actions/runs`, { params });
          return {
            totalCount: data.total_count ?? 0,
            runs: (data.workflow_runs ?? []).map(this.formatRun.bind(this)),
          };
        },
      },

      // ── gh_run_status ──────────────────────────────────────────────────────
      {
        name: 'gh_run_status',
        description: 'Get the status and jobs of a specific workflow run',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            runId: { type: 'number', description: 'Workflow run ID' },
          },
          required: ['owner', 'repo', 'runId'],
        },
        handler: async ({ owner, repo, runId }: any) => {
          const [run, jobs] = await Promise.all([
            this.ghFetch(`/repos/${owner}/${repo}/actions/runs/${runId}`),
            this.ghFetch(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs`),
          ]);
          return {
            ...this.formatRun(run),
            jobs: (jobs.jobs ?? []).map((j: any) => ({
              id: j.id,
              name: j.name,
              status: j.status,
              conclusion: j.conclusion ?? 'pending',
              startedAt: j.started_at,
              completedAt: j.completed_at,
              steps: (j.steps ?? []).map((s: any) => ({
                name: s.name,
                status: s.status,
                conclusion: s.conclusion,
                number: s.number,
              })),
            })),
          };
        },
      },

      // ── gh_trigger_workflow ────────────────────────────────────────────────
      {
        name: 'gh_trigger_workflow',
        description: 'Manually trigger a GitHub Actions workflow (workflow_dispatch)',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            workflow: {
              type: 'string',
              description: 'Workflow file name (e.g. "deploy.yml") or ID',
            },
            ref: { type: 'string', description: 'Branch or tag to run on (default: main)' },
            inputs: {
              type: 'object',
              description: 'Workflow input parameters (key-value pairs)',
            },
          },
          required: ['owner', 'repo', 'workflow'],
        },
        handler: async ({ owner, repo, workflow, ref = 'main', inputs = {} }: any) => {
          await this.ghFetch(
            `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
            { method: 'POST', body: { ref, inputs } }
          );
          // Give GitHub a moment then fetch the latest run
          await new Promise((r) => setTimeout(r, 2000));
          const runs = await this.ghFetch(`/repos/${owner}/${repo}/actions/runs`, {
            params: { per_page: '1', event: 'workflow_dispatch' },
          });
          const latestRun = runs.workflow_runs?.[0];
          return {
            triggered: true,
            run: latestRun ? this.formatRun(latestRun) : null,
          };
        },
      },

      // ── gh_cancel_run ──────────────────────────────────────────────────────
      {
        name: 'gh_cancel_run',
        description: 'Cancel a running GitHub Actions workflow run',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            runId: { type: 'number' },
          },
          required: ['owner', 'repo', 'runId'],
        },
        handler: async ({ owner, repo, runId }: any) => {
          await this.ghFetch(`/repos/${owner}/${repo}/actions/runs/${runId}/cancel`, {
            method: 'POST',
          });
          return { cancelled: true, runId };
        },
      },

      // ── gh_list_prs ────────────────────────────────────────────────────────
      {
        name: 'gh_list_prs',
        description: 'List pull requests for a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            state: {
              type: 'string',
              enum: ['open', 'closed', 'all'],
              description: 'PR state filter (default: open)',
            },
            limit: { type: 'number', description: 'Max PRs (default: 20)' },
          },
          required: ['owner', 'repo'],
        },
        handler: async ({ owner, repo, state = 'open', limit = 20 }: any) => {
          const data = await this.ghFetch(`/repos/${owner}/${repo}/pulls`, {
            params: { state, per_page: String(Math.min(limit, 100)), sort: 'updated' },
          });
          return {
            count: data.length,
            prs: data.map(this.formatPR.bind(this)),
          };
        },
      },

      // ── gh_create_pr ───────────────────────────────────────────────────────
      {
        name: 'gh_create_pr',
        description: 'Create a new pull request',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            title: { type: 'string', description: 'PR title' },
            body: { type: 'string', description: 'PR description' },
            head: { type: 'string', description: 'Source branch (your feature branch)' },
            base: { type: 'string', description: 'Target branch (default: main)' },
            draft: { type: 'boolean', description: 'Create as draft PR (default: false)' },
          },
          required: ['owner', 'repo', 'title', 'head'],
        },
        handler: async ({ owner, repo, title, body = '', head, base = 'main', draft = false }: any) => {
          const pr = await this.ghFetch(`/repos/${owner}/${repo}/pulls`, {
            method: 'POST',
            body: { title, body, head, base, draft },
          });
          return { created: true, ...this.formatPR(pr) };
        },
      },

      // ── gh_merge_pr ────────────────────────────────────────────────────────
      {
        name: 'gh_merge_pr',
        description: 'Merge a pull request',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            prNumber: { type: 'number', description: 'PR number' },
            method: {
              type: 'string',
              enum: ['merge', 'squash', 'rebase'],
              description: 'Merge strategy (default: merge)',
            },
            commitTitle: { type: 'string', description: 'Custom commit title' },
          },
          required: ['owner', 'repo', 'prNumber'],
        },
        handler: async ({ owner, repo, prNumber, method = 'merge', commitTitle }: any) => {
          const body: any = { merge_method: method };
          if (commitTitle) body.commit_title = commitTitle;
          const res = await this.ghFetch(`/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
            method: 'PUT',
            body,
          });
          return { merged: true, sha: res.sha, message: res.message };
        },
      },

      // ── gh_list_issues ─────────────────────────────────────────────────────
      {
        name: 'gh_list_issues',
        description: 'List issues for a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            state: {
              type: 'string',
              enum: ['open', 'closed', 'all'],
              description: 'Issue state (default: open)',
            },
            labels: { type: 'string', description: 'Comma-separated label filter' },
            assignee: { type: 'string', description: 'Filter by assignee username' },
            limit: { type: 'number', description: 'Max issues (default: 20)' },
          },
          required: ['owner', 'repo'],
        },
        handler: async ({ owner, repo, state = 'open', labels, assignee, limit = 20 }: any) => {
          const params: Record<string, string> = {
            state,
            per_page: String(Math.min(limit, 100)),
            sort: 'updated',
          };
          if (labels) params.labels = labels;
          if (assignee) params.assignee = assignee;
          const data = await this.ghFetch(`/repos/${owner}/${repo}/issues`, { params });
          // Filter out pull requests (they appear in issues endpoint too)
          const issues = data.filter((i: any) => !i.pull_request);
          return {
            count: issues.length,
            issues: issues.map(this.formatIssue.bind(this)),
          };
        },
      },

      // ── gh_create_issue ────────────────────────────────────────────────────
      {
        name: 'gh_create_issue',
        description: 'Create a new GitHub issue',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            title: { type: 'string', description: 'Issue title' },
            body: { type: 'string', description: 'Issue body (markdown)' },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Label names to apply',
            },
            assignees: {
              type: 'array',
              items: { type: 'string' },
              description: 'GitHub usernames to assign',
            },
          },
          required: ['owner', 'repo', 'title'],
        },
        handler: async ({ owner, repo, title, body = '', labels = [], assignees = [] }: any) => {
          const issue = await this.ghFetch(`/repos/${owner}/${repo}/issues`, {
            method: 'POST',
            body: { title, body, labels, assignees },
          });
          return { created: true, ...this.formatIssue(issue) };
        },
      },

      // ── gh_comment ─────────────────────────────────────────────────────────
      {
        name: 'gh_comment',
        description: 'Add a comment to a GitHub issue or pull request',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            number: { type: 'number', description: 'Issue or PR number' },
            body: { type: 'string', description: 'Comment text (markdown)' },
          },
          required: ['owner', 'repo', 'number', 'body'],
        },
        handler: async ({ owner, repo, number, body }: any) => {
          const comment = await this.ghFetch(`/repos/${owner}/${repo}/issues/${number}/comments`, {
            method: 'POST',
            body: { body },
          });
          return {
            created: true,
            id: comment.id,
            url: comment.html_url,
          };
        },
      },

      // ── gh_releases ────────────────────────────────────────────────────────
      {
        name: 'gh_releases',
        description: 'List releases for a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            limit: { type: 'number', description: 'Max releases (default: 10)' },
          },
          required: ['owner', 'repo'],
        },
        handler: async ({ owner, repo, limit = 10 }: any) => {
          const data = await this.ghFetch(`/repos/${owner}/${repo}/releases`, {
            params: { per_page: String(Math.min(limit, 100)) },
          });
          return {
            count: data.length,
            releases: data.map((r: any) => ({
              id: r.id,
              tag: r.tag_name,
              name: r.name ?? r.tag_name,
              draft: r.draft,
              prerelease: r.prerelease,
              author: r.author?.login ?? '',
              publishedAt: r.published_at,
              body: r.body?.slice(0, 500) ?? '',
              assets: (r.assets ?? []).map((a: any) => ({
                name: a.name,
                size: a.size,
                downloads: a.download_count,
              })),
              url: r.html_url,
            })),
          };
        },
      },

      // ── gh_create_release ──────────────────────────────────────────────────
      {
        name: 'gh_create_release',
        description: 'Create a new GitHub release',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            tag: { type: 'string', description: 'Tag name (e.g. v1.2.3)' },
            name: { type: 'string', description: 'Release title' },
            body: { type: 'string', description: 'Release notes (markdown)' },
            draft: { type: 'boolean', description: 'Create as draft (default: false)' },
            prerelease: { type: 'boolean', description: 'Mark as pre-release (default: false)' },
            generateNotes: {
              type: 'boolean',
              description: 'Auto-generate release notes from PRs/commits (default: false)',
            },
          },
          required: ['owner', 'repo', 'tag'],
        },
        handler: async ({
          owner,
          repo,
          tag,
          name,
          body = '',
          draft = false,
          prerelease = false,
          generateNotes = false,
        }: any) => {
          const release = await this.ghFetch(`/repos/${owner}/${repo}/releases`, {
            method: 'POST',
            body: {
              tag_name: tag,
              name: name ?? tag,
              body,
              draft,
              prerelease,
              generate_release_notes: generateNotes,
            },
          });
          return {
            created: true,
            id: release.id,
            tag: release.tag_name,
            name: release.name,
            url: release.html_url,
            draft: release.draft,
          };
        },
      },

      // ── gh_notifications ───────────────────────────────────────────────────
      {
        name: 'gh_notifications',
        description: 'Get unread GitHub notifications (mentions, CI failures, reviews needed)',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max notifications (default: 20)' },
            all: { type: 'boolean', description: 'Include read notifications (default: false)' },
          },
        },
        handler: async ({ limit = 20, all = false }: any) => {
          const data = await this.ghFetch('/notifications', {
            params: {
              all: String(all),
              per_page: String(Math.min(limit, 50)),
            },
          });
          return {
            count: data.length,
            notifications: data.map((n: any) => ({
              id: n.id,
              unread: n.unread,
              reason: n.reason,
              type: n.subject?.type ?? '',
              title: n.subject?.title ?? '',
              repo: n.repository?.full_name ?? '',
              updatedAt: n.updated_at,
            })),
          };
        },
      },

      // ── gh_code_search ─────────────────────────────────────────────────────
      {
        name: 'gh_code_search',
        description: 'Search code across GitHub repositories',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (supports repo:, lang:, path: operators)' },
            limit: { type: 'number', description: 'Max results (default: 10)' },
          },
          required: ['query'],
        },
        handler: async ({ query, limit = 10 }: any) => {
          const data = await this.ghFetch('/search/code', {
            params: { q: query, per_page: String(Math.min(limit, 30)) },
          });
          return {
            totalCount: data.total_count ?? 0,
            results: (data.items ?? []).map((i: any) => ({
              repo: i.repository?.full_name ?? '',
              path: i.path,
              name: i.name,
              url: i.html_url,
            })),
          };
        },
      },
    ];
  }
}
