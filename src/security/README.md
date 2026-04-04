# src/security

Security layer for Conductor — authentication, keychain management, and credential encryption.

## Contents

- `keychain.ts` - OS keychain integration for secret storage
- `auth.ts` - Authentication and authorization utilities

## Architecture

Secret credentials are AES-256-GCM encrypted with a machine-bound key. The keychain stores secrets in the OS keychain rather than `config.json`. All HTTP endpoints are protected by `express-rate-limit`. The shell plugin uses a whitelist allowlist — no `eval()` or `exec()`.
