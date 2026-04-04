# src/ai

Multi-provider AI manager for Conductor. Supports Claude, OpenAI, Gemini, Ollama, and OpenRouter.

## Contents

- `manager.ts` - `AIManager` orchestrating multiple AI providers
- `base.ts` - Base provider interface and shared logic
- `claude.ts` - Anthropic Claude provider
- `openai.ts` - OpenAI provider
- `gemini.ts` - Google Gemini provider
- `ollama.ts` - Ollama (local) provider
- `openrouter.ts` - OpenRouter meta-provider
- `maestro.ts` - AI orchestration and routing logic

## Architecture

`AIManager` abstracts over multiple AI providers, allowing users to configure and switch between them. Each provider implements a common interface. The `maestro.ts` module handles intelligent routing and fallback between providers. Used by the MCP server for tool responses and by the bot for proactive reasoning.
