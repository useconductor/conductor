import { PluginTool } from '../plugins/manager.js';

export interface AIToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface AIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: AIToolCall[];
  tool_call_id?: string;
  name?: string; // Best practice for tool responses
}

export interface AIResponse {
  content: string;
  model: string;
  tokens_used?: number;
  finish_reason?: string;
  tool_calls?: AIToolCall[];
}

export interface AIProviderConfig {
  apiKey?: string;
  endpoint?: string;
  model?: string;
  maxTokens?: number;
}

export abstract class AIProvider {
  protected config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  /** Send a message and get a response. */
  abstract complete(messages: AIMessage[], tools?: PluginTool[]): Promise<AIResponse>;

  /** Stream a response (for real-time output). */
  abstract stream(messages: AIMessage[], tools?: PluginTool[]): AsyncGenerator<string>;

  /** Test if the provider is configured correctly. */
  abstract test(): Promise<boolean>;

  /** Get provider display name. */
  abstract getName(): string;

  /**
   * Parse user intent from a natural-language message.
   * Used by the Telegram bot to route commands to plugins.
   */
  async parseIntent(userMessage: string): Promise<any> {
    const systemPrompt = `You are a command parser for Conductor, an integration hub.
Parse user messages into structured intents.

Available intents:
- install_plugin: { plugin: string }
- list_plugins: {}
- enable_plugin: { plugin: string }
- disable_plugin: { plugin: string }
- execute_action: { plugin: string, action: string, params: object }
- get_status: {}
- help: {}
- chat: { message: string }

Examples:
"install github" → { "type": "install_plugin", "plugin": "github" }
"list my repos" → { "type": "execute_action", "plugin": "github", "action": "list_repos" }
"show status" → { "type": "get_status" }
"hello" → { "type": "chat", "message": "hello" }

Respond with JSON only. If unclear, use type "chat".`;

    const response = await this.complete([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]);

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return { type: 'chat', message: userMessage };
    } catch {
      return { type: 'chat', message: userMessage };
    }
  }
}
