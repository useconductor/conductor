import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';

export class WeatherPlugin implements Plugin {
  name = 'weather';
  description = 'Current weather and forecasts (powered by Open-Meteo, no API key needed)';
  version = '1.0.0';

  async initialize(_conductor: Conductor): Promise<void> {}
  isConfigured(): boolean {
    return true;
  }

  private async geocode(city: string): Promise<{ lat: number; lon: number; name: string; country: string }> {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
    const data = (await res.json()) as any;
    if (!data.results?.length) throw new Error(`City not found: ${city}`);
    const r = data.results[0];
    return { lat: r.latitude, lon: r.longitude, name: r.name, country: r.country };
  }

  private wmoCode(code: number): string {
    const codes: Record<number, string> = {
      0: 'Clear sky',
      1: 'Mainly clear',
      2: 'Partly cloudy',
      3: 'Overcast',
      45: 'Fog',
      48: 'Rime fog',
      51: 'Light drizzle',
      53: 'Moderate drizzle',
      55: 'Dense drizzle',
      61: 'Slight rain',
      63: 'Moderate rain',
      65: 'Heavy rain',
      71: 'Slight snow',
      73: 'Moderate snow',
      75: 'Heavy snow',
      77: 'Snow grains',
      80: 'Slight showers',
      81: 'Moderate showers',
      82: 'Violent showers',
      85: 'Slight snow showers',
      86: 'Heavy snow showers',
      95: 'Thunderstorm',
      96: 'Thunderstorm w/ slight hail',
      99: 'Thunderstorm w/ heavy hail',
    };
    return codes[code] || `Unknown (${code})`;
  }

  getTools(): PluginTool[] {
    return [
      {
        name: 'weather_current',
        description: 'Get current weather for a city',
        inputSchema: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name (e.g. "Toronto", "London")' },
          },
          required: ['city'],
        },
        handler: async (input: { city: string }) => {
          const geo = await this.geocode(input.city);
          const res = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m&temperature_unit=celsius`,
          );
          const data = (await res.json()) as any;
          const c = data.current;
          return {
            location: `${geo.name}, ${geo.country}`,
            temperature: `${c.temperature_2m}°C`,
            feels_like: `${c.apparent_temperature}°C`,
            humidity: `${c.relative_humidity_2m}%`,
            wind: `${c.wind_speed_10m} km/h`,
            condition: this.wmoCode(c.weather_code),
          };
        },
      },
      {
        name: 'weather_forecast',
        description: 'Get 7-day weather forecast for a city',
        inputSchema: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name' },
          },
          required: ['city'],
        },
        handler: async (input: { city: string }) => {
          const geo = await this.geocode(input.city);
          const res = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum&temperature_unit=celsius&forecast_days=7`,
          );
          const data = (await res.json()) as any;
          const d = data.daily;
          return {
            location: `${geo.name}, ${geo.country}`,
            forecast: d.time.map((date: string, i: number) => ({
              date,
              high: `${d.temperature_2m_max[i]}°C`,
              low: `${d.temperature_2m_min[i]}°C`,
              condition: this.wmoCode(d.weather_code[i]),
              precipitation: `${d.precipitation_sum[i]} mm`,
            })),
          };
        },
      },
    ];
  }
}
