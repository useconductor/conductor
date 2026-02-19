# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ Yes    |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report privately via GitHub Security Advisories:
👉 https://github.com/thealxlabs/conductor/security/advisories/new

You'll get a response within 48 hours. If confirmed, a fix will be released promptly and you'll be credited in the release notes.

## Credential Security

Conductor stores all credentials encrypted at rest using **AES-256-GCM**. The encryption key is derived via scrypt from your machine's hardware ID — credentials are machine-bound and cannot be decrypted on any other machine.

Keychain location: `~/.conductor/keychain/` (permissions: `0700`)

**Never share your `~/.conductor/keychain/` directory.**

## What to Report

- Credential exposure or keychain bypass
- Authentication flaws in the OAuth flow
- Arbitrary code execution via plugin system
- Privilege escalation
- Any vulnerability that could expose user tokens or secrets

## What Not to Report

- Deprecation warnings in npm dependencies
- Issues requiring physical access to the machine
