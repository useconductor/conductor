import { GoogleGenerativeAI, type FunctionDeclaration, type Tool as GeminiTool } from '@google/generative-ai';
import { AIProvider, AIMessage, AIResponse } from './base.js';
import { PluginTool } from '../plugins/manager.js';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import http from 'http';
import { URL } from 'url';

function convertToGeminiTools(tools?: PluginTool[]): GeminiTool[] {
  if (!tools || tools.length === 0) return [];

  const declarations: FunctionDeclaration[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema as unknown as FunctionDeclaration['parameters'],
  }));

  return [{ functionDeclarations: declarations }];
}

export class GeminiProvider extends AIProvider {
  private client: GoogleGenerativeAI | null = null;
  private oauth2Client: OAuth2Client | null = null;

  getName(): string {
    return 'Gemini';
  }

  async initialize(apiKey: string): Promise<void> {
    if (!this.config) {
      this.config = {};
    }
    this.config.model = this.config.model || 'gemini-2.0-flash-exp';
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async initializeWithOAuth(
    clientId: string,
    clientSecret: string,
    redirectUri = 'http://localhost:3000/google/callback',
  ): Promise<string> {
    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri,
    );

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/generative-language'],
    });

    return authUrl;
  }

  async completeOAuthFlow(code: string): Promise<void> {
    if (!this.oauth2Client) throw new Error('OAuth not initialized');

    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);

    this.client = new GoogleGenerativeAI(tokens.access_token as string);
  }

  async loginWithBrowser(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '', 'http://localhost:3000');

        if (url.pathname === '/google/callback') {
          const code = url.searchParams.get('code');

          if (code) {
            try {
              await this.completeOAuthFlow(code);

              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h1>Success!</h1>
                    <p>You're logged in with Google.</p>
                    <p>You can close this window and return to terminal.</p>
                  </body>
                </html>
              `);

              server.close();
              resolve();
            } catch {
              res.writeHead(500, { 'Content-Type': 'text/html' });
              res.end('<h1>Authentication failed</h1>');
              server.close();
              reject(new Error('OAuth flow failed'));
            }
          }
        }
      });

      server.listen(3000);
      server.on('error', reject);
    });
  }

  async complete(messages: AIMessage[], tools?: PluginTool[]): Promise<AIResponse> {
    if (!this.client) throw new Error('Gemini not initialized');

    const model = this.client.getGenerativeModel({
      model: this.config.model || 'gemini-2.0-flash-exp',
      tools: convertToGeminiTools(tools),
    });

    const geminiMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' as const : 'user' as const,
        parts: [{ text: m.content }],
      }));

    const systemInstruction = messages.find((m) => m.role === 'system');

    const chat = model.startChat({
      history: geminiMessages.slice(0, -1),
      systemInstruction: systemInstruction?.content,
    });

    const lastMessage = geminiMessages[geminiMessages.length - 1];
    const result = await chat.sendMessage(lastMessage.parts[0].text);
    const response = result.response;

    // Check for function calls
    const functionCalls = response.functionCalls();
    if (functionCalls && functionCalls.length > 0) {
      const fc = functionCalls[0];
      return {
        content: response.text() || '',
        model: this.config.model || 'gemini-2.0-flash-exp',
        tokens_used: response.usageMetadata?.totalTokenCount,
        tool_calls: [
          {
            id: fc.name,
            name: fc.name,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            arguments: (fc.args ?? {}) as Record<string, any>,
          },
        ],
      };
    }

    return {
      content: response.text(),
      model: this.config.model || 'gemini-2.0-flash-exp',
      tokens_used: response.usageMetadata?.totalTokenCount,
    };
  }

  async *stream(messages: AIMessage[], tools?: PluginTool[]): AsyncGenerator<string> {
    if (!this.client) throw new Error('Gemini not initialized');

    const model = this.client.getGenerativeModel({
      model: this.config.model || 'gemini-2.0-flash-exp',
      tools: convertToGeminiTools(tools),
    });

    const geminiMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' as const : 'user' as const,
        parts: [{ text: m.content }],
      }));

    const chat = model.startChat({
      history: geminiMessages.slice(0, -1),
    });

    const lastMessage = geminiMessages[geminiMessages.length - 1];
    const result = await chat.sendMessageStream(lastMessage.parts[0].text);

    for await (const chunk of result.stream) {
      yield chunk.text();
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
