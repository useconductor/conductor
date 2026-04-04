# src/dashboard

Web dashboard for Conductor — an Express server serving a single-page application.

## Contents

- `server.ts` - Express server with metrics, audit, health, and webhook endpoints
- `index.html` - Single-page application UI
- `cli.ts` - Dashboard-specific CLI commands

## Architecture

The dashboard provides a web UI for monitoring Conductor. It consumes metrics, audit logs, health status, and webhook data from the MCP server's shared state. The Express server uses `express-rate-limit` for protection. The `postbuild` script copies `index.html` to `dist/dashboard/index.html`.

Transport: HTTP/SSE for real-time updates from the MCP server.
