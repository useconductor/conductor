# Contributing to Conductor

Conductor stays small, technical, and dependable. Keep changes focused and easy to review.

## Setup

```bash
git clone https://github.com/useconductor/conductor.git
cd conductor
npm install
npm run dev
```

## Project structure

- `src/plugins/` — built-in plugins
- `src/ai/` — provider setup and routing
- `src/core/` — config, runtime, errors, and health
- `src/cli/` — command-line entry points
- `src/dashboard/` — web dashboard

## Adding a plugin

1. Add the plugin in `src/plugins/builtin/`
2. Export a `Plugin` class
3. Register it in the builtin index
4. Add or update tests if behavior changes

## Pull requests

- Use a short branch name
- Keep commits small and direct
- Link the issue in the PR
- Include the commands you ran to verify the change

## Code style

- TypeScript first
- Follow the existing file style
- Run `npm run lint`, `npm run format:check`, and `npm run typecheck` before opening a PR

When in doubt, prefer the simplest implementation that works.
