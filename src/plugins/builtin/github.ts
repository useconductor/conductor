import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

export class GitHubPlugin implements Plugin {
  name = 'github';
  description =
    'GitHub repositories, issues, PRs, releases, code search, and more (public data free, private needs token)';
  version = '2.0.0';

  configSchema = {
    fields: [
      {
        key: 'token',
        label: 'GitHub PAT (Personal Access Token)',
        type: 'password' as const,
        required: false,
        secret: true,
        service: 'github',
        description:
          'Create a PAT with "repo" and "workflow" scopes at GitHub Settings > Developer Settings > Personal Access Tokens.',
      },
    ],
    setupInstructions:
      'GitHub integration works for public data without a token. For private repos, issues, PRs and write operations, create a Personal Access Token at https://github.com/settings/tokens with "repo" and "workflow" scopes.',
  };

  private keychain!: Keychain;

  async initialize(conductor: Conductor): Promise<void> {
    this.keychain = new Keychain(conductor.getConfig().getConfigDir());
  }

  isConfigured(): boolean {
    return true; // public endpoints work without token
  }

  private async getToken(): Promise<string | null> {
    try {
      return await this.keychain.get('github', 'token');
    } catch {
      return null;
    }
  }

  private async ghFetch(
    path: string,
    options: { method?: string; body?: any; token?: string | null } = {},
  ): Promise<any> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
    const res = await fetch(`https://api.github.com${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`GitHub API ${res.status}: ${errText}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  getTools(): PluginTool[] {
    return [
      // ── User & repo basics ───────────────────────────────────────────────

      {
        name: 'github_user',
        description: 'Get GitHub user profile info',
        inputSchema: {
          type: 'object',
          properties: {
            username: { type: 'string', description: 'GitHub username' },
          },
          required: ['username'],
        },
        handler: async (input: { username: string }) => {
          const u = await this.ghFetch(`/users/${encodeURIComponent(input.username)}`);
          return {
            login: u.login,
            name: u.name,
            bio: u.bio,
            public_repos: u.public_repos,
            followers: u.followers,
            following: u.following,
            created: u.created_at,
            url: u.html_url,
            avatar: u.avatar_url,
          };
        },
      },

      {
        name: 'github_repo',
        description: 'Get repository details',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
          },
          required: ['owner', 'repo'],
        },
        handler: async (input: { owner: string; repo: string }) => {
          const token = await this.getToken();
          const r = await this.ghFetch(`/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`, {
            token,
          });
          return {
            name: r.full_name,
            description: r.description,
            language: r.language,
            stars: r.stargazers_count,
            forks: r.forks_count,
            open_issues: r.open_issues_count,
            license: r.license?.spdx_id,
            created: r.created_at,
            updated: r.updated_at,
            default_branch: r.default_branch,
            url: r.html_url,
            topics: r.topics,
            private: r.private,
          };
        },
      },

      {
        name: 'github_repos',
        description: 'List repositories for a user',
        inputSchema: {
          type: 'object',
          properties: {
            username: { type: 'string', description: 'GitHub username' },
            sort: { type: 'string', description: 'Sort by: stars, updated, created, name', default: 'updated' },
            per_page: { type: 'number', description: 'Results per page (max 100)', default: 30 },
          },
          required: ['username'],
        },
        handler: async (input: { username: string; sort?: string; per_page?: number }) => {
          const token = await this.getToken();
          const sort = input.sort ?? 'updated';
          const perPage = Math.min(input.per_page ?? 30, 100);
          const repos = await this.ghFetch(
            `/users/${encodeURIComponent(input.username)}/repos?sort=${sort}&per_page=${perPage}`,
            { token },
          );
          return (repos as any[]).map((r) => ({
            name: r.name,
            description: r.description,
            language: r.language,
            stars: r.stargazers_count,
            forks: r.forks_count,
            updated: r.updated_at,
            url: r.html_url,
            private: r.private,
          }));
        },
      },

      {
        name: 'github_trending',
        description: 'Search trending/popular repositories by query and optional language filter',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (e.g. "machine learning", "typescript cli")' },
            language: { type: 'string', description: 'Filter by language (e.g. typescript, python)' },
            per_page: { type: 'number', description: 'Results per page (default 10, max 30)', default: 10 },
          },
          required: ['query'],
        },
        handler: async (input: { query: string; language?: string; per_page?: number }) => {
          const token = await this.getToken();
          let q = encodeURIComponent(input.query);
          if (input.language) q += `+language:${encodeURIComponent(input.language)}`;
          const perPage = Math.min(input.per_page ?? 10, 30);
          const data = await this.ghFetch(`/search/repositories?q=${q}&sort=stars&per_page=${perPage}`, { token });
          return (data.items as any[]).map((r) => ({
            name: r.full_name,
            description: r.description,
            language: r.language,
            stars: r.stargazers_count,
            forks: r.forks_count,
            url: r.html_url,
          }));
        },
      },

      // ── Issues ──────────────────────────────────────────────────────────

      {
        name: 'github_issues',
        description: 'List issues for a repository with optional filters',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state (default: open)' },
            label: { type: 'string', description: 'Filter by label name' },
            assignee: { type: 'string', description: 'Filter by assignee username' },
            per_page: { type: 'number', description: 'Results per page (default 25, max 100)' },
          },
          required: ['owner', 'repo'],
        },
        handler: async (input: {
          owner: string;
          repo: string;
          state?: string;
          label?: string;
          assignee?: string;
          per_page?: number;
        }) => {
          const token = await this.getToken();
          const params = new URLSearchParams({
            state: input.state ?? 'open',
            per_page: String(Math.min(input.per_page ?? 25, 100)),
          });
          if (input.label) params.set('labels', input.label);
          if (input.assignee) params.set('assignee', input.assignee);
          const issues = await this.ghFetch(
            `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues?${params}`,
            { token },
          );
          return (issues as any[])
            .filter((i) => !i.pull_request)
            .map((i) => ({
              number: i.number,
              title: i.title,
              state: i.state,
              author: i.user?.login,
              assignees: i.assignees?.map((a: any) => a.login),
              labels: i.labels?.map((l: any) => l.name),
              comments: i.comments,
              created: i.created_at,
              updated: i.updated_at,
              url: i.html_url,
            }));
        },
      },

      {
        name: 'github_issue',
        description: 'Get a single issue by number',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            issue_number: { type: 'number', description: 'Issue number' },
          },
          required: ['owner', 'repo', 'issue_number'],
        },
        handler: async (input: { owner: string; repo: string; issue_number: number }) => {
          const token = await this.getToken();
          const i = await this.ghFetch(
            `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.issue_number}`,
            { token },
          );
          return {
            number: i.number,
            title: i.title,
            state: i.state,
            body: i.body,
            author: i.user?.login,
            assignees: i.assignees?.map((a: any) => a.login),
            labels: i.labels?.map((l: any) => l.name),
            milestone: i.milestone?.title,
            comments: i.comments,
            created: i.created_at,
            updated: i.updated_at,
            closed_at: i.closed_at,
            url: i.html_url,
          };
        },
      },

      {
        name: 'github_create_issue',
        description: 'Create a new issue in a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            title: { type: 'string', description: 'Issue title' },
            body: { type: 'string', description: 'Issue body (markdown)' },
            labels: { type: 'array', items: { type: 'string' }, description: 'Label names to add' },
            assignees: { type: 'array', items: { type: 'string' }, description: 'Usernames to assign' },
          },
          required: ['owner', 'repo', 'title'],
        },
        requiresApproval: true,
        handler: async (input: {
          owner: string;
          repo: string;
          title: string;
          body?: string;
          labels?: string[];
          assignees?: string[];
        }) => {
          const token = await this.getToken();
          if (!token) throw new Error('GitHub token required to create issues');
          const issue = await this.ghFetch(
            `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues`,
            {
              method: 'POST',
              token,
              body: { title: input.title, body: input.body, labels: input.labels, assignees: input.assignees },
            },
          );
          return { number: issue.number, url: issue.html_url, title: issue.title };
        },
      },

      {
        name: 'github_close_issue',
        description: 'Close an open issue',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            issue_number: { type: 'number', description: 'Issue number to close' },
            reason: { type: 'string', enum: ['completed', 'not_planned'], description: 'Close reason' },
          },
          required: ['owner', 'repo', 'issue_number'],
        },
        requiresApproval: true,
        handler: async (input: { owner: string; repo: string; issue_number: number; reason?: string }) => {
          const token = await this.getToken();
          if (!token) throw new Error('GitHub token required to close issues');
          await this.ghFetch(
            `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.issue_number}`,
            {
              method: 'PATCH',
              token,
              body: { state: 'closed', state_reason: input.reason ?? 'completed' },
            },
          );
          return { closed: true, issue_number: input.issue_number };
        },
      },

      {
        name: 'github_comment_issue',
        description: 'Add a comment to an issue or pull request',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            issue_number: { type: 'number', description: 'Issue or PR number' },
            body: { type: 'string', description: 'Comment text (markdown)' },
          },
          required: ['owner', 'repo', 'issue_number', 'body'],
        },
        requiresApproval: true,
        handler: async (input: { owner: string; repo: string; issue_number: number; body: string }) => {
          const token = await this.getToken();
          if (!token) throw new Error('GitHub token required to post comments');
          const comment = await this.ghFetch(
            `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.issue_number}/comments`,
            { method: 'POST', token, body: { body: input.body } },
          );
          return { comment_id: comment.id, url: comment.html_url };
        },
      },

      // ── Pull requests ────────────────────────────────────────────────────

      {
        name: 'github_prs',
        description: 'List pull requests for a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'PR state (default: open)' },
            base: { type: 'string', description: 'Filter by base branch name' },
            per_page: { type: 'number', description: 'Results per page (default 25, max 100)' },
          },
          required: ['owner', 'repo'],
        },
        handler: async (input: { owner: string; repo: string; state?: string; base?: string; per_page?: number }) => {
          const token = await this.getToken();
          const params = new URLSearchParams({
            state: input.state ?? 'open',
            per_page: String(Math.min(input.per_page ?? 25, 100)),
          });
          if (input.base) params.set('base', input.base);
          const prs = await this.ghFetch(
            `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls?${params}`,
            { token },
          );
          return (prs as any[]).map((p) => ({
            number: p.number,
            title: p.title,
            state: p.state,
            author: p.user?.login,
            head: p.head?.ref,
            base: p.base?.ref,
            draft: p.draft,
            mergeable: p.mergeable,
            reviews_requested: p.requested_reviewers?.map((r: any) => r.login),
            created: p.created_at,
            updated: p.updated_at,
            url: p.html_url,
          }));
        },
      },

      {
        name: 'github_pr',
        description: 'Get detailed PR info including diff stats, reviewers, and checks',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            pr_number: { type: 'number', description: 'Pull request number' },
          },
          required: ['owner', 'repo', 'pr_number'],
        },
        handler: async (input: { owner: string; repo: string; pr_number: number }) => {
          const token = await this.getToken();
          const base = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;
          const [p, reviews] = await Promise.all([
            this.ghFetch(`${base}/pulls/${input.pr_number}`, { token }),
            this.ghFetch(`${base}/pulls/${input.pr_number}/reviews`, { token }).catch(() => []),
          ]);
          return {
            number: p.number,
            title: p.title,
            state: p.state,
            author: p.user?.login,
            body: p.body,
            head: p.head?.ref,
            base: p.base?.ref,
            draft: p.draft,
            mergeable: p.mergeable,
            additions: p.additions,
            deletions: p.deletions,
            changed_files: p.changed_files,
            commits: p.commits,
            requested_reviewers: p.requested_reviewers?.map((r: any) => r.login),
            reviews: (reviews as any[]).map((r: any) => ({ reviewer: r.user?.login, state: r.state })),
            created: p.created_at,
            updated: p.updated_at,
            merged: p.merged,
            merged_at: p.merged_at,
            url: p.html_url,
          };
        },
      },

      {
        name: 'github_create_pr',
        description: 'Create a new pull request',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            title: { type: 'string', description: 'PR title' },
            body: { type: 'string', description: 'PR description (markdown)' },
            head: { type: 'string', description: 'Head branch (source)' },
            base: { type: 'string', description: 'Base branch (target, e.g. main)' },
            draft: { type: 'boolean', description: 'Create as draft PR', default: false },
          },
          required: ['owner', 'repo', 'title', 'head', 'base'],
        },
        requiresApproval: true,
        handler: async (input: {
          owner: string;
          repo: string;
          title: string;
          body?: string;
          head: string;
          base: string;
          draft?: boolean;
        }) => {
          const token = await this.getToken();
          if (!token) throw new Error('GitHub token required to create pull requests');
          const pr = await this.ghFetch(
            `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls`,
            {
              method: 'POST',
              token,
              body: {
                title: input.title,
                body: input.body,
                head: input.head,
                base: input.base,
                draft: input.draft ?? false,
              },
            },
          );
          return { number: pr.number, url: pr.html_url, title: pr.title };
        },
      },

      {
        name: 'github_merge_pr',
        description: 'Merge a pull request',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            pr_number: { type: 'number', description: 'Pull request number' },
            merge_method: {
              type: 'string',
              enum: ['merge', 'squash', 'rebase'],
              description: 'Merge method (default: merge)',
            },
            commit_message: { type: 'string', description: 'Optional commit message' },
          },
          required: ['owner', 'repo', 'pr_number'],
        },
        requiresApproval: true,
        handler: async (input: {
          owner: string;
          repo: string;
          pr_number: number;
          merge_method?: string;
          commit_message?: string;
        }) => {
          const token = await this.getToken();
          if (!token) throw new Error('GitHub token required to merge pull requests');
          const result = await this.ghFetch(
            `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls/${input.pr_number}/merge`,
            {
              method: 'PUT',
              token,
              body: {
                merge_method: input.merge_method ?? 'merge',
                commit_message: input.commit_message,
              },
            },
          );
          return { merged: result?.merged ?? true, sha: result?.sha, message: result?.message };
        },
      },

      // ── Code & files ─────────────────────────────────────────────────────

      {
        name: 'github_search_code',
        description: 'Search code across GitHub repositories',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (e.g. "useState repo:facebook/react")' },
            per_page: { type: 'number', description: 'Results per page (default 10, max 30)' },
          },
          required: ['query'],
        },
        handler: async (input: { query: string; per_page?: number }) => {
          const token = await this.getToken();
          const perPage = Math.min(input.per_page ?? 10, 30);
          const data = await this.ghFetch(`/search/code?q=${encodeURIComponent(input.query)}&per_page=${perPage}`, {
            token,
          });
          return {
            total_count: data.total_count,
            results: (data.items as any[]).map((i) => ({
              name: i.name,
              path: i.path,
              repo: i.repository?.full_name,
              url: i.html_url,
              sha: i.sha,
            })),
          };
        },
      },

      {
        name: 'github_file',
        description: 'Get file contents from a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            path: { type: 'string', description: 'File path in the repository (e.g. "src/index.ts")' },
            ref: { type: 'string', description: 'Branch, tag, or commit SHA (default: default branch)' },
          },
          required: ['owner', 'repo', 'path'],
        },
        handler: async (input: { owner: string; repo: string; path: string; ref?: string }) => {
          const token = await this.getToken();
          const params = input.ref ? `?ref=${encodeURIComponent(input.ref)}` : '';
          const data = await this.ghFetch(
            `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${input.path}${params}`,
            { token },
          );
          if (Array.isArray(data)) {
            // It's a directory listing
            return {
              type: 'directory',
              path: input.path,
              entries: data.map((e: any) => ({ name: e.name, type: e.type, size: e.size, path: e.path })),
            };
          }
          const content =
            data.encoding === 'base64' ? Buffer.from(data.content, 'base64').toString('utf-8') : data.content;
          return {
            type: 'file',
            name: data.name,
            path: data.path,
            size: data.size,
            sha: data.sha,
            content: content.slice(0, 50000), // cap at 50 KB
            encoding: data.encoding,
          };
        },
      },

      // ── Commits ──────────────────────────────────────────────────────────

      {
        name: 'github_commits',
        description: 'List commits for a repository or branch',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            branch: { type: 'string', description: 'Branch name (default: default branch)' },
            author: { type: 'string', description: 'Filter by author username or email' },
            per_page: { type: 'number', description: 'Results per page (default 20, max 100)' },
          },
          required: ['owner', 'repo'],
        },
        handler: async (input: {
          owner: string;
          repo: string;
          branch?: string;
          author?: string;
          per_page?: number;
        }) => {
          const token = await this.getToken();
          const params = new URLSearchParams({
            per_page: String(Math.min(input.per_page ?? 20, 100)),
          });
          if (input.branch) params.set('sha', input.branch);
          if (input.author) params.set('author', input.author);
          const commits = await this.ghFetch(
            `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/commits?${params}`,
            { token },
          );
          return (commits as any[]).map((c) => ({
            sha: c.sha?.slice(0, 8),
            message: c.commit?.message?.split('\n')[0],
            author: c.commit?.author?.name,
            date: c.commit?.author?.date,
            url: c.html_url,
          }));
        },
      },

      // ── Releases ─────────────────────────────────────────────────────────

      {
        name: 'github_releases',
        description: 'List releases for a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            per_page: { type: 'number', description: 'Results per page (default 10, max 30)' },
          },
          required: ['owner', 'repo'],
        },
        handler: async (input: { owner: string; repo: string; per_page?: number }) => {
          const token = await this.getToken();
          const perPage = Math.min(input.per_page ?? 10, 30);
          const releases = await this.ghFetch(
            `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/releases?per_page=${perPage}`,
            { token },
          );
          return (releases as any[]).map((r) => ({
            id: r.id,
            tag: r.tag_name,
            name: r.name,
            prerelease: r.prerelease,
            draft: r.draft,
            body: r.body?.slice(0, 2000),
            author: r.author?.login,
            created: r.created_at,
            published: r.published_at,
            url: r.html_url,
            assets: r.assets?.map((a: any) => ({ name: a.name, size: a.size, downloads: a.download_count })),
          }));
        },
      },

      {
        name: 'github_create_release',
        description: 'Create a new release/tag for a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            tag_name: { type: 'string', description: 'Tag name (e.g. v1.2.0)' },
            name: { type: 'string', description: 'Release name/title' },
            body: { type: 'string', description: 'Release notes (markdown)' },
            draft: { type: 'boolean', description: 'Create as draft', default: false },
            prerelease: { type: 'boolean', description: 'Mark as pre-release', default: false },
            target_commitish: { type: 'string', description: 'Branch or SHA to tag (default: default branch)' },
          },
          required: ['owner', 'repo', 'tag_name'],
        },
        requiresApproval: true,
        handler: async (input: {
          owner: string;
          repo: string;
          tag_name: string;
          name?: string;
          body?: string;
          draft?: boolean;
          prerelease?: boolean;
          target_commitish?: string;
        }) => {
          const token = await this.getToken();
          if (!token) throw new Error('GitHub token required to create releases');
          const release = await this.ghFetch(
            `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/releases`,
            {
              method: 'POST',
              token,
              body: {
                tag_name: input.tag_name,
                name: input.name,
                body: input.body,
                draft: input.draft ?? false,
                prerelease: input.prerelease ?? false,
                target_commitish: input.target_commitish,
              },
            },
          );
          return { id: release.id, tag: release.tag_name, url: release.html_url };
        },
      },

      // ── Social ───────────────────────────────────────────────────────────

      {
        name: 'github_star',
        description: 'Star a GitHub repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
          },
          required: ['owner', 'repo'],
        },
        requiresApproval: true,
        handler: async (input: { owner: string; repo: string }) => {
          const token = await this.getToken();
          if (!token) throw new Error('GitHub token required to star repositories');
          await this.ghFetch(`/user/starred/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`, {
            method: 'PUT',
            token,
          });
          return { starred: true, repo: `${input.owner}/${input.repo}` };
        },
      },

      {
        name: 'github_fork',
        description: 'Fork a GitHub repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            organization: {
              type: 'string',
              description: 'Fork into this organization (optional, defaults to your account)',
            },
          },
          required: ['owner', 'repo'],
        },
        requiresApproval: true,
        handler: async (input: { owner: string; repo: string; organization?: string }) => {
          const token = await this.getToken();
          if (!token) throw new Error('GitHub token required to fork repositories');
          const fork = await this.ghFetch(
            `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/forks`,
            {
              method: 'POST',
              token,
              body: input.organization ? { organization: input.organization } : {},
            },
          );
          return { name: fork.full_name, url: fork.html_url, cloneUrl: fork.clone_url };
        },
      },

      // ── Authenticated user ───────────────────────────────────────────────

      {
        name: 'github_notifications',
        description: 'List unread GitHub notifications (requires authentication)',
        inputSchema: {
          type: 'object',
          properties: {
            all: { type: 'boolean', description: 'Include read notifications', default: false },
            per_page: { type: 'number', description: 'Results per page (default 20, max 50)' },
          },
        },
        handler: async (input: { all?: boolean; per_page?: number }) => {
          const token = await this.getToken();
          if (!token) throw new Error('GitHub token required to read notifications');
          const params = new URLSearchParams({
            all: String(input.all ?? false),
            per_page: String(Math.min(input.per_page ?? 20, 50)),
          });
          const notifications = await this.ghFetch(`/notifications?${params}`, { token });
          return (notifications as any[]).map((n) => ({
            id: n.id,
            unread: n.unread,
            reason: n.reason,
            subject_type: n.subject?.type,
            subject_title: n.subject?.title,
            repo: n.repository?.full_name,
            updated: n.updated_at,
          }));
        },
      },

      {
        name: 'github_my_repos',
        description: "List the authenticated user's repositories (requires authentication)",
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['all', 'public', 'private', 'forks', 'sources'],
              description: 'Repository type filter (default: all)',
            },
            sort: { type: 'string', enum: ['created', 'updated', 'pushed', 'full_name'], description: 'Sort order' },
            per_page: { type: 'number', description: 'Results per page (default 30, max 100)' },
          },
        },
        handler: async (input: { type?: string; sort?: string; per_page?: number }) => {
          const token = await this.getToken();
          if (!token) throw new Error('GitHub token required to list your repositories');
          const params = new URLSearchParams({
            type: input.type ?? 'all',
            sort: input.sort ?? 'updated',
            per_page: String(Math.min(input.per_page ?? 30, 100)),
          });
          const repos = await this.ghFetch(`/user/repos?${params}`, { token });
          return (repos as any[]).map((r) => ({
            name: r.name,
            full_name: r.full_name,
            private: r.private,
            description: r.description,
            language: r.language,
            stars: r.stargazers_count,
            forks: r.forks_count,
            updated: r.updated_at,
            url: r.html_url,
          }));
        },
      },

      {
        name: 'github_gists',
        description: 'List public gists for a user',
        inputSchema: {
          type: 'object',
          properties: {
            username: { type: 'string', description: 'GitHub username (omit to list your own gists, requires auth)' },
            per_page: { type: 'number', description: 'Results per page (default 20, max 100)' },
          },
        },
        handler: async (input: { username?: string; per_page?: number }) => {
          const token = await this.getToken();
          const perPage = Math.min(input.per_page ?? 20, 100);
          const path = input.username
            ? `/users/${encodeURIComponent(input.username)}/gists?per_page=${perPage}`
            : `/gists?per_page=${perPage}`;
          const gists = await this.ghFetch(path, { token });
          return (gists as any[]).map((g) => ({
            id: g.id,
            description: g.description,
            public: g.public,
            files: Object.keys(g.files ?? {}),
            owner: g.owner?.login,
            created: g.created_at,
            updated: g.updated_at,
            url: g.html_url,
          }));
        },
      },
    ];
  }
}
