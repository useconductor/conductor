import { AIProvider, AIMessage, AIResponse } from './base.js';
import { PluginTool } from '../plugins/manager.js';
import OpenAI from 'openai';
import { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions.js';

export class OpenAIProvider extends AIProvider {
  private client: OpenAI | null = null;

  async initialize(apiKey: string): Promise<void> {
    this.client = new OpenAI({ apiKey });
  }

  getName(): string {
    return 'OpenAI';
  }

  async complete(messages: AIMessage[], tools?: PluginTool[]): Promise<AIResponse> {
    if (!this.client) throw new Error('OpenAI not initialized');

    const model = this.config.model || 'gpt-4o';

    const requestTools: ChatCompletionTool[] | undefined = tools?.length
      ? tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema as any,
          },
        }))
      : undefined;

    const formattedMessages: ChatCompletionMessageParam[] = messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          content: m.content,
          tool_call_id: m.tool_call_id!,
        };
      } else if (m.role === 'assistant' && m.tool_calls) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        };
      }

      return {
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
      };
    });

    const response = await this.client.chat.completions.create({
      model,
      messages: formattedMessages,
      max_tokens: this.config.maxTokens || 4096,
      tools: requestTools,
    });

    const choice = response.choices[0];

    return {
      content: choice.message.content || '',
      model: response.model,
      tokens_used: response.usage?.total_tokens,
      finish_reason: choice.finish_reason || undefined,
      tool_calls: choice.message.tool_calls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
      })),
    };
  }

  async *stream(messages: AIMessage[], tools?: PluginTool[]): AsyncGenerator<string> {
    if (!this.client) throw new Error('OpenAI not initialized');

    const model = this.config.model || 'gpt-4o';

    const formattedMessages: ChatCompletionMessageParam[] = messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          content: m.content,
          tool_call_id: m.tool_call_id!,
        };
      } else if (m.role === 'assistant' && m.tool_calls) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        };
      }

      return {
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
      };
    });

    const requestTools: ChatCompletionTool[] | undefined = tools?.length
      ? tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema as any,
          },
        }))
      : undefined;

    const stream = await this.client.chat.completions.create({
      model,
      messages: formattedMessages,
      max_tokens: this.config.maxTokens || 4096,
      stream: true,
      tools: requestTools,
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
