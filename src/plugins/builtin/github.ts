import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';

export class GitHubPlugin implements Plugin {
  name = 'github';
  description = 'GitHub repositories, issues, stars, user info (public data free, private needs token)';
  version = '1.0.0';

  async initialize(_conductor: Conductor): Promise<void> {}
  isConfigured(): boolean { return true; } // Works for public data without token

  private async ghFetch(path: string, token?: string): Promise<any> {
    const headers: Record<string, string> = { 'Accept': 'application/vnd.github+json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com${path}`, { headers });
    if (!res.ok) throw new Error(`GitHub API: ${res.status} ${res.statusText}`);
    return res.json();
  }

  getTools(): PluginTool[] {
    return [
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
            login: u.login, name: u.name, bio: u.bio,
            public_repos: u.public_repos, followers: u.followers, following: u.following,
            created: u.created_at, url: u.html_url, avatar: u.avatar_url,
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
          const r = await this.ghFetch(`/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`);
          return {
            name: r.full_name, description: r.description, language: r.language,
            stars: r.stargazers_count, forks: r.forks_count, open_issues: r.open_issues_count,
            license: r.license?.spdx_id, created: r.created_at, updated: r.updated_at,
            default_branch: r.default_branch, url: r.html_url,
            topics: r.topics,
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
          },
          required: ['username'],
        },
        handler: async (input: { username: string; sort?: string }) => {
          const sort = input.sort || 'updated';
          const repos = await this.ghFetch(`/users/${encodeURIComponent(input.username)}/repos?sort=${sort}&per_page=20`);
          return repos.map((r: any) => ({
            name: r.name, description: r.description, language: r.language,
            stars: r.stargazers_count, forks: r.forks_count, updated: r.updated_at,
            url: r.html_url,
          }));
        },
      },
      {
        name: 'github_trending',
        description: 'Search trending/popular repositories',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (e.g. "machine learning", "typescript cli")' },
            language: { type: 'string', description: 'Filter by language (e.g. typescript, python)' },
          },
          required: ['query'],
        },
        handler: async (input: { query: string; language?: string }) => {
          let q = encodeURIComponent(input.query);
          if (input.language) q += `+language:${encodeURIComponent(input.language)}`;
          const data = await this.ghFetch(`/search/repositories?q=${q}&sort=stars&per_page=10`);
          return data.items.map((r: any) => ({
            name: r.full_name, description: r.description, language: r.language,
            stars: r.stargazers_count, forks: r.forks_count, url: r.html_url,
          }));
        },
      },
    ];
  }
}
