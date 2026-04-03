/**
 * Cron / Scheduler Plugin — TheAlxLabs / Conductor
 *
 * Persistent scheduled tasks with natural language time parsing.
 * Tasks survive restarts — stored in ~/.conductor/scheduler.json.
 *
 * Features:
 * - Natural language scheduling: "every day at 9am", "in 30 minutes", "every Monday"
 * - One-time and recurring tasks
 * - Task history (last 50 runs per task)
 * - Webhook callbacks or AI tool calls on trigger
 * - Pause/resume without deleting
 * - Timezone-aware scheduling
 * - Task categories and tags
 *
 * NO external cron dependencies — pure Node.js setTimeout/setInterval.
 * The scheduler runs in-process when Conductor is active.
 * Tasks that missed their window while Conductor was off are detected on restart.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';

type TaskFrequency = 'once' | 'minutely' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  tags: string[];
  frequency: TaskFrequency;
  cronExpression?: string; // for custom frequency
  nextRunAt: string; // ISO
  lastRunAt?: string; // ISO
  lastStatus?: 'success' | 'failed' | 'skipped';
  paused: boolean;
  createdAt: string;
  runCount: number;
  failCount: number;
  action: {
    type: 'webhook' | 'log' | 'notify';
    url?: string; // for webhook
    message?: string; // for log/notify
    method?: string; // for webhook
    headers?: Record<string, string>;
    body?: string;
  };
  timezone: string;
  maxRuns?: number; // auto-delete after N runs
  history: Array<{
    ranAt: string;
    status: 'success' | 'failed' | 'skipped';
    duration?: number;
    error?: string;
    output?: string;
  }>;
}

// ── Natural language time parser ────────────────────────────────────────────

function parseNaturalTime(
  expr: string,
  now = new Date(),
): { nextRun: Date; frequency: TaskFrequency; cronExpr?: string } | null {
  const e = expr.toLowerCase().trim();

  // "in X minutes/hours/days"
  const inMatch = e.match(/^in\s+(\d+)\s+(minute|hour|day|week)s?$/);
  if (inMatch) {
    const n = parseInt(inMatch[1]);
    const unit = inMatch[2];
    const next = new Date(now);
    if (unit === 'minute') next.setMinutes(next.getMinutes() + n);
    else if (unit === 'hour') next.setHours(next.getHours() + n);
    else if (unit === 'day') next.setDate(next.getDate() + n);
    else if (unit === 'week') next.setDate(next.getDate() + n * 7);
    return { nextRun: next, frequency: 'once' };
  }

  // "every X minutes/hours"
  const everyMatch = e.match(/^every\s+(\d+)\s+(minute|hour)s?$/);
  if (everyMatch) {
    const n = parseInt(everyMatch[1]);
    const unit = everyMatch[2];
    const next = new Date(now);
    if (unit === 'minute') {
      next.setMinutes(next.getMinutes() + n);
      return { nextRun: next, frequency: 'custom', cronExpr: `*/${n} * * * *` };
    }
    if (unit === 'hour') {
      next.setHours(next.getHours() + n);
      return { nextRun: next, frequency: 'custom', cronExpr: `0 */${n} * * *` };
    }
  }

  // "every day at HH:MM" or "daily at HH:MM"
  const dailyMatch = e.match(/^(?:every day|daily)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (dailyMatch) {
    let h = parseInt(dailyMatch[1]);
    const m = parseInt(dailyMatch[2] ?? '0');
    if (dailyMatch[3] === 'pm' && h < 12) h += 12;
    if (dailyMatch[3] === 'am' && h === 12) h = 0;
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return { nextRun: next, frequency: 'daily', cronExpr: `${m} ${h} * * *` };
  }

  // "every hour" / "hourly"
  if (e === 'every hour' || e === 'hourly') {
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return { nextRun: next, frequency: 'hourly', cronExpr: '0 * * * *' };
  }

  // "every minute" / "minutely"
  if (e === 'every minute' || e === 'minutely') {
    const next = new Date(now);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + 1);
    return { nextRun: next, frequency: 'minutely', cronExpr: '* * * * *' };
  }

  // "every Monday/Tuesday/.../weekday at HH:MM"
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const weekdayMatch = e.match(
    /^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/,
  );
  if (weekdayMatch) {
    const targetDay = days.indexOf(weekdayMatch[1]);
    let h = parseInt(weekdayMatch[2]);
    const m = parseInt(weekdayMatch[3] ?? '0');
    if (weekdayMatch[4] === 'pm' && h < 12) h += 12;
    if (weekdayMatch[4] === 'am' && h === 12) h = 0;
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    const daysUntil = (targetDay - now.getDay() + 7) % 7 || 7;
    next.setDate(next.getDate() + daysUntil);
    return { nextRun: next, frequency: 'weekly', cronExpr: `${m} ${h} * * ${targetDay}` };
  }

  // "every weekday at HH:MM"
  const weekdayGenMatch = e.match(/^every weekday\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (weekdayGenMatch) {
    let h = parseInt(weekdayGenMatch[1]);
    const m = parseInt(weekdayGenMatch[2] ?? '0');
    if (weekdayGenMatch[3] === 'pm' && h < 12) h += 12;
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next <= now || next.getDay() === 0 || next.getDay() === 6) {
      next.setDate(next.getDate() + 1);
      while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
    }
    return { nextRun: next, frequency: 'custom', cronExpr: `${m} ${h} * * 1-5` };
  }

  // "every month on the Xth at HH:MM"
  const monthlyMatch = e.match(
    /^(?:every month|monthly)\s+(?:on the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/,
  );
  if (monthlyMatch) {
    const day = parseInt(monthlyMatch[1]);
    let h = parseInt(monthlyMatch[2]);
    const m = parseInt(monthlyMatch[3] ?? '0');
    if (monthlyMatch[4] === 'pm' && h < 12) h += 12;
    const next = new Date(now);
    next.setDate(day);
    next.setHours(h, m, 0, 0);
    if (next <= now) next.setMonth(next.getMonth() + 1);
    return { nextRun: next, frequency: 'monthly', cronExpr: `${m} ${h} ${day} * *` };
  }

  // Try parsing as raw ISO date
  const isoDate = new Date(expr);
  if (!isNaN(isoDate.getTime()) && isoDate > now) {
    return { nextRun: isoDate, frequency: 'once' };
  }

  return null;
}

/** Compute next run time after a given time based on frequency/cron */
function getNextRun(task: ScheduledTask, after = new Date()): Date | null {
  if (task.frequency === 'once') return null;

  const next = new Date(after);
  if (task.frequency === 'minutely') {
    next.setMinutes(next.getMinutes() + 1, 0, 0);
    return next;
  }
  if (task.frequency === 'hourly') {
    next.setHours(next.getHours() + 1, 0, 0, 0);
    return next;
  }

  if (task.frequency === 'daily' || (task.frequency === 'custom' && task.cronExpression)) {
    // Simple: re-parse cron for next time
    if (task.cronExpression) {
      const parts = task.cronExpression.split(' ');
      if (parts.length === 5) {
        const [min, hour, dom, , dow] = parts;
        const result = new Date(after);

        if (dow !== '*' && !dow.includes('-') && !dow.includes('/')) {
          const targetDay = parseInt(dow);
          result.setHours(parseInt(hour), parseInt(min), 0, 0);
          const daysUntil = (targetDay - after.getDay() + 7) % 7 || 7;
          result.setDate(result.getDate() + daysUntil);
          return result;
        }

        if (dom !== '*') {
          result.setDate(parseInt(dom));
          result.setHours(parseInt(hour), parseInt(min), 0, 0);
          if (result <= after) result.setMonth(result.getMonth() + 1);
          return result;
        }

        result.setHours(parseInt(hour === '*' ? String(after.getHours()) : hour), parseInt(min), 0, 0);
        result.setDate(result.getDate() + 1);
        return result;
      }
    }
    next.setDate(next.getDate() + 1);
    return next;
  }

  if (task.frequency === 'weekly') {
    next.setDate(next.getDate() + 7);
    return next;
  }
  if (task.frequency === 'monthly') {
    next.setMonth(next.getMonth() + 1);
    return next;
  }
  return null;
}

export class CronPlugin implements Plugin {
  name = 'cron';
  description = 'Schedule recurring and one-time tasks with natural language — "every day at 9am", "in 30 minutes"';
  version = '1.0.0';

  private storePath!: string;
  private tasks: Map<string, ScheduledTask> = new Map();
  private loaded = false;
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  async initialize(conductor: Conductor): Promise<void> {
    const configDir = conductor.getConfig().getConfigDir();
    this.storePath = path.join(configDir, 'scheduler.json');
    await this.load();
    this.scheduleAll();
  }

  isConfigured(): boolean {
    return true;
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.storePath, 'utf-8');
      const arr: ScheduledTask[] = JSON.parse(raw);
      this.tasks = new Map(arr.map((t) => [t.id, t]));
    } catch {
      this.tasks = new Map();
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    const arr = Array.from(this.tasks.values());
    const tmp = this.storePath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(arr, null, 2));
    await fs.rename(tmp, this.storePath);
  }

  // ── Scheduler ───────────────────────────────────────────────────────────────

  private scheduleAll(): void {
    for (const task of this.tasks.values()) {
      if (!task.paused) this.scheduleTask(task);
    }
  }

  private scheduleTask(task: ScheduledTask): void {
    const existing = this.timers.get(task.id);
    if (existing) clearTimeout(existing);

    const nextRun = new Date(task.nextRunAt);
    const delay = nextRun.getTime() - Date.now();

    if (delay < 0) {
      // Missed run — log and reschedule
      task.history.unshift({
        ranAt: nextRun.toISOString(),
        status: 'skipped',
        error: 'Conductor was not running',
      });
      if (task.history.length > 50) task.history.pop();
      const next = getNextRun(task, new Date());
      if (next) {
        task.nextRunAt = next.toISOString();
        this.save().catch(() => {});
        this.scheduleTask(task);
      }
      return;
    }

    const timer = setTimeout(
      async () => {
        await this.runTask(task);
      },
      Math.min(delay, 2147483647),
    ); // setTimeout max

    this.timers.set(task.id, timer);
  }

  private async runTask(task: ScheduledTask): Promise<void> {
    const start = Date.now();
    let status: 'success' | 'failed' = 'success';
    let output: string | undefined;
    let error: string | undefined;

    try {
      if (task.action.type === 'webhook' && task.action.url) {
        const res = await fetch(task.action.url, {
          method: task.action.method ?? 'POST',
          headers: { 'Content-Type': 'application/json', ...task.action.headers },
          body: task.action.body ?? JSON.stringify({ taskId: task.id, taskName: task.name }),
        });
        output = `HTTP ${res.status}`;
        if (!res.ok) {
          status = 'failed';
          error = `HTTP ${res.status}: ${res.statusText}`;
        }
      } else if (task.action.type === 'log') {
        output = task.action.message ?? `Task "${task.name}" triggered`;
        process.stderr.write(`[Conductor Cron] ${output}\n`);
      }
    } catch (err: any) {
      status = 'failed';
      error = err.message ?? String(err);
    }

    const duration = Date.now() - start;
    task.lastRunAt = new Date().toISOString();
    task.lastStatus = status;
    task.runCount++;
    if (status === 'failed') task.failCount++;

    task.history.unshift({ ranAt: task.lastRunAt, status, duration, error, output });
    if (task.history.length > 50) task.history.pop();

    // Auto-delete if maxRuns reached
    if (task.maxRuns && task.runCount >= task.maxRuns) {
      this.tasks.delete(task.id);
      this.timers.delete(task.id);
      await this.save();
      return;
    }

    // Schedule next run
    const next = getNextRun(task, new Date());
    if (next) {
      task.nextRunAt = next.toISOString();
      await this.save();
      this.scheduleTask(task);
    } else {
      // One-time task done
      await this.save();
    }
  }

  // ── Tools ───────────────────────────────────────────────────────────────────

  getTools(): PluginTool[] {
    return [
      // ── cron_schedule ───────────────────────────────────────────────────────
      {
        name: 'cron_schedule',
        description:
          'Schedule a task. Supports natural language: "every day at 9am", "in 30 minutes", ' +
          '"every Monday at 8am", "every weekday at 6pm", "every hour", "every 15 minutes".',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Task name' },
            when: {
              type: 'string',
              description: 'When to run — natural language like "every day at 9am" or ISO datetime for one-time',
            },
            action: {
              type: 'string',
              enum: ['log', 'webhook'],
              description: 'What to do when triggered (default: log)',
            },
            message: {
              type: 'string',
              description: 'Message to log when triggered (for action=log)',
            },
            webhookUrl: {
              type: 'string',
              description: 'URL to POST to when triggered (for action=webhook)',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional tags for organization',
            },
            maxRuns: {
              type: 'number',
              description: 'Auto-delete after this many runs (optional)',
            },
            description: { type: 'string', description: 'Optional description' },
          },
          required: ['name', 'when'],
        },
        handler: async ({
          name,
          when,
          action = 'log',
          message,
          webhookUrl,
          tags = [],
          maxRuns,
          description = '',
        }: any) => {
          await this.load();

          const parsed = parseNaturalTime(when);
          if (!parsed) {
            return {
              error: `Could not parse schedule: "${when}". Try: "every day at 9am", "in 30 minutes", "every Monday at 8am"`,
            };
          }

          const id = crypto.randomUUID().slice(0, 8);
          const now = new Date().toISOString();

          const task: ScheduledTask = {
            id,
            name,
            description,
            tags,
            frequency: parsed.frequency,
            cronExpression: parsed.cronExpr,
            nextRunAt: parsed.nextRun.toISOString(),
            paused: false,
            createdAt: now,
            runCount: 0,
            failCount: 0,
            action: {
              type: action,
              url: webhookUrl,
              message: message ?? `Task "${name}" triggered`,
              method: 'POST',
            },
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            maxRuns,
            history: [],
          };

          this.tasks.set(id, task);
          this.scheduleTask(task);
          await this.save();

          return {
            scheduled: true,
            id,
            name,
            frequency: parsed.frequency,
            nextRunAt: parsed.nextRun.toISOString(),
            nextRunIn: this.humanDuration(parsed.nextRun.getTime() - Date.now()),
            cronExpression: parsed.cronExpr ?? null,
          };
        },
      },

      // ── cron_list ───────────────────────────────────────────────────────────
      {
        name: 'cron_list',
        description: 'List all scheduled tasks',
        inputSchema: {
          type: 'object',
          properties: {
            includePaused: { type: 'boolean', description: 'Include paused tasks (default: true)' },
            tag: { type: 'string', description: 'Filter by tag' },
          },
        },
        handler: async ({ includePaused = true, tag }: any) => {
          await this.load();
          let tasks = Array.from(this.tasks.values());
          if (!includePaused) tasks = tasks.filter((t) => !t.paused);
          if (tag) tasks = tasks.filter((t) => t.tags.includes(tag));
          tasks.sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime());
          return {
            count: tasks.length,
            tasks: tasks.map((t) => ({
              id: t.id,
              name: t.name,
              frequency: t.frequency,
              cronExpression: t.cronExpression ?? null,
              nextRunAt: t.nextRunAt,
              nextRunIn: this.humanDuration(new Date(t.nextRunAt).getTime() - Date.now()),
              lastRunAt: t.lastRunAt ?? null,
              lastStatus: t.lastStatus ?? null,
              paused: t.paused,
              runCount: t.runCount,
              failCount: t.failCount,
              tags: t.tags,
            })),
          };
        },
      },

      // ── cron_cancel ─────────────────────────────────────────────────────────
      {
        name: 'cron_cancel',
        description: 'Cancel and delete a scheduled task',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Task ID' },
            name: { type: 'string', description: 'Task name (used if ID not known)' },
          },
        },
        handler: async ({ id, name }: any) => {
          await this.load();
          let taskId = id;
          if (!taskId && name) {
            for (const [tid, task] of this.tasks.entries()) {
              if (task.name.toLowerCase().includes(name.toLowerCase())) {
                taskId = tid;
                break;
              }
            }
          }
          if (!taskId || !this.tasks.has(taskId)) return { error: 'Task not found.' };
          const timer = this.timers.get(taskId);
          if (timer) clearTimeout(timer);
          this.timers.delete(taskId);
          const task = this.tasks.get(taskId)!;
          this.tasks.delete(taskId);
          await this.save();
          return { cancelled: true, id: taskId, name: task.name };
        },
      },

      // ── cron_pause ──────────────────────────────────────────────────────────
      {
        name: 'cron_pause',
        description: 'Pause or resume a scheduled task without deleting it',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Task ID' },
            paused: { type: 'boolean', description: 'true = pause, false = resume' },
          },
          required: ['id', 'paused'],
        },
        handler: async ({ id, paused }: any) => {
          await this.load();
          const task = this.tasks.get(id);
          if (!task) return { error: `Task ${id} not found.` };
          task.paused = paused;
          if (paused) {
            const timer = this.timers.get(id);
            if (timer) clearTimeout(timer);
            this.timers.delete(id);
          } else {
            this.scheduleTask(task);
          }
          await this.save();
          return { id, name: task.name, paused };
        },
      },

      // ── cron_history ────────────────────────────────────────────────────────
      {
        name: 'cron_history',
        description: 'Get the run history for a scheduled task',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Task ID' },
            limit: { type: 'number', description: 'Max history entries (default: 10)' },
          },
          required: ['id'],
        },
        handler: async ({ id, limit = 10 }: any) => {
          await this.load();
          const task = this.tasks.get(id);
          if (!task) return { error: `Task ${id} not found.` };
          return {
            id,
            name: task.name,
            runCount: task.runCount,
            failCount: task.failCount,
            successRate: task.runCount
              ? `${Math.round(((task.runCount - task.failCount) / task.runCount) * 100)}%`
              : 'N/A',
            history: task.history.slice(0, limit),
          };
        },
      },

      // ── cron_run_now ─────────────────────────────────────────────────────────
      {
        name: 'cron_run_now',
        description: 'Immediately trigger a scheduled task without waiting for its next run time',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Task ID' },
          },
          required: ['id'],
        },
        handler: async ({ id }: any) => {
          await this.load();
          const task = this.tasks.get(id);
          if (!task) return { error: `Task ${id} not found.` };
          await this.runTask(task);
          return { triggered: true, id, name: task.name, lastStatus: task.lastStatus };
        },
      },
    ];
  }

  private humanDuration(ms: number): string {
    if (ms < 0) return 'overdue';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
}
