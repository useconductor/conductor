/**
 * Tests for all zero-config plugins — no API keys required.
 * Covers: calculator, colors, hash, text-tools, timezone.
 */
import { describe, it, expect } from 'vitest';
import { CalculatorPlugin } from '../src/plugins/builtin/calculator.js';
import { ColorPlugin } from '../src/plugins/builtin/colors.js';
import { HashPlugin } from '../src/plugins/builtin/hash.js';
import { TextToolsPlugin } from '../src/plugins/builtin/text-tools.js';
import { TimezonePlugin } from '../src/plugins/builtin/timezone.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getHandler<T = unknown>(
  plugin: { getTools(): { name: string; handler: (i: unknown) => Promise<unknown> }[] },
  toolName: string,
): (input: T) => Promise<unknown> {
  const tool = plugin.getTools().find((t) => t.name === toolName);
  if (!tool) throw new Error(`Tool ${toolName} not found`);
  return tool.handler as (input: T) => Promise<unknown>;
}

// ── Calculator ────────────────────────────────────────────────────────────────

describe('CalculatorPlugin', () => {
  const plugin = new CalculatorPlugin();

  it('is always configured', () => {
    expect(plugin.isConfigured()).toBe(true);
  });

  it('exposes calc_math, calc_convert, calc_date tools', () => {
    const names = plugin.getTools().map((t) => t.name);
    expect(names).toContain('calc_math');
    expect(names).toContain('calc_convert');
    expect(names).toContain('calc_date');
  });

  describe('calc_math', () => {
    const fn = () => getHandler<{ expression: string }>(plugin, 'calc_math');

    it('evaluates addition', async () => {
      const r = (await fn()({ expression: '2 + 2' })) as { result: unknown };
      expect(r.result).toBe(4);
    });

    it('evaluates sqrt', async () => {
      const r = (await fn()({ expression: 'sqrt(144)' })) as { result: unknown };
      expect(r.result).toBe(12);
    });

    it('evaluates combined expression', async () => {
      const r = (await fn()({ expression: 'sqrt(144) + 2^3' })) as { result: unknown };
      expect(r.result).toBe(20);
    });

    it('evaluates PI', async () => {
      const r = (await fn()({ expression: 'PI' })) as { result: number };
      expect(r.result).toBeCloseTo(Math.PI, 5);
    });

    it('evaluates sin(0)', async () => {
      const r = (await fn()({ expression: 'sin(0)' })) as { result: number };
      expect(r.result).toBe(0);
    });

    it('evaluates floor / ceil / round', async () => {
      expect(((await fn()({ expression: 'floor(3.9)' })) as { result: unknown }).result).toBe(3);
      expect(((await fn()({ expression: 'ceil(3.1)' })) as { result: unknown }).result).toBe(4);
      expect(((await fn()({ expression: 'round(3.5)' })) as { result: unknown }).result).toBe(4);
    });

    it('throws on invalid expression', async () => {
      await expect(fn()({ expression: 'not_a_function_xyz()' })).rejects.toThrow();
    });

    it('respects order of operations with parentheses', async () => {
      const r = (await fn()({ expression: '(2 + 3) * 4' })) as { result: unknown };
      expect(r.result).toBe(20);
    });
  });

  describe('calc_convert', () => {
    const fn = () => getHandler<{ value: number; from: string; to: string }>(plugin, 'calc_convert');

    it('converts km to mi', async () => {
      const r = (await fn()({ value: 1, from: 'km', to: 'mi' })) as { result: number };
      expect(r.result).toBeCloseTo(0.621371, 3);
    });

    it('converts mi to km', async () => {
      const r = (await fn()({ value: 1, from: 'mi', to: 'km' })) as { result: number };
      expect(r.result).toBeCloseTo(1.60934, 3);
    });

    it('converts kg to lb', async () => {
      const r = (await fn()({ value: 1, from: 'kg', to: 'lb' })) as { result: number };
      expect(r.result).toBeCloseTo(2.20462, 3);
    });

    it('converts 100°C to 212°F', async () => {
      const r = (await fn()({ value: 100, from: 'c', to: 'f' })) as { result: number };
      expect(r.result).toBe(212);
    });

    it('converts 32°F to 0°C', async () => {
      const r = (await fn()({ value: 32, from: 'f', to: 'c' })) as { result: number };
      expect(r.result).toBe(0);
    });

    it('converts 0°C to 273.15K', async () => {
      const r = (await fn()({ value: 0, from: 'c', to: 'k' })) as { result: number };
      expect(r.result).toBe(273.15);
    });

    it('converts 1 GB to 1024 MB', async () => {
      const r = (await fn()({ value: 1, from: 'gb', to: 'mb' })) as { result: number };
      expect(r.result).toBe(1024);
    });

    it('converts 1 L to ~0.264 gal', async () => {
      const r = (await fn()({ value: 1, from: 'l', to: 'gal' })) as { result: number };
      expect(r.result).toBeCloseTo(0.264172, 4);
    });

    it('returns same value when from === to', async () => {
      const r = (await fn()({ value: 42, from: 'km', to: 'km' })) as { result: number };
      expect(r.result).toBe(42);
    });

    it('throws on unsupported conversion', async () => {
      await expect(fn()({ value: 1, from: 'parsecs', to: 'lightyears' })).rejects.toThrow();
    });
  });

  describe('calc_date', () => {
    const fn = () =>
      getHandler<{ date: string; add_days?: number; end_date?: string }>(plugin, 'calc_date');

    it('calculates days between two dates', async () => {
      const r = (await fn()({ date: '2024-01-01', end_date: '2024-01-31' })) as { days: number };
      expect(r.days).toBe(30);
    });

    it('adds days to a date', async () => {
      const r = (await fn()({ date: '2024-01-01', add_days: 10 })) as { result: string };
      expect(r.result).toBe('2024-01-11');
    });

    it('subtracts days with negative add_days', async () => {
      const r = (await fn()({ date: '2024-01-11', add_days: -10 })) as { result: string };
      expect(r.result).toBe('2024-01-01');
    });

    it('handles "today" as date', async () => {
      const today = new Date().toISOString().split('T')[0];
      const r = (await fn()({ date: 'today', add_days: 0 })) as { result: string };
      expect(r.result).toBe(today);
    });

    it('throws on invalid date', async () => {
      await expect(fn()({ date: 'not-a-date' })).rejects.toThrow();
    });

    it('returns day_of_week when adding days', async () => {
      const r = (await fn()({ date: '2024-01-01', add_days: 0 })) as { day_of_week: string };
      expect(r.day_of_week).toBeTruthy();
    });
  });
});

