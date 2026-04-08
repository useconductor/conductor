/**
 * Linear Plugin — Conductor
 *
 * Interact with Linear issues, teams, projects, and cycles via the
 * Linear GraphQL API. Requires a personal API key.
 *
 * Setup: Linear Settings > API > Personal API Keys
 * Keychain entry: linear / api_key
 */

import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

const LINEAR_GRAPHQL = 'https://api.linear.app/graphql';

export class LinearPlugin implements Plugin {
  name = 'linear';
  description = 'Manage Linear issues, teams, projects, and cycles — requires Linear API key';
  version = '1.0.0';

  configSchema = {
    fields: [
      {
        key: 'api_key',
        label: 'Linear API Key',
        type: 'password' as const,
        required: true,
        secret: true,
        service: 'linear',
        description: 'Create a personal API key at Linear Settings > API > Personal API Keys.',
      },
    ],
    setupInstructions:
      'Get your API key from Linear Settings > API > Personal API Keys. The key starts with "lin_api_".',
  };

  private keychain!: Keychain;

  async initialize(conductor: Conductor): Promise<void> {
    this.keychain = new Keychain(conductor.getConfig().getConfigDir());
  }

  isConfigured(): boolean {
    return true; // check at tool call time
  }

  private async getApiKey(): Promise<string> {
    const key = await this.keychain.get('linear', 'api_key');
    if (!key) {
      throw new Error('Linear API key not configured. Run: conductor plugins setup linear');
    }
    return key;
  }

