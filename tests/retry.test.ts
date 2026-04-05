import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../src/core/retry.js';

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const result = await withRetry(async () => 'hello', { maxAttempts: 3, baseDelay: 0, maxDelay: 0 });
    expect(result).toBe('hello');
  });

  it('retries on failure and eventually succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('transient');
        return 'success';
      },
      { maxAttempts: 3, baseDelay: 0, maxDelay: 0 },
    );
    expect(result).toBe('success');
    expect(calls).toBe(3);
  });

  it('throws after exhausting maxAttempts', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('always fails');
        },
        { maxAttempts: 3, baseDelay: 0, maxDelay: 0 },
      ),
    ).rejects.toThrow('always fails');
    expect(calls).toBe(3);
  });

  it('calls onRetry callback with attempt info', async () => {
    const onRetry = vi.fn();
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('fail');
        },
        { maxAttempts: 3, baseDelay: 0, maxDelay: 0, onRetry },
      ),
    ).rejects.toThrow();
    expect(onRetry).toHaveBeenCalledTimes(2); // called after attempt 1 and 2
    expect(onRetry.mock.calls[0][0]).toBe(1);
    expect(onRetry.mock.calls[1][0]).toBe(2);
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('NOT_RETRYABLE');
        },
        {
          maxAttempts: 3,
          baseDelay: 0,
          maxDelay: 0,
          retryableErrors: ['transient', 'rate_limit'],
        },
      ),
    ).rejects.toThrow('NOT_RETRYABLE');
    expect(calls).toBe(1); // only one attempt
  });

  it('retries matching retryableErrors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('rate_limit exceeded');
        },
        {
          maxAttempts: 3,
          baseDelay: 0,
          maxDelay: 0,
          retryableErrors: ['rate_limit'],
        },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(3); // all 3 attempted
  });

  it('uses defaults when no options provided', async () => {
    // Should work with defaults (we can't easily test timing, just ensure it runs)
    const result = await withRetry(async () => 'default');
    expect(result).toBe('default');
  });

  it('wraps non-Error throws into Error', async () => {
    await expect(
      withRetry(async () => { throw 'string error'; }, { maxAttempts: 1, baseDelay: 0, maxDelay: 0 }),
    ).rejects.toThrow('string error');
  });
});
