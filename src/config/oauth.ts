/**
 * OAuth credentials for Conductor.
 *
 * These are the app's OAuth credentials, not user credentials.
 * Users authenticate through the OAuth flow using these credentials.
 *
 * Precedence:
 *   1. Environment variables (recommended for production)
 *   2. ~/.conductor/config.json oauth section (set by installer)
 *
 * To configure: run the installer (install.sh) or set env vars:
 *   CONDUCTOR_GOOGLE_CLIENT_ID
 *   CONDUCTOR_GOOGLE_CLIENT_SECRET
 */

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export const OAUTH_CREDENTIALS: Record<string, OAuthCredentials> = {
  google: {
    clientId:
      process.env.CONDUCTOR_GOOGLE_CLIENT_ID || '',
    clientSecret:
      process.env.CONDUCTOR_GOOGLE_CLIENT_SECRET || '',
    redirectUri:
      process.env.CONDUCTOR_GOOGLE_REDIRECT_URI || 'http://localhost:3000/callback',
  },
  gemini: {
    clientId:
      process.env.CONDUCTOR_GOOGLE_CLIENT_ID || '',
    clientSecret:
      process.env.CONDUCTOR_GOOGLE_CLIENT_SECRET || '',
    redirectUri:
      process.env.CONDUCTOR_GOOGLE_REDIRECT_URI || 'http://localhost:3000/callback',
  },
};

export function getOAuthCredentials(provider: string): OAuthCredentials {
  const creds = OAUTH_CREDENTIALS[provider];
  if (!creds) {
    throw new Error(`No OAuth credentials configured for ${provider}`);
  }
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error(
      `Google OAuth not configured. Set CONDUCTOR_GOOGLE_CLIENT_ID and ` +
      `CONDUCTOR_GOOGLE_CLIENT_SECRET, or run the installer.`
    );
  }
  return creds;
}
