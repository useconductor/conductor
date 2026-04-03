/**
 * Zero-Config Mode Bootstrap
 *
 * Automatically enables 20+ tools that work without any API keys.
 * These plugins have isConfigured() returning true without setup,
 * or have safe defaults that work for public/unauthenticated use.
 */

import { Conductor } from '../core/conductor.js';

/**
 * List of plugins that work without any credentials
 * (isConfigured() returns true or they have safe defaults)
 */
export const ZERO_CONFIG_PLUGINS = [
  // Core utilities - all work without credentials
  'calculator', // Math expressions, unit conversions
  'colors', // Color format conversion
  'crypto', // Cryptocurrency prices/search
  'hash', // Hashing, encoding
  'text-tools', // JSON formatting, word count
  'timezone', // Timezone conversion
  'network', // DNS lookup, IP info
  'url-tools', // URL parsing, expansion
  'fun', // Jokes, facts
  'system', // System info, clipboard

  // Productivity - local only or safe defaults
  'notes', // Local markdown notes
  'memory', // Local semantic memory
  'cron', // Cron expression parsing

  // Infrastructure - local tools
  'shell', // Safe shell commands (whitelist)
  'docker', // Local Docker (if installed)

  // GitHub - public data works without auth
  'github', // Public repos, user info

  // Weather - uses free Open-Meteo API
  'weather', // Weather/current forecasts

  // File system tools are built into Shell plugin
];

/**
 * Enable zero-config plugins on first run
 */
export async function enableZeroConfigMode(conductor: Conductor): Promise<void> {
  const config = conductor.getConfig();

  // Get currently enabled plugins
  let enabledPlugins = config.get<string[]>('plugins.enabled') ?? [];

  // Enable any zero-config plugins not already enabled
  const toEnable = ZERO_CONFIG_PLUGINS.filter((plugin) => !enabledPlugins.includes(plugin));

  if (toEnable.length > 0) {
    enabledPlugins = [...enabledPlugins, ...toEnable];
    await config.set('plugins.enabled', enabledPlugins);

    process.stderr.write(`[ZERO-CONFIG] Enabled ${toEnable.length} plugins: ${toEnable.join(', ')}\n`);
  }
}

/**
 * Check if zero-config mode is active
 */
export function isZeroConfigMode(conductor: Conductor): boolean {
  const enabledPlugins = conductor.getConfig().get<string[]>('plugins.enabled') ?? [];
  return ZERO_CONFIG_PLUGINS.every((plugin) => enabledPlugins.includes(plugin));
}
