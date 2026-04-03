/**
 * n8n Plugin — TheAlxLabs / Conductor
 *
 * Full n8n automation platform integration:
 * - Workflows: list, activate/deactivate, get structure, trigger manually
 * - Executions: list, inspect, retry, delete
 * - Webhooks: trigger webhook-based workflows with custom payloads
 * - Credentials: list (no secrets exposed)
 * - Tags: organize and filter workflows by tag
 * - Health: instance status and queue metrics
 *
 * Works with both self-hosted n8n and n8n Cloud.
 *
 * Setup:
 *   1. n8n → Settings → API → Create API Key
 *   2. Run: conductor plugins config n8n api_key <YOUR_KEY>
 *   3. Run: conductor plugins config n8n base_url <YOUR_N8N_URL>
 *      e.g. https://n8n.yourdomain.com  or  https://app.n8n.cloud/api
 *
 * Keychain: n8n / api_key, n8n / base_url
 */

import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

export class N8nPlugin implements Plugin {
  name = 'n8n';
  description = 'Trigger and manage n8n workflows, inspect executions, fire webhooks — requires n8n API key';
  version = '1.0.0';

  configSchema = {
    fields: [
      {
        key: 'api_key',
        label: 'n8n API Key',
        type: 'password' as const,
        required: true,
        secret: true,
        service: 'n8n',
      },
      {
        key: 'base_url',
        label: 'n8n Instance URL',
        type: 'string' as const,
        required: true,
        secret: false,
        description: 'e.g. https://n8n.yourdomain.com',
      },
    ],
    setupInstructions: 'Create an API Key in your n8n instance: Settings > API > Create Key.',
  };

  private keychain!: Keychain;

  async initialize(conductor: Conductor): Promise<void> {
    this.keychain = new Keychain(conductor.getConfig().getConfigDir());
  }

  isConfigured(): boolean {
    return true;
  }

  private async getConfig(): Promise<{ apiKey: string; baseUrl: string }> {
    const apiKey = await this.keychain.get('n8n', 'api_key');
    if (!apiKey) {
      throw new Error(
        'n8n API key not configured.\n' +
          'Get one from your n8n instance: Settings → API → Create Key\n' +
          'Then run: conductor plugins config n8n api_key <KEY>',
      );
    }
    const rawUrl = await this.keychain.get('n8n', 'base_url');
    let baseUrl = (rawUrl ?? 'http://localhost:5678').replace(/\/$/, '');
    if (!baseUrl.endsWith('/api/v1')) baseUrl = `${baseUrl}/api/v1`;
    return { apiKey, baseUrl };
  }

