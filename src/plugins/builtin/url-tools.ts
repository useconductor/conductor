import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';

export class URLToolsPlugin implements Plugin {
  name = 'url-tools';
  description = 'URL utilities — expand short links, check status, extract headers';
  version = '1.0.0';

  async initialize(_conductor: Conductor): Promise<void> {}
  isConfigured(): boolean {
    return true;
  }

  getTools(): PluginTool[] {
    return [
      {
        name: 'url_expand',
        description: 'Expand a shortened URL to its final destination',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string', description: 'Short URL to expand' } },
          required: ['url'],
        },
        handler: async (input: { url: string }) => {
          const res = await fetch(input.url, { method: 'HEAD', redirect: 'follow' });
          return { original: input.url, expanded: res.url, status: res.status };
        },
      },
      {
        name: 'url_status',
        description: 'Check if a URL is accessible and get response details',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string', description: 'URL to check' } },
          required: ['url'],
        },
        handler: async (input: { url: string }) => {
          const start = Date.now();
          try {
            const res = await fetch(input.url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
            const ms = Date.now() - start;
            const headers: Record<string, string> = {};
            for (const [k, v] of res.headers.entries()) {
              if (['content-type', 'server', 'x-powered-by', 'content-length'].includes(k.toLowerCase())) {
                headers[k] = v;
              }
            }
            return { url: input.url, status: res.status, ok: res.ok, response_ms: ms, headers };
          } catch (e: any) {
            return { url: input.url, ok: false, error: e.message, response_ms: Date.now() - start };
          }
        },
      },
      {
        name: 'url_headers',
        description: 'Get all HTTP response headers for a URL',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string', description: 'URL to inspect' } },
          required: ['url'],
        },
        handler: async (input: { url: string }) => {
          const res = await fetch(input.url, { method: 'HEAD' });
          const headers: Record<string, string> = {};
          res.headers.forEach((v, k) => {
            headers[k] = v;
          });
          return { url: input.url, status: res.status, headers };
        },
      },
    ];
  }
}
