import { AIProvider, AIMessage, AIResponse } from './base.js';
import { PluginTool } from '../plugins/manager.js';

/**
 * Maestro Provider — connects to a locally running Maestro model via Ollama.
 * Maestro is a fine-tuned Qwen2.5-Coder 7B model by TheAlxLabs, optimized
 * for coding assistance, bug fixing, documentation, and code explanation.
 */
export class MaestroProvider extends AIProvider {
  private endpoint: string;
  private modelName: string;

  constructor(config: any) {
    super(config);
    this.endpoint = config.endpoint || 'http://localhost:11434';
    this.modelName = config.model || 'maestro';
  }

  getName(): string {
    return 'Maestro';
  }

  async initialize(): Promise<void> {
    const isRunning = await this.test();
    if (!isRunning) {
      throw new Error(
        'Maestro is not running. Make sure Ollama is running and the Maestro model is pulled.\n' +
        'Run: ollama pull thealxlabs/maestro'
      );
    }
  }

  async complete(messages: AIMessage[], tools?: PluginTool[]): Promise<AIResponse> {
    const formattedMessages = this.formatMessages(messages);

    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        messages: formattedMessages,
        stream: false,
        options: {
          temperature: 0.2,       // Lower = more precise code output
          top_p: 0.95,
          repeat_penalty: 1.1,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Maestro error: ${response.statusText}`);
    }

    const data = (await response.json()) as any;

    return {
      content: data.message.content,
      model: `maestro (${data.model})`,
      tokens_used: data.eval_count,
      finish_reason: data.done ? 'stop' : undefined,
    };
  }

  async *stream(messages: AIMessage[], tools?: PluginTool[]): AsyncGenerator<string> {
    const formattedMessages = this.formatMessages(messages);

    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        messages: formattedMessages,
        stream: true,
        options: {
          temperature: 0.2,
          top_p: 0.95,
          repeat_penalty: 1.1,
        },
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Maestro stream error: ${response.statusText}`);
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
      // Check Ollama is running
      const tagsResponse = await fetch(`${this.endpoint}/api/tags`);
      if (!tagsResponse.ok) return false;

      // Check Maestro model is available
      const data = (await tagsResponse.json()) as any;
      const models: string[] = data.models?.map((m: any) => m.name) || [];
      const hasMaestro = models.some(m => m.includes('maestro'));

      if (!hasMaestro) {
        console.warn(
          '\n⚠️  Maestro model not found in Ollama.\n' +
          'Pull it with: ollama pull thealxlabs/maestro\n'
        );
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /** Pull the Maestro model via Ollama */
  async pullModel(): Promise<void> {
    console.log('🎼 Pulling Maestro model from Ollama registry...');
    const response = await fetch(`${this.endpoint}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: this.modelName, stream: false }),
    });

    if (!response.ok) {
      throw new Error(`Failed to pull Maestro: ${response.statusText}`);
    }

    console.log('✅ Maestro model ready!');
  }

  /** Format messages into Ollama-compatible format with Maestro system prompt */
  private formatMessages(messages: AIMessage[]) {
    const hasSytem = messages.some(m => m.role === 'system');

    const maestroSystem: AIMessage = {
      role: 'system',
      content:
        'You are Maestro, an elite AI coding assistant by TheAlxLabs. ' +
        'You specialize in writing clean, efficient, well-documented code across all languages. ' +
        'You excel at fixing bugs, explaining complex code, and writing documentation. ' +
        'Always provide accurate, working code. Be concise but thorough.',
    };

    const allMessages = hasSytem ? messages : [maestroSystem, ...messages];

    return allMessages.map(m => ({
      role: m.role,
      content: m.content,
    }));
  }
}