  private async n8nFetch(
    path: string,
    options: { method?: string; body?: any; params?: Record<string, string> } = {},
  ): Promise<any> {
    const { apiKey, baseUrl } = await this.getConfig();
    const url = new URL(`${baseUrl}${path}`);
    if (options.params) {
      for (const [k, v] of Object.entries(options.params)) url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers: {
        'X-N8N-API-KEY': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (res.status === 204) return {};
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: res.statusText }))) as any;
      throw new Error(`n8n API ${res.status}: ${err.message ?? res.statusText}`);
    }
    return res.json();
  }

  private async webhookFetch(
    webhookUrl: string,
    method: string,
    body?: any,
    headers?: Record<string, string>,
  ): Promise<any> {
    const res = await fetch(webhookUrl, {
      method,
      headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`Webhook ${res.status}: ${res.statusText}`);
    }
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) return res.json();
    return { response: await res.text() };
  }

  private formatWorkflow(w: any) {
    return {
      id: w.id,
      name: w.name,
      active: w.active ?? false,
      nodeCount: (w.nodes ?? []).length,
      triggerType: this.detectTriggerType(w.nodes ?? []),
      webhookPath: this.extractWebhookPath(w.nodes ?? []),
      tags: (w.tags ?? []).map((t: any) => (typeof t === 'string' ? t : t.name)),
      createdAt: w.createdAt ?? null,
      updatedAt: w.updatedAt ?? null,
    };
  }

  private formatExecution(e: any) {
    const duration =
      e.startedAt && e.stoppedAt
        ? `${Math.round((new Date(e.stoppedAt).getTime() - new Date(e.startedAt).getTime()) / 1000)}s`
        : null;
    return {
      id: e.id,
      workflowId: e.workflowId,
      workflowName: e.workflowData?.name ?? null,
      status: (e.status ?? e.finished) ? 'success' : 'running',
      mode: e.mode ?? 'unknown',
      startedAt: e.startedAt ?? null,
      stoppedAt: e.stoppedAt ?? null,
      duration,
      nodeCount: Object.keys(e.data?.resultData?.runData ?? {}).length,
      error: e.data?.resultData?.error?.message ?? null,
    };
  }

  private detectTriggerType(nodes: any[]): string {
    const triggerNode = nodes.find(
      (n: any) => n.type?.includes('Trigger') || n.type?.includes('Webhook') || n.type?.includes('Cron'),
    );
    if (!triggerNode) return 'manual';
    if (triggerNode.type?.includes('Webhook')) return 'webhook';
    if (triggerNode.type?.includes('Cron') || triggerNode.type?.includes('Schedule')) return 'schedule';
    if (triggerNode.type?.includes('EmailImap')) return 'email';
    return triggerNode.type?.split('.').pop()?.replace('Trigger', '') ?? 'trigger';
  }

  private extractWebhookPath(nodes: any[]): string | null {
    const webhookNode = nodes.find((n: any) => n.type === 'n8n-nodes-base.webhook' || n.type?.includes('Webhook'));
    return webhookNode?.parameters?.path ?? webhookNode?.parameters?.webhookId ?? null;
  }

  getTools(): PluginTool[] {
    return [
      // ── n8n_workflows ───────────────────────────────────────────────────────
      {
        name: 'n8n_workflows',
        description: 'List all n8n workflows with their active status and trigger type',
        inputSchema: {
          type: 'object',
          properties: {
            active: {
              type: 'boolean',
              description: 'Filter to only active or only inactive workflows',
            },
            tag: { type: 'string', description: 'Filter by tag name' },
            limit: { type: 'number', description: 'Max workflows (default: 50)' },
            search: { type: 'string', description: 'Search by workflow name' },
          },
        },
        handler: async ({ active, tag, limit = 50, search }: any) => {
          const params: Record<string, string> = {
            limit: String(Math.min(limit, 250)),
          };
          if (active !== undefined) params.active = String(active);
          if (tag) params.tags = tag;

          const data = await this.n8nFetch('/workflows', { params });
          let workflows = (data.data ?? data) as any[];

          if (search) {
            const q = search.toLowerCase();
            workflows = workflows.filter((w: any) => w.name?.toLowerCase().includes(q));
          }

          const formatted = workflows.map(this.formatWorkflow.bind(this));
          const activeCount = formatted.filter((w) => w.active).length;

          return {
            total: formatted.length,
            active: activeCount,
            inactive: formatted.length - activeCount,
            workflows: formatted,
          };
        },
      },

      // ── n8n_workflow ────────────────────────────────────────────────────────
      {
        name: 'n8n_workflow',
        description: 'Get full details of a specific n8n workflow including all nodes and connections',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Workflow ID' },
          },
          required: ['id'],
        },
        handler: async ({ id }: any) => {
          const w = await this.n8nFetch(`/workflows/${id}`);
          return {
            ...this.formatWorkflow(w),
            nodes: (w.nodes ?? []).map((n: any) => ({
              name: n.name,
              type: n.type?.split('.').pop() ?? n.type,
              position: n.position,
              disabled: n.disabled ?? false,
              hasCredentials: !!n.credentials,
            })),
            connections: Object.keys(w.connections ?? {}).length,
            settings: w.settings ?? {},
          };
        },
      },

      // ── n8n_activate ────────────────────────────────────────────────────────
      {
        name: 'n8n_activate',
        description: 'Activate or deactivate an n8n workflow',
        requiresApproval: true,
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Workflow ID' },
            active: { type: 'boolean', description: 'true = activate, false = deactivate' },
          },
          required: ['id', 'active'],
        },
        handler: async ({ id, active }: any) => {
          await this.n8nFetch(`/workflows/${id}`, {
            method: 'PATCH',
            body: { active },
          });
          return { id, active, message: `Workflow ${active ? 'activated' : 'deactivated'}` };
        },
      },

      // ── n8n_trigger ─────────────────────────────────────────────────────────
      {
        name: 'n8n_trigger',
        description:
          'Manually trigger an n8n workflow execution. ' +
          'For webhook workflows, fires the webhook URL. ' +
          'For others, uses the n8n execute API.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Workflow ID' },
            payload: {
              type: 'object',
              description: 'Data to pass to the workflow (for webhook triggers)',
            },
            waitForResult: {
              type: 'boolean',
              description: 'Wait for execution to complete and return result (default: false)',
            },
          },
          required: ['id'],
        },
        handler: async ({ id, payload = {}, waitForResult = false }: any) => {
          const workflow = await this.n8nFetch(`/workflows/${id}`);
          const triggerType = this.detectTriggerType(workflow.nodes ?? []);
          const webhookPath = this.extractWebhookPath(workflow.nodes ?? []);

          if (triggerType === 'webhook' && webhookPath) {
            const { baseUrl } = await this.getConfig();
            const n8nBase = baseUrl.replace('/api/v1', '');
            const webhookUrl = `${n8nBase}/webhook/${webhookPath}`;

            const result = await this.webhookFetch(webhookUrl, 'POST', payload);
            return {
              triggered: true,
              method: 'webhook',
              webhookUrl,
              workflowId: id,
              workflowName: workflow.name,
              response: result,
            };
          }

          const result = await this.n8nFetch(`/workflows/${id}/run`, {
            method: 'POST',
            body: { runData: payload },
          });

          if (waitForResult) {
            const execId = result.data?.executionId;
            if (execId) {
              for (let i = 0; i < 15; i++) {
                await new Promise((r) => setTimeout(r, 2000));
                const exec = await this.n8nFetch(`/executions/${execId}`).catch(() => null);
                if (exec?.finished || exec?.status === 'error') {
                  return {
                    triggered: true,
                    method: 'execute',
                    workflowId: id,
                    execution: this.formatExecution(exec),
                  };
                }
              }
            }
          }

          return {
            triggered: true,
            method: 'execute',
            workflowId: id,
            workflowName: workflow.name,
            executionId: result.data?.executionId ?? null,
          };
        },
      },

      // ── n8n_webhook ─────────────────────────────────────────────────────────
      {
        name: 'n8n_webhook',
        description:
          'Fire an n8n webhook directly by its path or full URL. ' +
          'Use this when you know the webhook path but not the workflow ID.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Webhook path (e.g. "my-hook") or full URL',
            },
            payload: { type: 'object', description: 'JSON body to send' },
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'PATCH'],
              description: 'HTTP method (default: POST)',
            },
            headers: {
              type: 'object',
              description: 'Additional headers',
            },
          },
          required: ['path'],
        },
        handler: async ({ path, payload, method = 'POST', headers }: any) => {
          let url: string;
          if (path.startsWith('http')) {
            url = path;
          } else {
            const { baseUrl } = await this.getConfig();
            const n8nBase = baseUrl.replace('/api/v1', '');
            url = `${n8nBase}/webhook/${path.replace(/^\//, '')}`;
          }

          const result = await this.webhookFetch(url, method, payload, headers);
          return { fired: true, url, method, response: result };
        },
      },

      // ── n8n_executions ──────────────────────────────────────────────────────
      {
        name: 'n8n_executions',
        description: 'List recent workflow executions with status and duration',
        inputSchema: {
          type: 'object',
          properties: {
            workflowId: { type: 'string', description: 'Filter by workflow ID' },
            status: {
              type: 'string',
              enum: ['error', 'success', 'waiting', 'running'],
              description: 'Filter by execution status',
            },
            limit: { type: 'number', description: 'Max executions (default: 20)' },
          },
        },
        handler: async ({ workflowId, status, limit = 20 }: any) => {
          const params: Record<string, string> = { limit: String(Math.min(limit, 100)) };
          if (workflowId) params.workflowId = workflowId;
          if (status) params.status = status;

          const data = await this.n8nFetch('/executions', { params });
          const executions = (data.data ?? data) as any[];

          const formatted = executions.map(this.formatExecution.bind(this));
          const errorCount = formatted.filter((e) => e.status === 'error').length;

          return {
            count: formatted.length,
            errors: errorCount,
            executions: formatted,
          };
        },
      },

      // ── n8n_execution ───────────────────────────────────────────────────────
      {
        name: 'n8n_execution',
        description: 'Get detailed results of a specific workflow execution including node outputs',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Execution ID' },
          },
          required: ['id'],
        },
        handler: async ({ id }: any) => {
          const e = await this.n8nFetch(`/executions/${id}`);
          const runData = e.data?.resultData?.runData ?? {};

          const nodeResults = Object.entries(runData).map(([nodeName, runs]: [string, any]) => {
            const lastRun = Array.isArray(runs) ? runs[runs.length - 1] : runs;
            const outputData = lastRun?.data?.main?.[0] ?? [];
            return {
              node: nodeName,
              itemCount: outputData.length,
              error: lastRun?.error?.message ?? null,
              sample: outputData[0]?.json ? JSON.stringify(outputData[0].json).slice(0, 500) : null,
            };
          });

          return {
            ...this.formatExecution(e),
            nodeResults,
            triggerData: e.data?.triggerData ?? null,
          };
        },
      },

      // ── n8n_retry ───────────────────────────────────────────────────────────
      {
        name: 'n8n_retry',
        description: 'Retry a failed workflow execution',
        inputSchema: {
          type: 'object',
          properties: {
            executionId: { type: 'string', description: 'Execution ID to retry' },
            loadWorkflow: {
              type: 'boolean',
              description: 'Load latest workflow version before retrying (default: false)',
            },
          },
          required: ['executionId'],
        },
        handler: async ({ executionId, loadWorkflow = false }: any) => {
          const result = await this.n8nFetch(`/executions/${executionId}/retry`, {
            method: 'POST',
            body: { loadWorkflow },
          });
          return {
            retried: true,
            originalId: executionId,
            newExecutionId: result.data ?? result,
          };
        },
      },

      // ── n8n_delete_execution ────────────────────────────────────────────────
      {
        name: 'n8n_delete_execution',
        description: 'Delete a workflow execution from n8n history',
        requiresApproval: true,
        inputSchema: {
          type: 'object',
          properties: {
            executionId: { type: 'string', description: 'Execution ID to delete' },
          },
          required: ['executionId'],
        },
        handler: async ({ executionId }: any) => {
          await this.n8nFetch(`/executions/${executionId}`, { method: 'DELETE' });
          return { deleted: true, executionId };
        },
      },

      // ── n8n_credentials ─────────────────────────────────────────────────────
      {
        name: 'n8n_credentials',
        description: 'List credential types configured in n8n (names only — no secrets exposed)',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Filter by credential type name' },
          },
        },
        handler: async ({ type }: any) => {
          const params: Record<string, string> = {};
          if (type) params.filter = JSON.stringify({ type });
          const data = await this.n8nFetch('/credentials', { params });
          const creds = (data.data ?? data) as any[];
          return {
            count: creds.length,
            credentials: creds.map((c: any) => ({
              id: c.id,
              name: c.name,
              type: c.type,
              createdAt: c.createdAt ?? null,
              updatedAt: c.updatedAt ?? null,
            })),
          };
        },
      },

      // ── n8n_tags ────────────────────────────────────────────────────────────
      {
        name: 'n8n_tags',
        description: 'List all workflow tags in n8n',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const data = await this.n8nFetch('/tags');
          const tags = (data.data ?? data) as any[];
          return {
            count: tags.length,
            tags: tags.map((t: any) => ({ id: t.id, name: t.name })),
          };
        },
      },

      // ── n8n_health ──────────────────────────────────────────────────────────
      {
        name: 'n8n_health',
        description: 'Check n8n instance health, version, and queue metrics',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const [health, version] = await Promise.allSettled([this.n8nFetch('/health'), this.n8nFetch('/version')]);

          const { baseUrl } = await this.getConfig();

          return {
            instanceUrl: baseUrl.replace('/api/v1', ''),
            healthy: health.status === 'fulfilled',
            version: version.status === 'fulfilled' ? ((version.value as any).version ?? 'unknown') : 'unknown',
            status: health.status === 'fulfilled' ? ((health.value as any).status ?? 'ok') : 'unreachable',
          };
        },
      },
    ];
  }
}
