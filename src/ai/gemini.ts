import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIProvider, AIMessage, AIResponse } from './base.js';
import { google } from 'googleapis';
import http from 'http';
import { URL } from 'url';

export class GeminiProvider extends AIProvider {
  private client: GoogleGenerativeAI | null = null;
  private oauth2Client: any = null;

  getName(): string {
    return 'Gemini';
  }

  /** Initialize with API key (simple method). */
  async initialize(apiKey: string): Promise<void> {
    if (!this.config) {
      this.config = {};
    }
    this.config.model = this.config.model || 'gemini-2.0-flash-exp';
    this.client = new GoogleGenerativeAI(apiKey);
  }

  /** Initialize with OAuth (one-click login). */
  async initializeWithOAuth(
    clientId: string,
    clientSecret: string,
    redirectUri: string = 'http://localhost:3000/google/callback'
  ): Promise<string> {
    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/generative-language'],
    });

    return authUrl;
  }

  /** Complete OAuth flow by exchanging code for tokens. */
  async completeOAuthFlow(code: string): Promise<void> {
    if (!this.oauth2Client) throw new Error('OAuth not initialized');

    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);

    this.client = new GoogleGenerativeAI(tokens.access_token);
  }

  /** Start local server to handle OAuth callback. */
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
                    <h1>✅ Success!</h1>
                    <p>You're logged in with Google.</p>
                    <p>You can close this window and return to terminal.</p>
                  </body>
                </html>
              `);

              server.close();
              resolve();
            } catch (error) {
              res.writeHead(500, { 'Content-Type': 'text/html' });
              res.end('<h1>Authentication failed</h1>');
              server.close();
              reject(error);
            }
          }
        }
      });

      server.listen(3000);
      server.on('error', reject);
    });
  }

  async complete(messages: AIMessage[]): Promise<AIResponse> {
    if (!this.client) throw new Error('Gemini not initialized');

    const model = this.client.getGenerativeModel({
      model: this.config.model || 'gemini-2.0-flash-exp',
    });

    const geminiMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' as const : 'user' as const,
        parts: [{ text: m.content }],
      }));

    const systemInstruction = messages.find(m => m.role === 'system');

    const chat = model.startChat({
      history: geminiMessages.slice(0, -1),
      systemInstruction: systemInstruction?.content,
    });

    const lastMessage = geminiMessages[geminiMessages.length - 1];
    const result = await chat.sendMessage(lastMessage.parts[0].text);
    const response = result.response;

    return {
      content: response.text(),
      model: this.config.model || 'gemini-2.0-flash-exp',
      tokens_used: response.usageMetadata?.totalTokenCount,
    };
  }

  async *stream(messages: AIMessage[]): AsyncGenerator<string> {
    if (!this.client) throw new Error('Gemini not initialized');

    const model = this.client.getGenerativeModel({
      model: this.config.model || 'gemini-2.0-flash-exp',
    });

    const geminiMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
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
