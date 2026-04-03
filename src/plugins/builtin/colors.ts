import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';

export class ColorPlugin implements Plugin {
  name = 'colors';
  description = 'Color conversion (hex/rgb/hsl), palette generation, contrast checking';
  version = '1.0.0';

  async initialize(_conductor: Conductor): Promise<void> {}
  isConfigured(): boolean {
    return true;
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    hex = hex.replace('#', '');
    if (hex.length === 3)
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  private rgbToHex(r: number, g: number, b: number): string {
    return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
  }

  private rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  private luminance(r: number, g: number, b: number): number {
    const a = [r, g, b].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  }

  getTools(): PluginTool[] {
    return [
      {
        name: 'color_convert',
        description: 'Convert a color between hex, RGB, and HSL formats',
        inputSchema: {
          type: 'object',
          properties: {
            color: { type: 'string', description: 'Color value: "#ff5733", "rgb(255,87,51)", or "hsl(11,100%,60%)"' },
          },
          required: ['color'],
        },
        handler: async (input: { color: string }) => {
          let r: number, g: number, b: number;
          const c = input.color.trim();

          if (c.startsWith('#') || /^[0-9a-fA-F]{3,6}$/.test(c)) {
            ({ r, g, b } = this.hexToRgb(c));
          } else if (c.startsWith('rgb')) {
            const m = c.match(/(\d+)/g);
            if (!m || m.length < 3) throw new Error('Invalid RGB format');
            [r, g, b] = m.map(Number);
          } else {
            throw new Error('Provide hex (#ff5733) or rgb(255,87,51)');
          }

          const hsl = this.rgbToHsl(r, g, b);
          return {
            hex: this.rgbToHex(r, g, b),
            rgb: `rgb(${r}, ${g}, ${b})`,
            hsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
            values: { r, g, b, h: hsl.h, s: hsl.s, l: hsl.l },
          };
        },
      },
      {
        name: 'color_contrast',
        description: 'Check WCAG contrast ratio between two colors',
        inputSchema: {
          type: 'object',
          properties: {
            foreground: { type: 'string', description: 'Foreground color (hex)' },
            background: { type: 'string', description: 'Background color (hex)' },
          },
          required: ['foreground', 'background'],
        },
        handler: async (input: { foreground: string; background: string }) => {
          const fg = this.hexToRgb(input.foreground);
          const bg = this.hexToRgb(input.background);
          const l1 = this.luminance(fg.r, fg.g, fg.b);
          const l2 = this.luminance(bg.r, bg.g, bg.b);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          return {
            foreground: input.foreground,
            background: input.background,
            ratio: Number(ratio.toFixed(2)),
            aa_normal: ratio >= 4.5 ? 'PASS' : 'FAIL',
            aa_large: ratio >= 3 ? 'PASS' : 'FAIL',
            aaa_normal: ratio >= 7 ? 'PASS' : 'FAIL',
            aaa_large: ratio >= 4.5 ? 'PASS' : 'FAIL',
          };
        },
      },
      {
        name: 'color_palette',
        description: 'Generate a color palette (complementary, analogous, triadic, or random)',
        inputSchema: {
          type: 'object',
          properties: {
            base: { type: 'string', description: 'Base color in hex (e.g. "#ff5733")' },
            type: {
              type: 'string',
              description: 'Palette type: complementary, analogous, triadic, random',
              default: 'analogous',
            },
          },
          required: ['base'],
        },
        handler: async (input: { base: string; type?: string }) => {
          const { r, g, b } = this.hexToRgb(input.base);
          const hsl = this.rgbToHsl(r, g, b);
          const type = input.type || 'analogous';

          const hslToHex = (h: number, s: number, l: number): string => {
            h = ((h % 360) + 360) % 360;
            s /= 100;
            l /= 100;
            const c = (1 - Math.abs(2 * l - 1)) * s;
            const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
            const m = l - c / 2;
            let rr = 0,
              gg = 0,
              bb = 0;
            if (h < 60) {
              rr = c;
              gg = x;
            } else if (h < 120) {
              rr = x;
              gg = c;
            } else if (h < 180) {
              gg = c;
              bb = x;
            } else if (h < 240) {
              gg = x;
              bb = c;
            } else if (h < 300) {
              rr = x;
              bb = c;
            } else {
              rr = c;
              bb = x;
            }
            return this.rgbToHex(Math.round((rr + m) * 255), Math.round((gg + m) * 255), Math.round((bb + m) * 255));
          };

          let colors: string[];
          switch (type) {
            case 'complementary':
              colors = [input.base, hslToHex(hsl.h + 180, hsl.s, hsl.l)];
              break;
            case 'triadic':
              colors = [input.base, hslToHex(hsl.h + 120, hsl.s, hsl.l), hslToHex(hsl.h + 240, hsl.s, hsl.l)];
              break;
            case 'random':
              colors = Array.from(
                { length: 5 },
                () =>
                  '#' +
                  Math.floor(Math.random() * 16777215)
                    .toString(16)
                    .padStart(6, '0'),
              );
              break;
            default: // analogous
              colors = [
                hslToHex(hsl.h - 30, hsl.s, hsl.l),
                input.base,
                hslToHex(hsl.h + 30, hsl.s, hsl.l),
                hslToHex(hsl.h + 60, hsl.s, hsl.l),
              ];
          }

          return { base: input.base, type, palette: colors };
        },
      },
    ];
  }
}
