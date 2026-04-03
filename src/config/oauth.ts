import { Conductor } from '../core/conductor.js';

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getOAuthCredentials(conductor: Conductor, provider: string): OAuthCredentials {
  const config = conductor.getConfig();
  const searchProvider = provider === 'gemini' ? 'google' : provider;
  const oauth = config.get<any>(`oauth.${searchProvider}`) || {};

  const clientId = process.env.CONDUCTOR_GOOGLE_CLIENT_ID || oauth.clientId || '';
  const clientSecret = process.env.CONDUCTOR_GOOGLE_CLIENT_SECRET || oauth.clientSecret || '';
  const redirectUri =
    process.env.CONDUCTOR_GOOGLE_REDIRECT_URI || oauth.redirectUri || 'http://localhost:3000/callback';

  if (!clientId || !clientSecret) {
    throw new Error(
      `Google OAuth not configured. Run "conductor google" to setup your Client ID and Secret interactively.`,
    );
  }

  return { clientId, clientSecret, redirectUri };
}
