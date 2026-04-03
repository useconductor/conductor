import { describe, it, expect } from 'vitest';

describe('ShellPlugin', () => {
  it('defines all expected tools', async () => {
    const { ShellPlugin } = await import('../src/plugins/builtin/shell.js');
    const plugin = new ShellPlugin();
    const tools = plugin.getTools();

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('shell_run');
    expect(toolNames).toContain('shell_read_file');
    expect(toolNames).toContain('shell_write_file');
    expect(toolNames).toContain('shell_list_dir');
    expect(toolNames).toContain('shell_search_files');
    expect(toolNames).toContain('shell_search_content');
    expect(tools.length).toBe(6);
  });

  it('marks write operations as requiring approval', async () => {
    const { ShellPlugin } = await import('../src/plugins/builtin/shell.js');
    const plugin = new ShellPlugin();
    const tools = plugin.getTools();

    const writeTool = tools.find((t) => t.name === 'shell_write_file');
    expect(writeTool?.requiresApproval).toBe(true);

    const runTool = tools.find((t) => t.name === 'shell_run');
    expect(runTool?.requiresApproval).toBe(true);
  });

  it('has proper input schemas', async () => {
    const { ShellPlugin } = await import('../src/plugins/builtin/shell.js');
    const plugin = new ShellPlugin();
    const tools = plugin.getTools();

    for (const tool of tools) {
      expect(tool.inputSchema).toHaveProperty('type');
      expect(tool.inputSchema).toHaveProperty('properties');
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });
});
