# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, email us at **security@conductor.dev** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 24 hours and provide a detailed response within 72 hours.

## Security Best Practices

### For Users

1. **Keep Conductor updated** — always run the latest version
2. **Use strong API keys** — rotate credentials regularly
3. **Enable plugin approval** — don't run with `full-auto` mode in production
4. **Review tool calls** — audit what tools the AI is calling
5. **Use the encrypted keychain** — never store credentials in plaintext config files

### For Plugin Developers

1. **Validate all inputs** — use Zod schemas, never trust AI-generated arguments
2. **Use `execFile` not `exec`** — never pass user input through a shell
3. **Principle of least privilege** — request only the permissions you need
4. **No `eval()` or `new Function()`** — use safe parsers like `mathjs`
5. **Rate limit your endpoints** — protect against abuse

### Architecture

- **Encrypted keychain** — AES-256-GCM with machine-bound key derivation
- **Zod validation** — every tool input is validated before execution
- **Safe shell** — whitelist-based command filtering, no shell interpretation
- **Plugin sandboxing** — plugins run with minimal permissions
- **Approval workflow** — dangerous operations require explicit user approval
- **Rate limiting** — all endpoints protected against abuse
