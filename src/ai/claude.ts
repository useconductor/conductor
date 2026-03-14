import Anthropic from '@anthropic-ai/sdk';
import { AIProvider, AIMessage, AIResponse } from './base.js';
import { PluginTool } from '../plugins/manager.js';

export class ClaudeProvider extends AIProvider {
  private client: Anthropic | null = null;

  async initialize(apiKey: string): Promise<void> {
    this.client = new Anthropic({ apiKey });
  }

  getName(): string {
    return 'Claude';
  }

  async complete(messages: AIMessage[], tools?: PluginTool[]): Promise<AIResponse> {
    if (!this.client) throw new Error('Claude not initialized. Call initialize() first.');

    const model = this.config.model || 'claude-3-5-sonnet-20241022';

    const requestTools = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    // Separate system message from conversation messages
    const anthropicMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'user' as const,
            content: [
              {
                type: 'tool_result' as const,
                tool_use_id: m.tool_call_id!,
                content: m.content,
              },
            ],
          };
        } else if (m.role === 'assistant' && m.tool_calls) {
          const content: Anthropic.Messages.ContentBlockParam[] = [];
          if (m.content) content.push({ type: 'text', text: m.content });
          m.tool_calls.forEach((tc) => {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          });
          return { role: 'assistant' as const, content };
        }
        return {
          role: m.role as 'user' | 'assistant',
          content: m.content,
        };
      });

    const systemMessage = messages.find((m) => m.role === 'system');

    const response = await this.client.messages.create({
      model,
      max_tokens: this.config.maxTokens || 4096,
      system: systemMessage?.content,
      messages: anthropicMessages as Anthropic.Messages.MessageParam[],
      tools: requestTools,
    });

    const toolCalls = response.content
      .filter((c): c is Anthropic.Messages.ToolUseBlock => c.type === 'tool_use')
      .map((c) => ({
        id: c.id,
        name: c.name,
        arguments: c.input as Record<string, unknown>,
      }));

    const textContent = response.content
      .filter((c): c is Anthropic.Messages.TextBlock => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    return {
      content: textContent,
      model: response.model,
      tokens_used: response.usage.input_tokens + response.usage.output_tokens,
      finish_reason: response.stop_reason || undefined,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async *stream(messages: AIMessage[], tools?: PluginTool[]): AsyncGenerator<string> {
    if (!this.client) throw new Error('Claude not initialized');

    const model = this.config.model || 'claude-3-5-sonnet-20241022';

    const requestTools = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    const anthropicMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'user' as const,
            content: [
              {
                type: 'tool_result' as const,
                tool_use_id: m.tool_call_id!,
                content: m.content,
              },
            ],
          };
        } else if (m.role === 'assistant' && m.tool_calls) {
          const content: Anthropic.Messages.ContentBlockParam[] = [];
          if (m.content) content.push({ type: 'text', text: m.content });
          m.tool_calls.forEach((tc) => {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          });
          return { role: 'assistant' as const, content };
        }
        return {
          role: m.role as 'user' | 'assistant',
          content: m.content,
        };
      });

    const systemMessage = messages.find((m) => m.role === 'system');

    const stream = await this.client.messages.stream({
      model,
      max_tokens: this.config.maxTokens || 4096,
      system: systemMessage?.content,
      messages: anthropicMessages as Anthropic.Messages.MessageParam[],
      tools: requestTools,
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
