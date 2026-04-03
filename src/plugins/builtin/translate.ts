import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';

export class TranslatePlugin implements Plugin {
  name = 'translate';
  description = 'Translate text between languages (free, no API key)';
  version = '1.0.0';

  async initialize(_conductor: Conductor): Promise<void> {}
  isConfigured(): boolean {
    return true;
  }

  getTools(): PluginTool[] {
    return [
      {
        name: 'translate_text',
        description: 'Translate text between languages. Use ISO 639-1 codes (en, fr, es, de, ja, zh, ko, ar, etc.)',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to translate' },
            from: { type: 'string', description: 'Source language code (e.g. en)', default: 'auto' },
            to: { type: 'string', description: 'Target language code (e.g. fr)' },
          },
          required: ['text', 'to'],
        },
        handler: async (input: { text: string; from?: string; to: string }) => {
          const from = input.from || 'auto';
          const pair = `${from}|${input.to}`;
          const res = await fetch(
            `https://api.mymemory.translated.net/get?q=${encodeURIComponent(input.text)}&langpair=${encodeURIComponent(pair)}`,
          );
          if (!res.ok) throw new Error(`Translation API error: ${res.statusText}`);
          const data = (await res.json()) as any;
          return {
            original: input.text,
            translated: data.responseData?.translatedText || 'Translation failed',
            from,
            to: input.to,
            confidence: data.responseData?.match,
          };
        },
      },
    ];
  }
}
