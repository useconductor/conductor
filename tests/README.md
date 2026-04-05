# tests

Test suite for Conductor. Uses [Vitest](https://vitest.dev) as the test runner.

## Running tests

```bash
npm test                                      # Run all tests
npm run test:watch                            # Watch mode
npm run test:coverage                         # Coverage report
npx vitest run tests/calculator.test.ts       # Single file
```

## Test files

| File | Covers |
|---|---|
| `audit.test.ts` | AuditLogger — SHA-256 chain, integrity verify, query filters, secret redaction |
| `calculator.test.ts` | Calculator plugin — math eval, unit conversions, date arithmetic |
| `circuit-breaker.test.ts` | CircuitBreaker — state machine (closed/open/half_open), recovery, reset |
| `docker.test.ts` | Docker plugin — container listing, image inspection |
| `errors.test.ts` | ConductorError class, ERRORS constants, createError interpolation |
| `load.test.ts` | Concurrent tool call load test — 100 simultaneous requests |
| `mcp.test.ts` | MCP server — tool registration, handler dispatch, error propagation |
| `retry.test.ts` | withRetry — backoff, onRetry callback, retryable error filtering |
| `shell.test.ts` | Shell plugin — allowlist enforcement, dangerous pattern blocking |
| `validation.test.ts` | withValidation/validateTools — Zod schema conversion, type checking |
| `zero-config.test.ts` | Zero-config plugins — colors, hash, text-tools, timezone, calculator |

## What's tested

- **Core infrastructure** — audit logging, circuit breaker state machine, retry with backoff, input validation, error codes
- **Security** — shell command allowlist, secret redaction in audit logs, dangerous pattern detection
- **Zero-config plugins** — all 5 plugins fully exercised without mocking: calculator (math/convert/date), colors (convert/palette/contrast), hash (sha256/md5/base64/uuid), text-tools (json/stats/regex/transform), timezone (world clock/conversion)
- **MCP server** — tool registration, request routing, error handling
- **Load** — 100 concurrent requests, circuit breaker under parallel load

## Adding tests

Follow the existing pattern — one `describe` block per class/function, `it()` cases that are self-documenting. Tests should not hit external APIs or require credentials. For plugins that need credentials, mock at the transport layer or skip with `it.skip`.
