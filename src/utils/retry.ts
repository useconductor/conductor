/**
 * Utility for handling network retries with exponential backoff.
 */

export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error: any) {
      attempt++;
      if (attempt > maxRetries) {
        throw error;
      }

      // Determine if error is retryable.
      // Network errors (fetch failed), 429 Too Many Requests, and 5xx Server Errors are retryable.
      const isRetryable =
        error.message?.includes('429') ||
        error.message?.includes('500') ||
        error.message?.includes('502') ||
        error.message?.includes('503') ||
        error.message?.includes('fetch failed') ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT';

      if (!isRetryable) {
        // e.g. 400 Bad Request, 401 Unauthorized, 403 Forbidden shouldn't be retried
        throw error;
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      process.stderr.write(`  ⚠ Operation failed. Retrying in ${delay}ms (Attempt ${attempt}/${maxRetries})...\n`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
