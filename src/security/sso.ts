/**
 * Enterprise SSO/OIDC Auth Middleware
 *
 * Supports:
 * - OIDC (Okta, Auth0, Google Workspace, Azure AD)
 * - Custom JWT
 *
 * Usage:
 *   conductor config set security.auth.provider oidc
 *   conductor config set security.auth.clientId <id>
 *   conductor config set security.auth.clientSecret <secret>
 *   conductor config set security.auth.issuerUrl <url>
 */

import jwt from 'jsonwebtoken';

export interface AuthConfig {
  provider: 'none' | 'oidc' | 'saml' | 'jwt';
  issuerUrl?: string;
  clientId?: string;
  clientSecret?: string;
  audience?: string;
  jwksUri?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  roles: string[];
}

export class AuthMiddleware {
  private config: AuthConfig;

  constructor(config: any) {
    this.config = config?.security?.auth ?? { provider: 'none' };
  }

  isEnabled(): boolean {
    return this.config.provider !== 'none';
  }

  async verifyToken(token: string): Promise<AuthUser | null> {
    if (this.config.provider === 'none' || !token) {
      return null;
    }

    try {
      if (this.config.provider === 'jwt') {
        return this.verifyJWT(token);
      }
      return this.verifyOIDC(token);
    } catch (err) {
      console.error('Auth verification failed:', err);
      return null;
    }
  }

  private verifyJWT(token: string): AuthUser {
    const secret = this.config.clientSecret;
    if (!secret) throw new Error('JWT secret not configured');

    const decoded = jwt.verify(token, secret, {
      issuer: this.config.issuerUrl,
      audience: this.config.audience,
    }) as any;

    return {
      id: decoded.sub,
      email: decoded.email,
      name: decoded.name,
      roles: decoded.roles ?? [],
    };
  }

  private async verifyOIDC(token: string): Promise<AuthUser> {
    // Introspect endpoint
    const response = await fetch(this.config.issuerUrl + '/oauth/introspect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
      },
      body: `token=${token}`,
    });

    const data = (await response.json()) as any;
    if (!data.active) throw new Error('Token inactive');

    return {
      id: data.sub,
      email: data.email ?? data.preferred_username,
      name: data.name,
      roles: data.roles ?? [],
    };
  }
}

export function createAuthMiddleware(config: any) {
  const auth = new AuthMiddleware(config);

  return async (req: any, res: any, next: any) => {
    if (!auth.isEnabled()) return next();

    const token = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-forwarded-auth'] || '';

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await auth.verifyToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = user;
    next();
  };
}
