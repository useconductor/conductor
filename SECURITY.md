# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | Yes                |

Older versions are not supported. Always run the latest release.

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security issues through one of these private channels:

- **Email:** [security@thealxlabs.ca](mailto:security@thealxlabs.ca)
- **GitHub Security Advisories:** https://github.com/thealxlabs/conductor/security/advisories/new

You will receive an acknowledgement within **48 hours**. If the vulnerability is confirmed, a fix will be released as soon as possible and you will be credited in the release notes (unless you prefer to remain anonymous).

Please include as much detail as possible:

- A clear description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- The version of Conductor you are running
- Your operating system and Node.js version
- Any relevant logs or screenshots (redact sensitive values)

---

## Credential & Keychain Security

Conductor stores all credentials encrypted at rest. No raw secrets are ever written to `config.json` or logs.

**Encryption scheme:**
- Algorithm: **AES-256-GCM**
- Key derivation: **scrypt** from your machine's hardware ID
- Credentials are **machine-bound** — they cannot be decrypted on any other machine

**Keychain location:** `~/.conductor/keychain/`
**Directory permissions:** `0700` (owner read/write/execute only)

**Best practices:**
- Never share or back up your `~/.conductor/keychain/` directory to untrusted locations (cloud storage, USB drives, etc.)
- If you suspect your keychain has been compromised, revoke all associated tokens (Google OAuth, API keys, Slack/Telegram tokens) immediately and re-run `conductor ai setup` / `conductor auth google`
- On shared or multi-user machines, ensure your home directory permissions restrict access to your user only

---

## Scope

### In scope — please report these

- Keychain bypass or credential exposure without physical machine access
- Authentication flaws in the Google OAuth or Slack/Telegram token flows
- Arbitrary code execution via the plugin system or tool calling loop
- Privilege escalation beyond the running user's permissions
- Prompt injection attacks that cause Conductor to exfiltrate data or take unintended actions
- Path traversal or unauthorized filesystem access
- Any vulnerability that could expose user tokens, API keys, or secrets

### Out of scope — please do not report these

- Deprecation warnings or known vulnerabilities in npm dependencies with no available fix
- Issues that require physical access to the machine (the keychain is intentionally machine-bound)
- Social engineering attacks targeting the user directly
- Rate limiting or denial-of-service against third-party APIs (report to the respective provider)
- Security issues in third-party services that Conductor integrates with (Google, Slack, Telegram, Spotify, etc.)

---

## Proactive Mode & Approval Gates

Conductor's Proactive Mode runs an autonomous AI reasoning loop. To reduce risk:

- **Approval gates** are built into the tool system. Tools marked `requiresApproval` will pause execution and notify you via Slack or Telegram before running.
- You can approve or deny any pending action with `/approve <id>` or `/deny <id>`.
- Review which tools are enabled with `conductor plugins list` and disable any you don't need.

---

## Responsible Disclosure

We follow a coordinated disclosure process:

1. You report the issue privately (email or GitHub advisory)
2. We confirm receipt within 48 hours
3. We investigate and develop a fix
4. We release a patch and publish a security advisory
5. You are credited (with your permission)

We ask that you give us reasonable time to address the issue before any public disclosure.

---

## Contact

For security issues: [security@thealxlabs.ca](mailto:security@thealxlabs.ca)
For general questions: open a [GitHub Discussion](https://github.com/thealxlabs/conductor/discussions) or issue
