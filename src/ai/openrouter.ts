import OpenAI from 'openai';
import { AIProvider, AIMessage, AIResponse } from './base.js';

export class OpenRouterProvider extends AIProvider {
  private client: OpenAI | null = null;

  async initialize(apiKey: string): Promise<void> {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/thealxlabs/conductor',
        'X-Title': 'Conductor',
      },
    });
  }

  getName(): string {
    return 'OpenRouter';
  }

  async complete(messages: AIMessage[]): Promise<AIResponse> {
    if (!this.client) throw new Error('OpenRouter not initialized');

    const model = this.config.model || 'openai/gpt-4o';

    const response = await this.client.chat.completions.create({
      model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: this.config.maxTokens || 4096,
    });

    const choice = response.choices[0];

    return {
      content: choice.message.content || '',
      model: response.model,
      tokens_used: response.usage?.total_tokens,
      finish_reason: choice.finish_reason || undefined,
    };
  }

  async *stream(messages: AIMessage[]): AsyncGenerator<string> {
    if (!this.client) throw new Error('OpenRouter not initialized');

    const model = this.config.model || 'openai/gpt-4o';

    const stream = await this.client.chat.completions.create({
      model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: this.config.maxTokens || 4096,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  async test(): Promise<boolean> {
    try {
      await this.complete([{ role: 'user', content: 'Say "OK"' }]);
      return true;
    } catch {
      return false;
    }
  }
}
