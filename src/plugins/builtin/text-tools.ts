import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';

export class TextToolsPlugin implements Plugin {
  name = 'text-tools';
  description = 'JSON formatting, text stats, regex testing, string manipulation';
  version = '1.0.0';

  async initialize(_conductor: Conductor): Promise<void> {}
  isConfigured(): boolean {
    return true;
  }

  getTools(): PluginTool[] {
    return [
      {
        name: 'json_format',
        description: 'Format, validate, and minify JSON',
        inputSchema: {
          type: 'object',
          properties: {
            json: { type: 'string', description: 'JSON string to format' },
            minify: { type: 'boolean', description: 'Minify instead of pretty-print', default: false },
          },
          required: ['json'],
        },
        handler: async (input: { json: string; minify?: boolean }) => {
          try {
            const parsed = JSON.parse(input.json);
            const formatted = input.minify ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2);
            return { valid: true, formatted, keys: typeof parsed === 'object' ? Object.keys(parsed) : undefined };
          } catch (e: any) {
            return { valid: false, error: e.message };
          }
        },
      },
      {
        name: 'text_stats',
        description: 'Get text statistics — word count, character count, sentence count, reading time',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to analyze' },
          },
          required: ['text'],
        },
        handler: async (input: { text: string }) => {
          const t = input.text;
          const words = t
            .trim()
            .split(/\s+/)
            .filter((w) => w.length > 0);
          const sentences = t.split(/[.!?]+/).filter((s) => s.trim().length > 0);
          const paragraphs = t.split(/\n\n+/).filter((p) => p.trim().length > 0);
          return {
            characters: t.length,
            characters_no_spaces: t.replace(/\s/g, '').length,
            words: words.length,
            sentences: sentences.length,
            paragraphs: paragraphs.length,
            reading_time: `${Math.max(1, Math.ceil(words.length / 200))} min`,
            speaking_time: `${Math.max(1, Math.ceil(words.length / 130))} min`,
          };
        },
      },
      {
        name: 'regex_test',
        description: 'Test a regex pattern against text',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Regex pattern (without delimiters)' },
            text: { type: 'string', description: 'Text to test against' },
            flags: { type: 'string', description: 'Regex flags (g, i, m, etc.)', default: 'g' },
          },
          required: ['pattern', 'text'],
        },
        handler: async (input: { pattern: string; text: string; flags?: string }) => {
          try {
            const regex = new RegExp(input.pattern, input.flags || 'g');
            const matches = [...input.text.matchAll(regex)];
            return {
              pattern: input.pattern,
              flags: input.flags || 'g',
              matches_found: matches.length,
              matches: matches.map((m) => ({
                match: m[0],
                index: m.index,
                groups: m.groups || undefined,
              })),
            };
          } catch (e: any) {
            return { error: `Invalid regex: ${e.message}` };
          }
        },
      },
      {
        name: 'text_transform',
        description: 'Transform text: uppercase, lowercase, title case, camelCase, snake_case, slug, reverse',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to transform' },
            transform: { type: 'string', description: 'uppercase, lowercase, title, camel, snake, slug, reverse' },
          },
          required: ['text', 'transform'],
        },
        handler: async (input: { text: string; transform: string }) => {
          const t = input.text;
          let result: string;
          switch (input.transform.toLowerCase()) {
            case 'uppercase':
              result = t.toUpperCase();
              break;
            case 'lowercase':
              result = t.toLowerCase();
              break;
            case 'title':
              result = t.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
              break;
            case 'camel':
              result = t.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase());
              break;
            case 'snake':
              result = t
                .replace(/\s+/g, '_')
                .replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
                .replace(/^_/, '')
                .toLowerCase();
              break;
            case 'slug':
              result = t
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '');
              break;
            case 'reverse':
              result = t.split('').reverse().join('');
              break;
            default:
              throw new Error(
                `Unknown transform: ${input.transform}. Use: uppercase, lowercase, title, camel, snake, slug, reverse`,
              );
          }
          return { original: t, transform: input.transform, result };
        },
      },
    ];
  }
}
