import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../src/core/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 3, recoveryTimeout: 100, successThreshold: 2 });
  });

  it('starts in closed state', () => {
    expect(cb.getState()).toBe('closed');
  });

  it('executes successfully in closed state', async () => {
    const result = await cb.execute(async () => 'ok');
    expect(result).toBe('ok');
    expect(cb.getState()).toBe('closed');
  });

  it('opens after hitting failure threshold', async () => {
    const fail = async () => { throw new Error('fail'); };
    await expect(cb.execute(fail)).rejects.toThrow('fail');
    await expect(cb.execute(fail)).rejects.toThrow('fail');
    await expect(cb.execute(fail)).rejects.toThrow('fail');
    expect(cb.getState()).toBe('open');
  });

  it('throws CircuitOpenError when open', async () => {
    const fail = async () => { throw new Error('fail'); };
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow();
    }
    await expect(cb.execute(async () => 'ok')).rejects.toThrow(CircuitOpenError);
  });

  it('transitions to half_open after recovery timeout', async () => {
    const fail = async () => { throw new Error('fail'); };
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow();
    }
    expect(cb.getState()).toBe('open');

    // Mock time passing
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    expect(cb.getState()).toBe('half_open');
    vi.useRealTimers();
  });

  it('closes circuit after successThreshold successes in half_open', async () => {
    const fail = async () => { throw new Error('fail'); };
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow();
    }

    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    // Must call getState() while fake timers are active to trigger the open→half_open transition
    expect(cb.getState()).toBe('half_open');
    vi.useRealTimers();

    await cb.execute(async () => 'ok');
    await cb.execute(async () => 'ok');
    expect(cb.getState()).toBe('closed');
  });

  it('re-opens on failure in half_open state', async () => {
    const fail = async () => { throw new Error('fail'); };
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow();
    }

    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    // Must call getState() while fake timers are active to trigger the open→half_open transition
    expect(cb.getState()).toBe('half_open');
    vi.useRealTimers();

    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.getState()).toBe('open');
  });

  it('reset() returns circuit to closed state', async () => {
    const fail = async () => { throw new Error('fail'); };
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow();
    }
    expect(cb.getState()).toBe('open');
    cb.reset();
    expect(cb.getState()).toBe('closed');
  });

  it('getStatus() returns state and failure counts', async () => {
    const fail = async () => { throw new Error('fail'); };
    await expect(cb.execute(fail)).rejects.toThrow();
    await expect(cb.execute(fail)).rejects.toThrow();

    const status = cb.getStatus();
    expect(status.state).toBe('closed');
    expect(status.failures).toBe(2);
  });

  it('resets failure count on success', async () => {
    const fail = async () => { throw new Error('fail'); };
    await expect(cb.execute(fail)).rejects.toThrow();
    await expect(cb.execute(fail)).rejects.toThrow();
    await cb.execute(async () => 'ok'); // success resets failures
    const status = cb.getStatus();
    expect(status.failures).toBe(0);
  });

  it('uses default options when none provided', () => {
    const defaultCb = new CircuitBreaker();
    expect(defaultCb.getState()).toBe('closed');
  });

  it('handles concurrent executions', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => cb.execute(async () => 42)),
    );
    expect(results).toHaveLength(10);
    expect(results.every((r) => r === 42)).toBe(true);
  });
});
