# src/utils

Shared utility functions used across the Conductor codebase.

## Contents

- `google-auth.ts` - Google OAuth authentication helpers
- `retry.ts` - Generic retry logic utilities

## Architecture

These are cross-cutting utilities consumed by multiple modules. `google-auth.ts` is used by Google Workspace plugins (GCal, GDrive, Gmail). `retry.ts` provides reusable retry logic complementary to the core retry module.
