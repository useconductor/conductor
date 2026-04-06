#!/usr/bin/env bash
# Conductor — The AI Tool Hub
# install.sh: one-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/useconductor/conductor/main/install.sh | bash

set -euo pipefail

# ── Terminal styling (b/w only) ───────────────────────────────────────────────
if [[ -t 1 ]]; then
  BOLD="$(tput bold 2>/dev/null || printf '\033[1m')"
  DIM="$(tput dim 2>/dev/null || printf '\033[2m')"
  RESET="$(tput sgr0 2>/dev/null || printf '\033[0m')"
else
  BOLD='' DIM='' RESET=''
fi

NPM_PACKAGE="@useconductor/conductor"
MIN_NODE_MAJOR=20
UPGRADE_MODE=false
WIDTH=50

# ── Drawing helpers ───────────────────────────────────────────────────────────

box_top()    { printf "  ┌"; printf '─%.0s' $(seq 1 $WIDTH); printf "┐\n"; }
box_mid()    { printf "  ├"; printf '─%.0s' $(seq 1 $WIDTH); printf "┤\n"; }
box_bot()    { printf "  └"; printf '─%.0s' $(seq 1 $WIDTH); printf "┘\n"; }
box_line() {
  local text="$1"
  local pad=$(( WIDTH - ${#text} - 1 ))
  printf "  │ %s%${pad}s│\n" "$text" ""
}
box_blank()  { box_line ""; }

step()    { printf "\n  ${BOLD}▸ %s${RESET}\n" "$*"; }
ok()      { printf "  ${BOLD}✓${RESET} %s\n" "$*"; }
warn()    { printf "  ${BOLD}!${RESET} %s\n" "$*"; }
info()    { printf "  ${DIM}  %s${RESET}\n" "$*"; }
die()     { printf "\n  ${BOLD}✗ Error:${RESET} %s\n\n" "$*" >&2; exit 1; }

hr() { printf "  "; printf '─%.0s' $(seq 1 $WIDTH); printf "\n"; }

spinner() {
  local pid=$1 msg="$2"
  local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${BOLD}%s${RESET} %s " "${frames[$((i % ${#frames[@]}))]}" "$msg"
    i=$((i + 1))
    sleep 0.1
  done
  printf "\r\033[K"
}

# ── Header ────────────────────────────────────────────────────────────────────

print_header() {
  echo ""
  box_top
  box_blank
  box_line "${BOLD}  Conductor — The AI Tool Hub${RESET}"
  box_blank
  box_line "${DIM}  One MCP server. 100+ tools. Any AI.${RESET}"
  box_line "${DIM}  github.com/useconductor/conductor${RESET}"
  box_blank
  box_bot
  echo ""
}

# ── Platform detection ────────────────────────────────────────────────────────

detect_platform() {
  OS="unknown"
  case "$(uname -s)" in
    Linux*)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        OS="wsl"
      else
        OS="linux"
      fi
      ;;
    Darwin*)                    OS="macos"   ;;
    CYGWIN*|MINGW*|MSYS*)       OS="windows" ;;
  esac
  [[ "$OS" == "unknown" ]] && OS="linux"
}

# ── Dependency checks ─────────────────────────────────────────────────────────

check_node() {
  step "Checking prerequisites"

  if ! command -v node &>/dev/null; then
    echo ""
    die "Node.js is not installed.\n  Install Node.js ${MIN_NODE_MAJOR}+ from https://nodejs.org"
  fi

  NODE_VERSION_RAW="$(node --version)"
  NODE_VERSION_CLEAN="${NODE_VERSION_RAW#v}"
  NODE_MAJOR="${NODE_VERSION_CLEAN%%.*}"
  NODE_MINOR="${NODE_VERSION_CLEAN#*.}"
  NODE_MINOR="${NODE_MINOR%%.*}"

  if [[ "${NODE_MAJOR}" -lt "${MIN_NODE_MAJOR}" ]]; then
    die "Node.js ${NODE_VERSION_RAW} found, but ${MIN_NODE_MAJOR}+ required.\n  Upgrade at https://nodejs.org"
  fi

  # Warn if below 20.12 (util.styleText requirement)
  if [[ "${NODE_MAJOR}" -eq 20 && "${NODE_MINOR}" -lt 12 ]]; then
    warn "Node.js ${NODE_VERSION_RAW} — recommend 20.12+ for full compatibility"
  else
    ok "Node.js ${NODE_VERSION_RAW}"
  fi
}

check_npm() {
  if ! command -v npm &>/dev/null; then
    die "npm not found. Reinstall Node.js from https://nodejs.org"
  fi
  ok "npm v$(npm --version)"
}

# ── Already installed? ────────────────────────────────────────────────────────

check_existing() {
  if command -v conductor &>/dev/null; then
    EXISTING_VERSION="$(conductor --version 2>/dev/null || echo 'unknown')"
    echo ""
    warn "Conductor ${EXISTING_VERSION} is already installed."

    if [[ -t 0 ]]; then
      printf "\n  Upgrade to latest? [Y/n] "
      read -r REPLY
      echo ""
      case "${REPLY:-Y}" in
        [Nn]*) info "Skipping upgrade."; echo ""; exit 0 ;;
      esac
    else
      info "Non-interactive mode — upgrading automatically."
      echo ""
    fi

    UPGRADE_MODE=true
  fi
}

# ── Installation ──────────────────────────────────────────────────────────────

install_conductor() {
  echo ""
  if [[ "${UPGRADE_MODE}" == true ]]; then
    step "Upgrading Conductor"
  else
    step "Installing Conductor"
  fi
  echo ""

  NPM_PREFIX="$(npm config get prefix 2>/dev/null || echo "")"

  if [[ "$NPM_PREFIX" == /usr* ]] && [[ "$(id -u)" -ne 0 ]]; then
    if command -v sudo &>/dev/null; then
      info "Global npm prefix is ${NPM_PREFIX} — needs sudo"
      echo ""
      (sudo npm install -g "${NPM_PACKAGE}" 2>&1 | grep -v "^npm warn" | tail -3) &
      spinner $! "Installing ${NPM_PACKAGE} ..." || \
        die "Installation failed. Try: sudo npm install -g ${NPM_PACKAGE}"
    else
      die "Cannot write to ${NPM_PREFIX}.\n  Run: sudo npm install -g ${NPM_PACKAGE}"
    fi
  else
    (npm install -g "${NPM_PACKAGE}" 2>&1 | grep -v "^npm warn" | tail -3) &
    spinner $! "Installing ${NPM_PACKAGE} ..." || \
      die "Installation failed — check npm output above."
  fi
}

# ── Verify ────────────────────────────────────────────────────────────────────

verify_installation() {
  if ! command -v conductor &>/dev/null; then
    echo ""
    warn "conductor not found in PATH after install."
    NPM_BIN="$(npm config get prefix 2>/dev/null)/bin"
    echo ""
    info "Add npm's global bin to your PATH:"
    printf "    ${BOLD}export PATH=\"%s:\$PATH\"${RESET}\n" "$NPM_BIN"
    echo ""
    info "Then reload your shell and run: conductor init"
    echo ""
    return 1
  fi

  INSTALLED_VERSION="$(conductor --version 2>/dev/null || echo 'unknown')"
  ok "conductor v${INSTALLED_VERSION} ready"
  return 0
}

# ── Next steps ────────────────────────────────────────────────────────────────

print_next_steps() {
  echo ""
  hr
  echo ""
  printf "  ${BOLD}Conductor installed.${RESET} Get started:\n"
  echo ""
  printf "  ${BOLD}conductor init${RESET}\n"
  info "First-run wizard: AI provider, plugins, MCP config"
  echo ""
  printf "  ${DIM}Other commands:${RESET}\n"
  printf "  ${DIM}  conductor onboard${RESET}        Pick and configure plugins\n"
  printf "  ${DIM}  conductor mcp setup${RESET}      Auto-configure Claude Desktop / Cursor\n"
  printf "  ${DIM}  conductor mcp start${RESET}      Start the MCP server (stdio)\n"
  printf "  ${DIM}  conductor doctor${RESET}         Diagnose issues\n"
  printf "  ${DIM}  conductor dashboard${RESET}      Open web dashboard\n"
  echo ""
  hr
  echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  print_header
  detect_platform
  check_node
  check_npm
  check_existing
  install_conductor
  verify_installation
  print_next_steps
}

main "$@"
