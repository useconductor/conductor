# packages/plugin-sdk/src

Source code for the Conductor Plugin SDK.

## Contents

- `index.ts` - SDK entry point, re-exports all public types and utilities

## Architecture

This is the implementation of the Plugin SDK. The single entry point re-exports the `Plugin` interface, `PluginTool`, `PluginConfigSchema`, and validation helpers from the main codebase. This allows plugin developers to import everything from `@conductor/plugin-sdk` without depending on the full Conductor package.
