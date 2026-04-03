import { describe, it, expect } from 'vitest';

describe('CalculatorPlugin', () => {
  it('evaluates simple math expressions', async () => {
    const { CalculatorPlugin } = await import('../src/plugins/builtin/calculator.js');
    const plugin = new CalculatorPlugin();
    const tools = plugin.getTools();
    const mathTool = tools.find((t) => t.name === 'calc_math');

    expect(mathTool).toBeDefined();
    const result = await mathTool!.handler({ expression: '2 + 2' });
    expect(result).toEqual({ expression: '2 + 2', result: 4 });
  });

  it('evaluates complex math expressions', async () => {
    const { CalculatorPlugin } = await import('../src/plugins/builtin/calculator.js');
    const plugin = new CalculatorPlugin();
    const tools = plugin.getTools();
    const mathTool = tools.find((t) => t.name === 'calc_math');

    const result = await mathTool!.handler({ expression: 'sqrt(144) + pow(2, 3)' });
    expect(result).toEqual({ expression: 'sqrt(144) + pow(2, 3)', result: 20 });
  });

  it('rejects invalid expressions', async () => {
    const { CalculatorPlugin } = await import('../src/plugins/builtin/calculator.js');
    const plugin = new CalculatorPlugin();
    const tools = plugin.getTools();
    const mathTool = tools.find((t) => t.name === 'calc_math');

    await expect(mathTool!.handler({ expression: 'process.exit(0)' })).rejects.toThrow();
  });

  it('converts units correctly', async () => {
    const { CalculatorPlugin } = await import('../src/plugins/builtin/calculator.js');
    const plugin = new CalculatorPlugin();
    const tools = plugin.getTools();
    const convertTool = tools.find((t) => t.name === 'calc_convert');

    const result = await convertTool!.handler({ value: 1, from: 'km', to: 'mi' });
    expect(result).toHaveProperty('result');
    expect(Math.abs((result as any).result - 0.621371)).toBeLessThan(0.0001);
  });

  it('calculates date differences', async () => {
    const { CalculatorPlugin } = await import('../src/plugins/builtin/calculator.js');
    const plugin = new CalculatorPlugin();
    const tools = plugin.getTools();
    const dateTool = tools.find((t) => t.name === 'calc_date');

    const result = await dateTool!.handler({ date: '2024-01-01', end_date: '2024-01-31' });
    expect(result).toHaveProperty('days', 30);
  });
});