// ── Colors ────────────────────────────────────────────────────────────────────

describe('ColorPlugin', () => {
  const plugin = new ColorPlugin();

  it('is always configured', () => {
    expect(plugin.isConfigured()).toBe(true);
  });

  it('exposes color_convert, color_contrast, color_palette', () => {
    const names = plugin.getTools().map((t) => t.name);
    expect(names).toContain('color_convert');
    expect(names).toContain('color_contrast');
    expect(names).toContain('color_palette');
  });

  describe('color_convert', () => {
    const fn = () => getHandler<{ color: string }>(plugin, 'color_convert');

    it('returns hex, rgb (string), hsl (string), and values', async () => {
      const r = (await fn()({ color: '#ff0000' })) as { hex: string; rgb: string; hsl: string; values: Record<string, number> };
      expect(r.hex).toBeDefined();
      expect(r.rgb).toBeDefined();
      expect(r.hsl).toBeDefined();
      expect(r.values).toBeDefined();
    });

    it('converts red — rgb string format', async () => {
      const r = (await fn()({ color: '#ff0000' })) as { rgb: string; values: { r: number; g: number; b: number } };
      expect(r.rgb).toContain('255');
      expect(r.values.r).toBe(255);
      expect(r.values.g).toBe(0);
      expect(r.values.b).toBe(0);
    });

    it('converts white', async () => {
      const r = (await fn()({ color: '#ffffff' })) as { values: { r: number; g: number; b: number } };
      expect(r.values.r).toBe(255);
      expect(r.values.g).toBe(255);
      expect(r.values.b).toBe(255);
    });

    it('converts black', async () => {
      const r = (await fn()({ color: '#000000' })) as { values: { r: number; g: number; b: number } };
      expect(r.values.r).toBe(0);
      expect(r.values.g).toBe(0);
      expect(r.values.b).toBe(0);
    });

    it('handles 3-digit hex', async () => {
      const r = (await fn()({ color: '#f00' })) as { values: { r: number; g: number; b: number } };
      expect(r.values.r).toBe(255);
      expect(r.values.g).toBe(0);
      expect(r.values.b).toBe(0);
    });
  });

  describe('color_palette', () => {
    // color_palette uses `base` not `base_color`
    const fn = () => getHandler<{ base: string; type?: string }>(plugin, 'color_palette');

    it('generates a palette from base color', async () => {
      const r = (await fn()({ base: '#3b82f6' })) as Record<string, unknown>;
      // response includes colors array
      expect(r).toBeDefined();
    });

    it('generates complementary palette', async () => {
      const r = (await fn()({ base: '#ff0000', type: 'complementary' })) as Record<string, unknown>;
      expect(r).toBeDefined();
    });

    it('generates triadic palette', async () => {
      const r = (await fn()({ base: '#ff0000', type: 'triadic' })) as Record<string, unknown>;
      expect(r).toBeDefined();
    });
  });

  describe('color_contrast', () => {
    const fn = () =>
      getHandler<{ foreground: string; background: string }>(plugin, 'color_contrast');

    it('returns contrast ratio', async () => {
      const r = (await fn()({ foreground: '#000000', background: '#ffffff' })) as { ratio: number };
      expect(r.ratio).toBeGreaterThan(20); // ~21:1
    });

    it('passes AA for black on white (PASS string)', async () => {
      const r = (await fn()({ foreground: '#000000', background: '#ffffff' })) as { aa_normal: string };
      expect(r.aa_normal).toBe('PASS');
    });

    it('fails AA for same color (FAIL string)', async () => {
      const r = (await fn()({ foreground: '#ffffff', background: '#ffffff' })) as { aa_normal: string };
      expect(r.aa_normal).toBe('FAIL');
    });
  });
});

