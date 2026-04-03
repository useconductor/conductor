import crypto from 'crypto';
import fs from 'fs/promises';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import os from 'os';

/**
 * Keychain — encrypted credential storage.
 *
 * Supports two formats:
 *   v2  — AES-256-GCM with machine-specific key derivation (written by install.sh)
 *   v1  — AES-256-CBC legacy format (written by older versions)
 *
 * New writes always use the v2 format.
 */
export class Keychain {
  private keychainDir: string;
  private masterKey: Buffer;

  constructor(configDir: string) {
    this.keychainDir = path.join(configDir, 'keychain');
    this.masterKey = this.deriveMasterKey();
  }

  /**
   * Derive a machine-specific master key.
   * Matches the install.sh derivation so credentials saved by either
   * the installer or the app are interchangeable.
   */
  private deriveMasterKey(): Buffer {
    const machineSecret = this.getMachineSecret();
    const salt = crypto.createHash('sha256').update('conductor:keychain:v1').digest();
    return crypto.scryptSync(machineSecret, salt, 32, { N: 16384, r: 8, p: 1 });
  }

  /**
   * Get a machine-specific secret for key derivation.
   * Mirrors the logic in install.sh's save_cred function.
   */
  private getMachineSecret(): string {
    // Linux: /etc/machine-id or /var/lib/dbus/machine-id
    const linuxSources = ['/etc/machine-id', '/var/lib/dbus/machine-id', '/proc/sys/kernel/random/boot_id'];

    for (const src of linuxSources) {
      try {
        const data = readFileSync(src, 'utf8').trim();
        if (data) return data;
      } catch {
        // Not available on this platform
      }
    }

    // macOS: IOPlatformUUID
    if (process.platform === 'darwin') {
      try {
        const out = execSync("ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformUUID/{print $NF}'", {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
          .trim()
          .replace(/"/g, '');
        if (out) return out;
      } catch {
        // ioreg not available
      }
    }

    // Windows: MachineGuid from registry
    if (process.platform === 'win32') {
      try {
        const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const match = out.match(/MachineGuid\s+REG_SZ\s+(.+)/);
        if (match?.[1]?.trim()) return match[1].trim();
      } catch {
        // Registry not accessible
      }
    }

    // Persistent fallback: Save a random UUID to a file if hardware IDs fail.
    // This is safer than hostname which can change.
    const fallbackPath = path.join(this.keychainDir, 'machine_secret');
    try {
      if (readFileSync(fallbackPath, 'utf8').trim()) {
        return readFileSync(fallbackPath, 'utf8').trim();
      }
    } catch {
      try {
        const secret = crypto.randomUUID();
        // Use synchronous write since this is inside deriveMasterKey constructor path
        mkdirSync(this.keychainDir, { recursive: true, mode: 0o700 });
        writeFileSync(fallbackPath, secret, { mode: 0o600 });
        return secret;
      } catch {
        // Absolute last resort
        return os.hostname();
      }
    }

    return os.hostname();
  }

  /**
   * Store an encrypted credential (v2 format: AES-256-GCM).
   */
  async set(service: string, key: string, value: string): Promise<void> {
    await fs.mkdir(this.keychainDir, { recursive: true, mode: 0o700 });
    // Enforce 0700 permissions in case dir already existed with wrong perms
    await fs.chmod(this.keychainDir, 0o700).catch(() => {});

    const iv = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);

    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');

    // Format: v2:iv:tag:ciphertext
    const result = ['v2', iv.toString('hex'), tag, encrypted].join(':');

    const filepath = path.join(this.keychainDir, `${service}.${key}.enc`);
    await fs.writeFile(filepath, result, { mode: 0o600 });
  }

  /**
   * Retrieve and decrypt a credential.
   * Handles both v2 (GCM) and legacy v1 (CBC) formats.
   */
  async get(service: string, key: string): Promise<string | null> {
    try {
      const filepath = path.join(this.keychainDir, `${service}.${key}.enc`);
      const data = await fs.readFile(filepath, 'utf-8');
      return this.decrypt(data.trim());
    } catch {
      return null;
    }
  }

  /**
   * Delete a credential.
   */
  async delete(service: string, key: string): Promise<void> {
    const filepath = path.join(this.keychainDir, `${service}.${key}.enc`);
    try {
      await fs.unlink(filepath);
    } catch {
      // File doesn't exist — that's fine
    }
  }

  /**
   * Check if a credential exists.
   */
  async has(service: string, key: string): Promise<boolean> {
    try {
      const filepath = path.join(this.keychainDir, `${service}.${key}.enc`);
      await fs.access(filepath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all credential keys for a service.
   */
  async list(service: string): Promise<string[]> {
    try {
      const files = await fs.readdir(this.keychainDir);
      return files
        .filter((f) => f.startsWith(`${service}.`) && f.endsWith('.enc'))
        .map((f) => f.replace(`${service}.`, '').replace('.enc', ''));
    } catch {
      return [];
    }
  }

  /**
   * Decrypt a stored value, auto-detecting format version.
   */
  private decrypt(stored: string): string {
    const parts = stored.split(':');

    if (parts[0] === 'v2' && parts.length === 4) {
      // v2: AES-256-GCM — iv:tag:ciphertext
      return this.decryptGCM(parts[1], parts[2], parts[3]);
    }

    if (parts.length === 2) {
      // Legacy v1: AES-256-CBC — iv:ciphertext (no version prefix)
      return this.decryptCBC(parts[0], parts[1]);
    }

    throw new Error('Unrecognized credential format');
  }

  /**
   * AES-256-GCM decryption (v2 format, matches install.sh).
   */
  private decryptGCM(ivHex: string, tagHex: string, cipherHex: string): string {
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * AES-256-CBC decryption (legacy v1 format).
   * Kept for backward-compat with credentials written before the v2 migration.
   */
  private decryptCBC(ivHex: string, cipherHex: string): string {
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.masterKey, iv);

    let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
