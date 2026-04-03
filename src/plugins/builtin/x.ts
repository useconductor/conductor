/**
 * X (Twitter) Plugin
 *
 * Post tweets, search X, get user info, manage timeline.
 * Uses X API v2 with a Bearer Token (read) and OAuth 1.0a (write).
 *
 * Setup:
 *   For read-only (search, timeline, user lookup):
 *     1. Go to https://developer.x.com and create a project + app
 *     2. Copy the Bearer Token
 *     3. Run: conductor plugins config x bearer_token <YOUR_TOKEN>
 *
 *   For posting (tweets, likes, follows):
 *     Also needed: API Key, API Secret, Access Token, Access Token Secret
 *     These use OAuth 1.0a for user-level write access.
 *     Run: conductor plugins config x api_key <KEY>
 *          conductor plugins config x api_secret <SECRET>
 *          conductor plugins config x access_token <TOKEN>
 *          conductor plugins config x access_secret <SECRET>
 *
 * Stored in keychain as: x / bearer_token, x / api_key, etc.
 *
 * Note: X API free tier allows ~500k tweet reads/month and posting.
 *       Basic plan ($100/mo) removes most limits.
 */

import crypto from 'crypto';
import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';
import { withRetry } from '../../core/retry.js';

const X_BASE = 'https://api.twitter.com/2';

export class XPlugin implements Plugin {
  name = 'x';
  description = 'Post tweets, search X, get timelines and user info — requires X API credentials';
  version = '1.0.0';

  configSchema = {
    fields: [
      {
        key: 'bearer_token',
        label: 'X Bearer Token',
        type: 'password' as const,
        required: true,
        secret: true,
        service: 'x'
      },
      {
        key: 'api_key',
        label: 'X API Key (Consumer)',
        type: 'password' as const,
        required: true,
        secret: true,
        service: 'x'
      },
      {
        key: 'api_secret',
        label: 'X API Secret (Consumer)',
        type: 'password' as const,
        required: true,
        secret: true,
        service: 'x'
      },
      {
        key: 'access_token',
        label: 'X Access Token',
        type: 'password' as const,
        required: true,
        secret: true,
        service: 'x'
      },
      {
        key: 'access_secret',
        label: 'X Access Secret',
        type: 'password' as const,
        required: true,
        secret: true,
        service: 'x'
      }
    ],
    setupInstructions: 'Create a Project and App in developer.x.com. Enable "User authentication settings" with OAuth 1.0a permissions for write access.'
  };

  private keychain!: Keychain;

  async initialize(conductor: Conductor): Promise<void> {
    this.keychain = new Keychain(conductor.getConfig().getConfigDir());
  }

  isConfigured(): boolean { return true; }

  private async getBearerToken(): Promise<string> {
    const token = await this.keychain.get('x', 'bearer_token');
    if (!token) {
      throw new Error(
        'X Bearer Token not configured.\n' +
        'Get one at https://developer.x.com and run:\n' +
        '  conductor plugins config x bearer_token <YOUR_TOKEN>'
      );
    }
    return token;
  }