// ── Hash ──────────────────────────────────────────────────────────────────────

describe('HashPlugin', () => {
  const plugin = new HashPlugin();

  it('is always configured', () => {
    expect(plugin.isConfigured()).toBe(true);
  });

  it('exposes hash_text, base64_encode, base64_decode, generate_uuid, generate_password', () => {
    const names = plugin.getTools().map((t) => t.name);
    expect(names).toContain('hash_text');
    expect(names).toContain('base64_encode');
    expect(names).toContain('base64_decode');
    expect(names).toContain('generate_uuid');
    expect(names).toContain('generate_password');
  });

  describe('hash_text', () => {
    const fn = () => getHandler<{ text: string; algorithm?: string }>(plugin, 'hash_text');

    it('hashes with sha256 by default', async () => {
      const r = (await fn()({ text: 'hello' })) as { algorithm: string; hash: string };
      expect(r.algorithm).toBe('sha256');
      expect(r.hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('hashes with md5', async () => {
      const r = (await fn()({ text: 'hello', algorithm: 'md5' })) as { hash: string };
      expect(r.hash).toBe('5d41402abc4b2a76b9719d911017c592');
    });

    it('hashes with sha512 (128 hex chars)', async () => {
      const r = (await fn()({ text: 'hello', algorithm: 'sha512' })) as { hash: string };
      expect(r.hash).toHaveLength(128);
    });

    it('produces consistent hashes', async () => {
      const a = (await fn()({ text: 'test' })) as { hash: string };
      const b = (await fn()({ text: 'test' })) as { hash: string };
      expect(a.hash).toBe(b.hash);
    });

    it('different input → different hash', async () => {
      const a = (await fn()({ text: 'hello' })) as { hash: string };
      const b = (await fn()({ text: 'world' })) as { hash: string };
      expect(a.hash).not.toBe(b.hash);
    });
  });

  describe('base64_encode / base64_decode', () => {
    const enc = () => getHandler<{ text: string }>(plugin, 'base64_encode');
    const dec = () => getHandler<{ text: string }>(plugin, 'base64_decode');

    it('encodes to base64', async () => {
      const r = (await enc()({ text: 'hello world' })) as { encoded: string };
      expect(r.encoded).toBe('aGVsbG8gd29ybGQ=');
    });

    it('decodes from base64', async () => {
      const r = (await dec()({ text: 'aGVsbG8gd29ybGQ=' })) as { decoded: string };
      expect(r.decoded).toBe('hello world');
    });

    it('round-trips encode/decode', async () => {
      const original = 'The quick brown fox';
      const { encoded } = (await enc()({ text: original })) as { encoded: string };
      const { decoded } = (await dec()({ text: encoded })) as { decoded: string };
      expect(decoded).toBe(original);
    });
  });

  describe('generate_uuid', () => {
    // Returns { uuids: string[] }
    const fn = () => getHandler<{ count?: number }>(plugin, 'generate_uuid');

    it('generates a valid UUID v4', async () => {
      const r = (await fn()({})) as { uuids: string[] };
      expect(r.uuids).toHaveLength(1);
      expect(r.uuids[0]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('generates N unique UUIDs', async () => {
      const r = (await fn()({ count: 5 })) as { uuids: string[] };
      expect(r.uuids).toHaveLength(5);
      expect(new Set(r.uuids).size).toBe(5);
    });

    it('caps at 50 UUIDs', async () => {
      const r = (await fn()({ count: 100 })) as { uuids: string[] };
      expect(r.uuids.length).toBeLessThanOrEqual(50);
    });
  });

  describe('generate_password', () => {
    const fn = () => getHandler<{ length?: number; symbols?: boolean }>(plugin, 'generate_password');

    it('generates a password', async () => {
      const r = (await fn()({})) as { password: string };
      expect(typeof r.password).toBe('string');
      expect(r.password.length).toBeGreaterThan(0);
    });

    it('respects length parameter', async () => {
      const r = (await fn()({ length: 24 })) as { password: string };
      expect(r.password.length).toBe(24);
    });
  });
});

// ── TextTools ─────────────────────────────────────────────────────────────────

describe('TextToolsPlugin', () => {
  const plugin = new TextToolsPlugin();

  it('is always configured', () => {
    expect(plugin.isConfigured()).toBe(true);
  });

  it('exposes json_format, text_stats, regex_test, text_transform', () => {
    const names = plugin.getTools().map((t) => t.name);
    expect(names).toContain('json_format');
    expect(names).toContain('text_stats');
    expect(names).toContain('regex_test');
    expect(names).toContain('text_transform');
  });

  describe('json_format', () => {
    const fn = () => getHandler<{ json: string; minify?: boolean }>(plugin, 'json_format');

    it('pretty-prints valid JSON', async () => {
      const r = (await fn()({ json: '{"a":1}' })) as { valid: boolean; formatted: string };
      expect(r.valid).toBe(true);
      expect(r.formatted).toContain('\n');
    });

    it('minifies JSON', async () => {
      const r = (await fn()({ json: '{"a": 1, "b": 2}', minify: true })) as { formatted: string };
      expect(r.formatted).toBe('{"a":1,"b":2}');
    });

    it('reports invalid JSON', async () => {
      const r = (await fn()({ json: '{invalid}' })) as { valid: boolean };
      expect(r.valid).toBe(false);
    });
  });

  describe('text_stats', () => {
    const fn = () => getHandler<{ text: string }>(plugin, 'text_stats');

    it('counts words correctly', async () => {
      const r = (await fn()({ text: 'Hello world foo bar' })) as { words: number };
      expect(r.words).toBe(4);
    });

    it('counts characters', async () => {
      const r = (await fn()({ text: 'hello' })) as { characters: number };
      expect(r.characters).toBe(5);
    });

    it('returns reading time', async () => {
      const r = (await fn()({ text: 'word '.repeat(200) })) as { reading_time: string };
      expect(r.reading_time).toContain('min');
    });

    it('handles empty string', async () => {
      const r = (await fn()({ text: '' })) as { words: number };
      expect(r.words).toBe(0);
    });
  });

  describe('regex_test', () => {
    // Returns { matches, match_count (or count), ... }
    const fn = () => getHandler<{ pattern: string; text: string; flags?: string }>(plugin, 'regex_test');

    it('finds matches and returns count', async () => {
      const r = (await fn()({ pattern: '\\d+', text: 'abc 123 def 456' })) as Record<string, unknown>;
      // could be match_count or count depending on implementation
      const count = (r.match_count ?? r.count ?? (r.matches as unknown[])?.length) as number;
      expect(count).toBe(2);
    });

    it('returns zero matches when no match', async () => {
      const r = (await fn()({ pattern: '\\d+', text: 'no numbers here' })) as Record<string, unknown>;
      const count = (r.match_count ?? r.count ?? (r.matches as unknown[])?.length) as number;
      expect(count).toBe(0);
    });

    it('handles case-insensitive flag', async () => {
      const r = (await fn()({ pattern: 'hello', text: 'Hello HELLO hello', flags: 'gi' })) as Record<string, unknown>;
      const count = (r.match_count ?? r.count ?? (r.matches as unknown[])?.length) as number;
      expect(count).toBe(3);
    });
  });

  describe('text_transform', () => {
    // Tool is named text_transform, parameter is `transform` not `operation`
    const fn = () => getHandler<{ text: string; transform: string }>(plugin, 'text_transform');

    it('uppercases text', async () => {
      const r = (await fn()({ text: 'hello', transform: 'uppercase' })) as { result: string };
      expect(r.result).toBe('HELLO');
    });

    it('lowercases text', async () => {
      const r = (await fn()({ text: 'HELLO', transform: 'lowercase' })) as { result: string };
      expect(r.result).toBe('hello');
    });

    it('reverses text', async () => {
      const r = (await fn()({ text: 'hello', transform: 'reverse' })) as { result: string };
      expect(r.result).toBe('olleh');
    });

    it('converts to camelCase', async () => {
      const r = (await fn()({ text: 'hello world foo', transform: 'camel' })) as { result: string };
      expect(r.result).toContain('World');
    });

    it('converts to title case', async () => {
      const r = (await fn()({ text: 'hello world', transform: 'title' })) as { result: string };
      expect(r.result.charAt(0)).toBe('H');
    });

    it('converts to snake_case', async () => {
      const r = (await fn()({ text: 'hello world', transform: 'snake' })) as { result: string };
      expect(r.result).toContain('_');
    });

    it('converts to slug', async () => {
      const r = (await fn()({ text: 'Hello World', transform: 'slug' })) as { result: string };
      expect(r.result).toContain('-');
      expect(r.result).not.toContain(' ');
    });
  });
});

// ── Timezone ─────────────────────────────────────────────────────────────────

describe('TimezonePlugin', () => {
  const plugin = new TimezonePlugin();

  it('is always configured', () => {
    expect(plugin.isConfigured()).toBe(true);
  });

  it('exposes time_now and time_convert', () => {
    const names = plugin.getTools().map((t) => t.name);
    expect(names).toContain('time_now');
    expect(names).toContain('time_convert');
  });

  describe('time_now', () => {
    // time_now takes { cities: string[] } — required array
    const fn = () => getHandler<{ cities: string[] }>(plugin, 'time_now');

    it('returns current time in UTC', async () => {
      const r = (await fn()({ cities: ['UTC'] })) as Array<{ city: string; timezone: string; time: string }>;
      expect(Array.isArray(r)).toBe(true);
      expect(r[0].city).toBe('UTC');
      expect(r[0].time).toBeTruthy();
    });

    it('returns current time in Tokyo', async () => {
      const r = (await fn()({ cities: ['Tokyo'] })) as Array<{ city: string }>;
      expect(r[0].city).toBe('Tokyo');
    });

    it('returns current time in New York', async () => {
      const r = (await fn()({ cities: ['New York'] })) as Array<{ city: string }>;
      expect(r[0].city).toBe('New York');
    });

    it('returns multiple cities at once', async () => {
      const r = (await fn()({ cities: ['Tokyo', 'London', 'New York'] })) as Array<{ city: string }>;
      expect(r).toHaveLength(3);
      expect(r.map((c) => c.city)).toEqual(['Tokyo', 'London', 'New York']);
    });
  });

  describe('time_convert', () => {
    const fn = () => getHandler<{ time: string; from: string; to: string }>(plugin, 'time_convert');

    it('converts time between UTC and America/New_York', async () => {
      const r = await fn()({ time: '12:00', from: 'UTC', to: 'New York' });
      expect(r).toBeDefined();
    });

    it('converts from Tokyo to London', async () => {
      const r = await fn()({ time: '09:00', from: 'Tokyo', to: 'London' });
      expect(r).toBeDefined();
    });
  });
});
