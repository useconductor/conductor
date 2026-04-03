import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import os from 'os';

export class SystemInfoPlugin implements Plugin {
  name = 'system';
  description = 'System information — CPU, memory, disk, network, OS details';
  version = '1.0.0';

  async initialize(_conductor: Conductor): Promise<void> {}
  isConfigured(): boolean { return true; }

  getTools(): PluginTool[] {
    return [
      {
        name: 'system_info',
        description: 'Get comprehensive system information',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const cpus = os.cpus();
          const totalMem = os.totalmem();
          const freeMem = os.freemem();
          return {
            os: { platform: os.platform(), release: os.release(), arch: os.arch(), hostname: os.hostname() },
            cpu: { model: cpus[0]?.model, cores: cpus.length, speed: `${cpus[0]?.speed} MHz` },
            memory: {
              total: `${(totalMem / 1073741824).toFixed(1)} GB`,
              free: `${(freeMem / 1073741824).toFixed(1)} GB`,
              used: `${((totalMem - freeMem) / 1073741824).toFixed(1)} GB`,
              usage: `${(((totalMem - freeMem) / totalMem) * 100).toFixed(1)}%`,
            },
            uptime: `${(os.uptime() / 3600).toFixed(1)} hours`,
            user: os.userInfo().username,
            home: os.homedir(),
            node: process.version,
          };
        },
      },
      {
        name: 'system_processes',
        description: 'Get top processes by memory usage',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const { execSync } = await import('child_process');
          try {
            if (os.platform() === 'win32') {
              const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8' });
              return { note: 'Windows process list', processes: out.split('\n').slice(0, 15) };
            }
            // macOS uses different ps syntax than Linux
            const psCmd = os.platform() === 'darwin'
              ? 'ps aux -m | head -11'
              : 'ps aux --sort=-%mem | head -11';
            const out = execSync(psCmd, { encoding: 'utf8' });
            const lines = out.trim().split('\n');
            return {
              processes: lines.slice(1).map(line => {
                const parts = line.trim().split(/\s+/);
                return { user: parts[0], pid: parts[1], cpu: parts[2], mem: parts[3], command: parts.slice(10).join(' ') };
              }),
            };
          } catch {
            return { error: 'Could not list processes' };
          }
        },
      },
      {
        name: 'system_network',
        description: 'Get network interfaces and IP addresses',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const interfaces = os.networkInterfaces();
          const result: any[] = [];
          for (const [name, addrs] of Object.entries(interfaces)) {
            if (!addrs) continue;
            for (const addr of addrs) {
              if (!addr.internal) {
                result.push({ interface: name, address: addr.address, family: addr.family, mac: addr.mac });
              }
            }
          }
          return { interfaces: result };
        },
      },
    ];
  }
}
