import { describe, it, expect } from 'vitest';

describe('DockerPlugin', () => {
  it('defines all expected tools', async () => {
    const { DockerPlugin } = await import('../src/plugins/builtin/docker.js');
    const plugin = new DockerPlugin();
    const tools = plugin.getTools();

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('docker_containers');
    expect(toolNames).toContain('docker_container_logs');
    expect(toolNames).toContain('docker_container_action');
    expect(toolNames).toContain('docker_images');
    expect(toolNames).toContain('docker_pull');
    expect(toolNames).toContain('docker_run');
    expect(toolNames).toContain('docker_volumes');
    expect(toolNames).toContain('docker_networks');
    expect(toolNames).toContain('docker_stats');
    expect(tools.length).toBe(16);
  });

  it('marks docker_run as requiring approval', async () => {
    const { DockerPlugin } = await import('../src/plugins/builtin/docker.js');
    const plugin = new DockerPlugin();
    const tools = plugin.getTools();

    const runTool = tools.find((t) => t.name === 'docker_run');
    expect(runTool?.requiresApproval).toBe(true);
  });

  it('has proper input schemas', async () => {
    const { DockerPlugin } = await import('../src/plugins/builtin/docker.js');
    const plugin = new DockerPlugin();
    const tools = plugin.getTools();

    for (const tool of tools) {
      expect(tool.inputSchema).toHaveProperty('type');
      expect(tool.inputSchema).toHaveProperty('properties');
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });
});
