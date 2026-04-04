/**
 * Load Test — 100 concurrent tool calls against the calculator plugin.
 *
 * Validates that the plugin handles concurrent load without failures,
 * circuit breaker trips, or unacceptable latency.
 */

import { describe, it, expect } from 'vitest';
import { CalculatorPlugin } from '../src/plugins/builtin/calculator.js';
import { CircuitBreaker } from '../src/core/circuit-breaker.js';

interface CallResult {
  index: number;
  expression: string;
  latencyMs: number;
  success: boolean;
  error?: string;
}

/**
 * Calculate percentile from a sorted array of numbers.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

describe('Load Test — 100 concurrent tool calls', () => {
  it('handles 100 concurrent calc_math calls with 100% success rate', async () => {
    const plugin = new CalculatorPlugin();
    const tools = plugin.getTools();
    const mathTool = tools.find((t) => t.name === 'calc_math');
    expect(mathTool).toBeDefined();

    // Dedicated circuit breaker for this test
    const cb = new CircuitBreaker({ failureThreshold: 10, recoveryTimeout: 5000 });

    const expressions = Array.from({ length: 100 }, (_, i) => {
      const n = i + 1;
      const exprs = [
        `${n} + ${n * 2}`,
        `sqrt(${n * 100})`,
        `pow(${n}, 2)`,
        `abs(-${n})`,
        `${n} * ${n + 1} / ${n}`,
        `ceil(${n}.7)`,
        `floor(${n}.3)`,
        `round(${n}.5)`,
        `${n} % 7`,
        `log(${n})`,
      ];
      return exprs[i % exprs.length];
    });

    const results: CallResult[] = [];

    // Spawn all 100 calls concurrently
    const promises = expressions.map((expression, index) =>
      (async () => {
        const start = performance.now();
        try {
          const result = await cb.execute(async () => mathTool!.handler({ expression }));
          const latency = performance.now() - start;
          results.push({ index, expression, latencyMs: latency, success: true });
          return result;
        } catch (err: unknown) {
          const latency = performance.now() - start;
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ index, expression, latencyMs: latency, success: false, error: msg });
          // eslint-disable-next-line no-console
          console.log(`FAIL [${index}]: "${expression}" => ${msg}`);
          throw err;
        }
      })(),
    );

    // Wait for all to settle (don't throw on individual failures — we collect them)
    await Promise.allSettled(promises);

    // ── Statistics ──
    const totalCalls = results.length;
    const successCount = results.filter((r) => r.success).length;
    const failCount = totalCalls - successCount;
    const successRate = (successCount / totalCalls) * 100;

    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const min = latencies[0] ?? 0;
    const max = latencies[latencies.length - 1] ?? 0;
    const avg = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;

    // ── Circuit breaker status ──
    const cbStatus = cb.getStatus();

    // ── Summary table ──
    const table = `
┌─────────────────────────────────────────────────────┐
│              LOAD TEST SUMMARY                      │
├─────────────────────────────────────────────────────┤
│ Total calls:          ${String(totalCalls).padEnd(30)}│
│ Successful:           ${String(successCount).padEnd(30)}│
│ Failed:               ${String(failCount).padEnd(30)}│
│ Success rate:         ${`${successRate.toFixed(1)}%`.padEnd(30)}│
├─────────────────────────────────────────────────────┤
│ Min latency:          ${`${min.toFixed(2)}ms`.padEnd(30)}│
│ Avg latency:          ${`${avg.toFixed(2)}ms`.padEnd(30)}│
│ P50 latency:          ${`${p50.toFixed(2)}ms`.padEnd(30)}│
│ P95 latency:          ${`${p95.toFixed(2)}ms`.padEnd(30)}│
│ P99 latency:          ${`${p99.toFixed(2)}ms`.padEnd(30)}│
│ Max latency:          ${`${max.toFixed(2)}ms`.padEnd(30)}│
├─────────────────────────────────────────────────────┤
│ Circuit breaker:      ${cbStatus.state.padEnd(30)}│
│ CB failures:          ${String(cbStatus.failures).padEnd(30)}│
└─────────────────────────────────────────────────────┘`;

    // eslint-disable-next-line no-console
    console.log(table);

    // ── Assertions ──
    expect(totalCalls).toBe(100);
    expect(successRate).toBe(100);
    expect(p99).toBeLessThan(500);
    expect(cbStatus.state).toBe('closed');
    expect(cbStatus.failures).toBe(0);
  });
});
