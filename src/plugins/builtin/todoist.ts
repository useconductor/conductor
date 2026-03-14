/**
 * Todoist Plugin — Conductor
 *
 * Manage tasks, projects, and comments in Todoist.
 * Uses the Todoist REST API v2 with a personal API token.
 *
 * Setup:
 *   1. Go to https://app.todoist.com/app/settings/integrations/developer
 *   2. Scroll to "API token" and copy your token
 *   3. Run: conductor plugins config todoist api_token <YOUR_TOKEN>
 *      OR set it during install when prompted
 *
 * Keychain entry: todoist / api_token
 */

import { z, ZodError } from 'zod';
import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const TODOIST_BASE = 'https://api.todoist.com/api/v1';

// ── Todoist API types ─────────────────────────────────────────────────────────

interface TodoistTask {
  id: string;
  content: string;
  description: string;
  project_id: string;
  section_id: string | null;
  parent_id: string | null;
  labels: string[];
  priority: number;
  due: {
    date: string;
    string: string;
    datetime?: string;
    is_recurring: boolean;
  } | null;
  url: string;
  comment_count: number;
  created_at: string;
  creator_id: string;
  checked: boolean;
  order: number;
}

interface TodoistProject {
  id: string;
  name: string;
  color: string;
  parent_id: string | null;
  order: number;
  comment_count: number;
  is_shared: boolean;
  is_favorite: boolean;
  is_inbox_project: boolean;
  is_team_inbox: boolean;
  url: string;
}

interface TodoistLabel {
  id: string;
  name: string;
  color: string;
  order: number;
  is_favorite: boolean;
}

interface TodoistComment {
  id: string;
  task_id: string;
  content: string;
  posted_at: string;
}

// ── Priority helpers ──────────────────────────────────────────────────────────

const PRIORITY_LABELS: Record<number, string> = {
  1: 'normal',
  2: 'medium',
  3: 'high',
  4: 'urgent',
};

function priorityLabel(p: number): string {
  return PRIORITY_LABELS[p] ?? `p${p}`;
}

function formatDue(due: TodoistTask['due']): string {
  if (!due) return 'no due date';
  return due.string ?? due.date;
}

// ── Plugin class ──────────────────────────────────────────────────────────────

export class TodoistPlugin implements Plugin {
  name = 'todoist';
  description = 'Manage Todoist tasks, projects, and comments — requires Todoist API token';
  version = '1.0.0';

  configSchema = {
    fields: [
      {
        key: 'api_token',
        label: 'API Token',
        type: 'password' as const,
        required: true,
        secret: true,
        service: 'todoist',
        description: 'Copy your token from Todoist Settings > Integrations > Developer.',
      },
    ],
    setupInstructions:
      '1. Open Todoist and go to Settings > Integrations > Developer. ' +
      '2. Copy the "API token" shown at the bottom of the page. ' +
      '3. Run: conductor plugins config todoist api_token <YOUR_TOKEN>',
  };

  private keychain!: Keychain;

  async initialize(conductor: Conductor): Promise<void> {
    this.keychain = new Keychain(conductor.getConfig().getConfigDir());
  }

  isConfigured(): boolean {
    return true; // lazily validated on first tool call via getToken()
  }

  async getContext(): Promise<string | null> {
    try {
      const overdue: TodoistTask[] = await this.todoistFetch('/tasks', { params: { filter: 'overdue' } });
      const today: TodoistTask[] = await this.todoistFetch('/tasks', { params: { filter: 'today' } });
      const parts: string[] = [];
      if (overdue.length > 0) parts.push(`${overdue.length} overdue`);
      if (today.length > 0) parts.push(`${today.length} due today`);
      if (parts.length === 0) return null;
      return `[TODOIST] Tasks: ${parts.join(', ')}`;
    } catch {
      return null;
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async getToken(): Promise<string> {
    const token = await this.keychain.get('todoist', 'api_token');
    if (!token) {
      throw new Error(
        'Todoist not configured. Get your API token from ' +
          'https://app.todoist.com/app/settings/integrations/developer\n' +
          'Then run: conductor plugins config todoist api_token <YOUR_TOKEN>'
      );
    }
    return token;
  }

  /**
   * Thin wrapper around the Todoist REST API v2.
   * Handles auth, JSON encoding, and error surfacing.
   */
  private async todoistFetch(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'DELETE';
      params?: Record<string, string>;
      body?: Record<string, unknown>;
    } = {}
  ): Promise<any> {
    const token = await this.getToken();
    const { method = 'GET', params, body } = options;

    let url = `${TODOIST_BASE}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) {
      // No content — successful operation with no body (e.g. close, delete)
      return null;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Todoist API ${res.status}: ${text}`);
    }

