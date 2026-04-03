# Conductor Plugin Reference

All built-in plugins live in `src/plugins/builtin/`. Each plugin implements the `Plugin` interface.

## Plugin Interface

```typescript
interface Plugin {
  name: string;
  description: string;
  version: string;
  initialize(conductor: Conductor): Promise<void>;
  isConfigured(): boolean;
  getTools(): PluginTool[];
  configSchema?: PluginConfigSchema;
  getContext?(): Promise<string | null>;
}
```

---

## Utility Plugins (no credentials required)

### calculator
Math expression evaluator, unit converter, date calculator.

**Tools**: `calculate`, `convert_unit`, `date_calc`

### colors
Color format conversion, contrast checking, palette generation.

**Tools**: `colors_convert`, `colors_contrast`, `colors_palette`

### hash
Hashing, base64 encoding/decoding.

**Tools**: `hash_text`, `base64_encode`, `base64_decode`

### text-tools
JSON formatter, word counter, text transformers.

**Tools**: `format_json`, `word_count`, `text_transform`

### timezone
Timezone conversion and lookup.

**Tools**: `timezone_convert`, `timezone_list`

### crypto
Cryptocurrency prices and search.

**Tools**: `crypto_price`, `crypto_search`

### network
DNS lookup, IP geolocation, reverse DNS.

**Tools**: `dns_lookup`, `ip_info`, `reverse_dns`

### url-tools
URL expansion, QR code generation, URL parsing.

**Tools**: `expand_url`, `url_parse`

### fun
Random jokes and facts.

**Tools**: `random_joke`, `random_fact`

### notes
Local markdown note management.

**Tools**: `notes_create`, `notes_list`, `notes_read`, `notes_update`, `notes_delete`, `notes_search`

### cron
Cron expression parser and scheduler.

**Tools**: `cron_parse`, `cron_next`

### system
System stats, process management, clipboard.

**Tools**: `system_info`, `list_processes`, `kill_process`, `clipboard_read`, `clipboard_write`

### translate
Text translation using LibreTranslate.

**Tools**: `translate_text`, `detect_language`

---

## Google Plugins

All Google plugins require Google OAuth. Connect via: `conductor auth google`

**Keychain**: `google / access_token`, `google / refresh_token`

### gmail
Read, send, archive emails and manage labels.

**Tools**: `gmail_list`, `gmail_read`, `gmail_send`, `gmail_reply`, `gmail_archive`, `gmail_labels`, `gmail_search`

**getContext()**: Returns unread message count.

### gcal
Create, read, update, delete calendar events.

**Tools**: `gcal_list_calendars`, `gcal_list_events`, `gcal_create_event`, `gcal_update_event`, `gcal_delete_event`, `gcal_find_free_time`

**getContext()**: Returns today's event summaries.

### gdrive
Browse, read, create, upload files in Google Drive.

**Tools**: `gdrive_list`, `gdrive_read`, `gdrive_create`, `gdrive_upload`, `gdrive_search`

---

## Developer Plugins

### github
GitHub repositories, issues, stars, user info.

**Required credential**: `github / token` (PAT with `repo` and `workflow` scopes)

**Tools**: `github_user`, `github_repo`, `github_repos`, `github_search_repos`, `github_issues`, `github_create_issue`, `github_close_issue`, `github_prs`, `github_create_pr`, `github_merge_pr`, `github_stars`

### github-actions
Trigger and monitor GitHub Actions workflows.

**Required credential**: `github / token`

**Tools**: `github_actions_list`, `github_actions_run`, `github_actions_status`

### vercel
Deploy and manage Vercel projects and deployments.

**Required credential**: `vercel / token`

**Tools**: `vercel_list_projects`, `vercel_deployments`, `vercel_deploy`, `vercel_logs`

### n8n
Trigger and manage n8n automation workflows.

**Required credentials**: `n8n / api_key`, `n8n / base_url`

**Tools**: `n8n_list_workflows`, `n8n_trigger_workflow`, `n8n_get_execution`

---

## Service Plugins

### notion
Read, search, and create Notion pages and databases.

**Required credential**: `notion / api_key` (Internal Integration Token)

**Setup**: Visit https://www.notion.so/my-integrations, create integration, copy token.

**Tools**: `notion_search`, `notion_get_page`, `notion_create_page`, `notion_query_database`, `notion_append_block`

### spotify
Control Spotify playback and search music.

**Required credentials**: `spotify / client_id`, `spotify / client_secret`, `spotify / access_token`

