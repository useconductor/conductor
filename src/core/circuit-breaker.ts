/**
 * Circuit Breaker — prevents cascading failures.
 *
 * When a tool or dependency fails repeatedly, the circuit opens and
 * subsequent calls fail fast without hitting the failing service.
 * After a cooldown period, the circuit half-opens to test recovery.
 *
 * States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (testing) → CLOSED
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms before attempting recovery */
  recoveryTimeout: number;
  /** Number of successful calls in half_open to close the circuit */
  successThreshold: number;
}

const DEFAULTS: CircuitBreakerOptions = {
  failureThreshold: 5,
  recoveryTimeout: 60_000,
  successThreshold: 2,
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailureAt = 0;
  private options: CircuitBreakerOptions;

  constructor(options?: Partial<CircuitBreakerOptions>) {
    this.options = { ...DEFAULTS, ...options };
  }

  getState(): CircuitState {
    if (this.state === 'open') {
      // Check if recovery timeout has elapsed
      if (Date.now() - this.lastFailureAt >= this.options.recoveryTimeout) {
        this.state = 'half_open';
        this.successes = 0;
      }
    }
    return this.state;
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws CircuitOpenError if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.getState();

    if (state === 'open') {
      throw new CircuitOpenError('Circuit breaker is open — call rejected');
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /**
   * Record a successful call.
   */
  private onSuccess(): void {
    this.failures = 0;

    if (this.state === 'half_open') {
      this.successes++;
      if (this.successes >= this.options.successThreshold) {
        this.state = 'closed';
        this.successes = 0;
      }
    }
  }

  /**
   * Record a failed call.
   */
  private onFailure(): void {
    this.failures++;
    this.lastFailureAt = Date.now();

    if (this.state === 'half_open') {
      // Any failure in half_open re-opens the circuit
      this.state = 'open';
      this.successes = 0;
    } else if (this.failures >= this.options.failureThreshold) {
      this.state = 'open';
    }
  }

  /**
   * Reset the circuit breaker to closed state.
   */
  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureAt = 0;
  }

  /**
   * Get circuit breaker status for health checks.
   */
  getStatus(): { state: CircuitState; failures: number; successes: number } {
    return {
      state: this.getState(),
      failures: this.failures,
      successes: this.successes,
    };
  }
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}
