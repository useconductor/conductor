# src/mcp/tools

MCP tool definitions and handlers that bridge the protocol layer to plugin implementations.

## Contents

- `misc.ts` - Miscellaneous tools not tied to a specific plugin

## Architecture

This directory contains tool definitions that are registered with the MCP server. Most tools are provided by plugins in `src/plugins/`, but cross-cutting or standalone tools live here. Each tool is wrapped with circuit breaker, retry, audit logging, and Zod validation by the MCP server.
