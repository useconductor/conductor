import { AIProvider, AIMessage, AIResponse } from './base.js';
import { PluginTool } from '../plugins/manager.js';

interface OllamaToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

function convertToOllamaTools(tools?: PluginTool[]): OllamaToolDefinition[] {
  if (!tools || tools.length === 0) return [];

  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object' as const,
        properties: (t.inputSchema.properties ?? {}) as Record<string, unknown>,
        required: (t.inputSchema.required as string[]) ?? [],
      },
    },
  }));
}

export class OllamaProvider extends AIProvider {
  private endpoint: string;

  constructor(config: Record<string, unknown>) {
    super(config);
    this.endpoint = (config.endpoint as string) || 'http://localhost:11434';
  }

  getName(): string {
    return 'Ollama';
  }

  async initialize(): Promise<void> {
    const isRunning = await this.test();
    if (!isRunning) {
      throw new Error('Ollama is not running. Start it with: ollama serve');
    }
  }

  async complete(messages: AIMessage[], tools?: PluginTool[]): Promise<AIResponse> {
    const model = (this.config.model as string) || 'llama3.2';
    const ollamaTools = convertToOllamaTools(tools);

    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
    };

    if (ollamaTools.length > 0) {
      body.tools = ollamaTools;
    }

    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await response.json()) as any;

    // Check for tool calls in the response
    if (data.message?.tool_calls) {
      const toolCall = data.message.tool_calls[0];
      return {
        content: data.message.content || '',
        model: data.model,
        tokens_used: data.eval_count,
        tool_calls: [
          {
            id: toolCall.function?.name ?? 'unknown',
            name: toolCall.function?.name ?? 'unknown',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            arguments: (toolCall.function?.arguments ?? {}) as Record<string, any>,
          },
        ],
      };
    }

    return {
      content: data.message?.content ?? '',
      model: data.model,
      tokens_used: data.eval_count,
    };
  }

  async *stream(messages: AIMessage[], tools?: PluginTool[]): AsyncGenerator<string> {
    const model = (this.config.model as string) || 'llama3.2';
    const ollamaTools = convertToOllamaTools(tools);

    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };

    if (ollamaTools.length > 0) {
      body.tools = ollamaTools;
    }

    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const json = JSON.parse(line) as any;
          if (json.message?.content) {
            yield json.message.content;
          }
        } catch {
          // Skip invalid JSON fragments
        }
      }
    }
  }

  async test(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /** List available models. */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await response.json()) as any;
      return (data.models ?? []).map((m: { name: string }) => m.name);
    } catch {
      return [];
    }
  }

  /** Pull a model. */
  async pullModel(model: string): Promise<void> {
    const response = await fetch(`${this.endpoint}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: false }),
    });

    if (!response.ok) {
      throw new Error(`Failed to pull model: ${response.statusText}`);
    }
  }
}
