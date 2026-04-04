# packages/plugin-sdk

TypeScript SDK for building Conductor plugins. Provides types, utilities, and helpers for plugin development.

## Contents

- `package.json` - Package manifest and dependencies
- `src/` - SDK source code

## Architecture

The Plugin SDK is published to npm and consumed by plugin developers. It re-exports the core `Plugin` interface, tool types, config schema types, and validation utilities. Use this SDK when building external plugins to ensure type safety and API compatibility with the Conductor plugin system.