    const data = await res.json();
    // API v1 wraps list responses in { results: [], next_cursor }
    // Single-item responses (create/update) return the object directly
    if (data !== null && typeof data === 'object' && Array.isArray((data as any).results)) {
      return (data as any).results;
    }
    return data;
  }

  // ── Formatters ────────────────────────────────────────────────────────────

  /** Format a single task into a clean markdown string. */
  private formatTask(task: TodoistTask): string {
    const priority = task.priority > 1 ? ` [P${5 - task.priority} — ${priorityLabel(task.priority)}]` : '';
    const due = task.due ? ` | Due: ${formatDue(task.due)}` : '';
    const labels = task.labels.length ? ` | Labels: ${task.labels.join(', ')}` : '';
    const desc = task.description ? `\n   ${task.description}` : '';
    return `- [${task.id}] **${task.content}**${priority}${due}${labels}${desc}`;
  }

  /** Format a project into a single-line summary. */
  private formatProject(project: TodoistProject): string {
    const inbox = project.is_inbox_project ? ' (Inbox)' : '';
    const fav = project.is_favorite ? ' ★' : '';
    const shared = project.is_shared ? ' (shared)' : '';
    return `- [${project.id}] **${project.name}**${inbox}${fav}${shared}`;
  }

  // ── Tools ─────────────────────────────────────────────────────────────────

  getTools(): PluginTool[] {
    return [

      // ── todoist_list_tasks ────────────────────────────────────────────────
      {
        name: 'todoist_list_tasks',
        description:
          'List active Todoist tasks. Optionally filter by project ID, label name, or a ' +
          'Todoist filter string (e.g. "today", "overdue", "p1", "#Work & @urgent").',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Only return tasks in this project (use todoist_get_projects to find IDs)',
            },
            label: {
              type: 'string',
              description: 'Only return tasks with this label name',
            },
            filter: {
              type: 'string',
              description:
                'Todoist filter string, e.g. "today", "overdue", "p1", "assigned to: me". ' +
                'Cannot be combined with project_id or label.',
            },
            limit: {
              type: 'number',
              description: 'Max number of tasks to return (default: 50)',
            },
          },
        },
        handler: async (rawInput: Record<string, unknown>) => {
          try {
            const schema = z.object({
              project_id: z.string().optional(),
              label: z.string().optional(),
              filter: z.string().optional(),
              limit: z.number().int().min(1).max(200).optional().default(50),
            });
            const { project_id, label, filter, limit } = schema.parse(rawInput);

            const params: Record<string, string> = {};
            if (project_id) params.project_id = project_id;
            if (label) params.label = label;
            if (filter) params.filter = filter;

            const tasks: TodoistTask[] = await this.todoistFetch('/tasks', { params });
            const slice = tasks.slice(0, limit);

            if (slice.length === 0) {
              return 'No tasks found matching the given criteria.';
            }

            const lines = slice.map((t) => this.formatTask(t));
            const header =
              `Found ${slice.length} task${slice.length !== 1 ? 's' : ''}` +
              (tasks.length > limit ? ` (showing first ${limit} of ${tasks.length})` : '') +
              ':';

            return `${header}\n\n${lines.join('\n')}`;
          } catch (err: unknown) {
            if (err instanceof ZodError) return `Validation error: ${err.issues.map(e => `${e.path.join('.')}: ${(e as any).message}`).join('; ')}`;
            return `Error listing tasks: ${(err as Error).message}`;
          }
        },
      },

      // ── todoist_create_task ───────────────────────────────────────────────
      {
        name: 'todoist_create_task',
        description:
          'Create a new Todoist task. Supports natural-language due dates like ' +
          '"tomorrow at 3pm", "every Monday", or "in 2 weeks".',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'Task name / content (required)',
            },
            description: {
              type: 'string',
              description: 'Optional longer description or notes',
            },
            due_string: {
              type: 'string',
              description: 'Natural language due date, e.g. "tomorrow at 3pm", "next Monday", "every week"',
            },
            priority: {
              type: 'number',
              description: 'Priority: 1 = normal, 2 = medium, 3 = high, 4 = urgent (Todoist P4–P1)',
            },
            project_id: {
              type: 'string',
              description: 'Project to add the task to (defaults to Inbox)',
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Label names to attach, e.g. ["work", "urgent"]',
            },
          },
          required: ['content'],
        },
        handler: async (rawInput: Record<string, unknown>) => {
          try {
            const schema = z.object({
              content: z.string().min(1, 'content is required'),
              description: z.string().optional(),
              due_string: z.string().optional(),
              priority: z.number().int().min(1).max(4).optional(),
              project_id: z.string().optional(),
              labels: z.array(z.string()).optional(),
            });
            const { content, description, due_string, priority, project_id, labels } = schema.parse(rawInput);

            const body: Record<string, unknown> = { content };
            if (description) body.description = description;
            if (due_string) body.due_string = due_string;
            if (priority !== undefined) body.priority = priority;
            if (project_id) body.project_id = project_id;
            if (labels?.length) body.labels = labels;

            const task: TodoistTask = await this.todoistFetch('/tasks', {
              method: 'POST',
              body,
            });

            const lines = [
              `Task created successfully.`,
              ``,
              `**${task.content}** [ID: ${task.id}]`,
            ];
            if (task.description) lines.push(`Description: ${task.description}`);
            if (task.due) lines.push(`Due: ${formatDue(task.due)}`);
            if (task.priority > 1) lines.push(`Priority: ${priorityLabel(task.priority)}`);
            if (task.labels.length) lines.push(`Labels: ${task.labels.join(', ')}`);
            lines.push(`URL: ${task.url}`);

            return lines.join('\n');
          } catch (err: unknown) {
            if (err instanceof ZodError) return `Validation error: ${err.issues.map(e => `${e.path.join('.')}: ${(e as any).message}`).join('; ')}`;
            return `Error creating task: ${(err as Error).message}`;
          }
        },
      },

      // ── todoist_complete_task ─────────────────────────────────────────────
      {
        name: 'todoist_complete_task',
        description: 'Mark a Todoist task as completed (closed) by its ID.',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'The task ID to mark as complete',
            },
          },
          required: ['task_id'],
        },
        handler: async (rawInput: Record<string, unknown>) => {
          try {
            const schema = z.object({ task_id: z.string().min(1, 'task_id is required') });
            const { task_id } = schema.parse(rawInput);
            await this.todoistFetch(`/tasks/${encodeURIComponent(task_id)}/close`, {
              method: 'POST',
            });
            return `Task ${task_id} marked as complete.`;
          } catch (err: unknown) {
            if (err instanceof ZodError) return `Validation error: ${err.issues.map(e => `${e.path.join('.')}: ${(e as any).message}`).join('; ')}`;
            return `Error completing task: ${(err as Error).message}`;
          }
        },
      },

      // ── todoist_update_task ───────────────────────────────────────────────
      {
        name: 'todoist_update_task',
        description:
          'Update an existing task — change its content, description, due date, or priority.',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'The task ID to update',
            },
            content: {
              type: 'string',
              description: 'New task name / content',
            },
            description: {
              type: 'string',
              description: 'New description / notes',
            },
            due_string: {
              type: 'string',
              description: 'New due date as natural language, e.g. "next Friday at 10am"',
            },
            priority: {
              type: 'number',
              description: 'New priority: 1 = normal, 2 = medium, 3 = high, 4 = urgent',
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Replace all labels with this list',
            },
          },
          required: ['task_id'],
        },
        handler: async (rawInput: Record<string, unknown>) => {
          try {
            const schema = z.object({
              task_id: z.string().min(1, 'task_id is required'),
              content: z.string().optional(),
              description: z.string().optional(),
              due_string: z.string().optional(),
              priority: z.number().int().min(1).max(4).optional(),
              labels: z.array(z.string()).optional(),
            });
            const { task_id, content, description, due_string, priority, labels } = schema.parse(rawInput);

            const body: Record<string, unknown> = {};
            if (content !== undefined) body.content = content;
            if (description !== undefined) body.description = description;
            if (due_string !== undefined) body.due_string = due_string;
            if (priority !== undefined) body.priority = priority;
            if (labels !== undefined) body.labels = labels;

            if (Object.keys(body).length === 0) {
              return 'No fields to update were provided.';
            }

            const task: TodoistTask = await this.todoistFetch(
              `/tasks/${encodeURIComponent(task_id)}`,
              { method: 'POST', body }
            );

            const lines = [
              `Task updated successfully.`,
              ``,
              `**${task.content}** [ID: ${task.id}]`,
            ];
            if (task.description) lines.push(`Description: ${task.description}`);
            if (task.due) lines.push(`Due: ${formatDue(task.due)}`);
            if (task.priority > 1) lines.push(`Priority: ${priorityLabel(task.priority)}`);
            if (task.labels.length) lines.push(`Labels: ${task.labels.join(', ')}`);

            return lines.join('\n');
          } catch (err: unknown) {
            if (err instanceof ZodError) return `Validation error: ${err.issues.map(e => `${e.path.join('.')}: ${(e as any).message}`).join('; ')}`;
            return `Error updating task: ${(err as Error).message}`;
          }
        },
      },

      // ── todoist_delete_task ───────────────────────────────────────────────
      {
        name: 'todoist_delete_task',
        description:
          'Permanently delete a task from Todoist. This cannot be undone. ' +
          'Prefer todoist_complete_task unless the task should be fully removed.',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'The task ID to permanently delete',
            },
          },
          required: ['task_id'],
        },
        requiresApproval: true,
        handler: async (rawInput: Record<string, unknown>) => {
          try {
            const schema = z.object({ task_id: z.string().min(1, 'task_id is required') });
            const { task_id } = schema.parse(rawInput);
            await this.todoistFetch(`/tasks/${encodeURIComponent(task_id)}`, {
              method: 'DELETE',
            });
            return `Task ${task_id} has been permanently deleted.`;
          } catch (err: unknown) {
            if (err instanceof ZodError) return `Validation error: ${err.issues.map(e => `${e.path.join('.')}: ${(e as any).message}`).join('; ')}`;
            return `Error deleting task: ${(err as Error).message}`;
          }
        },
      },

      // ── todoist_get_projects ──────────────────────────────────────────────
      {
        name: 'todoist_get_projects',
        description: 'List all Todoist projects in the account.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: async (_rawInput: Record<string, unknown>) => {
          try {
            const projects: TodoistProject[] = await this.todoistFetch('/projects');

            if (projects.length === 0) {
              return 'No projects found.';
            }

            const lines = projects.map((p) => this.formatProject(p));
            return `${projects.length} project${projects.length !== 1 ? 's' : ''}:\n\n${lines.join('\n')}`;
          } catch (err: unknown) {
            return `Error fetching projects: ${(err as Error).message}`;
          }
        },
      },

      // ── todoist_search_tasks ──────────────────────────────────────────────
      {
        name: 'todoist_search_tasks',
        description:
          'Search tasks using Todoist\'s filter syntax. Examples: "today", "overdue", ' +
          '"p1", "#Work", "@label", "assigned to: me", "created before: -7 days".',
        inputSchema: {
          type: 'object',
          properties: {
            filter: {
              type: 'string',
              description: 'Todoist filter expression',
            },
            limit: {
              type: 'number',
              description: 'Max results to return (default: 50)',
            },
          },
          required: ['filter'],
        },
        handler: async (rawInput: Record<string, unknown>) => {
          try {
            const schema = z.object({
              filter: z.string().min(1, 'filter is required'),
              limit: z.number().int().min(1).max(200).optional().default(50),
            });
            const { filter, limit } = schema.parse(rawInput);

            const tasks: TodoistTask[] = await this.todoistFetch('/tasks', {
              params: { filter },
            });
            const slice = tasks.slice(0, limit);

            if (slice.length === 0) {
              return `No tasks matched the filter: "${filter}"`;
            }

            const lines = slice.map((t) => this.formatTask(t));
            const header =
              `Found ${slice.length} task${slice.length !== 1 ? 's' : ''} matching "${filter}"` +
              (tasks.length > limit ? ` (showing first ${limit} of ${tasks.length})` : '') +
              ':';

            return `${header}\n\n${lines.join('\n')}`;
          } catch (err: unknown) {
            if (err instanceof ZodError) return `Validation error: ${err.issues.map(e => `${e.path.join('.')}: ${(e as any).message}`).join('; ')}`;
            return `Error searching tasks: ${(err as Error).message}`;
          }
        },
      },

      // ── todoist_add_comment ───────────────────────────────────────────────
      {
        name: 'todoist_add_comment',
        description: 'Add a comment to a Todoist task.',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'The task ID to comment on',
            },
            content: {
              type: 'string',
              description: 'The comment text',
            },
          },
          required: ['task_id', 'content'],
        },
        handler: async (rawInput: Record<string, unknown>) => {
          try {
            const schema = z.object({
              task_id: z.string().min(1, 'task_id is required'),
              content: z.string().min(1, 'content is required'),
            });
            const { task_id, content } = schema.parse(rawInput);
            const comment: TodoistComment = await this.todoistFetch('/comments', {
              method: 'POST',
              body: { task_id, content },
            });
            return (
              `Comment added to task ${task_id}.\n` +
              `Comment ID: ${comment.id}\n` +
              `Posted at: ${comment.posted_at}`
            );
          } catch (err: unknown) {
            if (err instanceof ZodError) return `Validation error: ${err.issues.map(e => `${e.path.join('.')}: ${(e as any).message}`).join('; ')}`;
            return `Error adding comment: ${(err as Error).message}`;
          }
        },
      },

    ];
  }
}
