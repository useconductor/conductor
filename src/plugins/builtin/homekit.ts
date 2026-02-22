/**
 * HomeKit Plugin — TheAlxLabs / Conductor
 *
 * Control HomeKit accessories via the Homebridge UI REST API.
 * Requires Homebridge with homebridge-config-ui-x installed (the default UI).
 *
 * Setup:
 *   1. Install Homebridge: https://homebridge.io
 *      (homebridge-config-ui-x is included by default)
 *   2. Run: conductor plugins config homekit base_url http://homebridge.local:8581
 *   3. Run: conductor plugins config homekit username admin
 *   4. Run: conductor plugins config homekit password <YOUR_PASSWORD>
 *
 * Keychain entries: homekit/base_url, homekit/username, homekit/password
 *
 * Supported tools:
 *   - homekit_accessories   — List all accessories with current state
 *   - homekit_get_accessory — Get a single accessory's full details
 *   - homekit_set           — Set any characteristic (On, Brightness, Hue, Temperature, etc.)
 *   - homekit_toggle        — Toggle an accessory on/off by name
 *   - homekit_rooms         — Show room layout from Homebridge
 *   - homekit_status        — Check Homebridge connectivity and version
 */

import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

export class HomeKitPlugin implements Plugin {
  name = 'homekit';
  description =
    'Control HomeKit smart home devices via Homebridge — list, get, and control accessories';
  version = '1.0.0';

  configSchema = {
    fields: [
      {
        key: 'base_url',
        label: 'Homebridge URL',
        type: 'string' as const,
        required: true,
        secret: false,
        description: 'e.g. http://homebridge.local:8581 or http://192.168.1.100:8581',
      },
      {
        key: 'username',
        label: 'Homebridge Username',
        type: 'string' as const,
        required: true,
        secret: false,
        description: 'Your Homebridge UI login username (default: admin)',
      },
      {
        key: 'password',
        label: 'Homebridge Password',
        type: 'password' as const,
        required: true,
        secret: true,
        service: 'homekit',
      },
    ],
    setupInstructions:
      'Install Homebridge (https://homebridge.io) on your local network. ' +
      'The homebridge-config-ui-x plugin must be installed (it is by default with most install methods). ' +
      'Find your Homebridge URL by opening the Homebridge UI in a browser (usually http://homebridge.local:8581 ' +
      'or http://<your-pi-ip>:8581).',
  };

  private keychain!: Keychain;
  private cachedToken: string | null = null;
  private tokenExpiry: number = 0;

  async initialize(conductor: Conductor): Promise<void> {
    this.keychain = new Keychain(conductor.getConfig().getConfigDir());
  }

  isConfigured(): boolean {
    return true;
  }

  // ── Credential helpers ───────────────────────────────────────────────────────

  private async getCredentials(): Promise<{ baseUrl: string; username: string; password: string }> {
    const rawUrl = await this.keychain.get('homekit', 'base_url');
    const username = await this.keychain.get('homekit', 'username');
    const password = await this.keychain.get('homekit', 'password');

    if (!rawUrl) {
      throw new Error(
        'Homebridge URL not configured.\n' +
        'Run: conductor plugins config homekit base_url http://homebridge.local:8581'
      );
    }
    if (!username) {
      throw new Error(
        'Homebridge username not configured.\n' +
        'Run: conductor plugins config homekit username admin'
      );
    }
    if (!password) {
      throw new Error(
        'Homebridge password not configured.\n' +
        'Run: conductor plugins config homekit password <YOUR_PASSWORD>'
      );
    }

    const baseUrl = rawUrl.replace(/\/$/, '');
    return { baseUrl, username, password };
  }