  private async linearQuery(query: string, variables?: Record<string, any>): Promise<any> {
    const apiKey = await this.getApiKey();
    const res = await fetch(LINEAR_GRAPHQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Linear API ${res.status}: ${errText}`);
    }
    const json = (await res.json()) as { errors?: { message: string }[]; data?: unknown };
    if (json.errors?.length) {
      throw new Error(`Linear GraphQL error: ${json.errors.map((e) => e.message).join(', ')}`);
    }
    return json.data;
  }

  getTools(): PluginTool[] {
    return [
      // ── Me ───────────────────────────────────────────────────────────────

      {
        name: 'linear_me',
        description: 'Get current Linear user info',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const data = await this.linearQuery(`query { viewer { id name email displayName avatarUrl createdAt } }`);
          return data.viewer;
        },
      },

      // ── Teams ────────────────────────────────────────────────────────────

      {
        name: 'linear_teams',
        description: 'List all teams in the Linear workspace',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const data = await this.linearQuery(`
            query {
              teams {
                nodes { id key name description memberCount createdAt }
              }
            }
          `);
          return data.teams.nodes;
        },
      },

      // ── Issues ───────────────────────────────────────────────────────────

      {
        name: 'linear_issues',
        description: 'List issues with optional filters (team, state, assignee, priority)',
        inputSchema: {
          type: 'object',
          properties: {
            team_key: { type: 'string', description: 'Team key (e.g. "ENG") — use linear_teams to find keys' },
            state: { type: 'string', description: 'State name filter (e.g. "In Progress", "Todo")' },
            assignee_name: { type: 'string', description: 'Assignee display name filter' },
            priority: {
              type: 'number',
              description: 'Priority filter: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low',
            },
            first: { type: 'number', description: 'Number of issues to return (default 25, max 50)' },
          },
        },
        handler: async (input: {
          team_key?: string;
          state?: string;
          assignee_name?: string;
          priority?: number;
          first?: number;
        }) => {
          const filterParts: string[] = [];
          if (input.team_key) filterParts.push(`team: { key: { eq: "${input.team_key}" } }`);
          if (input.state) filterParts.push(`state: { name: { eq: "${input.state}" } }`);
          if (input.assignee_name) filterParts.push(`assignee: { displayName: { eq: "${input.assignee_name}" } }`);
          if (input.priority !== undefined) filterParts.push(`priority: { eq: ${input.priority} }`);

          const filterArg = filterParts.length ? `filter: { ${filterParts.join(', ')} }` : '';
          const first = Math.min(input.first ?? 25, 50);

          const data = await this.linearQuery(`
            query {
              issues(${filterArg}, first: ${first}, orderBy: updatedAt) {
                nodes {
                  id identifier title
                  state { name color }
                  priority priorityLabel
                  assignee { name displayName }
                  team { key name }
                  createdAt updatedAt
                  url
                }
              }
            }
          `);
          return data.issues.nodes.map((i: any) => ({
            id: i.id,
            identifier: i.identifier,
            title: i.title,
            state: i.state?.name,
            priority: i.priorityLabel,
            assignee: i.assignee?.displayName ?? i.assignee?.name,
            team: i.team?.key,
            created: i.createdAt,
            updated: i.updatedAt,
            url: i.url,
          }));
        },
      },

      {
        name: 'linear_issue',
        description: 'Get detailed info for a single issue by ID or identifier (e.g. ENG-123)',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Issue UUID or identifier like "ENG-123"' },
          },
          required: ['id'],
        },
        handler: async (input: { id: string }) => {
          // Linear accepts both UUIDs and identifiers in the issue() query
          const data = await this.linearQuery(
            `
            query($id: String!) {
              issue(id: $id) {
                id identifier title description
                state { name }
                priority priorityLabel
                assignee { name displayName email }
                team { key name }
                labels { nodes { name color } }
                comments { nodes { body user { name } createdAt } }
                createdAt updatedAt dueDate
                url
              }
            }
          `,
            { id: input.id },
          );
          const i = data.issue;
          return {
            id: i.id,
            identifier: i.identifier,
            title: i.title,
            description: i.description,
            state: i.state?.name,
            priority: i.priorityLabel,
            assignee: i.assignee?.displayName ?? i.assignee?.name,
            team: i.team?.key,
            labels: i.labels?.nodes?.map((l: any) => l.name),
            comments: i.comments?.nodes?.map((c: any) => ({
              body: c.body,
              author: c.user?.name,
              created: c.createdAt,
            })),
            created: i.createdAt,
            updated: i.updatedAt,
            due: i.dueDate,
            url: i.url,
          };
        },
      },

      {
        name: 'linear_create_issue',
        description: 'Create a new Linear issue',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Issue title' },
            description: { type: 'string', description: 'Issue description (markdown)' },
            team_key: { type: 'string', description: 'Team key (e.g. "ENG") — required' },
            priority: {
              type: 'number',
              description: 'Priority: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low',
            },
            assignee_id: { type: 'string', description: 'Assignee user ID' },
            state_id: { type: 'string', description: 'State ID to set' },
          },
          required: ['title', 'team_key'],
        },
        requiresApproval: true,
        handler: async (input: {
          title: string;
          description?: string;
          team_key: string;
          priority?: number;
          assignee_id?: string;
          state_id?: string;
        }) => {
          // First resolve team key to ID
          const teamsData = await this.linearQuery(`query { teams { nodes { id key } } }`);
          const team = teamsData.teams.nodes.find((t: any) => t.key === input.team_key);
          if (!team) throw new Error(`Team "${input.team_key}" not found`);

          const issueInput: Record<string, any> = {
            title: input.title,
            teamId: team.id,
          };
          if (input.description) issueInput.description = input.description;
          if (input.priority !== undefined) issueInput.priority = input.priority;
          if (input.assignee_id) issueInput.assigneeId = input.assignee_id;
          if (input.state_id) issueInput.stateId = input.state_id;

          const data = await this.linearQuery(
            `
            mutation($input: IssueCreateInput!) {
              issueCreate(input: $input) {
                success
                issue { id identifier title url }
              }
            }
          `,
            { input: issueInput },
          );
          return data.issueCreate.issue;
        },
      },

      {
        name: 'linear_update_issue',
        description: 'Update issue state, priority, or assignee',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Issue UUID or identifier (e.g. ENG-123)' },
            state_id: { type: 'string', description: 'New state ID' },
            priority: { type: 'number', description: 'New priority (0-4)' },
            assignee_id: { type: 'string', description: 'New assignee user ID' },
            title: { type: 'string', description: 'New title' },
            description: { type: 'string', description: 'New description' },
          },
          required: ['id'],
        },
        requiresApproval: true,
        handler: async (input: {
          id: string;
          state_id?: string;
          priority?: number;
          assignee_id?: string;
          title?: string;
          description?: string;
        }) => {
          const updateInput: Record<string, any> = {};
          if (input.state_id) updateInput.stateId = input.state_id;
          if (input.priority !== undefined) updateInput.priority = input.priority;
          if (input.assignee_id) updateInput.assigneeId = input.assignee_id;
          if (input.title) updateInput.title = input.title;
          if (input.description) updateInput.description = input.description;

          const data = await this.linearQuery(
            `
            mutation($id: String!, $input: IssueUpdateInput!) {
              issueUpdate(id: $id, input: $input) {
                success
                issue { id identifier title url }
              }
            }
          `,
            { id: input.id, input: updateInput },
          );
          return data.issueUpdate.issue;
        },
      },

      {
        name: 'linear_comment',
        description: 'Add a comment to a Linear issue',
        inputSchema: {
          type: 'object',
          properties: {
            issue_id: { type: 'string', description: 'Issue UUID or identifier (e.g. ENG-123)' },
            body: { type: 'string', description: 'Comment text (markdown)' },
          },
          required: ['issue_id', 'body'],
        },
        requiresApproval: true,
        handler: async (input: { issue_id: string; body: string }) => {
          const data = await this.linearQuery(
            `
            mutation($input: CommentCreateInput!) {
              commentCreate(input: $input) {
                success
                comment { id body createdAt }
              }
            }
          `,
            { input: { issueId: input.issue_id, body: input.body } },
          );
          return data.commentCreate.comment;
        },
      },

      // ── Projects ─────────────────────────────────────────────────────────

      {
        name: 'linear_projects',
        description: 'List projects in the Linear workspace',
        inputSchema: {
          type: 'object',
          properties: {
            first: { type: 'number', description: 'Number of projects to return (default 20)' },
          },
        },
        handler: async (input: { first?: number }) => {
          const first = Math.min(input.first ?? 20, 50);
          const data = await this.linearQuery(`
            query {
              projects(first: ${first}) {
                nodes {
                  id name description
                  state
                  progress
                  startDate targetDate
                  teams { nodes { key name } }
                  createdAt updatedAt
                  url
                }
              }
            }
          `);
          return data.projects.nodes.map((p: any) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            state: p.state,
            progress: p.progress,
            start: p.startDate,
            target: p.targetDate,
            teams: p.teams?.nodes?.map((t: any) => t.key),
            url: p.url,
          }));
        },
      },

      // ── Cycles ───────────────────────────────────────────────────────────

      {
        name: 'linear_cycles',
        description: 'List cycles (sprints) for a team',
        inputSchema: {
          type: 'object',
          properties: {
            team_key: { type: 'string', description: 'Team key (e.g. "ENG")' },
            first: { type: 'number', description: 'Number of cycles to return (default 10)' },
          },
          required: ['team_key'],
        },
        handler: async (input: { team_key: string; first?: number }) => {
          const first = Math.min(input.first ?? 10, 25);
          const data = await this.linearQuery(
            `
            query($filter: CycleFilter) {
              cycles(filter: $filter, first: ${first}, orderBy: createdAt) {
                nodes {
                  id number name
                  startsAt endsAt
                  progress
                  isActive isNext
                  issues { totalCount }
                  completedIssues: issues(filter: { completedAt: { null: false } }) { totalCount }
                  team { key }
                }
              }
            }
          `,
            { filter: { team: { key: { eq: input.team_key } } } },
          );
          return data.cycles.nodes.map((c: any) => ({
            id: c.id,
            number: c.number,
            name: c.name,
            starts: c.startsAt,
            ends: c.endsAt,
            progress: c.progress,
            active: c.isActive,
            next: c.isNext,
            total_issues: c.issues?.totalCount,
            completed_issues: c.completedIssues?.totalCount,
          }));
        },
      },
    ];
  }
}
