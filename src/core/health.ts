/**
 * Health Check System — Stripe-grade service health monitoring.
 *
 * Reports the status of every plugin, dependency, and subsystem.
 * Designed for load balancers, orchestrators, and monitoring dashboards.
 *
 * Endpoints:
 *   GET /health     — quick check (status: ok/degraded/down)
 *   GET /health/detailed — full breakdown with per-plugin status
 *   GET /health/ready — readiness probe (can accept traffic?)
 */

import type { CircuitBreaker, CircuitState } from './circuit-breaker.js';

export interface HealthComponent {
  name: string;
  status: 'ok' | 'degraded' | 'down';
  message?: string;
  latencyMs?: number;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  uptime: number;
  timestamp: string;
  components: HealthComponent[];
  metrics?: {
    totalToolCalls: number;
    failedToolCalls: number;
    avgLatencyMs: number;
    activeWebhooks: number;
    openCircuits: number;
  };
}

const startTime = Date.now();

export class HealthChecker {
  private components: Map<string, () => Promise<HealthComponent>> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private metrics: {
    totalToolCalls: number;
    failedToolCalls: number;
    totalLatencyMs: number;
    activeWebhooks: number;
  } = { totalToolCalls: 0, failedToolCalls: 0, totalLatencyMs: 0, activeWebhooks: 0 };

  /**
   * Register a health check for a component.
   */
  register(name: string, check: () => Promise<HealthComponent>): void {
    this.components.set(name, check);
  }

  /**
   * Register a circuit breaker for monitoring.
   */
  registerCircuitBreaker(name: string, breaker: CircuitBreaker): void {
    this.circuitBreakers.set(name, breaker);
  }

  /**
   * Record a tool call for metrics.
   */
  recordToolCall(success: boolean, latencyMs: number): void {
    this.metrics.totalToolCalls++;
    if (!success) this.metrics.failedToolCalls++;
    this.metrics.totalLatencyMs += latencyMs;
  }

  /**
   * Update webhook count.
   */
  setWebhookCount(count: number): void {
    this.metrics.activeWebhooks = count;
  }

  /**
   * Get a quick health status.
   */
  async check(): Promise<{ status: 'ok' | 'degraded' | 'down'; version: string }> {
    const report = await this.detailed();
    return { status: report.status, version: report.version };
  }

  /**
   * Get a detailed health report.
   */
  async detailed(version = '1.0.0'): Promise<HealthReport> {
    const components: HealthComponent[] = [];

    // Run all registered health checks in parallel
    const checks = Array.from(this.components.entries()).map(async ([, check]) => {
      try {
        return await check();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { name: 'unknown', status: 'down' as const, message };
      }
    });

    const results = await Promise.allSettled(checks);
    for (const result of results) {
      if (result.status === 'fulfilled') {
        components.push(result.value);
      }
    }

    // Check circuit breakers
    let openCircuits = 0;
    for (const [name, breaker] of this.circuitBreakers) {
      const state = breaker.getState();
      if (state === 'open') openCircuits++;
      components.push({
        name: `circuit:${name}`,
        status: state === 'closed' ? 'ok' : state === 'half_open' ? 'degraded' : 'down',
        message: state === 'open' ? 'Circuit breaker open — service unavailable' : undefined,
      });
    }

    // Determine overall status
    const hasDown = components.some((c) => c.status === 'down');
    const hasDegraded = components.some((c) => c.status === 'degraded');
    const status = hasDown ? 'down' : hasDegraded ? 'degraded' : 'ok';

    const avgLatency = this.metrics.totalToolCalls > 0
      ? Math.round(this.metrics.totalLatencyMs / this.metrics.totalToolCalls)
      : 0;

    return {
      status,
      version,
      uptime: Math.round((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
      components,
      metrics: {
        totalToolCalls: this.metrics.totalToolCalls,
        failedToolCalls: this.metrics.failedToolCalls,
        avgLatencyMs: avgLatency,
        activeWebhooks: this.metrics.activeWebhooks,
        openCircuits,
      },
    };
  }

  /**
   * Readiness probe — can we accept traffic?
   */
  async ready(): Promise<{ ready: boolean; reason?: string }> {
    const report = await this.detailed();

    if (report.status === 'down') {
      const downComponents = report.components.filter((c) => c.status === 'down');
      return { ready: false, reason: `Critical components down: ${downComponents.map((c) => c.name).join(', ')}` };
    }

    return { ready: true };
  }
}