  private async getOAuthCreds(): Promise<{
    apiKey: string;
    apiSecret: string;
    accessToken: string;
    accessSecret: string;
  }> {
    const [apiKey, apiSecret, accessToken, accessSecret] = await Promise.all([
      this.keychain.get('x', 'api_key'),
      this.keychain.get('x', 'api_secret'),
      this.keychain.get('x', 'access_token'),
      this.keychain.get('x', 'access_secret'),
    ]);
    if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
      throw new Error(
        'X write credentials not fully configured. Run:\n' +
        '  conductor plugins config x api_key <KEY>\n' +
        '  conductor plugins config x api_secret <SECRET>\n' +
        '  conductor plugins config x access_token <TOKEN>\n' +
        '  conductor plugins config x access_secret <SECRET>'
      );
    }
    return { apiKey, apiSecret, accessToken, accessSecret };
  }

  private async xFetch(path: string, params?: Record<string, string>): Promise<any> {
    const token = await this.getBearerToken();
    const url = new URL(`${X_BASE}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }

    return withRetry(async () => {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        let errStr = res.statusText;
        try {
          const errJSON = await res.json() as any;
          errStr = errJSON.detail ?? errJSON.title ?? res.statusText;
        } catch { }
        const error = new Error(`X API ${res.status}: ${errStr}`);
        (error as any).status = res.status;
        throw error;
      }
      return res.json();
    });
  }

  private buildOAuthHeader(
    method: string,
    url: string,
    creds: { apiKey: string; apiSecret: string; accessToken: string; accessSecret: string }
  ): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const oauthParams: Record<string, string> = {
      oauth_consumer_key: creds.apiKey,
      oauth_nonce: nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_token: creds.accessToken,
      oauth_version: '1.0',
    };

    const allParams = { ...oauthParams };
    const sortedParams = Object.keys(allParams)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
      .join('&');

    const baseString = [
      method.toUpperCase(),
      encodeURIComponent(url),
      encodeURIComponent(sortedParams),
    ].join('&');

    const signingKey = `${encodeURIComponent(creds.apiSecret)}&${encodeURIComponent(creds.accessSecret)}`;
    const signature = crypto
      .createHmac('sha1', signingKey)
      .update(baseString)
      .digest('base64');

    oauthParams['oauth_signature'] = signature;

    const headerValue = Object.keys(oauthParams)
      .map((k) => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
      .join(', ');

    return `OAuth ${headerValue}`;
  }

  private async xPost(path: string, body: any): Promise<any> {
    const creds = await this.getOAuthCreds();
    const url = `${X_BASE}${path}`;
    const authHeader = this.buildOAuthHeader('POST', url, creds);

    return withRetry(async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let errStr = res.statusText;
        try {
          const errJSON = await res.json() as any;
          errStr = errJSON.detail ?? errJSON.title ?? res.statusText;
        } catch { }
        const error = new Error(`X API ${res.status}: ${errStr}`);
        (error as any).status = res.status;
        throw error;
      }
      return res.json();
    });
  }

  private formatTweet(t: any, includes?: any) {
    const author = includes?.users?.find((u: any) => u.id === t.author_id);
    return {
      id: t.id,
      text: t.text,
      author: author
        ? { id: author.id, username: author.username, name: author.name }
        : { id: t.author_id },
      createdAt: t.created_at ?? '',
      publicMetrics: t.public_metrics ?? {},
      url: t.author_id ? `https://x.com/i/web/status/${t.id}` : '',
    };
  }

  getTools(): PluginTool[] {
    return [
      // ── x_search ────────────────────────────────────────────────────────────
      {
        name: 'x_search',
        description:
          'Search recent tweets on X. Supports operators like from:user, #hashtag, -filter:retweets',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'X search query' },
            maxResults: {
              type: 'number',
              description: 'Max tweets to return (10–100, default: 10)',
            },
            sortOrder: {
              type: 'string',
              enum: ['recency', 'relevancy'],
              description: 'Sort by recency or relevancy (default: recency)',
            },
          },
          required: ['query'],
        },
        handler: async ({ query, maxResults = 10, sortOrder = 'recency' }: any) => {
          const res = await this.xFetch('/tweets/search/recent', {
            query,
            max_results: String(Math.min(Math.max(maxResults, 10), 100)),
            sort_order: sortOrder,
            'tweet.fields': 'created_at,public_metrics,author_id',
            expansions: 'author_id',
            'user.fields': 'username,name',
          });
          return {
            count: res.data?.length ?? 0,
            tweets: (res.data ?? []).map((t: any) => this.formatTweet(t, res.includes)),
          };
        },
      },

      // ── x_get_user ──────────────────────────────────────────────────────────
      {
        name: 'x_get_user',
        description: 'Get an X user profile by username or ID',
        inputSchema: {
          type: 'object',
          properties: {
            username: { type: 'string', description: 'X username (without @)' },
            userId: { type: 'string', description: 'X user ID (alternative to username)' },
          },
        },
        handler: async ({ username, userId }: any) => {
          if (!username && !userId) throw new Error('Provide username or userId.');
          const path = userId ? `/users/${userId}` : `/users/by/username/${username}`;
          const res = await this.xFetch(path, {
            'user.fields': 'name,username,description,public_metrics,created_at,verified,location,url',
          });
          const u = res.data;
          return {
            id: u.id,
            username: u.username,
            name: u.name,
            bio: u.description ?? '',
            location: u.location ?? '',
            url: u.url ?? '',
            followers: u.public_metrics?.followers_count ?? 0,
            following: u.public_metrics?.following_count ?? 0,
            tweetCount: u.public_metrics?.tweet_count ?? 0,
            verified: u.verified ?? false,
            createdAt: u.created_at ?? '',
            xUrl: `https://x.com/${u.username}`,
          };
        },
      },

      // ── x_get_timeline ──────────────────────────────────────────────────────
      {
        name: 'x_get_timeline',
        description: "Get a user's recent tweets",
        inputSchema: {
          type: 'object',
          properties: {
            username: { type: 'string', description: 'X username (without @)' },
            maxResults: { type: 'number', description: 'Max tweets (5–100, default: 10)' },
            excludeReplies: {
              type: 'boolean',
              description: 'Exclude reply tweets (default: false)',
            },
            excludeRetweets: {
              type: 'boolean',
              description: 'Exclude retweets (default: false)',
            },
          },
          required: ['username'],
        },
        handler: async ({ username, maxResults = 10, excludeReplies = false, excludeRetweets = false }: any) => {
          const userRes = await this.xFetch(`/users/by/username/${username}`);
          const userId = userRes.data?.id;
          if (!userId) throw new Error(`User not found: ${username}`);

          const exclude: string[] = [];
          if (excludeReplies) exclude.push('replies');
          if (excludeRetweets) exclude.push('retweets');

          const params: Record<string, string> = {
            max_results: String(Math.min(Math.max(maxResults, 5), 100)),
            'tweet.fields': 'created_at,public_metrics',
          };
          if (exclude.length) params.exclude = exclude.join(',');

          const res = await this.xFetch(`/users/${userId}/tweets`, params);
          return {
            username,
            count: res.data?.length ?? 0,
            tweets: (res.data ?? []).map((t: any) => ({
              id: t.id,
              text: t.text,
              createdAt: t.created_at ?? '',
              likes: t.public_metrics?.like_count ?? 0,
              retweets: t.public_metrics?.retweet_count ?? 0,
              replies: t.public_metrics?.reply_count ?? 0,
              url: `https://x.com/${username}/status/${t.id}`,
            })),
          };
        },
      },

      // ── x_post_tweet ────────────────────────────────────────────────────────
      {
        name: 'x_post_tweet',
        description: 'Post a new tweet to X (requires OAuth 1.0a write credentials)',
        requiresApproval: true,
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Tweet text (max 280 chars)' },
            replyToId: {
              type: 'string',
              description: 'Tweet ID to reply to (optional)',
            },
          },
          required: ['text'],
        },
        handler: async ({ text, replyToId }: any) => {
          if (text.length > 280) {
            return { error: `Tweet too long: ${text.length} chars (max 280).` };
          }
          const body: any = { text };
          if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId };

          const res = await this.xPost('/tweets', body);
          return {
            posted: true,
            id: res.data?.id,
            text: res.data?.text,
            url: `https://x.com/i/web/status/${res.data?.id}`,
          };
        },
      },

      // ── x_delete_tweet ──────────────────────────────────────────────────────
      {
        name: 'x_delete_tweet',
        description: 'Delete one of your tweets (requires OAuth write credentials)',
        requiresApproval: true,
        inputSchema: {
          type: 'object',
          properties: {
            tweetId: { type: 'string', description: 'Tweet ID to delete' },
          },
          required: ['tweetId'],
        },
        handler: async ({ tweetId }: any) => {
          const creds = await this.getOAuthCreds();
          const url = `${X_BASE}/tweets/${tweetId}`;
          const authHeader = this.buildOAuthHeader('DELETE', url, creds);

          const res = await fetch(url, {
            method: 'DELETE',
            headers: { Authorization: authHeader },
          });
          if (!res.ok) throw new Error(`Delete failed: ${res.status} ${res.statusText}`);
          const data = await res.json() as any;
          return { deleted: data.data?.deleted ?? true, tweetId };
        },
      },

      // ── x_like_tweet ────────────────────────────────────────────────────────
      {
        name: 'x_like_tweet',
        description: 'Like a tweet (requires OAuth write credentials and your user ID)',
        requiresApproval: true,
        inputSchema: {
          type: 'object',
          properties: {
            tweetId: { type: 'string', description: 'Tweet ID to like' },
            userId: { type: 'string', description: 'Your X user ID (required for liking)' },
          },
          required: ['tweetId', 'userId'],
        },
        handler: async ({ tweetId, userId }: any) => {
          const res = await this.xPost(`/users/${userId}/likes`, { tweet_id: tweetId });
          return { liked: res.data?.liked ?? true, tweetId };
        },
      },
    ];
  }
}
