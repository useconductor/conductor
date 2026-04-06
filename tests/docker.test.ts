import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DockerPlugin } from '../src/plugins/builtin/docker.js';

let plugin: DockerPlugin;

// Helper to get a tool's handler by name
function tool(name: string) {
  const t = plugin.getTools().find((t) => t.name === name);
  if (!t) throw new Error(`Tool not found: ${name}`);
  return t.handler as (args: Record<string, unknown>) => Promise<unknown>;
}

// Mock the private `docker` method on the plugin instance
function mockDocker(stdout: string, stderr = '') {
  vi.spyOn(plugin as any, 'docker').mockResolvedValue({ stdout, stderr });
}

function mockDockerError(message: string) {
  vi.spyOn(plugin as any, 'docker').mockRejectedValue(new Error(`Docker command failed: ${message}`));
}

beforeEach(() => {
  plugin = new DockerPlugin();
  vi.clearAllMocks();
});

// ── Structure ────────────────────────────────────────────────────────────────

describe('DockerPlugin structure', () => {
  it('has correct name', () => {
    expect(plugin.name).toBe('docker');
  });

  it('isConfigured() returns a boolean (true when Docker socket present)', () => {
    expect(typeof plugin.isConfigured()).toBe('boolean');
  });

  it('registers 16 tools', () => {
    expect(plugin.getTools()).toHaveLength(16);
  });

  it('marks docker_run as requiresApproval', () => {
    const t = plugin.getTools().find((t) => t.name === 'docker_run');
    expect(t?.requiresApproval).toBe(true);
  });

  it('all tools have a description and inputSchema', () => {
    for (const t of plugin.getTools()) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema).toHaveProperty('type');
      expect(t.inputSchema).toHaveProperty('properties');
    }
  });

  it('has tool names for all expected capabilities', () => {
    const names = plugin.getTools().map((t) => t.name);
    expect(names).toContain('docker_containers');
    expect(names).toContain('docker_container_logs');
    expect(names).toContain('docker_container_action');
    expect(names).toContain('docker_images');
    expect(names).toContain('docker_pull');
    expect(names).toContain('docker_run');
    expect(names).toContain('docker_volumes');
    expect(names).toContain('docker_networks');
    expect(names).toContain('docker_stats');
  });
});

// ── docker_containers ────────────────────────────────────────────────────────

describe('docker_containers', () => {
  it('returns empty array when no containers running', async () => {
    mockDocker('');
    const result = await tool('docker_containers')({}) as Record<string, unknown>;
    expect(result.containers).toEqual([]);
  });

  it('parses JSON lines from docker ps --format', async () => {
    const c1 = { ID: 'abc123', Names: 'my-app', Status: 'Up 2 hours', Image: 'nginx:latest' };
    const c2 = { ID: 'def456', Names: 'db', Status: 'Up 1 day', Image: 'postgres:15' };
    mockDocker(`${JSON.stringify(c1)}\n${JSON.stringify(c2)}`);

    const result = await tool('docker_containers')({}) as Record<string, unknown>;
    const containers = result.containers as any[];
    expect(containers).toHaveLength(2);
    expect(containers[0].ID).toBe('abc123');
    expect(containers[1].Names).toBe('db');
  });

  it('passes -a in docker args when all=true', async () => {
    const spy = vi.spyOn(plugin as any, 'docker').mockResolvedValue({ stdout: '', stderr: '' });
    await tool('docker_containers')({ all: true });
    expect(spy.mock.calls[0][0]).toContain('-a');
  });

  it('passes --filter in docker args when filters provided', async () => {
    const spy = vi.spyOn(plugin as any, 'docker').mockResolvedValue({ stdout: '', stderr: '' });
    await tool('docker_containers')({ filters: 'status=exited' });
    const args = spy.mock.calls[0][0] as string[];
    expect(args).toContain('--filter');
    expect(args).toContain('status=exited');
  });

  it('skips malformed JSON lines gracefully', async () => {
    const good = JSON.stringify({ ID: 'abc', Names: 'app' });
    mockDocker(`${good}\nnot-json\n${good}`);
    const result = await tool('docker_containers')({}) as Record<string, unknown>;
    expect((result.containers as any[]).length).toBe(2);
  });

  it('throws when docker command fails', async () => {
    mockDockerError('Cannot connect to Docker daemon');
    await expect(tool('docker_containers')({})).rejects.toThrow('Docker command failed');
  });
});

// ── docker_images ────────────────────────────────────────────────────────────

