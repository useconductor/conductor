# src/bot

Bot integrations for Conductor — Telegram bot and Slack Bolt app.

## Contents

- `telegram.ts` - Telegram bot integration
- `slack.ts` - Slack Bolt integration

## Architecture

Both integrations share the same `Conductor` instance, giving them access to all plugins, AI providers, and tools. The proactive reasoning cycle runs on a timer, calling `plugin.getContext()` on each enabled plugin and feeding results to the AI manager for intelligent responses.
