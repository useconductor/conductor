# tests

Test suite for Conductor. Uses Vitest as the test runner.

## Contents

- `calculator.test.ts` - Calculator plugin tests
- `docker.test.ts` - Docker plugin tests
- `mcp.test.ts` - MCP server tests
- `shell.test.ts` - Shell plugin tests

## Architecture

Tests match `**/*.test.ts` and are run via `npx vitest run`. Use `npm run test:watch` for watch mode and `npm run test:coverage` for coverage reports. Add new test files alongside the modules they test, following the existing naming convention.

```bash
npx vitest run tests/calculator.test.ts  # Run a single test file
npm test                                  # Run all tests
```
