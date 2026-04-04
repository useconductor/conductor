# src/mcp

Model Context Protocol server implementation. Exposes plugin tools to AI agents via stdio or HTTP/SSE transport.

## Contents

- `server.ts` - MCP server with circuit breaker, retry, audit logging, metrics, and Zod validation
- `tools/` - Tool definitions and handlers

## Architecture

The MCP server wraps every plugin tool with:

1. **Circuit breaker** — opens after repeated failures
2. **Retry with exponential backoff**
3. **Audit logging** — tamper-evident SHA-256 chained log
4. **Metrics** — in-memory call counts and latency per tool
5. **Zod validation** — validates inputs before handler invocation

Transport: `StdioServerTransport` for AI agent integration; HTTP/SSE for the dashboard.
