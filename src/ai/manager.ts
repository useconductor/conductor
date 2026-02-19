import { AIProvider } from './base.js';
import { ClaudeProvider } from './claude.js';
import { OpenAIProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';
import { OllamaProvider } from './ollama.js';
import { OpenRouterProvider } from './openrouter.js';
import { Conductor } from '../core/conductor.js';
import { Keychain } from '../security/keychain.js';

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
        // Try API key first
        const apiKey = await this.keychain.get('gemini', 'api_key');
        if (apiKey) {
          const provider = new GeminiProvider({
            model: this.conductor.getConfig().get<string>('ai.model'),
          });
          await provider.initialize(apiKey);
          this.currentProvider = provider;
          return provider;
        }

        // Try OAuth access token
        const accessToken = await this.keychain.get('gemini', 'access_token');
        if (accessToken) {
          const provider = new GeminiProvider({
            model: this.conductor.getConfig().get<string>('ai.model'),
          });
          await provider.initialize(accessToken);
          this.currentProvider = provider;
          return provider;
        }

        throw new Error('Gemini not configured. Run: conductor ai gemini');
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
      getOAuthCredentials('gemini');

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
}