describe('docker_images', () => {
  it('parses image list JSON lines', async () => {
    const img = { Repository: 'nginx', Tag: 'latest', ID: 'sha256:abc', Size: '142MB' };
    mockDocker(JSON.stringify(img));
    const result = await tool('docker_images')({}) as Record<string, unknown>;
    expect((result.images as any[])[0].Repository).toBe('nginx');
    expect((result.images as any[])[0].Tag).toBe('latest');
  });

  it('returns empty array when no images', async () => {
    mockDocker('');
    const result = await tool('docker_images')({}) as Record<string, unknown>;
    expect(result.images).toEqual([]);
  });

  it('skips malformed image JSON lines', async () => {
    mockDocker(`bad-line\n${JSON.stringify({ Repository: 'alpine', Tag: '3' })}`);
    const result = await tool('docker_images')({}) as Record<string, unknown>;
    expect((result.images as any[]).length).toBe(1);
  });
});

// ── docker_container_logs ────────────────────────────────────────────────────

describe('docker_container_logs', () => {
  it('returns stdout logs', async () => {
    mockDocker('Line 1\nLine 2\nLine 3');
    const result = await tool('docker_container_logs')({ container: 'my-app' }) as Record<string, unknown>;
    expect(result.logs).toContain('Line 1');
    expect(result.container).toBe('my-app');
  });

  it('falls back to stderr when stdout is empty', async () => {
    mockDocker('', 'stderr log output');
    const result = await tool('docker_container_logs')({ container: 'my-app' }) as Record<string, unknown>;
    expect(result.logs).toBe('stderr log output');
  });

  it('uses default tail 100 when not specified', async () => {
    const spy = vi.spyOn(plugin as any, 'docker').mockResolvedValue({ stdout: '', stderr: '' });
    await tool('docker_container_logs')({ container: 'app' });
    expect((spy.mock.calls[0][0] as string[]).includes('100')).toBe(true);
  });

  it('passes custom tail value', async () => {
    const spy = vi.spyOn(plugin as any, 'docker').mockResolvedValue({ stdout: '', stderr: '' });
    await tool('docker_container_logs')({ container: 'app', tail: 50 });
    expect((spy.mock.calls[0][0] as string[]).includes('50')).toBe(true);
  });
});

// ── docker_container_action ──────────────────────────────────────────────────

describe('docker_container_action', () => {
  it('stops a container and returns success', async () => {
    mockDocker('my-app');
    const result = await tool('docker_container_action')({
      container: 'my-app', action: 'stop',
    }) as Record<string, unknown>;
    expect(result.status).toBe('success');
    expect(result.action).toBe('stop');
    expect(result.container).toBe('my-app');
  });

  it('passes -f flag for remove action', async () => {
    const spy = vi.spyOn(plugin as any, 'docker').mockResolvedValue({ stdout: '', stderr: '' });
    await tool('docker_container_action')({ container: 'dead', action: 'remove' });
    const args = spy.mock.calls[0][0] as string[];
    expect(args[0]).toBe('remove');
    expect(args).toContain('-f');
  });

  it('throws when container not found', async () => {
    mockDockerError('No such container: ghost');
    await expect(tool('docker_container_action')({ container: 'ghost', action: 'start' }))
      .rejects.toThrow('Docker command failed');
  });
});

// ── docker_volumes ───────────────────────────────────────────────────────────

describe('docker_volumes', () => {
  it('parses volume list', async () => {
    const vol = { Name: 'my-vol', Driver: 'local', Mountpoint: '/var/lib/docker/volumes/my-vol/_data' };
    mockDocker(JSON.stringify(vol));
    const result = await tool('docker_volumes')({}) as Record<string, unknown>;
    expect((result.volumes as any[])[0].Name).toBe('my-vol');
  });

  it('returns empty when no volumes', async () => {
    mockDocker('');
    const result = await tool('docker_volumes')({}) as Record<string, unknown>;
    expect(result.volumes).toEqual([]);
  });
});

// ── docker_networks ──────────────────────────────────────────────────────────

describe('docker_networks', () => {
  it('parses network list', async () => {
    const net = { ID: 'n1', Name: 'bridge', Driver: 'bridge', Scope: 'local' };
    mockDocker(JSON.stringify(net));
    const result = await tool('docker_networks')({}) as Record<string, unknown>;
    expect((result.networks as any[])[0].Name).toBe('bridge');
  });

  it('returns empty when no networks', async () => {
    mockDocker('');
    const result = await tool('docker_networks')({}) as Record<string, unknown>;
    expect(result.networks).toEqual([]);
  });
});

// ── docker_stats ─────────────────────────────────────────────────────────────

describe('docker_stats', () => {
  it('returns parsed stats', async () => {
    const s = { Name: 'my-app', CPUPerc: '2.5%', MemUsage: '50MiB / 2GiB' };
    mockDocker(JSON.stringify(s));
    const result = await tool('docker_stats')({}) as Record<string, unknown>;
    expect((result.stats as any[])[0].Name).toBe('my-app');
  });

  it('returns empty when no running containers', async () => {
    mockDocker('');
    const result = await tool('docker_stats')({}) as Record<string, unknown>;
    expect(result.stats).toEqual([]);
  });
});