  /** Authenticate with Homebridge UI and return a JWT token (cached). */
  private async getToken(): Promise<string> {
    // Return cached token if still valid (with 5-minute buffer)
    if (this.cachedToken && Date.now() < this.tokenExpiry - 5 * 60 * 1000) {
      return this.cachedToken;
    }

    const { baseUrl, username, password } = await this.getCredentials();

    const res = await fetch(`${baseUrl}/api/auth/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: res.statusText }))) as any;
      throw new Error(
        `Homebridge authentication failed: ${err.message ?? res.statusText}\n` +
        'Check your credentials with: conductor plugins config homekit'
      );
    }

    const data = (await res.json()) as any;
    this.cachedToken = data.access_token;
    // Homebridge tokens are valid for ~8 hours; cache for 7 to stay safe
    this.tokenExpiry = Date.now() + 7 * 60 * 60 * 1000;

    return this.cachedToken!;
  }

  // ── API fetch wrapper ────────────────────────────────────────────────────────

  private async homebridgeFetch(
    path: string,
    options: { method?: string; body?: any } = {}
  ): Promise<any> {
    const { baseUrl } = await this.getCredentials();
    const token = await this.getToken();

    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (res.status === 204) return {};

    if (res.status === 401) {
      // Token expired — clear cache so next call re-authenticates
      this.cachedToken = null;
      throw new Error('Homebridge session expired. Please retry the request.');
    }

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: res.statusText }))) as any;
      throw new Error(`Homebridge API ${res.status}: ${err.message ?? res.statusText}`);
    }

    return res.json();
  }

  // ── Formatting helpers ───────────────────────────────────────────────────────

  private formatAccessory(acc: any) {
    return {
      uniqueId: acc.uniqueId,
      name: acc.serviceName ?? acc.displayName ?? 'Unknown',
      type: acc.humanType ?? acc.type ?? 'Unknown',
      room: acc.roomName ?? null,
      values: acc.values ?? {},
      on: acc.values?.On ?? null,
      reachable: acc.reachable ?? true,
    };
  }

  // ── Tools ────────────────────────────────────────────────────────────────────

  getTools(): PluginTool[] {
    return [
      // ── homekit_accessories ───────────────────────────────────────────────
      {
        name: 'homekit_accessories',
        description: 'List all HomeKit accessories with their current state',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description:
                'Filter by accessory type (e.g. "Lightbulb", "Switch", "Thermostat", "Lock", "Fan")',
            },
            room: {
              type: 'string',
              description: 'Filter by room name (partial match, case-insensitive)',
            },
          },
        },
        handler: async ({ type, room }: any) => {
          const accessories = (await this.homebridgeFetch('/api/accessories')) as any[];
          let filtered = accessories;

          if (type) {
            const q = type.toLowerCase();
            filtered = filtered.filter((a: any) =>
              (a.humanType ?? a.type ?? '').toLowerCase().includes(q)
            );
          }

          if (room) {
            const q = room.toLowerCase();
            filtered = filtered.filter((a: any) =>
              (a.roomName ?? '').toLowerCase().includes(q)
            );
          }

          return {
            count: filtered.length,
            accessories: filtered.map(this.formatAccessory.bind(this)),
          };
        },
      },

      // ── homekit_get_accessory ─────────────────────────────────────────────
      {
        name: 'homekit_get_accessory',
        description:
          'Get the current state and all characteristics of a specific HomeKit accessory',
        inputSchema: {
          type: 'object',
          properties: {
            uniqueId: {
              type: 'string',
              description: 'Accessory uniqueId (from homekit_accessories)',
            },
          },
          required: ['uniqueId'],
        },
        handler: async ({ uniqueId }: any) => {
          const acc = await this.homebridgeFetch(
            `/api/accessories/${encodeURIComponent(uniqueId)}`
          );
          return {
            ...this.formatAccessory(acc),
            serviceCharacteristics: (acc.serviceCharacteristics ?? []).map((c: any) => ({
              type: c.type,
              description: c.description,
              value: c.value,
              format: c.format,
              unit: c.unit ?? null,
              minValue: c.minValue ?? null,
              maxValue: c.maxValue ?? null,
              canRead: c.canRead ?? true,
              canWrite: c.canWrite ?? false,
            })),
          };
        },
      },

      // ── homekit_set ───────────────────────────────────────────────────────
      {
        name: 'homekit_set',
        description:
          'Set a characteristic on a HomeKit accessory. ' +
          'Common examples: On (true/false), Brightness (0-100), ' +
          'TargetTemperature (degrees), Hue (0-360), Saturation (0-100), ' +
          'LockTargetState (0=unsecured, 1=secured).',
        inputSchema: {
          type: 'object',
          properties: {
            uniqueId: {
              type: 'string',
              description: 'Accessory uniqueId (from homekit_accessories)',
            },
            characteristicType: {
              type: 'string',
              description:
                'The characteristic to set (e.g. "On", "Brightness", "TargetTemperature", "Hue")',
            },
            value: {
              description: 'The value to set (boolean, number, or string)',
            },
          },
          required: ['uniqueId', 'characteristicType', 'value'],
        },
        requiresApproval: true,
        handler: async ({ uniqueId, characteristicType, value }: any) => {
          await this.homebridgeFetch(`/api/accessories/${encodeURIComponent(uniqueId)}`, {
            method: 'PUT',
            body: { characteristicType, value },
          });

          // Fetch updated state to confirm the change
          const updated = await this.homebridgeFetch(
            `/api/accessories/${encodeURIComponent(uniqueId)}`
          );

          return {
            success: true,
            set: { characteristicType, value },
            accessory: this.formatAccessory(updated),
          };
        },
      },

      // ── homekit_toggle ────────────────────────────────────────────────────
      {
        name: 'homekit_toggle',
        description:
          'Toggle a HomeKit accessory on or off by name. ' +
          'Finds the accessory by partial name match and flips (or sets) its On state.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Accessory name (partial match, case-insensitive)',
            },
            on: {
              type: 'boolean',
              description:
                'Force on (true) or off (false). If omitted, toggles the current state.',
            },
          },
          required: ['name'],
        },
        requiresApproval: true,
        handler: async ({ name, on }: any) => {
          const accessories = (await this.homebridgeFetch('/api/accessories')) as any[];
          const q = name.toLowerCase();
          const acc = accessories.find((a: any) =>
            (a.serviceName ?? a.displayName ?? '').toLowerCase().includes(q)
          );

          if (!acc) {
            const available = accessories
              .map((a: any) => a.serviceName ?? a.displayName)
              .filter(Boolean)
              .join(', ');
            return {
              error: `No accessory found matching "${name}".`,
              available,
            };
          }

          const currentOn = acc.values?.On ?? false;
          const targetOn = on !== undefined ? on : !currentOn;

          await this.homebridgeFetch(`/api/accessories/${encodeURIComponent(acc.uniqueId)}`, {
            method: 'PUT',
            body: { characteristicType: 'On', value: targetOn },
          });

          return {
            success: true,
            accessory: acc.serviceName ?? acc.displayName,
            uniqueId: acc.uniqueId,
            previousState: currentOn,
            on: targetOn,
          };
        },
      },

      // ── homekit_rooms ─────────────────────────────────────────────────────
      {
        name: 'homekit_rooms',
        description: 'Get the room layout from Homebridge — shows which accessories are in which rooms',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const layout = (await this.homebridgeFetch('/api/accessories/layout')) as any[];
          return {
            count: layout.length,
            rooms: layout.map((room: any) => ({
              name: room.name ?? 'Default Room',
              accessories: (room.services ?? []).map((s: any) => ({
                uniqueId: s.uniqueId,
                name: s.customName ?? s.serviceName ?? s.displayName,
                type: s.humanType ?? s.type,
              })),
            })),
          };
        },
      },

      // ── homekit_status ────────────────────────────────────────────────────
      {
        name: 'homekit_status',
        description:
          'Check Homebridge connection status, version, and a summary of all accessories',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const [accessoriesResult, serverResult] = await Promise.allSettled([
            this.homebridgeFetch('/api/accessories'),
            this.homebridgeFetch('/api/server/version'),
          ]);

          const accessories =
            accessoriesResult.status === 'fulfilled'
              ? (accessoriesResult.value as any[])
              : [];
          const server =
            serverResult.status === 'fulfilled' ? (serverResult.value as any) : {};

          // Count accessories by type
          const byType: Record<string, number> = {};
          for (const acc of accessories) {
            const type = acc.humanType ?? 'Unknown';
            byType[type] = (byType[type] ?? 0) + 1;
          }

          const { baseUrl } = await this.getCredentials();

          return {
            connected: accessoriesResult.status === 'fulfilled',
            homebridgeUrl: baseUrl,
            homebridgeVersion: server.homebridgeVersion ?? server.currentVersion ?? 'unknown',
            nodeVersion: server.nodeVersion ?? 'unknown',
            totalAccessories: accessories.length,
            byType,
          };
        },
      },
    ];
  }
}
