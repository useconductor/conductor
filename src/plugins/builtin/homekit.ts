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

export class HomeKitPlugin implements Plugin {
  name = 'homekit';
  description = 'Control HomeKit smart home devices via Homebridge UI REST API';
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
        label: 'Homebridge UI URL',
        type: 'string' as const,
        description: 'URL to your Homebridge UI (e.g. http://homebridge.local:8581)',
        required: true,
        secret: false,
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
        description: 'Your Homebridge UI username (default: admin)',
        required: true,
        secret: false,
        required: true,
        secret: false,
        description: 'Your Homebridge UI login username (default: admin)',
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
      'Install Homebridge (https://homebridge.io) on your local network. ' +
      'The homebridge-config-ui-x plugin must be installed (it is by default with most install methods). ' +
      'Find your Homebridge URL by opening the Homebridge UI in a browser (usually http://homebridge.local:8581 ' +
      'or http://<your-pi-ip>:8581).',
  };

  private keychain!: Keychain;
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

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Homebridge API ${res.status} ${path}: ${text}`);
    }

    const text = await res.text();
    return text ? JSON.parse(text) : {};
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
      // ── homekit_accessories ───────────────────────────────────────────────
      {
        name: 'homekit_accessories',
        description: 'List all HomeKit accessories with their current state',
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
            count: filtered.length,
            accessories: filtered.map(this.formatAccessory.bind(this)),
          };
        },
      },

      // ── homekit_get_accessory ─────────────────────────────────────────────
      {
        name: 'homekit_get_accessory',
        description: 'Get full details and all characteristics of a specific HomeKit accessory',
        description:
          'Get the current state and all characteristics of a specific HomeKit accessory',
        inputSchema: {
          type: 'object',
          properties: {
            uniqueId: {
              type: 'string',
              description: 'The uniqueId of the accessory (from homekit_accessories)',
              description: 'Accessory uniqueId (from homekit_accessories)',
            },
          },
          required: ['uniqueId'],
        },
        handler: async ({ uniqueId }: any) => {
          const acc = await this.hbFetch(`/api/accessories/${uniqueId}`);
          return this.formatAccessory(acc);
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
          'Set a characteristic on a HomeKit accessory (e.g. On, Brightness, TargetTemperature, Hue, LockTargetState)',
          'Set a characteristic on a HomeKit accessory. ' +
          'Common examples: On (true/false), Brightness (0-100), ' +
          'TargetTemperature (degrees), Hue (0-360), Saturation (0-100), ' +
          'LockTargetState (0=unsecured, 1=secured).',
        inputSchema: {
          type: 'object',
          properties: {
            uniqueId: {
              type: 'string',
              description: 'The uniqueId of the accessory',
              description: 'Accessory uniqueId (from homekit_accessories)',
            },
            characteristicType: {
              type: 'string',
              description:
                'Characteristic to set (e.g. "On", "Brightness", "TargetTemperature", "Hue", "Saturation", "LockTargetState")',
            },
            value: {
              description: 'Value to set (boolean, number, or string depending on characteristic)',
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
        description: 'Toggle a HomeKit accessory on or off by name (partial match)',
        description:
          'Toggle a HomeKit accessory on or off by name. ' +
          'Finds the accessory by partial name match and flips (or sets) its On state.',
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
        description: 'View the room/zone layout from Homebridge',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const layout = await this.hbFetch('/api/accessories/layout');
          return { rooms: layout };
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
