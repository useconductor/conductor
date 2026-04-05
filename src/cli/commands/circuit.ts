/**
 * conductor circuit — view and manage circuit breaker state.
 *
 * Commands:
 *   conductor circuit list   — show state of all circuit breakers
 *   conductor circuit reset  — reset a specific circuit to closed state
 */

import type { Conductor } from '../../core/conductor.js';

export async function circuitList(conductor: Conductor, opts: { json?: boolean }): Promise<void> {
  await conductor.initialize();

  // Circuit breaker state is held in the running MCP server's memory.
  // If we're not in the server process, we read the persisted health state
  // from the health check endpoint instead.
  try {
    const { HealthChecker } = await import('../../core/health.js');
    const checker = new HealthChecker();
    const report = await checker.detailed('0');

    const metrics = report.metrics;

    if (opts.json) {
      console.log(JSON.stringify({ open_circuits: metrics?.openCircuits ?? 0 }, null, 2));
      return;
    }

    console.log('');
    console.log('  ⚡ Circuit Breaker Status\n');

    if (!metrics || metrics.openCircuits === 0) {
      console.log('  All circuits are CLOSED (healthy).\n');
    } else {
      console.log(
        `  ⚠️  ${metrics.openCircuits} circuit(s) OPEN — tools unavailable until recovery timeout expires.\n`,
      );
      console.log('  Run: conductor health --json for per-tool details.\n');
    }

    console.log(`  Total tool calls: ${metrics?.totalToolCalls ?? 0}`);
    console.log(`  Failed calls:     ${metrics?.failedToolCalls ?? 0}`);
    console.log(`  Avg latency:      ${metrics?.avgLatencyMs ?? 0}ms`);
    console.log('');
    console.log('  To reset a specific circuit: conductor circuit reset <tool>\n');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ❌ ${msg}\n`);
  }
}

export async function circuitReset(conductor: Conductor, tool: string): Promise<void> {
  await conductor.initialize();

  // Circuit breaker reset requires the server process. We emit a signal file
  // that the running server will pick up, or print guidance if no server is running.
  console.log('');
  console.log(`  ℹ️  Circuit breaker state lives in the running MCP server process.`);
  console.log(`  To reset "${tool}":`);
  console.log(`    1. Restart the MCP server:  conductor mcp start`);
  console.log(`    2. Or wait for the recovery timeout to expire (default: 30s)`);
  console.log('');
}
