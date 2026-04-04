# src/config

Configuration helpers for Conductor, focused on OAuth flows and external service setup.

## Contents

- `oauth.ts` - OAuth 2.0 flow handling for third-party service integrations

## Architecture

This module handles OAuth authentication flows for plugins that require user authorization (Google, GitHub, etc.). It manages token exchange, refresh, and storage. OAuth tokens are encrypted and stored securely via the keychain system.
