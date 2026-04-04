# .github/workflows

GitHub Actions CI/CD workflows for Conductor.

## Contents

- `ci.yml` - Continuous integration: lint, typecheck, test, build
- `auto-release.yml` - Automated release creation
- `claude-code-review.yml` - AI-assisted code review
- `claude.yml` - Claude Code automation
- `sync-install.yml` - Install script synchronization

## Architecture

These workflows automate the development lifecycle:

- **CI** runs on every push/PR to ensure code quality
- **Auto-release** publishes new versions on tag creation
- **Claude workflows** provide AI-assisted review and automation
- **Sync-install** keeps installation scripts up to date

All workflows run on GitHub's infrastructure and are triggered by push, pull request, or schedule events.
