# /conductor-setup

Set up Conductor integration hub for this project.

1. Check if Conductor is installed: `which conductor || npm list -g @thealxlabs/conductor`
2. If not installed: `npm install && npm run build` from the conductor repo root
3. Configure the MCP server: `conductor mcp setup`
4. Check status: `conductor mcp status`
5. List available plugins: `conductor plugins list`

Tell the user which services are configured and suggest running `conductor google` for Google services or `conductor slack setup` for Slack.
