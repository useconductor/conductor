/**
 * Conductor Error Codes
 *
 * Every error in Conductor has a unique code, clear message, and actionable fix.
 * Pattern: COND-{CATEGORY}-{NUMBER}
 *
 * Categories:
 *   AUTH  - Authentication/authorization errors
 *   NET   - Network/connectivity errors
 *   SEC   - Security/validation errors
 *   CFG   - Configuration errors
 *   MCP   - MCP protocol errors
 *   PLG   - Plugin errors
 *   DB    - Database errors
 *   SYS   - System/infrastructure errors
 */

export interface ErrorDefinition {
  code: string;
  message: string;
  fix?: string;
  details?: Record<string, unknown>;
}

export class ConductorError extends Error {
  code: string;
  fix?: string;
  details?: Record<string, unknown>;

  constructor(error: { code: string; message: string; fix?: string; details?: Record<string, unknown> }) {
    super(error.message);
    this.name = 'ConductorError';
    this.code = error.code;
    this.fix = error.fix;
    this.details = error.details;
  }

  toJSON(): { code: string; message: string; fix?: string; details?: Record<string, unknown> } {
    return {
      code: this.code,
      message: this.message,
      fix: this.fix,
      details: this.details,
    };
  }
}

// ── Authentication Errors (AUTH-001 to AUTH-099) ─────────────────────────────

