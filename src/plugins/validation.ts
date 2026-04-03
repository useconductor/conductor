/**
 * Zod validation wrapper for plugin tool handlers.
 *
 * Every tool handler input is validated against its inputSchema before execution.
 * Invalid inputs are rejected with clear error messages — no silent failures,
 * no `any` types slipping through.
 */

import { z } from 'zod';
import type { PluginTool } from './manager.js';

/**
 * Convert an MCP-style JSON Schema inputSchema to a Zod schema.
 * This validates tool inputs at runtime before they reach the handler.
 */
function schemaFromInputSchema(schema: Record<string, unknown>): z.ZodType {
  if (schema.type !== 'object') {
    return z.unknown();
  }

  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set<string>((schema.required as string[]) ?? []);
  const shape: Record<string, z.ZodType> = {};

  for (const [key, propSchema] of Object.entries(properties)) {
    let fieldSchema: z.ZodType;

    switch (propSchema.type) {
      case 'string':
        fieldSchema = z.string();
        if (propSchema.enum) {
          fieldSchema = z.enum(propSchema.enum as [string, ...string[]]);
        }
        break;
      case 'number':
      case 'integer':
        fieldSchema = z.number();
        break;
      case 'boolean':
        fieldSchema = z.boolean();
        break;
      case 'array':
        fieldSchema = z.array(
          (propSchema.items as { type?: string })?.type === 'string'
            ? z.string()
            : (propSchema.items as { type?: string })?.type === 'number'
              ? z.number()
              : z.unknown(),
        );
        break;
      case 'object':
        fieldSchema = z.record(z.string(), z.unknown());
        break;
      default:
        fieldSchema = z.unknown();
    }

    if (propSchema.description) {
      fieldSchema = fieldSchema.describe(propSchema.description as string);
    }

    shape[key] = required.has(key) ? fieldSchema : fieldSchema.optional();
  }

  return z.object(shape);
}

/**
 * Wrap a plugin tool with Zod validation.
 * Returns a new tool whose handler validates input before execution.
 */
export function withValidation(tool: PluginTool): PluginTool {
  const validator = schemaFromInputSchema(tool.inputSchema);

  return {
    ...tool,
    handler: async (input: unknown) => {
      const result = validator.safeParse(input);
      if (!result.success) {
        const errors = result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
        throw new Error(`Invalid input for tool "${tool.name}": ${errors}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return tool.handler(result.data as any);
    },
  };
}

/**
 * Wrap an array of plugin tools with Zod validation.
 */
export function validateTools(tools: PluginTool[]): PluginTool[] {
  return tools.map(withValidation);
}