**Tools**: `spotify_search`, `spotify_play`, `spotify_pause`, `spotify_next`, `spotify_current`, `spotify_queue`

### weather
Current weather and forecasts.

**Required credential**: `weather / api_key` (OpenWeatherMap API key)

**Tools**: `weather_current`, `weather_forecast`

### todoist
Manage Todoist tasks, projects, and comments.

**Required credential**: `todoist / api_token`

**Setup**: Go to https://app.todoist.com/app/settings/integrations/developer, copy API token.

**Tools**:
- `todoist_list_tasks` — List tasks with optional filters
- `todoist_create_task` — Create a task with natural-language due date
- `todoist_complete_task` — Mark a task as complete
- `todoist_update_task` — Update task content, due date, priority
- `todoist_delete_task` — Permanently delete a task (requiresApproval)
- `todoist_get_projects` — List all projects
- `todoist_search_tasks` — Search with Todoist filter syntax
- `todoist_add_comment` — Add a comment to a task

**getContext()**: Returns overdue and today's task counts.

### x (Twitter)
Post tweets and manage X/Twitter account.

**Required credential**: `x / api_key`

**Tools**: `x_post`, `x_read_timeline`, `x_search`

---

## Messaging Plugins

### slack
Send messages and manage Slack channels and threads.

**Required credential**: `slack / bot_token` (Bot User OAuth Token)

**Tools**: `slack_send_message`, `slack_list_channels`, `slack_read_channel`, `slack_reply_thread`

---

## Smart Home

### homekit
Control HomeKit accessories via the homebridge REST API.

**Required credentials**: `homekit / base_url`, `homekit / username`, `homekit / password`

**Tools**: `homekit_list`, `homekit_get`, `homekit_set`

---

## Infrastructure Plugins

### docker
Docker container, image, volume, and network management.

**No credentials required** — uses the local Docker CLI.

**Tools**:
- `docker_containers` — List containers (use `--all` for stopped)
- `docker_container_logs` — Get container logs
- `docker_container_action` — start/stop/restart/pause/kill/remove
- `docker_images` — List images
- `docker_pull` — Pull an image
- `docker_run` — Run a container (requiresApproval)
- `docker_volumes` — List volumes
- `docker_networks` — List networks
- `docker_stats` — Resource usage stats

### database
Query PostgreSQL, MySQL, MongoDB, and Redis databases.

**Required credentials** (stored encrypted in keychain):
- `database / postgres_url` — `postgresql://user:pass@host:5432/db`
- `database / mysql_url` — `mysql://user:pass@host:3306/db`
- `database / mongo_url` — `mongodb://user:pass@host:27017/db`
- `database / redis_url` — `redis://:pass@host:6379/0`

**Tools**:
- `db_postgres_query` — Read-only SELECT query
- `db_mysql_query` — Read-only SELECT query
- `db_mongo_find` — Query a collection
- `db_redis_command` — Execute a Redis command
- `db_list_connections` — List configured connections

### shell
Safe shell command execution with approval workflow and path validation.

**No credentials required.**

**Tools**:
- `shell_run` — Run a whitelisted command (requiresApproval)
- `shell_read_file` — Read file contents
- `shell_write_file` — Write content to file (requiresApproval)
- `shell_list_dir` — List directory contents
- `shell_search_files` — Search files by glob pattern
- `shell_search_content` — Search file contents with grep

**Safety features:**
- Whitelist-based command filtering (no arbitrary commands)
- Path traversal protection
- Dangerous pattern detection (fork bombs, rm -rf /, etc.)
- 10MB output limit, 120s timeout

---

## AI

### lumen
Agentic AI coding assistant. Writes code, runs shell commands, manages git.

**Required**: Ollama running locally with the `lumen` model.

**Tools** (all with `requiresApproval: true` for shell-executing tools):
- `lumen_ask` — Ask Lumen to complete any coding task
- `lumen_shell` — Run a shell task
- `lumen_write_file` — Generate and write a file
- `lumen_fix_bug` — Investigate and fix a bug
- `lumen_git_commit` — Stage and commit changes
- `lumen_git_push` — Push to origin
- `lumen_git_status` — Show git status
- `lumen_ping` — Check if Lumen is available

---

## System Plugins

### memory
Long-term memory storage and recall using SQLite.

**Tools**: `memory_recall`, `memory_store`, `memory_forget`, `memory_list`, `search_past_conversations`

Note: `search_past_conversations` is scoped to the current user's conversation history.
