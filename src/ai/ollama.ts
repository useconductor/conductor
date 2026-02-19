import { AIProvider, AIMessage, AIResponse } from './base.js';

export class OllamaProvider extends AIProvider {
  private endpoint: string;

  constructor(config: any) {
    super(config);
    this.endpoint = config.endpoint || 'http://localhost:11434';
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

  async complete(messages: AIMessage[]): Promise<AIResponse> {
    const model = this.config.model || 'llama3.2';

    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const data = (await response.json()) as any;

    return {
      content: data.message.content,
      model: data.model,
      tokens_used: data.eval_count,
    };
  }

  async *stream(messages: AIMessage[]): AsyncGenerator<string> {
    const model = this.config.model || 'llama3.2';

    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
      }),
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
      const lines = chunk.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
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
      const data = (await response.json()) as any;
      return data.models.map((m: any) => m.name);
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
