/**
 * Jira Plugin — Conductor
 *
 * Search issues, create/update tickets, add comments, list projects,
 * and transition issues using the Jira Cloud REST API v3.
 *
 * Setup:
 *   1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
 *   2. Create an API token
 *   3. Your domain is the subdomain of your Jira URL (e.g. "acme" for acme.atlassian.net)
 *
 * Keychain entry: jira / api_token
 * Config entries: jira.domain, jira.email
 */

import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

export class JiraPlugin implements Plugin {
  name = 'jira';
  description = 'Search Jira issues, create/update tickets, add comments, and transition issues';
  version = '1.0.0';

  private keychain!: Keychain;
  private conductor!: Conductor;

  configSchema = {
    fields: [
      {
        key: 'domain',
        label: 'Jira Domain',
        type: 'string' as const,
        required: true,
        description: 'Your Atlassian subdomain (e.g. acme for acme.atlassian.net)',
      },
      {
        key: 'email',
        label: 'Atlassian Account Email',
        type: 'string' as const,
        required: true,
        description: 'The email you use to log into Jira',
      },
      {
        key: 'api_token',
        label: 'API Token',
        type: 'password' as const,
        required: true,
        secret: true,
        service: 'jira',
        description: 'Create at https://id.atlassian.com/manage-profile/security/api-tokens',
      },
    ],
    setupInstructions:
      'Create a Jira API token at https://id.atlassian.com/manage-profile/security/api-tokens. Your domain is the subdomain before .atlassian.net.',
  };

  async initialize(conductor: Conductor): Promise<void> {
    this.keychain = new Keychain(conductor.getConfig().getConfigDir());
    this.conductor = conductor;
  }

  isConfigured(): boolean {
    return true;
  }

  private async getCredentials(): Promise<{ domain: string; email: string; token: string }> {
    const config = this.conductor.getConfig();
    const domain = config.get<string>('plugins.jira.domain');
    const email = config.get<string>('plugins.jira.email');
    const token = await this.keychain.get('jira', 'api_token');

    if (!domain || !email || !token) {
      throw new Error('Jira not configured. Run: conductor plugins setup jira');
    }
    return { domain, email, token };
  }

