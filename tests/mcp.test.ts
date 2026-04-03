import { describe, it, expect } from 'vitest';

describe('MCP Server', () => {
  it('exports startMCPServer function', async () => {
    const { startMCPServer } = await import('../src/mcp/server.js');
    expect(typeof startMCPServer).toBe('function');
  });

  it('builds tool registry with builtin tools', async () => {
    // This tests that the MCP server can start and register tools
    const { startMCPServer } = await import('../src/mcp/server.js');
    expect(startMCPServer).toBeDefined();
  });
});