export const ERRORS = {
  // Auth
  AUTH_TOKEN_MISSING: {
    code: 'COND-AUTH-001',
    message: 'Authentication token not provided.',
    fix: 'Include Authorization: Bearer <token> header or add ?token=<token> to query params.',
  },
  AUTH_TOKEN_INVALID: {
    code: 'COND-AUTH-002',
    message: 'Invalid authentication token.',
    fix: 'Regenerate your token with: conductor auth generate',
  },
  AUTH_GITHUB_TOKEN_MISSING: {
    code: 'COND-AUTH-003',
    message: 'GitHub token not configured.',
    fix: 'Create a PAT at https://github.com/settings/tokens then run: conductor plugins config github token YOUR_TOKEN',
  },
  AUTH_SLACK_TOKEN_MISSING: {
    code: 'COND-AUTH-004',
    message: 'Slack bot token not configured.',
    fix: 'Create a Slack app at https://api.slack.com/apps then run: conductor plugins config slack bot_token xoxb-...',
  },
  AUTH_NOTION_TOKEN_MISSING: {
    code: 'COND-AUTH-005',
    message: 'Notion API key not configured.',
    fix: 'Create an integration at https://www.notion.so/my-integrations then run: conductor plugins config notion api_key YOUR_KEY',
  },
  AUTH_GOOGLE_OAUTH_MISSING: {
    code: 'COND-AUTH-006',
    message: 'Google OAuth not configured.',
    fix: 'Run: conductor auth google',
  },
  AUTH_SPOTIFY_TOKEN_MISSING: {
    code: 'COND-AUTH-007',
    message: 'Spotify credentials not configured.',
    fix: 'Create an app at https://developer.spotify.com/dashboard then run: conductor plugins config spotify client_id YOUR_ID',
  },
  AUTH_VERCEL_TOKEN_MISSING: {
    code: 'COND-AUTH-008',
    message: 'Vercel API token not configured.',
    fix: 'Create a token at https://vercel.com/account/tokens then run: conductor plugins config vercel token YOUR_TOKEN',
  },
  AUTH_N8N_CREDENTIALS_MISSING: {
    code: 'COND-AUTH-009',
    message: 'n8n credentials not configured.',
    fix: 'Run: conductor plugins config n8n api_key YOUR_KEY && conductor plugins config n8n base_url https://your-n8n.com',
  },
  AUTH_X_TOKEN_MISSING: {
    code: 'COND-AUTH-010',
    message: 'X (Twitter) API credentials not configured.',
    fix: 'Create an app at https://developer.x.com then run: conductor plugins config x api_key YOUR_KEY',
  },
  AUTH_HOMEKIT_CREDENTIALS_MISSING: {
    code: 'COND-AUTH-011',
    message: 'Homebridge credentials not configured.',
    fix: 'Run: conductor plugins config homekit base_url http://homebridge.local:8581',
  },
  AUTH_TODOIST_TOKEN_MISSING: {
    code: 'COND-AUTH-012',
    message: 'Todoist API token not configured.',
    fix: 'Get your token from https://app.todoist.com/app/settings/integrations/developer then run: conductor plugins config todoist api_token YOUR_TOKEN',
  },
  AUTH_DATABASE_URL_MISSING: {
    code: 'COND-AUTH-013',
    message: 'Database connection URL not configured.',
    fix: 'Run: conductor plugins config database postgres_url postgresql://user:pass@host:5432/db',
  },

  // Network
  NET_CONNECTION_REFUSED: {
    code: 'COND-NET-001',
    message: 'Connection refused. The target service may be down or unreachable.',
    fix: 'Check that the service is running and accessible from this machine.',
  },
  NET_TIMEOUT: {
    code: 'COND-NET-002',
    message: 'Request timed out after {timeout}ms.',
    fix: 'Check your network connection and try again. Increase timeout if needed.',
  },
  NET_DNS_FAILURE: {
    code: 'COND-NET-003',
    message: 'DNS resolution failed for {hostname}.',
    fix: 'Check the hostname and your DNS settings.',
  },
  NET_RATE_LIMITED: {
    code: 'COND-NET-004',
    message: 'Rate limited by {service}. Too many requests.',
    fix: 'Wait {retryAfter} seconds before trying again.',
  },

  // Security
  SEC_COMMAND_BLOCKED: {
    code: 'COND-SEC-001',
    message: 'Command "{command}" is not in the safe command whitelist.',
    fix: `Allowed commands: ls, cat, head, tail, wc, grep, find, stat, file, pwd, whoami, date, uptime, df, du, free, top, git, node, npm, pnpm, yarn, python, python3, pip, pip3, make, cmake, cargo, go, rustc, gcc, clang, curl, wget, ssh, scp, rsync, docker, docker-compose, kubectl, helm, terraform, ansible, vault, psql, mysql, mongosh, redis-cli, jq, yq, sed, awk, cut, sort, uniq, tr, xargs, zip, unzip, tar, gzip, chmod, chown, mkdir, rmdir, cp, mv, rm, touch, ln, diff, patch, md5sum, sha256sum, sha1sum`,
  },
  SEC_PATH_TRAVERSAL: {
    code: 'COND-SEC-002',
    message: 'Path traversal detected: {path}. Paths must be within the current working directory.',
    fix: 'Use a path within the current directory or specify an absolute path that does not traverse outside the workspace.',
  },
  SEC_DANGEROUS_PATTERN: {
    code: 'COND-SEC-003',
    message: 'Command matches a dangerous pattern and has been blocked.',
    fix: 'This command is not allowed for security reasons. Contact an administrator if you believe this is a false positive.',
  },
  SEC_INVALID_INPUT: {
    code: 'COND-SEC-004',
    message: 'Invalid input for tool "{tool}": {errors}',
    fix: 'Check the tool documentation for the correct input schema.',
  },

  // Configuration
  CFG_KEY_NOT_FOUND: {
    code: 'COND-CFG-001',
    message: 'Configuration key "{key}" not found.',
    fix: 'Check available keys with: conductor config list',
  },
  CFG_INVALID_VALUE: {
    code: 'COND-CFG-002',
    message: 'Invalid value for configuration key "{key}".',
    fix: 'Check the expected format with: conductor config describe {key}',
  },
  CFG_CORRUPTED: {
    code: 'COND-CFG-003',
    message: 'Configuration file is corrupted or invalid JSON.',
    fix: 'Restore from backup or run: conductor init to create a new config.',
  },

  // MCP
  MCP_TOOL_NOT_FOUND: {
    code: 'COND-MCP-001',
    message: 'Tool "{tool}" not found.',
    fix: 'Run conductor_tools_list to see available tools. Enable the plugin with: conductor plugins enable {plugin}',
  },
  MCP_CIRCUIT_OPEN: {
    code: 'COND-MCP-002',
    message: 'Service unavailable: tool "{tool}" is temporarily disabled due to repeated failures.',
    fix: 'Wait {retryAfter} seconds and try again. Check the health status with: conductor health',
  },
  MCP_SERVER_ERROR: {
    code: 'COND-MCP-003',
    message: 'MCP server error: {error}',
    fix: 'Check the server logs and try again. Restart with: conductor mcp restart',
  },

  // Plugin
  PLG_NOT_FOUND: {
    code: 'COND-PLG-001',
    message: 'Plugin "{plugin}" not found.',
    fix: 'Run: conductor plugins list to see available plugins.',
  },
  PLG_NOT_CONFIGURED: {
    code: 'COND-PLG-002',
    message: 'Plugin "{plugin}" is not configured.',
    fix: 'Run: conductor plugins configure {plugin}',
  },
  PLG_INITIALIZATION_FAILED: {
    code: 'COND-PLG-003',
    message: 'Failed to initialize plugin "{plugin}": {error}',
    fix: 'Check the plugin documentation and ensure all required dependencies are installed.',
  },
  PLG_TOOL_FAILED: {
    code: 'COND-PLG-004',
    message: 'Tool "{tool}" in plugin "{plugin}" failed: {error}',
    fix: 'Check the tool documentation and try again.',
  },

  // Database
  DB_CONNECTION_FAILED: {
    code: 'COND-DB-001',
    message: 'Failed to connect to database: {error}',
    fix: 'Check the connection URL and ensure the database is running.',
  },
  DB_QUERY_FAILED: {
    code: 'COND-DB-002',
    message: 'Database query failed: {error}',
    fix: 'Check the query syntax and try again.',
  },
  DB_MIGRATION_FAILED: {
    code: 'COND-DB-003',
    message: 'Database migration failed: {error}',
    fix: 'Check the migration files and try again.',
  },

  // System
  SYS_DISK_FULL: {
    code: 'COND-SYS-001',
    message: 'Disk space is critically low ({percent}% used).',
    fix: 'Free up disk space or expand the volume.',
  },
  SYS_MEMORY_LOW: {
    code: 'COND-SYS-002',
    message: 'Memory usage is critically high ({percent}% used).',
    fix: 'Free up memory or add more RAM.',
  },
  SYS_SERVICE_DOWN: {
    code: 'COND-SYS-003',
    message: 'Service "{service}" is not running.',
    fix: 'Start the service with: systemctl start {service} or docker start {service}',
  },
};

// ── Error Factory ─────────────────────────────────────────────────────────────

/**
 * Create a ConductorError with interpolated values.
 */
export function createError(errorDef: ConductorError, variables?: Record<string, string | number>): ConductorError {
  let message = errorDef.message;
  let fix = errorDef.fix;

  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      message = message.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
      if (fix) fix = fix.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
    }
  }

  return new ConductorError({
    code: errorDef.code,
    message,
    fix,
    details: errorDef.details,
  });
}
