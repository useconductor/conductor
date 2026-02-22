/**
 * HomeKit Plugin — TheAlxLabs / Conductor
 *
 * Control HomeKit smart home devices via the Homebridge UI REST API
 * (homebridge-config-ui-x). Requires Homebridge with the UI plugin installed.
 *
 * Setup:
 *   1. Install Homebridge: https://homebridge.io/
 *   2. Install homebridge-config-ui-x (usually included by default)
 *   3. Configure the plugin:
 *      conductor plugins config homekit base_url http://homebridge.local:8581
 *      conductor plugins config homekit username admin
 *      conductor plugins config homekit password <your-password>
 *      conductor plugins enable homekit
 *
 * The plugin authenticates with Homebridge UI and caches the JWT token.
 */

import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';

export class HomeKitPlugin implements Plugin {
  name = 'homekit';
  description = 'Control HomeKit smart home devices via Homebridge UI REST API';
  version = '1.0.0';

  configSchema = {
    fields: [
      {
        key: 'base_url',
        label: 'Homebridge UI URL',
        type: 'string' as const,
        description: 'URL to your Homebridge UI (e.g. http://homebridge.local:8581)',
        required: true,
        secret: false,
      },
      {
        key: 'username',
        label: 'Homebridge Username',
        type: 'string' as const,
        description: 'Your Homebridge UI username (default: admin)',
        required: true,
        secret: false,
      },
      {
        key: 'password',
        label: 'Homebridge Password',
        type: 'password' as const,
        description: 'Your Homebridge UI password',
        required: true,
        secret: true,
        service: 'homekit',
      },
    ],
    setupInstructions:
      'Install Homebridge (https://homebridge.io/) with the homebridge-config-ui-x plugin. ' +
      'Then set base_url, username, and password to match your Homebridge UI settings.',
  };

  private config!: ReturnType<Conductor['getConfig']>;
  private cachedToken: string | null = null;
  private tokenExpiry: number = 0;

  async initialize(conductor: Conductor): Promise<void> {
    this.config = conductor.getConfig();
  }

  isConfigured(): boolean {
    const baseUrl = this.config.get<string>('plugins.homekit.base_url');
    const username = this.config.get<string>('plugins.homekit.username');
    return !!(baseUrl && username);
  }

  // ── Auth helpers ─────────────────────────────────────────────────────────────

  private getBaseUrl(): string {
    const url = this.config.get<string>('plugins.homekit.base_url');
    if (!url) throw new Error('HomeKit plugin not configured. Run: conductor plugins config homekit base_url <url>');
    return url.replace(/\/$/, '');
  }

