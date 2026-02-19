import Anthropic from '@anthropic-ai/sdk';
import { AIProvider, AIMessage, AIResponse } from './base.js';

export class ClaudeProvider extends AIProvider {
  private client: Anthropic | null = null;

  async initialize(apiKey: string): Promise<void> {
    this.client = new Anthropic({ apiKey });
  }

  getName(): string {
    return 'Claude';
  }

  async complete(messages: AIMessage[]): Promise<AIResponse> {
    if (!this.client) throw new Error('Claude not initialized. Call initialize() first.');

    const model = this.config.model || 'claude-sonnet-4-5-20250514';

    // Separate system message from conversation messages
    const anthropicMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const systemMessage = messages.find(m => m.role === 'system');

    const response = await this.client.messages.create({
      model,
      max_tokens: this.config.maxTokens || 4096,
      system: systemMessage?.content,
      messages: anthropicMessages,
    });

    const content = response.content[0];

    return {
      content: content.type === 'text' ? content.text : '',
      model: response.model,
      tokens_used: response.usage.input_tokens + response.usage.output_tokens,
      finish_reason: response.stop_reason || undefined,
    };
  }

  async *stream(messages: AIMessage[]): AsyncGenerator<string> {
    if (!this.client) throw new Error('Claude not initialized');

    const model = this.config.model || 'claude-sonnet-4-5-20250514';

    const anthropicMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const systemMessage = messages.find(m => m.role === 'system');

    const stream = await this.client.messages.stream({
      model,
      max_tokens: this.config.maxTokens || 4096,
      system: systemMessage?.content,
      messages: anthropicMessages,
    });

    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        yield chunk.delta.text;
      }
    }
  }

  async test(): Promise<boolean> {
    try {
      await this.complete([
        { role: 'user', content: 'Say "OK" if you can hear me.' },
      ]);
      return true;
    } catch {
      return false;
    }
  }
}
