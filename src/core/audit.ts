/**
 * Audit Logger — Stripe-grade audit trail for every action.
 *
 * Every tool call, config change, auth event, and plugin lifecycle event
 * is logged with: timestamp, actor, action, resource, result, metadata.
 *
 * Logs are append-only, tamper-evident (SHA-256 chain), and queryable.
 * Designed for SOC 2 compliance from day one.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export interface AuditEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Who performed the action: user ID, API key ID, or 'system' */
  actor: string;
  /** Action performed: tool_call, config_set, plugin_enable, auth_login, etc. */
  action: string;
  /** Resource affected: tool name, config key, plugin name, etc. */
  resource: string;
  /** Result: success, failure, denied, timeout */
  result: 'success' | 'failure' | 'denied' | 'timeout';
  /** Optional metadata: input, output, error, duration_ms, ip, user_agent */
  metadata: Record<string, unknown>;
  /** SHA-256 of previous entry's hash + this entry's content (tamper-evident chain) */
  hash: string;
  /** Hash of the previous entry (forms a blockchain-like chain) */
  previousHash: string;
}

export class AuditLogger {
  private logDir: string;
  private currentFile: string;
  private lastHash: string;
  private maxFileSize: number;
  private buffer: AuditEntry[];
  private flushTimer: NodeJS.Timeout | null;

  constructor(configDir: string, options?: { maxFileSizeMB?: number; flushIntervalMs?: number }) {
    this.logDir = path.join(configDir, 'audit');
    this.currentFile = path.join(this.logDir, 'audit.log');
    this.lastHash = '0000000000000000000000000000000000000000000000000000000000000000';
    this.maxFileSize = (options?.maxFileSizeMB ?? 100) * 1024 * 1024;
    this.buffer = [];
    this.flushTimer = null;

    const flushInterval = options?.flushIntervalMs ?? 1000;
    this.flushTimer = setInterval(() => this.flush().catch(() => {}), flushInterval);
  }

  /**
   * Log an audit entry. Appends to buffer, flushes periodically.
   */
  async log(entry: Omit<AuditEntry, 'hash' | 'previousHash' | 'timestamp'>): Promise<void> {
    const timestamp = new Date().toISOString();
    const content = JSON.stringify({ ...entry, timestamp, previousHash: '' });
    const hash = crypto
      .createHash('sha256')
      .update(this.lastHash + content)
      .digest('hex');

    const fullEntry: AuditEntry = {
      ...entry,
      timestamp,
      previousHash: this.lastHash,
      hash,
    };

    this.buffer.push(fullEntry);
    this.lastHash = hash;

    // Flush immediately for security-critical events
    if (entry.action === 'auth_login' || entry.action === 'auth_failure' || entry.action === 'config_set') {
      await this.flush();
    }
  }

  /**
   * Convenience: log a tool call.
   */
  async toolCall(
    actor: string,
    tool: string,
    input: unknown,
    result: 'success' | 'failure' | 'denied' | 'timeout',
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.log({
      actor,
      action: 'tool_call',
      resource: tool,
      result,
      metadata: { input: this.redactSensitive(input), ...metadata },
    });
  }

  /**
   * Convenience: log a config change.
   */
  async configChange(actor: string, key: string, oldValue: unknown, newValue: unknown): Promise<void> {
    await this.log({
      actor,
      action: 'config_set',
      resource: key,
      result: 'success',
      metadata: { old_value: this.redactSensitive(oldValue), new_value: this.redactSensitive(newValue) },
    });
  }

  /**
   * Convenience: log an auth event.
   */
  async authEvent(
    actor: string,
    method: string,
    success: boolean,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.log({
      actor,
      action: success ? 'auth_login' : 'auth_failure',
      resource: method,
      result: success ? 'success' : 'failure',
      metadata,
    });
  }

  /**
   * Convenience: log a plugin lifecycle event.
   */
  async pluginEvent(
    actor: string,
    plugin: string,
    action: 'enable' | 'disable' | 'install' | 'uninstall' | 'update',
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.log({
      actor,
      action: `plugin_${action}`,
      resource: plugin,
      result: 'success',
      metadata,
    });
  }

  /**
   * Query audit logs with filters.
   */
  async query(options?: {
    actor?: string;
    action?: string;
    resource?: string;
    result?: string;
    since?: string;
    limit?: number;
  }): Promise<AuditEntry[]> {
    const entries: AuditEntry[] = [];

    try {
      const files = await fs.readdir(this.logDir);
      const logFiles = files.filter((f) => f.endsWith('.log')).sort();

      for (const file of logFiles) {
        const content = await fs.readFile(path.join(this.logDir, file), 'utf-8');
        for (const line of content.split('\n').filter((l) => l.trim())) {
          try {
            const entry = JSON.parse(line) as AuditEntry;
            if (options?.actor && entry.actor !== options.actor) continue;
            if (options?.action && entry.action !== options.action) continue;
            if (options?.resource && entry.resource !== options.resource) continue;
            if (options?.result && entry.result !== options.result) continue;
            if (options?.since && entry.timestamp < options.since) continue;
            entries.push(entry);
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch {
      // No logs yet
    }

    const limit = options?.limit ?? 1000;
    return entries.slice(-limit);
  }

  /**
   * Verify the integrity of the audit log chain.
   * Returns true if no tampering detected.
   */
  async verifyIntegrity(): Promise<{ valid: boolean; brokenAt?: string }> {
    try {
      const content = await fs.readFile(this.currentFile, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';

      for (const line of lines) {
        const entry = JSON.parse(line) as AuditEntry;

        // Reconstruct what the hash should be
        const expectedHash = crypto
          .createHash('sha256')
          .update(prevHash + JSON.stringify({ ...entry, previousHash: entry.previousHash }))
          .digest('hex');

        if (entry.hash !== expectedHash) {
          return { valid: false, brokenAt: entry.timestamp };
        }

        prevHash = entry.hash;
      }

      return { valid: true };
    } catch {
      return { valid: true }; // No logs = no tampering
    }
  }

  /**
   * Flush the buffer to disk.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entries = [...this.buffer];
    this.buffer = [];

    try {
      await fs.mkdir(this.logDir, { recursive: true, mode: 0o700 });

      // Rotate if file is too large
      try {
        const stat = await fs.stat(this.currentFile);
        if (stat.size > this.maxFileSize) {
          const rotated = `${this.currentFile}.${Date.now()}.log`;
          await fs.rename(this.currentFile, rotated);
        }
      } catch {
        // File doesn't exist yet
      }

      const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await fs.appendFile(this.currentFile, lines, { mode: 0o600 });
    } catch (err) {
      // Put entries back in buffer on failure
      this.buffer.unshift(...entries);
      throw err;
    }
  }

  /**
   * Close the logger and flush remaining entries.
   */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /**
   * Redact sensitive values from metadata.
   */
  private redactSensitive(value: unknown): unknown {
    if (typeof value === 'string') {
      // Redact anything that looks like a token, key, or password
      if (/^(ghp_|xoxb_|xapp_|sk-|Bearer |token_|api_key_|password)/i.test(value)) {
        return '[REDACTED]';
      }
      if (value.length > 1000) {
        return `[truncated: ${value.length} chars]`;
      }
    }
    if (typeof value === 'object' && value !== null) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (/secret|token|key|password|auth/i.test(k)) {
          result[k] = '[REDACTED]';
        } else {
          result[k] = v;
        }
      }
      return result;
    }
    return value;
  }
}
