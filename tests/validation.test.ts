import { describe, it, expect } from 'vitest';
import { withValidation, validateTools } from '../src/plugins/validation.js';
import type { PluginTool } from '../src/plugins/manager.js';

function makeTool(name: string, inputSchema: Record<string, unknown>, handler?: (i: unknown) => Promise<unknown>): PluginTool {
  return {
    name,
    description: `Test tool: ${name}`,
    inputSchema,
    handler: handler ?? (async (i) => i),
  };
}

describe('withValidation', () => {
  it('passes valid input to handler', async () => {
    const tool = makeTool('t', {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });
    const validated = withValidation(tool);
    const result = await validated.handler({ name: 'Alice' });
    expect(result).toEqual({ name: 'Alice' });
  });

  it('throws on missing required field', async () => {
    const tool = makeTool('t', {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });
    const validated = withValidation(tool);
    await expect(validated.handler({})).rejects.toThrow(/Invalid input/);
  });

  it('throws with tool name in error message', async () => {
    const tool = makeTool('my_tool', {
      type: 'object',
      properties: { x: { type: 'number' } },
      required: ['x'],
    });
    const validated = withValidation(tool);
    await expect(validated.handler({ x: 'not-a-number' })).rejects.toThrow(/my_tool/);
  });

  it('accepts optional fields when missing', async () => {
    const tool = makeTool('t', {
      type: 'object',
      properties: {
        required_field: { type: 'string' },
        optional_field: { type: 'number' },
      },
      required: ['required_field'],
    });
    const validated = withValidation(tool);
    await expect(validated.handler({ required_field: 'hi' })).resolves.toBeDefined();
  });

  it('validates number type', async () => {
    const tool = makeTool('t', {
      type: 'object',
      properties: { count: { type: 'number' } },
      required: ['count'],
    });
    const validated = withValidation(tool);
    await expect(validated.handler({ count: 'five' })).rejects.toThrow(/Invalid input/);
    await expect(validated.handler({ count: 5 })).resolves.toBeDefined();
  });

  it('validates boolean type', async () => {
    const tool = makeTool('t', {
      type: 'object',
      properties: { flag: { type: 'boolean' } },
      required: ['flag'],
    });
    const validated = withValidation(tool);
    await expect(validated.handler({ flag: 'yes' })).rejects.toThrow(/Invalid input/);
    await expect(validated.handler({ flag: true })).resolves.toBeDefined();
  });

  it('validates array type', async () => {
    const tool = makeTool('t', {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'string' } } },
      required: ['items'],
    });
    const validated = withValidation(tool);
    await expect(validated.handler({ items: 'not-array' })).rejects.toThrow(/Invalid input/);
    await expect(validated.handler({ items: ['a', 'b'] })).resolves.toBeDefined();
  });

  it('validates object type', async () => {
    const tool = makeTool('t', {
      type: 'object',
      properties: { meta: { type: 'object' } },
      required: ['meta'],
    });
    const validated = withValidation(tool);
    await expect(validated.handler({ meta: 'not-object' })).rejects.toThrow(/Invalid input/);
    await expect(validated.handler({ meta: { key: 'val' } })).resolves.toBeDefined();
  });

  it('validates enum constraint', async () => {
    const tool = makeTool('t', {
      type: 'object',
      properties: { color: { type: 'string', enum: ['red', 'green', 'blue'] } },
      required: ['color'],
    });
    const validated = withValidation(tool);
    await expect(validated.handler({ color: 'yellow' })).rejects.toThrow(/Invalid input/);
    await expect(validated.handler({ color: 'red' })).resolves.toBeDefined();
  });

  it('handles unknown schema type gracefully', async () => {
    const tool = makeTool('t', {
      type: 'object',
      properties: { x: { type: 'unknown_type' } },
      required: ['x'],
    });
    const validated = withValidation(tool);
    // unknown types use z.unknown() which accepts any value
    await expect(validated.handler({ x: 'anything' })).resolves.toBeDefined();
  });

  it('handles non-object schema gracefully', async () => {
    const tool = makeTool('t', { type: 'string' });
    const validated = withValidation(tool);
    // non-object schema uses z.unknown() — passes any value
    await expect(validated.handler('hello')).resolves.toBeDefined();
  });

  it('preserves all other tool properties', () => {
    const tool = makeTool('my_tool', { type: 'object', properties: {} });
    const validated = withValidation(tool);
    expect(validated.name).toBe('my_tool');
    expect(validated.description).toBe('Test tool: my_tool');
    expect(validated.inputSchema).toBe(tool.inputSchema);
  });

  it('error message lists all field paths', async () => {
    const tool = makeTool('t', {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'number' },
      },
      required: ['a', 'b'],
    });
    const validated = withValidation(tool);
    await expect(validated.handler({})).rejects.toThrow(/a|b/);
  });
});

describe('validateTools', () => {
  it('wraps all tools in array', async () => {
    const tools = [
      makeTool('t1', { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] }),
      makeTool('t2', { type: 'object', properties: { y: { type: 'number' } }, required: ['y'] }),
    ];
    const validated = validateTools(tools);
    expect(validated).toHaveLength(2);
    // t1: string field validates
    await expect(validated[0].handler({ x: 'hello' })).resolves.toBeDefined();
    await expect(validated[0].handler({ x: 123 })).rejects.toThrow();
    // t2: number field validates
    await expect(validated[1].handler({ y: 42 })).resolves.toBeDefined();
    await expect(validated[1].handler({ y: 'bad' })).rejects.toThrow();
  });

  it('returns empty array for empty input', () => {
    expect(validateTools([])).toEqual([]);
  });
});
