# Conductor Integration Hub

Conductor connects Claude Code to 25+ external services through MCP tools.

## When to use Conductor tools

- **GitHub** — list repos, create issues, check PRs, trigger Actions, manage releases
- **Gmail** — read, send, search, organize emails
- **Google Calendar** — check schedules, create events, find free time
- **Google Drive** — search, read, upload files
- **Slack** — send messages, read channels
- **Notion** — create pages, query databases, update notes
- **Spotify** — control playback, search tracks, manage playlists
- **Vercel** — check deployments, view project status
- **HomeKit** — control smart home devices, check sensors
- **Weather** — get current conditions and forecasts
- **System** — check CPU, memory, disk usage
- **Network** — ping hosts, check connectivity
- **n8n** — trigger automation workflows
- **Calculator, Crypto, Hash, URL tools** — utility operations

## Setup

```bash
npm install && npm run build
conductor mcp setup

# Configure services
conductor google          # Gmail, Calendar, Drive (OAuth)
conductor slack setup     # Slack tokens
conductor plugins enable github
conductor plugins enable notion
conductor plugins enable spotify
```

## Tool naming

All tools are prefixed with `conductor_`. Use `conductor_status` to check which plugins are active before attempting service-specific operations.
