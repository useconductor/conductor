import { Conductor } from '../core/conductor.js';
import { startDashboard } from './server.js';
import { exec } from 'child_process';

export async function dashboardCommand(
  conductor: Conductor,
  opts: { port?: string; open?: boolean }
): Promise<void> {
  const port = parseInt(opts.port ?? '4242', 10);

  await conductor.initialize();

  console.log('');
  console.log('  \x1b[1m\x1b[36mConductor Dashboard\x1b[0m');
  console.log('');

  try {
    const server = await startDashboard(port);
    const url = `http://localhost:${server.port}`;

    console.log(`  \x1b[32m✓\x1b[0m Dashboard running at \x1b[36m${url}\x1b[0m`);
    console.log('  \x1b[2mPress Ctrl+C to stop\x1b[0m');
    console.log('');

    // Auto-open browser unless --no-open passed
    if (opts.open !== false) {
      const opener =
        process.platform === 'darwin' ? 'open' :
        process.platform === 'win32'  ? 'start' : 'xdg-open';
      exec(`${opener} ${url}`, () => {/* ignore errors */});
    }

    // Keep alive
    process.on('SIGINT', async () => {
      console.log('\n  \x1b[2mShutting down…\x1b[0m\n');
      await server.close();
      process.exit(0);
    });

    await new Promise(() => {/* run forever */});
  } catch (e: any) {
    if (e.code === 'EADDRINUSE') {
      console.error(`  \x1b[31m✗\x1b[0m Port ${port} is already in use. Try: conductor dashboard --port 4243`);
    } else {
      console.error(`  \x1b[31m✗\x1b[0m ${e.message}`);
    }
    process.exit(1);
  }
}
