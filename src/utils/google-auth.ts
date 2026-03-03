import { google } from 'googleapis';
import http from 'http';
import { URL } from 'url';
import { Conductor } from '../core/conductor.js';
import { Keychain } from '../security/keychain.js';
import { getOAuthCredentials } from '../config/oauth.js';
import fs from 'fs/promises';

export interface GoogleAuthOptions {
    scopes: string[];
    port?: number;
}

export class GoogleAuthManager {
    private conductor: Conductor;
    private keychain: Keychain;
    private oauth2Client: any = null;

    constructor(conductor: Conductor) {
        this.conductor = conductor;
        this.keychain = new Keychain(conductor.getConfig().getConfigDir());
    }

    /**
     * Start the browser-based OAuth flow.
     * Returns a promise that resolves when authentication is complete.
     */
    async login(options: GoogleAuthOptions): Promise<void> {
        let creds;
        try {
            creds = getOAuthCredentials(this.conductor, 'google');
        } catch (error) {
            console.log('\n  🔑 Google OAuth configuration missing.');
            console.log('  To get these, go to: https://console.cloud.google.com/apis/credentials');
            console.log('  1. Create a "OAuth client ID" for "Web application"');
            console.log('  2. Set Redirect URI to: http://localhost:3000/callback\n');

            const { default: inquirer } = await import('inquirer');
            const answers = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'clientId',
                    message: 'Enter your Google Client ID:',
                    validate: (input) => input.length > 0 || 'Client ID is required'
                },
                {
                    type: 'password',
                    name: 'clientSecret',
                    message: 'Enter your Google Client Secret:',
                    mask: '*',
                    validate: (input) => input.length > 0 || 'Client Secret is required'
                }
            ]);

            await this.conductor.getConfig().set('oauth.google', {
                clientId: answers.clientId,
                clientSecret: answers.clientSecret,
                redirectUri: 'http://localhost:3000/callback'
            });

            console.log('\n  ✅ Credentials saved locally.');
            creds = {
                clientId: answers.clientId,
                clientSecret: answers.clientSecret,
                redirectUri: 'http://localhost:3000/callback'
            };
        }

        const port = options.port || 3000;
        const redirectUri = creds.redirectUri || `http://localhost:${port}/google/callback`;

        this.oauth2Client = new google.auth.OAuth2(
            creds.clientId,
            creds.clientSecret,
            redirectUri
        );

        const authUrl = this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: options.scopes,
        });

        const open = (await import('open')).default;
        await open(authUrl);

        console.log('\n  🌍 Opening browser for Google authentication...');
        console.log('  ⌛ Waiting for authorization...\n');

        return new Promise((resolve, reject) => {
            const server = http.createServer(async (req, res) => {
                const url = new URL(req.url || '', `http://localhost:${port}`);

                if (url.pathname === '/google/callback' || url.pathname === '/callback') {
                    const code = url.searchParams.get('code');

                    if (code) {
                        try {
                            const { tokens } = await this.oauth2Client.getToken(code);

                            // Save tokens to keychain
                            if (tokens.access_token) {
                                await this.keychain.set('google', 'access_token', tokens.access_token);
                            }
                            if (tokens.refresh_token) {
                                await this.keychain.set('google', 'refresh_token', tokens.refresh_token);
                            }

                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(`
                <html>
                  <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #f4f7f6;">
                    <div style="max-width: 500px; margin: auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                      <h1 style="color: #2e7d32;">✅ Success!</h1>
                      <p style="font-size: 18px; color: #444;">Conductor is now connected to your Google account.</p>
                      <p style="color: #666;">You can safely close this window and return to the terminal.</p>
                    </div>
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

            server.listen(port);
            server.on('error', reject);
        });
    }

    /**
     * Import OAuth credentials from a Google JSON file.
     */
    async importFromJson(filePath: string): Promise<void> {
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            const json = JSON.parse(data);
            const web = json.web || json.installed;

            if (!web || !web.client_id || !web.client_secret) {
                throw new Error('Invalid Google OAuth JSON file structure.');
            }

            await this.conductor.getConfig().set('oauth.google', {
                clientId: web.client_id,
                clientSecret: web.client_secret,
                redirectUri: web.redirect_uris?.[0] || 'http://localhost:3000/callback'
            });

            console.log(`  ✅ Successfully imported Google credentials from ${filePath}`);
        } catch (error: any) {
            throw new Error(`Failed to import JSON: ${error.message}`);
        }
    }
}
