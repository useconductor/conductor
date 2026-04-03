/**
 * @conductor/plugin-sdk
 *
 * The official SDK for building Conductor plugins.
 * Provides type-safe plugin creation, input validation, testing utilities,
 * and a development server with hot-reload.
 *
 * Usage:
 *   import { createPlugin, z } from '@conductor/plugin-sdk';
 *
 *   export default createPlugin({
 *     name: 'my-plugin',
 *     description: 'My awesome plugin',
 *     tools: [
 *       {
 *         name: 'hello',
 *         description: 'Say hello',
 *         input: z.object({ name: z.string() }),
 *         handler: async ({ name }) => `Hello, ${name}!`,
 *       },
 *     ],
 *   });
 */

import { z } from 'zod';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PluginToolDefinition<TInput = Record<string, unknown>> {
  name: string;
  description: string;
  /** Zod schema for input validation */
  input: z.ZodType<TInput>;
  /** Tool handler — receives validated input */
  handler: (input: TInput) => Promise<unknown>;
  /** Whether this tool requires user approval before execution */
  requiresApproval?: boolean;
}

export interface PluginDefinition {
  name: string;
  description: string;
  version?: string;
  tools: PluginToolDefinition[];
  /** Called when the plugin is loaded */
  onInitialize?: () => Promise<void>;
  /** Called when the plugin is unloaded */
  onDestroy?: () => Promise<void>;
  /** Whether the plugin is configured and ready */
  isConfigured?: () => boolean;
  /** Configuration schema for the plugin */
  config?: Record<string, {
    label: string;
    type: 'string' | 'password' | 'number' | 'boolean';
    required: boolean;
    description?: string;
  }>;
}

// ── Plugin Factory ───────────────────────────────────────────────────────────

/**
 * Create a plugin with type-safe tool definitions.
 */
export function createPlugin(definition: PluginDefinition): PluginDefinition {
  return {
    version: '1.0.0',
    ...definition,
  };
}

// ── Tool Helpers ─────────────────────────────────────────────────────────────

/**
 * Create a tool definition with Zod-validated input.
 */
export function createTool<TInput>(tool: PluginToolDefinition<TInput>): PluginToolDefinition<TInput> {
  return tool;
}

// ── Testing Utilities ────────────────────────────────────────────────────────

export interface TestResult {
  tool: string;
  input: unknown;
  output: unknown;
  success: boolean;
  error?: string;
  latencyMs: number;
}

/**
 * Test a plugin's tools with mocked inputs.
 */
export async function testPlugin(
  plugin: PluginDefinition,
  tests: Array<{ tool: string; input: Record<string, unknown>; expectedError?: string }>,
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const test of tests) {
    const toolDef = plugin.tools.find((t) => t.name === test.tool);
    if (!toolDef) {
      results.push({
        tool: test.tool,
        input: test.input,
        output: null,
        success: false,
        error: `Tool "${test.tool}" not found in plugin "${plugin.name}"`,
        latencyMs: 0,
      });
      continue;
    }

    const start = Date.now();
    try {
      // Validate input
      const validated = toolDef.input.parse(test.input);
      const output = await toolDef.handler(validated);
      results.push({
        tool: test.tool,
        input: test.input,
        output,
        success: true,
        latencyMs: Date.now() - start,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (test.expectedError && message.includes(test.expectedError)) {
        results.push({
          tool: test.tool,
          input: test.input,
          output: null,
          success: true, // Expected error = test passed
          latencyMs: Date.now() - start,
        });
      } else {
        results.push({
          tool: test.tool,
          input: test.input,
          output: null,
          success: false,
          error: message,
          latencyMs: Date.now() - start,
        });
      }
    }
  }

  return results;
}

/**
 * Generate an MCP-compatible inputSchema from a Zod schema.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // Simplified Zod → JSON Schema conversion
  if (schema instanceof z.ZodObject) {
    const shape = (schema as z.ZodObject<Record<string, z.ZodType>>).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, field] of Object.entries(shape)) {
      if (!(field instanceof z.ZodOptional)) {
        required.push(key);
      }
      properties[key] = zodFieldSchema(field);
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  return { type: 'object', properties: {} };
}

function zodFieldSchema(field: z.ZodType): Record<string, unknown> {
  if (field instanceof z.ZodString) return { type: 'string' };
  if (field instanceof z.ZodNumber) return { type: 'number' };
  if (field instanceof z.ZodBoolean) return { type: 'boolean' };
  if (field instanceof z.ZodArray) return { type: 'array', items: { type: 'string' } };
  if (field instanceof z.ZodOptional) return zodFieldSchema(field.unwrap());
  if (field instanceof z.ZodEnum) return { type: 'string', enum: field._def.values };
  return { type: 'string' };
}

// Re-export Zod for convenience
export { z };
