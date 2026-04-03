import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';

export class TimezonePlugin implements Plugin {
  name = 'timezone';
  description = 'World clock, timezone conversions, current time in any city';
  version = '1.0.0';

  async initialize(_conductor: Conductor): Promise<void> {}
  isConfigured(): boolean {
    return true;
  }

  /** Map common city names to IANA timezone identifiers. */
  private cityToTz(city: string): string {
    const map: Record<string, string> = {
      'new york': 'America/New_York',
      nyc: 'America/New_York',
      'los angeles': 'America/Los_Angeles',
      la: 'America/Los_Angeles',
      chicago: 'America/Chicago',
      toronto: 'America/Toronto',
      vancouver: 'America/Vancouver',
      montreal: 'America/Toronto',
      london: 'Europe/London',
      paris: 'Europe/Paris',
      berlin: 'Europe/Berlin',
      tokyo: 'Asia/Tokyo',
      sydney: 'Australia/Sydney',
      dubai: 'Asia/Dubai',
      singapore: 'Asia/Singapore',
      'hong kong': 'Asia/Hong_Kong',
      shanghai: 'Asia/Shanghai',
      beijing: 'Asia/Shanghai',
      mumbai: 'Asia/Kolkata',
      delhi: 'Asia/Kolkata',
      seoul: 'Asia/Seoul',
      moscow: 'Europe/Moscow',
      'sao paulo': 'America/Sao_Paulo',
      cairo: 'Africa/Cairo',
      istanbul: 'Europe/Istanbul',
      bangkok: 'Asia/Bangkok',
      jakarta: 'Asia/Jakarta',
      'mexico city': 'America/Mexico_City',
      denver: 'America/Denver',
      'san francisco': 'America/Los_Angeles',
      sf: 'America/Los_Angeles',
      utc: 'UTC',
      gmt: 'UTC',
      est: 'America/New_York',
      pst: 'America/Los_Angeles',
      cst: 'America/Chicago',
      mst: 'America/Denver',
      cet: 'Europe/Paris',
      jst: 'Asia/Tokyo',
      ist: 'Asia/Kolkata',
      aest: 'Australia/Sydney',
    };
    return map[city.toLowerCase()] || city; // Fall back to raw timezone string
  }

  getTools(): PluginTool[] {
    return [
      {
        name: 'time_now',
        description: 'Get current time in one or more cities/timezones',
        inputSchema: {
          type: 'object',
          properties: {
            cities: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of cities or timezone names (e.g. ["Toronto", "Tokyo", "London"])',
            },
          },
          required: ['cities'],
        },
        handler: async (input: { cities: string[] }) => {
          return input.cities.map((city) => {
            const tz = this.cityToTz(city);
            try {
              const now = new Date();
              const options: Intl.DateTimeFormatOptions = {
                timeZone: tz,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              };
              return { city, timezone: tz, time: now.toLocaleString('en-US', options) };
            } catch {
              return { city, timezone: tz, error: `Invalid timezone: ${tz}` };
            }
          });
        },
      },
      {
        name: 'time_convert',
        description: 'Convert a time from one timezone to another',
        inputSchema: {
          type: 'object',
          properties: {
            time: { type: 'string', description: 'Time to convert (e.g. "3:00 PM", "15:00", "2025-03-15 09:00")' },
            from: { type: 'string', description: 'Source city or timezone' },
            to: { type: 'string', description: 'Target city or timezone' },
          },
          required: ['time', 'from', 'to'],
        },
        handler: async (input: { time: string; from: string; to: string }) => {
          const fromTz = this.cityToTz(input.from);
          const toTz = this.cityToTz(input.to);

          // Parse input time
          const now = new Date();
          let dateStr = input.time;

          // Handle time-only inputs by prepending today's date
          if (/^\d{1,2}:\d{2}/.test(dateStr)) {
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');

            // Convert 12h to 24h if needed
            const isPM = /pm/i.test(dateStr);
            const isAM = /am/i.test(dateStr);
            let clean = dateStr.replace(/\s*(am|pm)/i, '');
            if (isPM || isAM) {
              const parts = clean.split(':');
              let h = parseInt(parts[0]);
              if (isPM && h !== 12) h += 12;
              if (isAM && h === 12) h = 0;
              clean = `${h}:${parts[1]}`;
            }

            dateStr = `${y}-${m}-${d}T${clean}:00`;
          }

          // Create a date in the source timezone
          const sourceDate = new Date(dateStr);
          if (isNaN(sourceDate.getTime())) {
            return { error: `Could not parse time: "${input.time}"` };
          }

          const formatOpts: Intl.DateTimeFormatOptions = {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          };

          return {
            from: {
              city: input.from,
              timezone: fromTz,
              time: sourceDate.toLocaleString('en-US', { ...formatOpts, timeZone: fromTz }),
            },
            to: {
              city: input.to,
              timezone: toTz,
              time: sourceDate.toLocaleString('en-US', { ...formatOpts, timeZone: toTz }),
            },
          };
        },
      },
    ];
  }
}
