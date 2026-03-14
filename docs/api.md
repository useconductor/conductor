# Conductor Dashboard API

All API routes are served by the Express dashboard on `http://127.0.0.1:4242`.

## Authentication

Every `/api/*` request (except `/api/auth/google/callback`) must include:

```
Authorization: Bearer <token>
```

The token is generated on first startup and stored at `~/.conductor/dashboard.token` (mode 0600).
It is also injected into the served HTML as `<meta name="dashboard-token" content="...">`.

---

## Status

### GET /api/status
Returns server version and environment info.

**Response**
```json
{
  "version": "1.0.0",
  "configDir": "/Users/alex/.conductor",
  "nodeVersion": "v20.11.0",
  "platform": "darwin"
}
```

---

## Config

### GET /api/config
Returns the full config object (all keys).

### POST /api/config
Set a config value by dot-notation key.

**Body**
```json
{ "key": "ai.provider", "value": "claude" }
```

---

## Plugins

### GET /api/plugins
Returns plugin registry state.

**Response**
```json
{
  "installed": ["gmail", "github"],
  "enabled": ["gmail"],
  "all": ["calculator", "gmail", ...],
  "requiredCreds": { "gmail": [{"service": "google", "key": "access_token"}] }
}
```

### POST /api/plugins/toggle
Enable or disable a plugin. Returns 400 if required credentials are missing.

**Body**
```json
{ "plugin": "gmail", "enabled": true }
```

---

## Credentials

### GET /api/credentials
Returns credential status (does NOT return values).

**Response**
```json
[
  { "service": "claude", "key": "api_key", "hasValue": true },
  { "service": "github", "key": "token", "hasValue": false }
]
```

### POST /api/credentials
Store an encrypted credential.

**Body**
```json
{ "service": "github", "key": "token", "value": "ghp_..." }
```

### DELETE /api/credentials/:service/:key
Delete a credential.

---

## Google OAuth

### GET /api/auth/google/status
Returns `{ "connected": true/false }`.

### GET /api/auth/google/url
Returns the Google OAuth authorization URL.

**Response**
```json
{ "url": "https://accounts.google.com/o/oauth2/auth?..." }
```

### GET /api/auth/google/callback
OAuth redirect endpoint — must be accessible without auth token (browser redirect).

### DELETE /api/auth/google
Revoke stored Google tokens.

---

## Conversations

### GET /api/conversations
Returns recent messages from the database.

**Response**
```json
{
  "messages": [
    {
      "user_id": "123456",
      "role": "user",
      "content": "What's the weather?",
      "timestamp": "2026-03-12 10:00:00"
    }
  ]
}
```

---

## Live Logs

### GET /api/logs/stream
Server-Sent Events stream of log output.

**Response** (SSE)
```
data: {"level":"info","message":"Dashboard started","timestamp":"2026-03-12T10:00:00.000Z"}

data: {"level":"error","message":"Plugin error: ...","timestamp":"..."}
```

Levels: `info`, `warn`, `error`

---

## Activity

### GET /api/activity
Returns recent activity log entries (up to 20).

---

## Lumen API Key

### POST /api/lumen/key
Generate and store a new Lumen API key. Returns the plaintext key once.

**Response**
```json
{ "ok": true, "key": "cnd_..." }
```

### GET /api/lumen/key/status
Returns `{ "hasKey": true/false }`.

### DELETE /api/lumen/key
Revoke the current API key.

---

## Lumen Agent

### POST /api/lumen/ask
Forward a task to the local Lumen/Ollama agent.

**Auth**: `Authorization: Bearer <lumen-api-key>` (uses the Lumen API key, not the dashboard token)

**Body**
```json
{ "task": "Show git status", "max_iterations": 5 }
```

---

## Todoist Proxy

All routes require `todoist / api_token` to be set in the keychain.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/todoist/status | Check if configured |
| GET | /api/todoist/projects | List all projects |
| GET | /api/todoist/tasks | List tasks (query: project_id, label, filter) |
| POST | /api/todoist/tasks | Create a task |
| POST | /api/todoist/tasks/:id | Update a task |
| POST | /api/todoist/tasks/:id/close | Complete a task |
| DELETE | /api/todoist/tasks/:id | Delete a task |
