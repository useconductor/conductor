import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import crypto from 'crypto';

export class HashPlugin implements Plugin {
  name = 'hash';
  description = 'Hashing, encoding, UUID generation, and text utilities';
  version = '1.0.0';

  async initialize(_conductor: Conductor): Promise<void> {}
  isConfigured(): boolean { return true; }

  getTools(): PluginTool[] {
    return [
      {
        name: 'hash_text',
        description: 'Hash text with a specified algorithm (md5, sha1, sha256, sha512)',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to hash' },
            algorithm: { type: 'string', description: 'Hash algorithm', default: 'sha256' },
          },
          required: ['text'],
        },
        handler: async (input: { text: string; algorithm?: string }) => {
          const alg = input.algorithm || 'sha256';
          const hash = crypto.createHash(alg).update(input.text).digest('hex');
          return { algorithm: alg, input: input.text, hash };
        },
      },
      {
        name: 'base64_encode',
        description: 'Encode text to Base64',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string', description: 'Text to encode' } },
          required: ['text'],
        },
        handler: async (input: { text: string }) => ({
          input: input.text,
          encoded: Buffer.from(input.text).toString('base64'),
        }),
      },
      {
        name: 'base64_decode',
        description: 'Decode Base64 to text',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string', description: 'Base64 string to decode' } },
          required: ['text'],
        },
        handler: async (input: { text: string }) => ({
          input: input.text,
          decoded: Buffer.from(input.text, 'base64').toString('utf-8'),
        }),
      },
      {
        name: 'generate_uuid',
        description: 'Generate a random UUID (v4)',
        inputSchema: {
          type: 'object',
          properties: {
            count: { type: 'number', description: 'Number of UUIDs to generate', default: 1 },
          },
        },
        handler: async (input: { count?: number }) => {
          const count = Math.min(input.count || 1, 50);
          const uuids = Array.from({ length: count }, () => crypto.randomUUID());
          return { uuids };
        },
      },
      {
        name: 'generate_password',
        description: 'Generate a secure random password',
        inputSchema: {
          type: 'object',
          properties: {
            length: { type: 'number', description: 'Password length', default: 24 },
            symbols: { type: 'boolean', description: 'Include symbols', default: true },
          },
        },
        handler: async (input: { length?: number; symbols?: boolean }) => {
          const len = Math.min(Math.max(input.length || 24, 8), 128);
          let chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
          if (input.symbols !== false) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';
          const bytes = crypto.randomBytes(len);
          const password = Array.from(bytes).map(b => chars[b % chars.length]).join('');
          return { password, length: len, has_symbols: input.symbols !== false };
        },
      },
    ];
  }
}
