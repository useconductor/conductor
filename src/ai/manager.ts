import { AIProvider, AIMessage, AIToolCall } from './base.js';
import { ClaudeProvider } from './claude.js';
import { OpenAIProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';
import { OllamaProvider } from './ollama.js';
import { OpenRouterProvider } from './openrouter.js';
import { Conductor } from '../core/conductor.js';
import { Keychain } from '../security/keychain.js';

export interface AgentResponse {
  text: string;
  approvalRequired?: {
    toolCallId: string;
    toolName: string;
    arguments: any;
  };
}

export class AIManager {
  private conductor: Conductor;
  private keychain: Keychain;
  private currentProvider: AIProvider | null = null;

  constructor(conductor: Conductor) {
    this.conductor = conductor;
    this.keychain = new Keychain(conductor.getConfig().getConfigDir());
  }

  /** Get (or lazily initialize) the current AI provider. */
  async getCurrentProvider(): Promise<AIProvider | null> {
    if (this.currentProvider) return this.currentProvider;

    const provider = this.conductor.getConfig().get<string>('ai.provider');
    if (!provider) return null;

    await this.loadProvider(provider);
    return this.currentProvider;
  }

  /** Load and initialize a provider by name. */
  async loadProvider(providerName: string): Promise<AIProvider> {
    switch (providerName.toLowerCase()) {
      case 'claude':
      case 'anthropic': {
        // install.sh stores under "anthropic", CLI may store under "claude"
        const apiKey =
          (await this.keychain.get('anthropic', 'api_key')) ||
          (await this.keychain.get('claude', 'api_key'));
        if (!apiKey) throw new Error('Claude API key not found');

        const provider = new ClaudeProvider({
          model: this.conductor.getConfig().get<string>('ai.model'),
        });
        await provider.initialize(apiKey);
        this.currentProvider = provider;
        return provider;
      }

      case 'openai': {
        const apiKey = await this.keychain.get('openai', 'api_key');
        if (!apiKey) throw new Error('OpenAI API key not found');

        const provider = new OpenAIProvider({
          model: this.conductor.getConfig().get<string>('ai.model'),
        });
        await provider.initialize(apiKey);
        this.currentProvider = provider;
        return provider;
      }

      case 'gemini': {
        // Try centralized Google tokens first (from 'conductor auth google')
        const googleTokens = await this.keychain.get('google', 'access_token');
        if (googleTokens) {
          const provider = new GeminiProvider({
            model: this.conductor.getConfig().get<string>('ai.model'),
          });
          await provider.initialize(googleTokens);
          this.currentProvider = provider;
          return provider;
        }

        // Try API key next
        const apiKey = await this.keychain.get('gemini', 'api_key');
        if (apiKey) {
          const provider = new GeminiProvider({
            model: this.conductor.getConfig().get<string>('ai.model'),
          });
          await provider.initialize(apiKey);
          this.currentProvider = provider;
          return provider;
        }

        // Try Gemini-specific OAuth access token (legacy)
        const accessToken = await this.keychain.get('gemini', 'access_token');
        if (accessToken) {
          const provider = new GeminiProvider({
            model: this.conductor.getConfig().get<string>('ai.model'),
          });
          await provider.initialize(accessToken);
          this.currentProvider = provider;
          return provider;
        }

        throw new Error('Gemini not configured. Run: conductor auth google');
      }

      case 'openrouter': {
        const apiKey = await this.keychain.get('openrouter', 'api_key');
        if (!apiKey) throw new Error('OpenRouter API key not found');

        const provider = new OpenRouterProvider({
          model: this.conductor.getConfig().get<string>('ai.model'),
        });
        await provider.initialize(apiKey);
        this.currentProvider = provider;
        return provider;
      }

      case 'ollama': {
        const endpoint =
          this.conductor.getConfig().get<string>('ai.local_config.endpoint') ||
          'http://localhost:11434';
        const model =
          this.conductor.getConfig().get<string>('ai.model') || 'llama3.2';
        const provider = new OllamaProvider({ endpoint, model });
        await provider.initialize();
        this.currentProvider = provider;
        return provider;
      }

      default:
        throw new Error(`Unknown provider: ${providerName}`);
    }
  }

  /** Setup Claude with API key. */
  async setupClaude(apiKey: string, model?: string): Promise<void> {
    // Store under "anthropic" to match install.sh convention
    await this.keychain.set('anthropic', 'api_key', apiKey);
    await this.conductor.getConfig().set('ai.provider', 'claude');
    if (model) {
      await this.conductor.getConfig().set('ai.model', model);
    }

    const provider = new ClaudeProvider({ model });
    await provider.initialize(apiKey);
    const works = await provider.test();
    if (!works) throw new Error('Claude API key is invalid');

    this.currentProvider = provider;
  }

  /** Setup OpenAI with API key. */
  async setupOpenAI(apiKey: string, model?: string): Promise<void> {
    await this.keychain.set('openai', 'api_key', apiKey);
    await this.conductor.getConfig().set('ai.provider', 'openai');
    if (model) {
      await this.conductor.getConfig().set('ai.model', model);
    }

    const provider = new OpenAIProvider({ model });
    await provider.initialize(apiKey);
    const works = await provider.test();
    if (!works) throw new Error('OpenAI API key is invalid');

    this.currentProvider = provider;
  }

  /** Setup OpenRouter with API key. */
  async setupOpenRouter(apiKey: string, model?: string): Promise<void> {
    await this.keychain.set('openrouter', 'api_key', apiKey);
    await this.conductor.getConfig().set('ai.provider', 'openrouter');
    if (model) {
      await this.conductor.getConfig().set('ai.model', model);
    }

    const provider = new OpenRouterProvider({ model });
    await provider.initialize(apiKey);
    const works = await provider.test();
    if (!works) throw new Error('OpenRouter API key is invalid');

    this.currentProvider = provider;
  }

  /** Setup Gemini with OAuth (easiest — uses built-in OAuth app). */
  async setupGeminiOAuthEasy(): Promise<void> {
    const { getOAuthCredentials } = await import('../config/oauth.js');
    const { clientId, clientSecret, redirectUri } =
      getOAuthCredentials(this.conductor, 'google');

    const provider = new GeminiProvider({});

    const authUrl = await provider.initializeWithOAuth(
      clientId,
      clientSecret,
      redirectUri
    );

    const open = (await import('open')).default;
    await open(authUrl);

    await provider.loginWithBrowser();

    await this.conductor.getConfig().set('ai.provider', 'gemini');
    await this.conductor.getConfig().set('ai.mode', 'oauth');

    this.currentProvider = provider;
  }

  /** Setup Gemini with API key. */
  async setupGemini(apiKey: string): Promise<void> {
    await this.keychain.set('gemini', 'api_key', apiKey);
    await this.conductor.getConfig().set('ai.provider', 'gemini');

    const provider = new GeminiProvider({});
    await provider.initialize(apiKey);
    const works = await provider.test();
    if (!works) throw new Error('Gemini API key is invalid');

    this.currentProvider = provider;
  }

  /** Setup Ollama (local). */
  async setupOllama(
    model: string = 'llama3.2',
    endpoint: string = 'http://localhost:11434'
  ): Promise<void> {
    await this.conductor.getConfig().set('ai.provider', 'ollama');
    await this.conductor.getConfig().set('ai.model', model);
    await this.conductor.getConfig().set('ai.local_config.endpoint', endpoint);

    const provider = new OllamaProvider({ endpoint, model });
    const works = await provider.test();
    if (!works) {
      throw new Error('Ollama is not running. Start it with: ollama serve');
    }

    this.currentProvider = provider;
  }

  /** Parse user intent using the current AI provider. */
  async parseIntent(userMessage: string): Promise<any> {
    const provider = await this.getCurrentProvider();
    if (!provider) {
      throw new Error('No AI provider configured. Run: conductor ai');
    }
    return await provider.parseIntent(userMessage);
  }

  /** Router Agent: Determines the best persona for the request */
  private async determinePersona(userId: string, text: string): Promise<string> {
    const provider = await this.getCurrentProvider();
    if (!provider) return 'general';

    const prompt = `You are the Conductor Router Agent. Analyze the user's request and categorize it into the most appropriate persona.

Options:
- "coder": The user is asking to write code, debug, use git, bash, or manage files.
- "social": The user is asking to post tweets, check Slack/Telegram, or manage messages.
- "researcher": The user wants you to search the web, read pages, or summarize information.
- "general": Anything else, like checking the weather, calendar, emails, or small talk.

User Request: "${text}"

Respond with ONLY the exact literal string "coder", "social", "researcher", or "general". No punctuation. Always respond in English.`;

    try {
      const response = await provider.complete([
        { role: 'system', content: 'You are a strict routing classifier. Always respond in English.' },
        { role: 'user', content: prompt }
      ], []);

      const choice = response.content?.toLowerCase().trim();
      if (['coder', 'social', 'researcher', 'general'].includes(choice!)) {
        return choice!;
      }
    } catch {
      // Silently fallback to general
    }
    return 'general';
  }

  /** Helper to process tool calls non-interactively or halt for approval */
  private async processToolCalls(userId: string, messages: AIMessage[], tools: any[]): Promise<{ approvalRequired?: any, newMessages: AIMessage[] }> {
    const db = this.conductor.getDatabase();

    const lastAssistantMessageIndex = [...messages].reverse().findIndex(m => m.role === 'assistant' && m.tool_calls);
    if (lastAssistantMessageIndex === -1) return { newMessages: [] };

    const assistantMsg = messages[messages.length - 1 - lastAssistantMessageIndex];
    if (!assistantMsg.tool_calls) return { newMessages: [] };

    const subsequentMessages = messages.slice(messages.length - lastAssistantMessageIndex);
    const completedToolCallIds = subsequentMessages.filter(m => m.role === 'tool').map(m => m.tool_call_id);

    const pendingToolCalls = assistantMsg.tool_calls.filter((tc: AIToolCall) => !completedToolCallIds.includes(tc.id));

    const newMessages: AIMessage[] = [];

    for (const tc of pendingToolCalls) {
      const tool = tools.find(t => t.name === tc.name);
      if (tool?.requiresApproval) {
        return {
          approvalRequired: { toolCallId: tc.id, toolName: tc.name, arguments: tc.arguments },
          newMessages
        };
      }

      let resultStr = '';
      if (tool) {
        try {
          process.stderr.write(`\n  Executing Tool ➔ ${tc.name}\n`);
          const out = await tool.handler(tc.arguments);
          resultStr = typeof out === 'string' ? out : JSON.stringify(out);
          await db.logActivity(userId, 'tool_execution', tc.name, JSON.stringify(tc.arguments), true);
        } catch (e: any) {
          resultStr = `Error executing ${tc.name}: ${e.message}`;
          await db.logActivity(userId, 'tool_execution', tc.name, e.message, false);
        }
      } else {
        resultStr = `Tool ${tc.name} is not available.`;
        await db.logActivity(userId, 'tool_execution', tc.name, resultStr, false);
      }

      const toolMsg: AIMessage = {
        role: 'tool',
        content: resultStr,
        tool_call_id: tc.id,
        name: tc.name
      };
      await db.addMessage(userId, toolMsg);
      newMessages.push(toolMsg);
    }

    return { newMessages };
  }

  /** Execute an interactive conversation loop with the current provider */
  async handleConversation(userId: string, text?: string): Promise<AgentResponse> {
    const provider = await this.getCurrentProvider();
    if (!provider) {
      throw new Error('No AI provider configured. Run: conductor ai setup');
    }

    const db = this.conductor.getDatabase();
    const tools = await this.conductor.getPluginsManager().getEnabledTools();

    if (text) {
      const userMsg: AIMessage = { role: 'user', content: text };
      await db.addMessage(userId, userMsg);
    }

    let history = await db.getHistory(userId, 30);

    // Determine Persona
    let userIntentText = text;
    if (!userIntentText && history.length > 0) {
      const lastUser = [...history].reverse().find(m => m.role === 'user');
      if (lastUser) userIntentText = lastUser.content;
    }

    let persona = 'general';
    if (userIntentText) {
      persona = await this.determinePersona(userId, userIntentText);
    }

    let systemContent = 'You are Conductor, an autonomous integration hub agent. You are helpful, concise, and capable of executing tools on behalf of the user. Only use tools when necessary. Always respond in English, regardless of the language of the user\'s message or your training data.';

    if (persona === 'coder') {
      systemContent = 'You are Conductor [Persona: The Coder]. You are an expert software engineer. You write excellent, clean, well-documented code. You prefer using shell and file tools to accomplish programming tasks. Always respond in English, regardless of the language of the user\'s message or your training data.';
    } else if (persona === 'social') {
      systemContent = 'You are Conductor [Persona: The Social Manager]. You manage communications, social media, X/Twitter, Slack, and Telegram. You write engaging, professional, and concise updates. Always respond in English, regardless of the language of the user\'s message or your training data.';
    } else if (persona === 'researcher') {
      systemContent = 'You are Conductor [Persona: The Researcher]. You are a meticulous investigator. You use web search and browser tools to thoroughly research and summarize factual information. Always respond in English, regardless of the language of the user\'s message or your training data.';
    }

    const systemPrompt: AIMessage = {
      role: 'system',
      content: systemContent
    };

    let messages = [systemPrompt, ...history];
    let loopCount = 0;
    const maxLoops = 15;

    // Resume pending execution if needed
    const pendingProcess = await this.processToolCalls(userId, messages, tools);
    if (pendingProcess.newMessages.length > 0) messages.push(...pendingProcess.newMessages);
    if (pendingProcess.approvalRequired) {
      return { text: "Action still requires approval.", approvalRequired: pendingProcess.approvalRequired };
    }

    // Only ask AI if the last message is NOT an assistant message without tool_calls
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === 'assistant' && !lastMsg.tool_calls) {
      return { text: lastMsg.content };
    }

    while (loopCount < maxLoops) {
      loopCount++;

      const response = await provider.complete(messages, tools);
      const assistantMsg: AIMessage = {
        role: 'assistant',
        content: response.content || '',
        ...(response.tool_calls ? { tool_calls: response.tool_calls } : {})
      };

      await db.addMessage(userId, assistantMsg);
      messages.push(assistantMsg);

      if (!response.tool_calls || response.tool_calls.length === 0) {
        return { text: response.content || 'I completed the task but have nothing to say.' };
      }

      const processObj = await this.processToolCalls(userId, messages, tools);
      if (processObj.newMessages.length > 0) messages.push(...processObj.newMessages);
      if (processObj.approvalRequired) {
        return {
          text: response.content || `I need your permission to use ${processObj.approvalRequired.toolName}.`,
          approvalRequired: processObj.approvalRequired
        };
      }
    }

    return { text: "Agent loop cap reached. Task aborted to prevent runaway execution." };
  }

  /** Execute a tool that was manually approved by the user */
  async executeApprovedTool(userId: string, toolCallId: string): Promise<AgentResponse> {
    const db = this.conductor.getDatabase();
    const tools = await this.conductor.getPluginsManager().getEnabledTools();
    const history = await db.getHistory(userId, 30);

    let foundTc: AIToolCall | null = null;
    for (const msg of history) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        const tc = msg.tool_calls.find((t: AIToolCall) => t.id === toolCallId);
        if (tc) { foundTc = tc; break; }
      }
    }
    if (!foundTc) {
      return { text: "Tool call not found or already executed." };
    }

    const tool = tools.find(t => t.name === foundTc!.name);
    let resultStr = '';
    if (tool) {
      try {
        process.stderr.write(`\n  Executing Approved Tool ➔ ${foundTc.name}\n`);
        const out = await tool.handler(foundTc.arguments);
        resultStr = typeof out === 'string' ? out : JSON.stringify(out);
        await db.logActivity(userId, 'tool_execution', foundTc.name, JSON.stringify(foundTc.arguments), true);
      } catch (e: any) {
        resultStr = `Error: ${e.message}`;
        await db.logActivity(userId, 'tool_execution', foundTc.name, e.message, false);
      }
    } else {
      resultStr = `Tool ${foundTc.name} unavailable.`;
    }

    const toolMsg: AIMessage = {
      role: 'tool',
      content: resultStr,
      tool_call_id: toolCallId,
      name: foundTc.name
    };
    await db.addMessage(userId, toolMsg);

    return this.handleConversation(userId);
  }

  /** Record a denial for a tool and resume generation */
  async denyTool(userId: string, toolCallId: string): Promise<AgentResponse> {
    const db = this.conductor.getDatabase();
    const history = await db.getHistory(userId, 30);

    let foundTc: AIToolCall | null = null;
    for (const msg of history) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        const tc = msg.tool_calls.find((t: AIToolCall) => t.id === toolCallId);
        if (tc) { foundTc = tc; break; }
      }
    }

    if (!foundTc) {
      return { text: "Tool call not found." };
    }

    const toolMsg: AIMessage = {
      role: 'tool',
      content: "User denied the execution of this action.",
      tool_call_id: toolCallId,
      name: foundTc.name
    };
    await db.addMessage(userId, toolMsg);

    return this.handleConversation(userId);
  }
}