  private async jiraFetch(path: string, body?: Record<string, unknown>, method = 'GET'): Promise<any> {
    const { domain, email, token } = await this.getCredentials();
    const auth = Buffer.from(`${email}:${token}`).toString('base64');
    const base = `https://${domain}.atlassian.net/rest/api/3`;

    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Jira API error ${res.status}: ${err}`);
    }

    if (res.status === 204) return { ok: true };
    return res.json();
  }

  private formatIssue(i: any) {
    return {
      id: i.id,
      key: i.key,
      summary: i.fields?.summary,
      status: i.fields?.status?.name,
      statusCategory: i.fields?.status?.statusCategory?.name,
      priority: i.fields?.priority?.name,
      assignee: i.fields?.assignee?.displayName ?? null,
      reporter: i.fields?.reporter?.displayName ?? null,
      type: i.fields?.issuetype?.name,
      project: i.fields?.project?.key,
      created: i.fields?.created,
      updated: i.fields?.updated,
      labels: i.fields?.labels ?? [],
      url: `https://${i.self?.split('/rest/')[0]?.split('https://')[1]}/browse/${i.key}`,
    };
  }

  getTools(): PluginTool[] {
    return [
      // ── Search / list ─────────────────────────────────────────────────────
      {
        name: 'jira_issues',
        description: 'Search Jira issues using JQL (Jira Query Language)',
        inputSchema: {
          type: 'object',
          properties: {
            jql: {
              type: 'string',
              description:
                'JQL query. Examples: "assignee = currentUser()", "project = ENG AND status = \\"In Progress\\"", "sprint in openSprints()"',
            },
            max: { type: 'number', description: 'Max results (default 20, max 50)' },
          },
          required: ['jql'],
        },
        handler: async ({ jql, max = 20 }: any) => {
          const data = await this.jiraFetch(
            `/search?jql=${encodeURIComponent(jql)}&maxResults=${Math.min(max, 50)}&fields=summary,status,priority,assignee,reporter,issuetype,project,created,updated,labels`,
          );
          return {
            total: data.total,
            count: data.issues.length,
            issues: data.issues.map(this.formatIssue.bind(this)),
          };
        },
      },

      {
        name: 'jira_my_issues',
        description: 'List issues assigned to the current user (open issues)',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Filter by project key (optional)' },
            max: { type: 'number', description: 'Max results (default 25)' },
          },
        },
        handler: async ({ project, max = 25 }: any) => {
          let jql = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';
          if (project) jql = `project = ${project} AND ` + jql;
          const data = await this.jiraFetch(
            `/search?jql=${encodeURIComponent(jql)}&maxResults=${Math.min(max, 50)}&fields=summary,status,priority,assignee,issuetype,project,updated`,
          );
          return {
            total: data.total,
            count: data.issues.length,
            issues: data.issues.map(this.formatIssue.bind(this)),
          };
        },
      },

      {
        name: 'jira_issue',
        description: 'Get a single Jira issue by key (e.g. ENG-123)',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Issue key (e.g. ENG-123)' },
          },
          required: ['key'],
        },
        handler: async ({ key }: any) => {
          const i = await this.jiraFetch(
            `/issue/${key}?fields=summary,status,priority,assignee,reporter,issuetype,project,created,updated,labels,description,comment`,
          );
          const base = this.formatIssue(i);
          const comments = (i.fields?.comment?.comments ?? []).slice(-5).map((c: any) => ({
            author: c.author?.displayName,
            created: c.created,
            body: c.body?.content?.[0]?.content?.[0]?.text ?? '',
          }));
          return { ...base, comments };
        },
      },

      // ── Create / update ───────────────────────────────────────────────────
      {
        name: 'jira_create_issue',
        description: 'Create a new Jira issue',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Project key (e.g. ENG)' },
            summary: { type: 'string', description: 'Issue title/summary' },
            description: { type: 'string', description: 'Detailed description (plain text)' },
            issue_type: {
              type: 'string',
              description: 'Issue type: Task, Bug, Story, Epic (default: Task)',
            },
            priority: {
              type: 'string',
              description: 'Priority: Highest, High, Medium, Low, Lowest',
            },
            assignee: { type: 'string', description: 'Assignee account ID' },
            labels: { type: 'array', items: { type: 'string' }, description: 'Labels to add' },
          },
          required: ['project', 'summary'],
        },
        requiresApproval: true,
        handler: async ({ project, summary, description, issue_type = 'Task', priority, assignee, labels }: any) => {
          const fields: Record<string, unknown> = {
            project: { key: project },
            summary,
            issuetype: { name: issue_type },
          };

          if (description) {
            fields.description = {
              type: 'doc',
              version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }],
            };
          }
          if (priority) fields.priority = { name: priority };
          if (assignee) fields.assignee = { accountId: assignee };
          if (labels?.length) fields.labels = labels;

          const data = await this.jiraFetch('/issue', { fields }, 'POST');
          return { id: data.id, key: data.key, url: data.self };
        },
      },

      {
        name: 'jira_update_issue',
        description: 'Update a Jira issue fields (summary, priority, assignee)',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Issue key (e.g. ENG-123)' },
            summary: { type: 'string', description: 'New summary' },
            priority: { type: 'string', description: 'New priority: Highest, High, Medium, Low, Lowest' },
            assignee: { type: 'string', description: 'New assignee account ID (null to unassign)' },
            labels: { type: 'array', items: { type: 'string' }, description: 'Replace labels with these' },
          },
          required: ['key'],
        },
        requiresApproval: true,
        handler: async ({ key, summary, priority, assignee, labels }: any) => {
          const fields: Record<string, unknown> = {};
          if (summary) fields.summary = summary;
          if (priority) fields.priority = { name: priority };
          if (assignee !== undefined) fields.assignee = assignee ? { accountId: assignee } : null;
          if (labels) fields.labels = labels;

          await this.jiraFetch(`/issue/${key}`, { fields }, 'PUT');
          return { ok: true, key, updated: Object.keys(fields) };
        },
      },

      // ── Comments ──────────────────────────────────────────────────────────
      {
        name: 'jira_comment',
        description: 'Add a comment to a Jira issue',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Issue key (e.g. ENG-123)' },
            body: { type: 'string', description: 'Comment text' },
          },
          required: ['key', 'body'],
        },
        requiresApproval: true,
        handler: async ({ key, body }: any) => {
          const data = await this.jiraFetch(
            `/issue/${key}/comment`,
            {
              body: {
                type: 'doc',
                version: 1,
                content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }],
              },
            },
            'POST',
          );
          return { id: data.id, author: data.author?.displayName, created: data.created };
        },
      },

      // ── Projects ──────────────────────────────────────────────────────────
      {
        name: 'jira_projects',
        description: 'List all accessible Jira projects',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const data = await this.jiraFetch('/project/search?maxResults=50&orderBy=name');
          return {
            count: data.values.length,
            projects: data.values.map((p: any) => ({
              id: p.id,
              key: p.key,
              name: p.name,
              type: p.projectTypeKey,
              lead: p.lead?.displayName,
            })),
          };
        },
      },

      // ── Transitions ───────────────────────────────────────────────────────
      {
        name: 'jira_transitions',
        description: 'List available transitions (status moves) for a Jira issue',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Issue key (e.g. ENG-123)' },
          },
          required: ['key'],
        },
        handler: async ({ key }: any) => {
          const data = await this.jiraFetch(`/issue/${key}/transitions`);
          return {
            issue: key,
            transitions: data.transitions.map((t: any) => ({
              id: t.id,
              name: t.name,
              to: t.to?.name,
              category: t.to?.statusCategory?.name,
            })),
          };
        },
      },

      {
        name: 'jira_transition_issue',
        description: 'Move a Jira issue to a new status using a transition ID',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Issue key (e.g. ENG-123)' },
            transition_id: { type: 'string', description: 'Transition ID (get with jira_transitions)' },
            comment: { type: 'string', description: 'Optional comment to add when transitioning' },
          },
          required: ['key', 'transition_id'],
        },
        requiresApproval: true,
        handler: async ({ key, transition_id, comment }: any) => {
          const body: Record<string, unknown> = { transition: { id: transition_id } };
          if (comment) {
            body.update = {
              comment: [
                {
                  add: {
                    body: {
                      type: 'doc',
                      version: 1,
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }],
                    },
                  },
                },
              ],
            };
          }
          await this.jiraFetch(`/issue/${key}/transitions`, body, 'POST');
          return { ok: true, key, transitioned: transition_id };
        },
      },
    ];
  }
}
