// Plugin command logic is now inline in src/cli/index.ts.
// This file exists for backward compatibility with any imports.
import { Conductor } from '../../core/conductor.js';
import { PluginManager } from '../../plugins/manager.js';

export async function listPlugins(conductor: Conductor): Promise<void> {
  await conductor.initialize();
  const pm = new PluginManager(conductor);
  await pm.loadBuiltins();
  const list = pm.listPlugins();
  const enabled = conductor.getConfig().get<string[]>('plugins.enabled') || [];

  console.log('');
  console.log(`  🔌 Plugins (${list.length} available)\n`);
  for (const p of list) {
    const icon = enabled.includes(p.name) ? '🟢' : '⚪';
    console.log(`  ${icon} ${p.name}`);
    console.log(`     ${p.description}\n`);
  }
}

export async function enablePlugin(conductor: Conductor, name: string): Promise<void> {
  await conductor.initialize();
  const pm = new PluginManager(conductor);
  await pm.loadBuiltins();
  await pm.enablePlugin(name);
  console.log(`  ✓ Plugin "${name}" enabled`);
}

export async function disablePlugin(conductor: Conductor, name: string): Promise<void> {
  await conductor.initialize();
  const pm = new PluginManager(conductor);
  await pm.loadBuiltins();
  await pm.disablePlugin(name);
  console.log(`  ✓ Plugin "${name}" disabled`);
}
