import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuditLogger } from '../src/core/audit.js';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

describe('AuditLogger', () => {
  let logger: AuditLogger;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'conductor-audit-'));
    logger = new AuditLogger(tmpDir, { flushIntervalMs: 50000 }); // long interval so tests control flush
  });

  afterEach(async () => {
    await logger.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('logs an entry and flushes to disk', async () => {
    await logger.log({
      actor: 'user1',
      action: 'tool_call',
      resource: 'calc_math',
      result: 'success',
      metadata: { expression: '2+2' },
    });
    await logger.flush();

    const entries = await logger.query({ actor: 'user1' });
    expect(entries).toHaveLength(1);
    expect(entries[0].actor).toBe('user1');
    expect(entries[0].action).toBe('tool_call');
    expect(entries[0].resource).toBe('calc_math');
    expect(entries[0].result).toBe('success');
  });

  it('adds timestamp to each entry', async () => {
    const before = new Date().toISOString();
    await logger.log({
      actor: 'system',
      action: 'test',
      resource: 'x',
      result: 'success',
      metadata: {},
    });
    const after = new Date().toISOString();
    await logger.flush();

    const entries = await logger.query();
    expect(entries[0].timestamp >= before).toBe(true);
    expect(entries[0].timestamp <= after).toBe(true);
  });

  it('chains SHA-256 hashes', async () => {
    await logger.log({ actor: 'a', action: 'one', resource: 'r', result: 'success', metadata: {} });
    await logger.log({ actor: 'b', action: 'two', resource: 'r', result: 'success', metadata: {} });
    await logger.flush();

    const entries = await logger.query();
    expect(entries).toHaveLength(2);
    expect(entries[0].hash).toBeTruthy();
    expect(entries[1].previousHash).toBe(entries[0].hash);
  });

  it('verifyIntegrity returns valid for untampered log', async () => {
    await logger.log({ actor: 'u', action: 'a', resource: 'r', result: 'success', metadata: {} });
    await logger.log({ actor: 'u', action: 'b', resource: 'r', result: 'success', metadata: {} });
    await logger.flush();

    const { valid } = await logger.verifyIntegrity();
    expect(valid).toBe(true);
  });

  it('verifyIntegrity returns valid when no log file exists', async () => {
    const { valid } = await logger.verifyIntegrity();
    expect(valid).toBe(true);
  });

  describe('toolCall convenience', () => {
    it('logs tool calls correctly', async () => {
      await logger.toolCall('user1', 'calc_math', { expression: '1+1' }, 'success');
      await logger.flush();

      const entries = await logger.query({ action: 'tool_call' });
      expect(entries).toHaveLength(1);
      expect(entries[0].resource).toBe('calc_math');
    });

    it('redacts tokens in input', async () => {
      await logger.toolCall('user1', 'some_tool', { token: 'ghp_secrettoken' }, 'success');
      await logger.flush();

      const entries = await logger.query({ action: 'tool_call' });
      const input = entries[0].metadata.input as Record<string, string>;
      expect(input.token).toBe('[REDACTED]');
    });
  });

  describe('authEvent convenience', () => {
    it('logs auth_login for successful auth', async () => {
      await logger.authEvent('user1', 'google', true);
      await logger.flush();

      const entries = await logger.query({ action: 'auth_login' });
      expect(entries).toHaveLength(1);
      expect(entries[0].result).toBe('success');
    });

    it('logs auth_failure for failed auth', async () => {
      await logger.authEvent('user1', 'github', false);
      await logger.flush();

      const entries = await logger.query({ action: 'auth_failure' });
      expect(entries).toHaveLength(1);
      expect(entries[0].result).toBe('failure');
    });
  });

  describe('configChange convenience', () => {
    it('logs config changes immediately (flush on config_set)', async () => {
      await logger.configChange('admin', 'ai.provider', 'openai', 'claude');
      // No manual flush needed — config_set triggers immediate flush
      const entries = await logger.query({ action: 'config_set' });
      expect(entries).toHaveLength(1);
      expect(entries[0].resource).toBe('ai.provider');
    });

    it('redacts sensitive config values', async () => {
      await logger.configChange('admin', 'github.token', 'ghp_oldtoken', 'ghp_newtoken');
      const entries = await logger.query({ action: 'config_set' });
      const meta = entries[0].metadata as { old_value: string; new_value: string };
      expect(meta.old_value).toBe('[REDACTED]');
      expect(meta.new_value).toBe('[REDACTED]');
    });
  });

  describe('pluginEvent convenience', () => {
    it('logs plugin lifecycle events', async () => {
      await logger.pluginEvent('admin', 'github', 'enable');
      await logger.flush();

      const entries = await logger.query({ action: 'plugin_enable' });
      expect(entries).toHaveLength(1);
      expect(entries[0].resource).toBe('github');
    });
  });

  describe('query filters', () => {
    beforeEach(async () => {
      await logger.log({ actor: 'user1', action: 'tool_call', resource: 'calc_math', result: 'success', metadata: {} });
      await logger.log({ actor: 'user2', action: 'tool_call', resource: 'shell_run', result: 'failure', metadata: {} });
      await logger.log({ actor: 'user1', action: 'config_set', resource: 'ai.provider', result: 'success', metadata: {} });
      await logger.flush();
    });

    it('filters by actor', async () => {
      const entries = await logger.query({ actor: 'user1' });
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.actor === 'user1')).toBe(true);
    });

    it('filters by action', async () => {
      const entries = await logger.query({ action: 'tool_call' });
      expect(entries).toHaveLength(2);
    });

    it('filters by result', async () => {
      const entries = await logger.query({ result: 'failure' });
      expect(entries).toHaveLength(1);
      expect(entries[0].actor).toBe('user2');
    });

    it('filters by resource', async () => {
      const entries = await logger.query({ resource: 'calc_math' });
      expect(entries).toHaveLength(1);
    });

    it('respects limit', async () => {
      const entries = await logger.query({ limit: 2 });
      expect(entries).toHaveLength(2);
    });
  });
});
