import { Conductor } from '../../core/conductor.js';
import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';

const CLAUDE_DESKTOP_CONFIG = path.join(
  homedir(),
  process.platform === 'darwin'
    ? 'Library/Application Support/Claude/claude_desktop_config.json'
    : process.platform === 'win32'
      ? 'AppData/Roaming/Claude/claude_desktop_config.json'
      : '.config/Claude/claude_desktop_config.json'
);

export async function mcpSetup(conductor: Conductor): Promise<void> {
  await conductor.initialize();

  // Build MCP server config entry
  const conductorPath = process.argv[1]; // Path to the conductor CLI
  const mcpConfig = {
    command: 'node',
    args: [conductorPath, 'mcp', 'start'],
  };

  try {
    let config: any = {};
    try {
      const existing = await fs.readFile(CLAUDE_DESKTOP_CONFIG, 'utf-8');
      config = JSON.parse(existing);
    } catch {
      // File doesn't exist yet
    }

    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers.conductor = mcpConfig;

    await fs.mkdir(path.dirname(CLAUDE_DESKTOP_CONFIG), { recursive: true });
    await fs.writeFile(CLAUDE_DESKTOP_CONFIG, JSON.stringify(config, null, 2));

    console.log('✅ MCP server configured for Claude Desktop.');
    console.log(`   Config: ${CLAUDE_DESKTOP_CONFIG}`);
    console.log('   Restart Claude Desktop to connect.');
  } catch (error: any) {
    console.error(`❌ Failed to configure MCP: ${error.message}`);
  }
}

export async function mcpStatus(conductor: Conductor): Promise<void> {
  try {
    const data = await fs.readFile(CLAUDE_DESKTOP_CONFIG, 'utf-8');
    const config = JSON.parse(data);

    if (config.mcpServers?.conductor) {
      console.log('✅ Conductor MCP server is configured.');
      console.log(`   Command: ${config.mcpServers.conductor.command}`);
      console.log(`   Args: ${config.mcpServers.conductor.args.join(' ')}`);
    } else {
      console.log('❌ Conductor MCP server is not configured.');
      console.log('   Run: conductor mcp setup');
    }
  } catch {
    console.log('❌ Claude Desktop config not found.');
    console.log('   Run: conductor mcp setup');
  }
}

export async function mcpStart(conductor: Conductor): Promise<void> {
  // Start in MCP stdio mode — quiet to avoid polluting stdout
  const quietConductor = new (await import('../../core/conductor.js')).Conductor(
    undefined,
    { quiet: true }
  );
  await quietConductor.initialize();

  // Import and start MCP server (writes JSON-RPC to stdout)
  const { startMCPServer } = await import('../../mcp/server.js');
  await startMCPServer(quietConductor);
}

export async function mcpRemove(_conductor: Conductor): Promise<void> {
  try {
    const data = await fs.readFile(CLAUDE_DESKTOP_CONFIG, 'utf-8');
    const config = JSON.parse(data);

    if (config.mcpServers?.conductor) {
      delete config.mcpServers.conductor;
      await fs.writeFile(CLAUDE_DESKTOP_CONFIG, JSON.stringify(config, null, 2));
      console.log('✅ Conductor MCP server removed from Claude Desktop config.');
    } else {
      console.log('Conductor was not configured in Claude Desktop.');
    }
  } catch {
    console.log('Claude Desktop config not found. Nothing to remove.');
  }
}
