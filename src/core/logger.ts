/**
 * Structured logging with Pino.
 *
 * All logs go to stderr (stdout is reserved for MCP protocol).
 * In production, logs are JSON-structured for ingestion by log aggregators.
 * In development, logs are pretty-printed for readability.
 */

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

/**
 * Create a child logger with a specific context.
 * Use this for module-specific logging.
 */
export function childLogger(context: string) {
  return logger.child({ context });
}
