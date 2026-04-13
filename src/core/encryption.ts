/**
 * Encryption at rest for sensitive config data.
 * Uses AES-256-GCM with a machine-derived key.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Derive an encryption key from machine-specific data.
 * The key is stored in the config directory and tied to the machine.
 */
export class EncryptionManager {
  private keyPath: string;
  private key: Buffer | null = null;

  constructor(configDir: string) {
    this.keyPath = path.join(configDir, '.key');
  }

  /**
   * Get or create the encryption key.
   */
  private async getKey(): Promise<Buffer> {
    if (this.key) return this.key;

    try {
      const existing = await fs.readFile(this.keyPath);
      if (existing.length === KEY_LENGTH) {
        this.key = existing;
        return this.key;
      }
    } catch {
      /* key doesn't exist - generate new one */
    }

    // Generate new key
    this.key = crypto.randomBytes(KEY_LENGTH);
    await fs.writeFile(this.keyPath, this.key, { mode: 0o600 });
    return this.key;
  }

  /**
   * Encrypt data using AES-256-GCM.
   */
  async encrypt(plaintext: string): Promise<string> {
    const key = await this.getKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Format: iv + authTag + ciphertext (all base64)
    const result = Buffer.concat([iv, authTag, encrypted]);
    return result.toString('base64');
  }

  /**
   * Decrypt data using AES-256-GCM.
   */
  async decrypt(ciphertext: string): Promise<string> {
    const key = await this.getKey();
    const data = Buffer.from(ciphertext, 'base64');

    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    return decrypted.toString('utf8');
  }

  /**
   * Check if encryption has been initialized.
   */
  async isInitialized(): Promise<boolean> {
    try {
      await fs.access(this.keyPath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Encrypt a value if it looks sensitive.
 */
export function looksEncrypted(value: string): boolean {
  // Base64 strings that look like encryption output
  return /^[A-Za-z0-9+/]{40,}={0,2}$/.test(value);
}