  private async getToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.cachedToken && Date.now() < this.tokenExpiry - 60_000) {
      return this.cachedToken;
    }

    const baseUrl = this.getBaseUrl();
    const username = this.config.get<string>('plugins.homekit.username') || 'admin';
    const password = this.config.get<string>('plugins.homekit.password');

    if (!password) {
      throw new Error(
        'HomeKit password not configured.\n' +
        'Run: conductor plugins config homekit password <your-password>'
      );
    }

    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Homebridge auth failed (${res.status}): ${text}`);
    }

    const data = await res.json() as any;
    if (!data.access_token) {
      throw new Error('Homebridge did not return an access token. Check credentials.');
    }

    this.cachedToken = data.access_token;
    // Homebridge tokens expire in 8 hours by default
    this.tokenExpiry = Date.now() + (data.expires_in ?? 28_800) * 1000;
    return this.cachedToken!;
  }

  private async hbFetch(
    path: string,
    options: { method?: string; body?: any } = {}
  ): Promise<any> {
    const baseUrl = this.getBaseUrl();
    const token = await this.getToken();

    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Homebridge API ${res.status} ${path}: ${text}`);
    }

    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  // ── Formatting helpers ───────────────────────────────────────────────────────

  private formatAccessory(acc: any) {
    return {
      uniqueId: acc.uniqueId,
      aid: acc.aid,
      iid: acc.iid,
      uuid: acc.uuid,
      type: acc.type,
      humanType: acc.humanType,
      serviceName: acc.serviceName,
      serviceCharacteristics: (acc.serviceCharacteristics ?? []).map((c: any) => ({
        type: c.type,
        description: c.description,
        value: c.value,
        format: c.format,
        unit: c.unit,
        minValue: c.minValue,
        maxValue: c.maxValue,
        canRead: c.canRead,
        canWrite: c.canWrite,
      })),
      linked: acc.linked,
    };
  }

  // ── Tools ────────────────────────────────────────────────────────────────────

  getTools(): PluginTool[] {
    return [
      // ── homekit_status ────────────────────────────────────────────────────
      {
        name: 'homekit_status',
        description: 'Check Homebridge connectivity, version, and accessory summary',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const [server, accessories] = await Promise.all([
            this.hbFetch('/api/server/status').catch(() => null),
            this.hbFetch('/api/accessories').catch(() => []),
          ]);

          const acc = Array.isArray(accessories) ? accessories : [];
          const typeCount: Record<string, number> = {};
          for (const a of acc) {
            const t = a.humanType || a.type || 'Unknown';
            typeCount[t] = (typeCount[t] || 0) + 1;
          }

          return {
            connected: true,
            homebridgeVersion: server?.homebridgeVersion ?? 'unknown',
            nodeVersion: server?.nodeVersion ?? 'unknown',
            uptime: server?.uptime ?? null,
            totalAccessories: acc.length,
            byType: typeCount,
          };
        },
      },

      // ── homekit_accessories ───────────────────────────────────────────────
      {
        name: 'homekit_accessories',
        description:
          'List all HomeKit accessories with their current state. Optionally filter by type or name.',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'Filter by human type (e.g. "Lightbulb", "Switch", "Thermostat", "Lock")',
            },
            name: {
              type: 'string',
              description: 'Filter by accessory name (partial match, case-insensitive)',
            },
          },
        },
        handler: async ({ type, name }: any) => {
          const accessories = await this.hbFetch('/api/accessories');
          let acc = Array.isArray(accessories) ? accessories : [];

          if (type) {
            acc = acc.filter((a: any) =>
              (a.humanType || a.type || '').toLowerCase().includes(type.toLowerCase())
            );
          }
          if (name) {
            acc = acc.filter((a: any) =>
              (a.serviceName || '').toLowerCase().includes(name.toLowerCase())
            );
          }

          return {
            count: acc.length,
            accessories: acc.map((a: any) => {
              // Find the primary On/Active characteristic for a quick state summary
              const onChar = (a.serviceCharacteristics ?? []).find(
                (c: any) => c.type === 'On' || c.type === 'Active'
              );
              return {
                uniqueId: a.uniqueId,
                name: a.serviceName,
                type: a.humanType || a.type,
                state: onChar ? (onChar.value ? 'on' : 'off') : undefined,
                characteristics: (a.serviceCharacteristics ?? []).map((c: any) => ({
                  type: c.type,
                  value: c.value,
                  unit: c.unit,
                })),
              };
            }),
          };
        },
      },

      // ── homekit_get_accessory ─────────────────────────────────────────────
      {
        name: 'homekit_get_accessory',
        description: 'Get full details and all characteristics of a specific HomeKit accessory',
        inputSchema: {
          type: 'object',
          properties: {
            uniqueId: {
              type: 'string',
              description: 'The uniqueId of the accessory (from homekit_accessories)',
            },
          },
          required: ['uniqueId'],
        },
        handler: async ({ uniqueId }: any) => {
          const acc = await this.hbFetch(`/api/accessories/${uniqueId}`);
          return this.formatAccessory(acc);
        },
      },

      // ── homekit_set ───────────────────────────────────────────────────────
      {
        name: 'homekit_set',
        description:
          'Set a characteristic on a HomeKit accessory (e.g. On, Brightness, TargetTemperature, Hue, LockTargetState)',
        inputSchema: {
          type: 'object',
          properties: {
            uniqueId: {
              type: 'string',
              description: 'The uniqueId of the accessory',
            },
            characteristicType: {
              type: 'string',
              description:
                'Characteristic to set (e.g. "On", "Brightness", "TargetTemperature", "Hue", "Saturation", "LockTargetState")',
            },
            value: {
              description: 'Value to set (boolean, number, or string depending on characteristic)',
            },
          },
          required: ['uniqueId', 'characteristicType', 'value'],
        },
        requiresApproval: true,
        handler: async ({ uniqueId, characteristicType, value }: any) => {
          const result = await this.hbFetch(`/api/accessories/${uniqueId}`, {
            method: 'PUT',
            body: { characteristicType, value },
          });
          return {
            success: true,
            uniqueId,
            characteristicType,
            value,
            result,
          };
        },
      },

      // ── homekit_toggle ────────────────────────────────────────────────────
      {
        name: 'homekit_toggle',
        description: 'Toggle a HomeKit accessory on or off by name (partial match)',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Accessory name to toggle (partial match, case-insensitive)',
            },
            state: {
              type: 'boolean',
              description: 'true = on, false = off. If omitted, toggles current state.',
            },
          },
          required: ['name'],
        },
        requiresApproval: true,
        handler: async ({ name, state }: any) => {
          // Find matching accessories
          const accessories = await this.hbFetch('/api/accessories');
          const acc = Array.isArray(accessories) ? accessories : [];

          const matches = acc.filter((a: any) =>
            (a.serviceName || '').toLowerCase().includes(name.toLowerCase())
          );

          if (matches.length === 0) {
            return { error: `No accessory found matching: "${name}"` };
          }

          const results = [];
          for (const a of matches) {
            const onChar = (a.serviceCharacteristics ?? []).find(
              (c: any) => c.type === 'On' || c.type === 'Active'
            );
            if (!onChar) {
              results.push({ name: a.serviceName, error: 'No On/Active characteristic found' });
              continue;
            }

            const newState = state !== undefined ? state : !onChar.value;
            await this.hbFetch(`/api/accessories/${a.uniqueId}`, {
              method: 'PUT',
              body: { characteristicType: onChar.type, value: newState },
            });
            results.push({
              name: a.serviceName,
              type: a.humanType || a.type,
              previousState: onChar.value ? 'on' : 'off',
              newState: newState ? 'on' : 'off',
            });
          }

          return { toggled: results.length, results };
        },
      },

      // ── homekit_rooms ─────────────────────────────────────────────────────
      {
        name: 'homekit_rooms',
        description: 'View the room/zone layout from Homebridge',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const layout = await this.hbFetch('/api/accessories/layout');
          return { rooms: layout };
        },
      },
    ];
  }
}
