/**
 * Retry with exponential backoff and jitter.
 *
 * Every tool call is automatically retried on transient failures.
 * Backoff: baseDelay * 2^attempt + random jitter
 *
 * Designed for API rate limits, network blips, and temporary outages.
 */

export interface RetryOptions {
  /** Maximum number of attempts (including the first) */
  maxAttempts: number;
  /** Base delay in ms */
  baseDelay: number;
  /** Maximum delay in ms */
  maxDelay: number;
  /** Retry only on these error codes/messages */
  retryableErrors?: string[];
  /** Callback for each retry attempt */
  onRetry?: (attempt: number, error: Error, delay: number) => void;
}

const DEFAULTS: RetryOptions = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
};

export async function withRetry<T>(fn: () => Promise<T>, options?: Partial<RetryOptions>): Promise<T> {
  const opts = { ...DEFAULTS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry if error is not retryable
      if (opts.retryableErrors && opts.retryableErrors.length > 0) {
        if (!opts.retryableErrors.some((pattern) => lastError!.message.includes(pattern))) {
          throw lastError;
        }
      }

      // Don't retry on last attempt
      if (attempt === opts.maxAttempts) {
        throw lastError;
      }

      // Calculate delay with exponential backoff and jitter
      const delay = Math.min(
        opts.baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000,
        opts.maxDelay,
      );

      opts.onRetry?.(attempt, lastError, delay);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}
