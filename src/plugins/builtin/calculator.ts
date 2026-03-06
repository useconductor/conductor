import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';

export class CalculatorPlugin implements Plugin {
  name = 'calculator';
  description = 'Math expressions, unit conversions, date calculations';
  version = '1.0.0';

  async initialize(_conductor: Conductor): Promise<void> {}
  isConfigured(): boolean { return true; }

  getTools(): PluginTool[] {
    return [
      {
        name: 'calc_math',
        description: 'Evaluate a math expression. Supports +, -, *, /, **, %, sqrt(), abs(), sin(), cos(), tan(), log(), ceil(), floor(), round(), PI, E',
        inputSchema: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'Math expression, e.g. "sqrt(144) + 2 ** 3"' },
          },
          required: ['expression'],
        },
        handler: async (input: { expression: string }) => {
          // Sanitize: only allow math-safe characters
          const sanitized = input.expression
            .replace(/\bsqrt\b/g, 'Math.sqrt')
            .replace(/\babs\b/g, 'Math.abs')
            .replace(/\bsin\b/g, 'Math.sin')
            .replace(/\bcos\b/g, 'Math.cos')
            .replace(/\btan\b/g, 'Math.tan')
            .replace(/\blog\b/g, 'Math.log')
            .replace(/\bceil\b/g, 'Math.ceil')
            .replace(/\bfloor\b/g, 'Math.floor')
            .replace(/\bround\b/g, 'Math.round')
            .replace(/\bPI\b/g, 'Math.PI')
            .replace(/\bE\b/g, 'Math.E');

          // Validate: only allow digits, operators, parens, dots, Math.*
          if (!/^[0-9+\-*/().%\s,Math.sqrtabincostelgflorundPIE]+$/.test(sanitized)) {
            throw new Error('Invalid expression: only math operators and functions are allowed');
          }

          // Use Function constructor instead of eval for slightly better isolation
          const fn = new Function(`"use strict"; return (${sanitized})`);
          const result = fn();
          if (typeof result !== 'number' || !isFinite(result)) {
            throw new Error(`Result is not a finite number: ${result}`);
          }
          return { expression: input.expression, result };
        },
      },
      {
        name: 'calc_convert',
        description: 'Convert between units. Supports: km/mi/m/ft/in/cm, kg/lb/oz/g, °C/°F/K, L/gal/ml, GB/MB/KB/TB',
        inputSchema: {
          type: 'object',
          properties: {
            value: { type: 'number', description: 'Value to convert' },
            from: { type: 'string', description: 'Source unit' },
            to: { type: 'string', description: 'Target unit' },
          },
          required: ['value', 'from', 'to'],
        },
        handler: async (input: { value: number; from: string; to: string }) => {
          const f = input.from.toLowerCase().trim();
          const t = input.to.toLowerCase().trim();
          const v = input.value;

          // Convert everything to a base unit first, then to target
          type ConversionTable = Record<string, Record<string, (n: number) => number>>;
          const conversions: ConversionTable = {
            // Length → meters
            km: { m: n => n * 1000, mi: n => n * 0.621371, ft: n => n * 3280.84, cm: n => n * 100000, 'in': n => n * 39370.1 },
            mi: { km: n => n * 1.60934, m: n => n * 1609.34, ft: n => n * 5280, cm: n => n * 160934, 'in': n => n * 63360 },
            m: { km: n => n / 1000, mi: n => n / 1609.34, ft: n => n * 3.28084, cm: n => n * 100, 'in': n => n * 39.3701 },
            ft: { m: n => n * 0.3048, km: n => n * 0.0003048, mi: n => n / 5280, cm: n => n * 30.48, 'in': n => n * 12 },
            cm: { m: n => n / 100, km: n => n / 100000, ft: n => n / 30.48, 'in': n => n / 2.54, mi: n => n / 160934 },
            'in': { cm: n => n * 2.54, ft: n => n / 12, m: n => n * 0.0254, km: n => n * 0.0000254, mi: n => n / 63360 },
            // Weight → grams
            kg: { lb: n => n * 2.20462, oz: n => n * 35.274, g: n => n * 1000 },
            lb: { kg: n => n * 0.453592, oz: n => n * 16, g: n => n * 453.592 },
            oz: { kg: n => n * 0.0283495, lb: n => n / 16, g: n => n * 28.3495 },
            g: { kg: n => n / 1000, lb: n => n / 453.592, oz: n => n / 28.3495 },
            // Temperature
            c: { f: n => (n * 9/5) + 32, k: n => n + 273.15 },
            f: { c: n => (n - 32) * 5/9, k: n => (n - 32) * 5/9 + 273.15 },
            k: { c: n => n - 273.15, f: n => (n - 273.15) * 9/5 + 32 },
            '°c': { '°f': n => (n * 9/5) + 32, k: n => n + 273.15 },
            '°f': { '°c': n => (n - 32) * 5/9, k: n => (n - 32) * 5/9 + 273.15 },
            // Volume
            l: { gal: n => n * 0.264172, ml: n => n * 1000 },
            gal: { l: n => n * 3.78541, ml: n => n * 3785.41 },
            ml: { l: n => n / 1000, gal: n => n / 3785.41 },
            // Digital
            tb: { gb: n => n * 1024, mb: n => n * 1048576, kb: n => n * 1073741824 },
            gb: { tb: n => n / 1024, mb: n => n * 1024, kb: n => n * 1048576 },
            mb: { gb: n => n / 1024, tb: n => n / 1048576, kb: n => n * 1024 },
            kb: { mb: n => n / 1024, gb: n => n / 1048576, tb: n => n / 1073741824 },
          };

          if (f === t) return { value: v, from: f, to: t, result: v };

          const conv = conversions[f]?.[t];
          if (!conv) throw new Error(`Cannot convert from "${input.from}" to "${input.to}". Supported: km/mi/m/ft/in/cm, kg/lb/oz/g, C/F/K, L/gal/ml, GB/MB/KB/TB`);

          return { value: v, from: input.from, to: input.to, result: Number(conv(v).toFixed(6)) };
        },
      },
      {
        name: 'calc_date',
        description: 'Calculate days between dates, or add/subtract days from a date',
        inputSchema: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Start date (YYYY-MM-DD) or "today"' },
            add_days: { type: 'number', description: 'Days to add (negative to subtract)' },
            end_date: { type: 'string', description: 'End date for difference calculation' },
          },
          required: ['date'],
        },
        handler: async (input: { date: string; add_days?: number; end_date?: string }) => {
          const start = input.date === 'today' ? new Date() : new Date(input.date);
          if (isNaN(start.getTime())) throw new Error(`Invalid date: ${input.date}`);

          if (input.end_date) {
            const end = input.end_date === 'today' ? new Date() : new Date(input.end_date);
            if (isNaN(end.getTime())) throw new Error(`Invalid end date: ${input.end_date}`);
            const diff = Math.round((end.getTime() - start.getTime()) / 86400000);
            return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0], days: diff };
          }

          if (input.add_days !== undefined) {
            const result = new Date(start);
            result.setDate(result.getDate() + input.add_days);
            return {
              start: start.toISOString().split('T')[0],
              added: input.add_days,
              result: result.toISOString().split('T')[0],
              day_of_week: result.toLocaleDateString('en-US', { weekday: 'long' }),
            };
          }

          return {
            date: start.toISOString().split('T')[0],
            day_of_week: start.toLocaleDateString('en-US', { weekday: 'long' }),
            unix_timestamp: Math.floor(start.getTime() / 1000),
            iso: start.toISOString(),
          };
        },
      },
    ];
  }
}
