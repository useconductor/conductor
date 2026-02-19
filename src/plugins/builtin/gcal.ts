/**
 * Google Calendar Plugin
 *
 * Read, create, update, and delete calendar events.
 * Requires Google OAuth — stores access token as google / access_token.
 *
 * Scopes needed:
 *   https://www.googleapis.com/auth/calendar
 *   https://www.googleapis.com/auth/calendar.events
 */

import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

const CAL_BASE = 'https://www.googleapis.com/calendar/v3';

export class GoogleCalendarPlugin implements Plugin {
  name = 'gcal';
  description = 'Read and manage Google Calendar events — requires Google OAuth';
  version = '1.0.0';

  private keychain!: Keychain;

  async initialize(conductor: Conductor): Promise<void> {
    this.keychain = new Keychain(conductor.getConfig().getConfigDir());
  }

  isConfigured(): boolean { return true; }

  private async getToken(): Promise<string> {
    const token = await this.keychain.get('google', 'access_token');
    if (!token) throw new Error('Google not authenticated. Run: conductor ai setup google');
    return token;
  }

  private async calFetch(path: string, options: { method?: string; body?: any } = {}): Promise<any> {
    const token = await this.getToken();
    const res = await fetch(`${CAL_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      if (res.status === 401) throw new Error('Google token expired. Re-authenticate: conductor ai setup google');
      throw new Error(`Google Calendar API ${res.status}: ${err}`);
    }
    if (res.status === 204) return {};
    return res.json();
  }

  /** Format a GCal event for output */
  private formatEvent(e: any) {
    return {
      id: e.id,
      summary: e.summary ?? '(no title)',
      description: e.description ?? '',
      location: e.location ?? '',
      start: e.start?.dateTime ?? e.start?.date ?? '',
      end: e.end?.dateTime ?? e.end?.date ?? '',
      allDay: !!e.start?.date,
      attendees: (e.attendees ?? []).map((a: any) => ({
        email: a.email,
        name: a.displayName ?? '',
        status: a.responseStatus ?? 'needsAction',
      })),
      htmlLink: e.htmlLink ?? '',
      status: e.status ?? 'confirmed',
    };
  }

  getTools(): PluginTool[] {
    return [
      // ── gcal_list_calendars ─────────────────────────────────────────────────
      {
        name: 'gcal_list_calendars',
        description: 'List all Google Calendars accessible to the user',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const res = await this.calFetch('/users/me/calendarList');
          return {
            count: res.items?.length ?? 0,
            calendars: (res.items ?? []).map((c: any) => ({
              id: c.id,
              summary: c.summary,
              primary: c.primary ?? false,
              timeZone: c.timeZone ?? '',
              color: c.colorId ?? '',
            })),
          };
        },
      },

      // ── gcal_list_events ────────────────────────────────────────────────────
      {
        name: 'gcal_list_events',
        description: 'List upcoming calendar events',
        inputSchema: {
          type: 'object',
          properties: {
            calendarId: {
              type: 'string',
              description: 'Calendar ID (default: "primary")',
            },
            timeMin: {
              type: 'string',
              description: 'Start of time range (ISO 8601, default: now)',
            },
            timeMax: {
              type: 'string',
              description: 'End of time range (ISO 8601)',
            },
            maxResults: {
              type: 'number',
              description: 'Max events to return (default: 10)',
            },
            q: {
              type: 'string',
              description: 'Free text search in event fields',
            },
          },
        },
        handler: async ({ calendarId = 'primary', timeMin, timeMax, maxResults = 10, q }: any) => {
          const params = new URLSearchParams({
            singleEvents: 'true',
            orderBy: 'startTime',
            maxResults: String(Math.min(maxResults, 100)),
            timeMin: timeMin ?? new Date().toISOString(),
          });
          if (timeMax) params.set('timeMax', timeMax);
          if (q) params.set('q', q);

          const res = await this.calFetch(
            `/calendars/${encodeURIComponent(calendarId)}/events?${params}`
          );
          return {
            count: res.items?.length ?? 0,
            timeZone: res.timeZone ?? '',
            events: (res.items ?? []).map(this.formatEvent.bind(this)),
          };
        },
      },

      // ── gcal_get_event ──────────────────────────────────────────────────────
      {
        name: 'gcal_get_event',
        description: 'Get full details of a specific calendar event',
        inputSchema: {
          type: 'object',
          properties: {
            eventId: { type: 'string', description: 'Event ID from gcal_list_events' },
            calendarId: { type: 'string', description: 'Calendar ID (default: "primary")' },
          },
          required: ['eventId'],
        },
        handler: async ({ eventId, calendarId = 'primary' }: any) => {
          const e = await this.calFetch(
            `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
          );
          return this.formatEvent(e);
        },
      },

      // ── gcal_create_event ───────────────────────────────────────────────────
      {
        name: 'gcal_create_event',
        description: 'Create a new Google Calendar event',
        inputSchema: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Event title' },
            start: { type: 'string', description: 'Start time (ISO 8601)' },
            end: { type: 'string', description: 'End time (ISO 8601)' },
            description: { type: 'string', description: 'Event description' },
            location: { type: 'string', description: 'Physical location or meeting link' },
            attendees: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of attendee email addresses',
            },
            calendarId: { type: 'string', description: 'Calendar ID (default: "primary")' },
            allDay: { type: 'boolean', description: 'Whether this is an all-day event' },
          },
          required: ['summary', 'start', 'end'],
        },
        handler: async ({
          summary,
          start,
          end,
          description,
          location,
          attendees = [],
          calendarId = 'primary',
          allDay = false,
        }: any) => {
          const body: any = {
            summary,
            description,
            location,
            attendees: attendees.map((email: string) => ({ email })),
            start: allDay ? { date: start.split('T')[0] } : { dateTime: start },
            end: allDay ? { date: end.split('T')[0] } : { dateTime: end },
          };

          const e = await this.calFetch(
            `/calendars/${encodeURIComponent(calendarId)}/events`,
            { method: 'POST', body }
          );
          return { created: true, ...this.formatEvent(e) };
        },
      },

      // ── gcal_update_event ───────────────────────────────────────────────────
      {
        name: 'gcal_update_event',
        description: 'Update an existing Google Calendar event',
        inputSchema: {
          type: 'object',
          properties: {
            eventId: { type: 'string', description: 'Event ID to update' },
            calendarId: { type: 'string', description: 'Calendar ID (default: "primary")' },
            summary: { type: 'string', description: 'New title' },
            start: { type: 'string', description: 'New start time (ISO 8601)' },
            end: { type: 'string', description: 'New end time (ISO 8601)' },
            description: { type: 'string', description: 'New description' },
            location: { type: 'string', description: 'New location' },
          },
          required: ['eventId'],
        },
        handler: async ({ eventId, calendarId = 'primary', ...updates }: any) => {
          // PATCH — only send provided fields
          const patch: any = {};
          if (updates.summary !== undefined) patch.summary = updates.summary;
          if (updates.description !== undefined) patch.description = updates.description;
          if (updates.location !== undefined) patch.location = updates.location;
          if (updates.start !== undefined) patch.start = { dateTime: updates.start };
          if (updates.end !== undefined) patch.end = { dateTime: updates.end };

          const e = await this.calFetch(
            `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
            { method: 'PATCH', body: patch }
          );
          return { updated: true, ...this.formatEvent(e) };
        },
      },

      // ── gcal_delete_event ───────────────────────────────────────────────────
      {
        name: 'gcal_delete_event',
        description: 'Delete a Google Calendar event',
        inputSchema: {
          type: 'object',
          properties: {
            eventId: { type: 'string', description: 'Event ID to delete' },
            calendarId: { type: 'string', description: 'Calendar ID (default: "primary")' },
          },
          required: ['eventId'],
        },
        handler: async ({ eventId, calendarId = 'primary' }: any) => {
          await this.calFetch(
            `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
            { method: 'DELETE' }
          );
          return { deleted: true, eventId };
        },
      },
    ];
  }
}
