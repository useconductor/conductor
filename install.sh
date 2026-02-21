#!/usr/bin/env bash
# ============================================================
# Conductor Install Script — by TheAlxLabs
# ============================================================
#   curl -fsSL https://raw.githubusercontent.com/thealxlabs/conductor/main/install.sh | bash
#   bash install.sh
# ============================================================
set -euo pipefail
IFS=$'\n\t'

# ── Terminal colours ──────────────────────────────────────────────────────────
if [[ -t 1 ]] && command -v tput &>/dev/null; then
  RED=$(tput setaf 1)    GREEN=$(tput setaf 2)  YELLOW=$(tput setaf 3)
  BLUE=$(tput setaf 4)   CYAN=$(tput setaf 6)   BOLD=$(tput bold)
  DIM=$(tput dim 2>/dev/null || printf '')       ITALIC=''
  RESET=$(tput sgr0)
else
  RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m'
  BLUE='\033[0;34m' CYAN='\033[0;36m' BOLD='\033[1m'
  DIM='\033[2m'    ITALIC='\033[3m'   RESET='\033[0m'
fi

# ── Logging ───────────────────────────────────────────────────────────────────
info()    { echo -e "  ${BLUE}▶${RESET} $*"; }
success() { echo -e "  ${GREEN}✓${RESET} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET}  $*" >&2; }
fail()    { echo -e "\n  ${RED}✗ FATAL:${RESET} $*\n" >&2; exit 1; }
hint()    { echo -e "  ${DIM}${ITALIC}$*${RESET}"; }

step() {
  echo ""
  echo -e "  ${BOLD}${CYAN}┌──────────────────────────────────────────────${RESET}"
  echo -e "  ${BOLD}${CYAN}│  $*${RESET}"
  echo -e "  ${BOLD}${CYAN}└──────────────────────────────────────────────${RESET}"
}

# ── Cleanup & signal handling ─────────────────────────────────────────────────
_SPINNER_PID=""
_TMPFILES=()

cleanup() {
  local exit_code=$?
  if [[ -n "$_SPINNER_PID" ]] && kill -0 "$_SPINNER_PID" 2>/dev/null; then
    kill "$_SPINNER_PID" 2>/dev/null || true
    wait "$_SPINNER_PID" 2>/dev/null || true
  fi
  printf '\r\033[K' 2>/dev/null || true
  for f in "${_TMPFILES[@]:-}"; do
    [[ -f "$f" ]] && rm -f "$f" 2>/dev/null || true
  done
  if [[ $exit_code -ne 0 ]]; then
    echo ""
    warn "Installation did not complete (exit $exit_code). Re-run to retry — it is idempotent."
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ── Prompt helpers (always /dev/tty so piped installs work) ───────────────────
prompt_input() {
  local prompt="$1" varname="$2" default="${3:-}"
  if [[ -n "$default" ]]; then
    printf "  ${CYAN}?${RESET} ${BOLD}%s${RESET} ${DIM}[%s]${RESET}: " "$prompt" "$default" >/dev/tty
  else
    printf "  ${CYAN}?${RESET} ${BOLD}%s${RESET}: " "$prompt" >/dev/tty
  fi
  local _val; IFS= read -r _val </dev/tty || _val=""
  printf -v "$varname" '%s' "${_val:-$default}"
}

prompt_yn() {
  local prompt="$1" varname="$2" default="${3:-y}"
  local hint_str="Y/n"; [[ "$default" == "n" ]] && hint_str="y/N"
  printf "  ${CYAN}?${RESET} ${BOLD}%s${RESET} ${DIM}[%s]${RESET}: " "$prompt" "$hint_str" >/dev/tty
  local _val; IFS= read -r _val </dev/tty || _val=""
  _val="${_val:-$default}"
  if [[ "$_val" =~ ^[Yy] ]]; then printf -v "$varname" '%s' "true"
  else printf -v "$varname" '%s' "false"; fi
}

prompt_secret() {
  local prompt="$1" varname="$2"
  printf "  ${CYAN}?${RESET} ${BOLD}%s${RESET}: " "$prompt" >/dev/tty
  local _sec; IFS= read -rs _sec </dev/tty || _sec=""
  echo "" >/dev/tty
  printf -v "$varname" '%s' "$_sec"
}

# ── Spinner ───────────────────────────────────────────────────────────────────
spinner() {
  local pid=$1 label="${2:-Working}"
  local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${CYAN}%s${RESET} ${DIM}%s...${RESET}" "${frames[$i]}" "$label" >/dev/tty
    i=$(( (i + 1) % ${#frames[@]} ))
    sleep 0.1
  done
  printf '\r\033[K' >/dev/tty
}

# Run a command with a spinner; shows last 20 lines of output on failure
run_step() {
  local label="$1"; shift
  local log_file; log_file=$(mktemp)
  _TMPFILES+=("$log_file")
  "$@" >"$log_file" 2>&1 &
  local pid=$!
  spinner "$pid" "$label"
  local rc=0; wait "$pid" || rc=$?
  if [[ $rc -ne 0 ]]; then
    echo ""; warn "Command failed (exit $rc): $*"
    warn "Last output:"; tail -20 "$log_file" | sed 's/^/    /' >&2
    rm -f "$log_file"; return $rc
  fi
  rm -f "$log_file"; return 0
}

# ── Config helpers ────────────────────────────────────────────────────────────
CONFIG_DIR="$HOME/.conductor"
CONFIG_FILE="$CONFIG_DIR/config.json"

ensure_dirs() {
  mkdir -p "$CONFIG_DIR"/{keychain,plugins,logs}
  chmod 700 "$CONFIG_DIR/keychain"
  chmod 700 "$CONFIG_DIR"
}

# Atomic JSON merge: write to tmp, then rename
update_config() {
  local json_str="$1"
  local tmp_file; tmp_file=$(mktemp "${CONFIG_FILE}.XXXXXX")
  _TMPFILES+=("$tmp_file")
  python3 -c "
import json, sys, os
config_path, tmp_path, new_json = sys.argv[1], sys.argv[2], sys.argv[3]
existing = {}
if os.path.exists(config_path):
    try:
        with open(config_path) as f: existing = json.load(f)
    except Exception: pass
def merge(a, b):
    for k, v in b.items():
        if k in a and isinstance(a[k], dict) and isinstance(v, dict): merge(a[k], v)
        else: a[k] = v
    return a
with open(tmp_path, 'w') as f:
    json.dump(merge(existing, json.loads(new_json)), f, indent=2)
    f.flush(); os.fsync(f.fileno())
os.replace(tmp_path, config_path)
" "$CONFIG_FILE" "$tmp_file" "$json_str"
}

# Encrypt with AES-256-GCM, machine-keyed, v2 format (matches keychain.ts)
save_cred() {
  local service="$1" key="$2" val="$3"
  node - "$CONFIG_DIR" "$service" "$key" "$val" << 'JSEOF'
const crypto=require('crypto'),fs=require('fs'),path=require('path'),os=require('os'),{execSync}=require('child_process');
const [,,configDir,service,key,val]=process.argv;
const kd=path.join(configDir,'keychain'); fs.mkdirSync(kd,{recursive:true,mode:0o700});
function ms(){
  for(const s of['/etc/machine-id','/var/lib/dbus/machine-id'])try{const d=fs.readFileSync(s,'utf8').trim();if(d)return d}catch{}
  if(process.platform==='darwin')try{const o=execSync("ioreg -rd1 -c IOPlatformExpertDevice|awk '/IOPlatformUUID/{print $NF}'",{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim().replace(/"/g,'');if(o)return o}catch{}
  if(process.platform==='win32')try{const o=execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',{encoding:'utf8',stdio:['pipe','pipe','pipe']});const m=o.match(/MachineGuid\s+REG_SZ\s+(.+)/);if(m?.[1]?.trim())return m[1].trim()}catch{}
  const f=path.join(kd,'machine_secret');
  try{if(fs.readFileSync(f,'utf8').trim())return fs.readFileSync(f,'utf8').trim()}catch{}
  try{const s=crypto.randomUUID();fs.writeFileSync(f,s,{mode:0o600});return s}catch{return os.hostname()}
}
const salt=crypto.createHash('sha256').update('conductor:keychain:v1').digest();
const mk=crypto.scryptSync(ms(),salt,32,{N:16384,r:8,p:1});
const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',mk,iv);
let e=c.update(val,'utf8','hex'); e+=c.final('hex');
const t=c.getAuthTag().toString('hex');
const out=['v2',iv.toString('hex'),t,e].join(':');
const fp=path.join(kd,`${service}.${key}.enc`); const tmp=fp+'.tmp';
fs.writeFileSync(tmp,out,{mode:0o600}); fs.renameSync(tmp,fp);
JSEOF
}

add_plugin() {
  python3 -c "
import json, sys, os
p, pl = sys.argv[1], sys.argv[2]
c = {}
if os.path.exists(p):
    try:
        with open(p) as f: c = json.load(f)
    except Exception: pass
for k in ['installed','enabled']:
    lst = c.get('plugins',{}).get(k,[])
    if pl not in lst: lst.append(pl)
    c.setdefault('plugins',{})[k] = lst
with open(p,'w') as f: json.dump(c, f, indent=2)
" "$CONFIG_FILE" "$1"
}

version_gte() {
  local IFS='.'
  read -ra A <<< "$1"; read -ra B <<< "$2"
  for i in 0 1 2; do
    local a="${A[$i]:-0}" b="${B[$i]:-0}"
    (( a > b )) && return 0; (( a < b )) && return 1
  done
  return 0
}

# ── HEADER ────────────────────────────────────────────────────────────────────
clear 2>/dev/null || true
echo ""
printf "${BOLD}${CYAN}"
cat << 'BANNER'
        ██████╗ ██████╗ ███╗   ██╗██████╗ ██╗   ██╗ ██████╗████████╗ ██████╗ ██████╗
       ██╔════╝██╔═══██╗████╗  ██║██╔══██╗██║   ██║██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗
       ██║     ██║   ██║██╔██╗ ██║██║  ██║██║   ██║██║        ██║   ██║   ██║██████╔╝
       ██║     ██║   ██║██║╚██╗██║██║  ██║██║   ██║██║        ██║   ██║   ██║██╔══██╗
       ╚██████╗╚██████╔╝██║ ╚████║██████╔╝╚██████╔╝╚██████╗   ██║   ╚██████╔╝██║  ██║
        ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚═════╝  ╚═════╝  ╚═════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝
BANNER
printf "${RESET}\n"
echo -e "  ${DIM}Your AI Integration Hub  ·  by ${CYAN}TheAlxLabs${RESET}"
echo -e "  ${DIM}────────────────────────────────────────────────────────────${RESET}"
echo ""
echo -e "  ${ITALIC}Connect your services. Talk to your tools. Let AI handle the rest.${RESET}"
echo ""

# ── STEP 1: PREFLIGHT ─────────────────────────────────────────────────────────
step "01 / Preflight Check"

OS="$(uname -s 2>/dev/null || echo Unknown)"
ARCH="$(uname -m 2>/dev/null || echo Unknown)"
case "$OS" in
  Darwin) PLATFORM="macos" ;;
  Linux)  PLATFORM="linux" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  *) PLATFORM="unknown"; warn "Unknown OS: $OS" ;;
esac
info "Platform: ${BOLD}$OS${RESET} ($ARCH)"

# Node.js >= 18
command -v node &>/dev/null || fail "Node.js not found. Install v18+ from https://nodejs.org"
NODE_RAW=$(node --version 2>/dev/null || echo "v0")
NODE_VER="${NODE_RAW#v}"; NODE_MAJOR="${NODE_VER%%.*}"
[[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] && (( NODE_MAJOR >= 18 )) || \
  fail "Node.js v18+ required (found $NODE_RAW). Upgrade at https://nodejs.org"
success "Node.js $NODE_RAW"

command -v npm &>/dev/null || fail "npm not found. Reinstall Node.js from https://nodejs.org"
success "npm $(npm --version)"

command -v python3 &>/dev/null || fail "Python 3 not found. Install python3 and re-run."
PY_VER=$(python3 -c 'import sys; print(".".join(map(str,sys.version_info[:2])))' 2>/dev/null || echo "0.0")
version_gte "$PY_VER" "3.6" || fail "Python 3.6+ required (found $PY_VER)."
success "Python $PY_VER"

command -v git &>/dev/null && success "git $(git --version | awk '{print $3}')" || warn "git not found"
command -v curl &>/dev/null && success "curl $(curl --version | head -1 | awk '{print $2}')" || warn "curl not found — Telegram verification will be skipped"

ensure_dirs
success "Config dirs ready ($CONFIG_DIR)"

# ── STEP 2: INSTALL & BUILD ───────────────────────────────────────────────────
step "02 / Install & Build"

if [[ -f "package.json" ]] && grep -q '"conductor-hub"' package.json 2>/dev/null; then
  CONDUCTOR_DIR="$(pwd)"
  info "Using current directory: $CONDUCTOR_DIR"
else
  CONDUCTOR_DIR="$HOME/.conductor-src"
  if [[ -d "$CONDUCTOR_DIR/.git" ]]; then
    info "Updating existing source..."
    command -v git &>/dev/null && \
      (cd "$CONDUCTOR_DIR" && git pull --ff-only --quiet 2>/dev/null) || \
      warn "git pull failed — continuing with existing source"
  elif command -v git &>/dev/null; then
    info "Cloning from GitHub..."
    run_step "Cloning conductor" \
      git clone --depth=1 --quiet https://github.com/thealxlabs/conductor.git "$CONDUCTOR_DIR" || \
      fail "Clone failed. Check your internet or run:\n  git clone https://github.com/thealxlabs/conductor.git"
  else
    fail "git not found. Clone manually:\n  git clone https://github.com/thealxlabs/conductor.git && cd conductor && bash install.sh"
  fi
fi

cd "$CONDUCTOR_DIR"

info "Installing dependencies..."
run_step "Installing dependencies" npm install --no-fund --no-audit || \
  fail "npm install failed. Run 'npm install' in $CONDUCTOR_DIR to see the error."
success "Dependencies installed"

info "Building TypeScript..."
run_step "Compiling" npm run build || \
  fail "Build failed. Run 'npm run build' in $CONDUCTOR_DIR to see the error."

# Ensure CLI is executable
chmod +x "$CONDUCTOR_DIR/dist/cli/index.js" 2>/dev/null || true
[[ -d "dist" ]] || fail "dist/ not found after build."
success "Build complete"

chmod +x dist/cli/index.js 2>/dev/null || true

info "Linking conductor command..."
CONDUCTOR_BIN=""

_try_npm_link() {
  npm link --silent 2>/dev/null || return 1
  local linked; linked=$(command -v conductor 2>/dev/null || true)
  [[ -z "$linked" ]] && return 1
  chmod +x "$linked" 2>/dev/null || true
  local real; real=$(readlink -f "$linked" 2>/dev/null || readlink "$linked" 2>/dev/null || true)
  [[ -n "$real" ]] && chmod +x "$real" 2>/dev/null || true
  CONDUCTOR_BIN="$linked"; return 0
}

_try_global_install() {
  npm install -g . --silent 2>/dev/null || \
    sudo npm install -g . --silent 2>/dev/null || return 1
  CONDUCTOR_BIN=$(command -v conductor 2>/dev/null || true)
  [[ -n "$CONDUCTOR_BIN" ]] || return 1; return 0
}

_fallback_local_bin() {
  local BIN="$HOME/.local/bin"; mkdir -p "$BIN"
  printf '#!/usr/bin/env bash\nexec node "%s/dist/cli/index.js" "$@"\n' "$CONDUCTOR_DIR" > "$BIN/conductor"
  chmod +x "$BIN/conductor"
  for RC in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    if [[ -f "$RC" ]] && ! grep -qF '.local/bin' "$RC" 2>/dev/null; then
      printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$RC"; break
    fi
  done
  export PATH="$BIN:$PATH"
  CONDUCTOR_BIN="$BIN/conductor"
  hint "Added ~/.local/bin to PATH — restart your shell or: export PATH=\"\$HOME/.local/bin:\$PATH\""
  return 0
}

if _try_npm_link; then
  success "Linked via npm link"
elif _try_global_install; then
  success "Installed globally via npm"
elif _fallback_local_bin; then
  success "Installed to ~/.local/bin/conductor"
else
  fail "Could not install conductor. Run manually:\n  node $CONDUCTOR_DIR/dist/cli/index.js"
fi

echo ""
echo -e "  ${BOLD}${GREEN}conductor${RESET} ${DIM}→ $CONDUCTOR_BIN${RESET}"

# ── STEP 3: AI PROVIDER ───────────────────────────────────────────────────────
step "03 / AI Provider  ${DIM}powers natural language${RESET}"
echo ""
echo -e "  ${CYAN}1${RESET}  ${BOLD}Claude${RESET}       ${DIM}· Anthropic   · console.anthropic.com/settings/keys${RESET}
  ${CYAN}2${RESET}  ${BOLD}OpenAI${RESET}       ${DIM}· GPT-4o      · platform.openai.com/api-keys${RESET}
  ${CYAN}3${RESET}  ${BOLD}Gemini${RESET}       ${DIM}· Google      · aistudio.google.com/apikey${RESET}
  ${CYAN}4${RESET}  ${BOLD}OpenRouter${RESET}   ${DIM}· Multi-model · openrouter.ai/keys${RESET}
  ${CYAN}5${RESET}  ${BOLD}Ollama${RESET}       ${DIM}· Local       · no API key needed${RESET}
  ${CYAN}6${RESET}  ${BOLD}Skip${RESET}         ${DIM}· configure later: conductor ai setup${RESET}
"
echo ""

prompt_input "Choose" AI_CHOICE "6"
AI_PROVIDER_SET=""

case "$AI_CHOICE" in
1)
  prompt_secret "Anthropic API key" API_KEY
  if [[ -n "$API_KEY" ]]; then
    save_cred "anthropic" "api_key" "$API_KEY"
    update_config '{"ai":{"provider":"claude"}}'
    success "Claude configured"; AI_PROVIDER_SET="claude"
  else warn "Skipped — run later: conductor ai setup"; fi ;;
2)
  prompt_secret "OpenAI API key" API_KEY
  if [[ -n "$API_KEY" ]]; then
    save_cred "openai" "api_key" "$API_KEY"
    update_config '{"ai":{"provider":"openai"}}'
    success "OpenAI configured"
    hint "This key is also used by the Memory plugin for semantic embeddings."
    AI_PROVIDER_SET="openai"
  else warn "Skipped — run later: conductor ai setup"; fi ;;
3)
  prompt_secret "Gemini API key" API_KEY
  if [[ -n "$API_KEY" ]]; then
    save_cred "gemini" "api_key" "$API_KEY"
    update_config '{"ai":{"provider":"gemini"}}'
    success "Gemini configured"; AI_PROVIDER_SET="gemini"
  else warn "Skipped — run later: conductor ai setup"; fi ;;
4)
  prompt_secret "OpenRouter API key" API_KEY
  if [[ -n "$API_KEY" ]]; then
    save_cred "openrouter" "api_key" "$API_KEY"
    update_config '{"ai":{"provider":"openrouter"}}'
    success "OpenRouter configured"
    AI_PROVIDER_SET="openrouter"
  else warn "Skipped — run later: conductor ai setup"; fi ;;
5)
  prompt_input "Ollama model" OLLAMA_MODEL "llama3.2"
  update_config "{\"ai\":{\"provider\":\"ollama\",\"model\":\"$OLLAMA_MODEL\",\"local_config\":{\"endpoint\":\"http://localhost:11434\"}}}"
  success "Ollama configured with $OLLAMA_MODEL"
  hint "Make sure Ollama is running: ollama serve"
  AI_PROVIDER_SET="ollama" ;;
*)
  warn "Skipped — run later: conductor ai setup" ;;
esac

# ── STEP 4: MEMORY PLUGIN ─────────────────────────────────────────────────────
step "04 / Memory Plugin  ${DIM}long-term context across conversations${RESET}"
hint "Stores facts, preferences, and decisions — recalled automatically by the AI"
hint "Works in keyword mode without OpenAI; semantic search requires an OpenAI key"
echo ""

if [[ "$AI_PROVIDER_SET" == "openai" ]]; then
  hint "Your OpenAI key (already set) will power semantic memory search."
  update_config '{"plugins":{"memory":{"enabled":true}}}'
  add_plugin "memory"
  success "Memory plugin enabled with semantic search"
else
  prompt_yn "Enable memory plugin?" SETUP_MEM "y"
  if [[ "$SETUP_MEM" == "true" ]]; then
    if [[ "$AI_PROVIDER_SET" != "openai" ]]; then
      prompt_yn "Add an OpenAI key for semantic search? (optional — keyword search otherwise)" WANT_OAI "n"
      if [[ "$WANT_OAI" == "true" ]]; then
        prompt_secret "OpenAI API key" OAI_KEY
        if [[ -n "$OAI_KEY" ]]; then
          save_cred "openai" "api_key" "$OAI_KEY"
          success "OpenAI key saved for embeddings"
        else
          warn "No key entered — memory will use keyword search"
        fi
      fi
    fi
    update_config '{"plugins":{"memory":{"enabled":true}}}'
    add_plugin "memory"
    success "Memory plugin enabled"
  else
    warn "Skipped — enable later: conductor plugins enable memory"
  fi
fi


# ── STEP 5: GOOGLE SERVICES ───────────────────────────────────────────────────
step "05 / Google Services  ${DIM}Gmail · Calendar · Drive${RESET}"
hint "Uses Google OAuth — same credentials as Gemini AI"
echo ""

prompt_yn "Enable Gmail, Google Calendar, and Google Drive plugins?" SETUP_GOOGLE "y"

if [[ "$SETUP_GOOGLE" == "true" ]]; then
  HAVE_GOOGLE_TOKEN="false"

  if [[ "${AI_PROVIDER_SET:-}" == "gemini" ]]; then
    HAVE_GOOGLE_TOKEN="true"
    hint "Using your Gemini Google token for Gmail/Calendar/Drive."
  else
    STORED=$(node -e "
      const p=require('path'),fs=require('fs');
      const f=p.join(process.env.HOME,'.conductor','keychain','google.access_token.enc');
      process.stdout.write(fs.existsSync(f)?'yes':'no');
    " 2>/dev/null || echo "no")
    [[ "$STORED" == "yes" ]] && HAVE_GOOGLE_TOKEN="true"
  fi

  if [[ "$HAVE_GOOGLE_TOKEN" != "true" ]]; then
    echo ""
    echo -e "  ${DIM}We've made Google setup much easier!${RESET}"
    echo -e "  ${DIM}After installation, just run: ${CYAN}conductor auth google${RESET}"
    echo -e "  ${DIM}It will open your browser and handle everything for you.${RESET}"
    echo ""
  fi

  update_config '{"plugins":{"gmail":{"enabled":true},"gcal":{"enabled":true},"gdrive":{"enabled":true}}}'
  add_plugin "gmail"; add_plugin "gcal"; add_plugin "gdrive"
  success "Gmail, Calendar, and Drive plugins enabled"
  [[ "$HAVE_GOOGLE_TOKEN" != "true" ]] && hint "Authenticate later with: conductor auth google"

else
  warn "Skipped — enable later: conductor plugins enable gmail gcal gdrive"
fi

# ── STEP 6: NOTION ────────────────────────────────────────────────────────────
step "06 / Notion  ${DIM}optional${RESET}"
hint "Read and write Notion pages and databases"
hint "Get your integration token at: https://www.notion.so/my-integrations"
echo ""

prompt_yn "Set up Notion?" SETUP_NOTION "n"
if [[ "$SETUP_NOTION" == "true" ]]; then
  prompt_secret "Notion Integration Token (ntn_...)" NOTION_TOKEN
  if [[ -n "$NOTION_TOKEN" ]]; then
    info "Verifying token..."
    NOTION_STATUS="unknown"
    if command -v curl &>/dev/null; then
      NOTION_STATUS=$(curl -sf --max-time 8 \
        -X POST "https://api.notion.com/v1/search" \
        -H "Authorization: Bearer ${NOTION_TOKEN}" \
        -H "Notion-Version: 2022-06-28" \
        -H "Content-Type: application/json" \
        -d '{"query":"","page_size":1}' 2>/dev/null \
        | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if 'results' in d else 'fail')" 2>/dev/null \
        || echo "fail")
    fi
    if [[ "$NOTION_STATUS" == "ok" ]]; then
      save_cred "notion" "api_key" "$NOTION_TOKEN"
      update_config '{"plugins":{"notion":{"enabled":true}}}'
      add_plugin "notion"
      success "Notion connected"
      hint "Share pages with your integration in Notion's connection settings."
    else
      warn "Verification failed (bad token or no internet)."
      prompt_yn "Save token anyway?" SAVE_NOTION "n"
      if [[ "$SAVE_NOTION" == "true" ]]; then
        save_cred "notion" "api_key" "$NOTION_TOKEN"
        update_config '{"plugins":{"notion":{"enabled":true}}}'
        add_plugin "notion"
        warn "Saved unverified."
      fi
    fi
  else
    warn "Skipped — run later: conductor plugins config notion token <TOKEN>"
  fi
fi

# ── STEP 7: X (TWITTER) ───────────────────────────────────────────────────────
step "07 / X  ${DIM}optional${RESET}"
hint "Search tweets, get timelines, post — requires X Developer account"
hint "Get credentials at: https://developer.x.com"
echo ""

prompt_yn "Set up X?" SETUP_X "n"
if [[ "$SETUP_X" == "true" ]]; then
  echo ""
  echo -e "  ${CYAN}1${RESET}  ${BOLD}Read-only${RESET}  ${DIM}· Bearer Token only · search + timelines${RESET}"
  echo -e "  ${CYAN}2${RESET}  ${BOLD}Full access${RESET} ${DIM}· Bearer + OAuth 1.0a · also post/like/delete${RESET}"
  echo ""
  prompt_input "Choose" X_LEVEL "1"
  prompt_secret "Bearer Token" X_BEARER
  if [[ -n "$X_BEARER" ]]; then
    info "Verifying bearer token..."
    X_OK="fail"
    if command -v curl &>/dev/null; then
      X_OK=$(curl -sf --max-time 8 \
        "https://api.twitter.com/2/users/by/username/x" \
        -H "Authorization: Bearer ${X_BEARER}" 2>/dev/null \
        | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if 'data' in d else 'fail')" 2>/dev/null \
        || echo "fail")
    fi
    save_cred "x" "bearer_token" "$X_BEARER"
    [[ "$X_OK" == "ok" ]] && success "X Bearer Token verified" || warn "Could not verify token — saved anyway"

    if [[ "$X_LEVEL" == "2" ]]; then
      echo ""; hint "OAuth 1.0a credentials for write access:"
      prompt_secret "API Key (Consumer Key)" X_API_KEY
      prompt_secret "API Secret (Consumer Secret)" X_API_SECRET
      prompt_secret "Access Token" X_ACCESS_TOKEN
      prompt_secret "Access Token Secret" X_ACCESS_SECRET
      if [[ -n "$X_API_KEY" ]]; then save_cred "x" "api_key" "$X_API_KEY"; fi
      if [[ -n "$X_API_SECRET" ]]; then save_cred "x" "api_secret" "$X_API_SECRET"; fi
      if [[ -n "$X_ACCESS_TOKEN" ]]; then save_cred "x" "access_token" "$X_ACCESS_TOKEN"; fi
      if [[ -n "$X_ACCESS_SECRET" ]]; then save_cred "x" "access_secret" "$X_ACCESS_SECRET"; fi
      [[ -n "$X_API_KEY" && -n "$X_API_SECRET" && -n "$X_ACCESS_TOKEN" && -n "$X_ACCESS_SECRET" ]] && \
        success "X write credentials saved" || warn "Some fields empty — write access may not work"
    fi

    update_config '{"plugins":{"x":{"enabled":true}}}'
    add_plugin "x"
    success "X plugin enabled"
  else
    warn "Skipped — run later: conductor plugins config x bearer_token <TOKEN>"
  fi
fi

# ── STEP 8: SPOTIFY ───────────────────────────────────────────────────────────
step "08 / Spotify  ${DIM}optional${RESET}"
hint "Playback control, search, playlists, recommendations"
hint "Get credentials at: https://developer.spotify.com/dashboard"
echo ""

prompt_yn "Set up Spotify?" SETUP_SPOTIFY "n"
if [[ "$SETUP_SPOTIFY" == "true" ]]; then
  echo ""
  echo -e "  ${DIM}Create an app at ${CYAN}https://developer.spotify.com/dashboard${RESET}"
  echo -e "  ${DIM}Add redirect URI: ${CYAN}http://localhost:4839/spotify/callback${RESET}"
  echo -e "  ${DIM}Copy the Client ID and Access Token from your app dashboard${RESET}"
  echo ""
  prompt_secret "Spotify Client ID" SPOTIFY_CLIENT_ID
  prompt_secret "Spotify Access Token" SPOTIFY_TOKEN
  if [[ -n "$SPOTIFY_TOKEN" ]]; then
    # Quick verify
    SPOTIFY_OK="fail"
    if command -v curl &>/dev/null && [[ -n "$SPOTIFY_TOKEN" ]]; then
      SPOTIFY_OK=$(curl -sf --max-time 8 \
        "https://api.spotify.com/v1/me" \
        -H "Authorization: Bearer ${SPOTIFY_TOKEN}" 2>/dev/null \
        | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if 'id' in d else 'fail')" 2>/dev/null \
        || echo "fail")
    fi
    save_cred "spotify" "access_token" "$SPOTIFY_TOKEN"
    [[ -n "$SPOTIFY_CLIENT_ID" ]] && save_cred "spotify" "client_id" "$SPOTIFY_CLIENT_ID"
    [[ "$SPOTIFY_OK" == "ok" ]] && success "Spotify connected" || warn "Token saved (could not verify — may need refresh)"
    update_config '{"plugins":{"spotify":{"enabled":true}}}'
    add_plugin "spotify"
    hint "Tokens expire after 1hr. Re-run to refresh: conductor plugins config spotify access_token <NEW_TOKEN>"
  else
    warn "Skipped — run later: conductor plugins config spotify access_token <TOKEN>"
  fi
fi

# ── STEP 9: GITHUB ACTIONS ────────────────────────────────────────────────────
step "09 / GitHub Actions & CI  ${DIM}optional${RESET}"
hint "PRs, issues, workflow runs, releases, notifications — needs PAT"
hint "Create token: https://github.com/settings/tokens"
echo ""

# Check if we already have a GitHub token from earlier steps
GH_TOKEN_STORED=$(node -e "
  const p=require('path'),fs=require('fs');
  const f=p.join(process.env.HOME,'.conductor','keychain','github.token.enc');
  process.stdout.write(fs.existsSync(f)?'yes':'no');
" 2>/dev/null || echo "no")

if [[ "$GH_TOKEN_STORED" == "yes" ]]; then
  info "GitHub token already stored — enabling GitHub Actions plugin"
  update_config '{"plugins":{"github_actions":{"enabled":true}}}'
  add_plugin "github_actions"
  success "GitHub Actions plugin enabled"
else
  prompt_yn "Set up GitHub Actions plugin?" SETUP_GH_ACTIONS "n"
  if [[ "$SETUP_GH_ACTIONS" == "true" ]]; then
    echo ""
    echo -e "  ${DIM}Scopes needed: ${CYAN}repo, workflow, notifications, read:user${RESET}"
    echo ""
    prompt_secret "GitHub Personal Access Token" GH_PAT
    if [[ -n "$GH_PAT" ]]; then
      GH_OK="fail"
      if command -v curl &>/dev/null; then
        GH_OK=$(curl -sf --max-time 8 \
          "https://api.github.com/user" \
          -H "Authorization: Bearer ${GH_PAT}" \
          -H "Accept: application/vnd.github+json" 2>/dev/null \
          | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if 'login' in d else 'fail')" 2>/dev/null \
          || echo "fail")
      fi
      if [[ "$GH_OK" == "ok" ]]; then
        save_cred "github" "token" "$GH_PAT"
        success "GitHub token verified and saved"
      else
        warn "Verification failed — saving anyway"
        save_cred "github" "token" "$GH_PAT"
      fi
      update_config '{"plugins":{"github_actions":{"enabled":true}}}'
      add_plugin "github_actions"
      success "GitHub Actions plugin enabled"
    else
      warn "Skipped — run later: conductor plugins config github_actions token <TOKEN>"
    fi
  fi
fi

# ── STEP 10: VERCEL ───────────────────────────────────────────────────────────
step "10 / Vercel  ${DIM}optional${RESET}"
hint "Deployments, projects, domains, env vars, logs"
hint "Get token: https://vercel.com/account/tokens"
echo ""

prompt_yn "Set up Vercel?" SETUP_VERCEL "n"
if [[ "$SETUP_VERCEL" == "true" ]]; then
  prompt_secret "Vercel Token" VERCEL_TOKEN
  if [[ -n "$VERCEL_TOKEN" ]]; then
    VERCEL_OK="fail"
    if command -v curl &>/dev/null; then
      VERCEL_OK=$(curl -sf --max-time 8 \
        "https://api.vercel.com/v2/user" \
        -H "Authorization: Bearer ${VERCEL_TOKEN}" 2>/dev/null \
        | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if 'user' in d or 'id' in d else 'fail')" 2>/dev/null \
        || echo "fail")
    fi
    save_cred "vercel" "token" "$VERCEL_TOKEN"
    [[ "$VERCEL_OK" == "ok" ]] && success "Vercel connected" || warn "Token saved (could not verify)"
    prompt_yn "Are you on a Vercel team? (configure team scope)" VERCEL_TEAM "n"
    if [[ "$VERCEL_TEAM" == "true" ]]; then
      prompt_input "Team ID or slug" VERCEL_TEAM_ID ""
      [[ -n "$VERCEL_TEAM_ID" ]] && save_cred "vercel" "team_id" "$VERCEL_TEAM_ID"
    fi
    update_config '{"plugins":{"vercel":{"enabled":true}}}'
    add_plugin "vercel"
    success "Vercel plugin enabled"
  else
    warn "Skipped — run later: conductor plugins config vercel token <TOKEN>"
  fi
fi

# ── STEP 11: N8N ──────────────────────────────────────────────────────────────
step "11 / n8n Automation  ${DIM}optional${RESET}"
hint "Trigger workflows, inspect executions, fire webhooks"
hint "Works with self-hosted and n8n Cloud"
echo ""

prompt_yn "Set up n8n?" SETUP_N8N "n"
if [[ "$SETUP_N8N" == "true" ]]; then
  prompt_input "n8n instance URL" N8N_URL "http://localhost:5678"
  prompt_secret "n8n API Key (Settings → API → Create Key)" N8N_KEY
  if [[ -n "$N8N_KEY" ]]; then
    # Normalise URL
    N8N_BASE="${N8N_URL%/}/api/v1"
    N8N_OK="fail"
    if command -v curl &>/dev/null; then
      N8N_OK=$(curl -sf --max-time 10 \
        "${N8N_BASE}/health" \
        -H "X-N8N-API-KEY: ${N8N_KEY}" 2>/dev/null \
        | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if d.get('status')=='ok' or 'status' in d else 'fail')" 2>/dev/null \
        || echo "fail")
    fi
    save_cred "n8n" "api_key" "$N8N_KEY"
    save_cred "n8n" "base_url" "$N8N_URL"
    [[ "$N8N_OK" == "ok" ]] && success "n8n connected at ${N8N_URL}" || warn "Saved (could not verify — check URL and key)"
    update_config '{"plugins":{"n8n":{"enabled":true}}}'
    add_plugin "n8n"
    success "n8n plugin enabled"
  else
    warn "Skipped — run later:"
    hint "  conductor plugins config n8n api_key <KEY>"
    hint "  conductor plugins config n8n base_url <URL>"
  fi
fi

# ── STEP 12: NOTES & SCHEDULER ────────────────────────────────────────────────
step "12 / Notes & Scheduler  ${DIM}local, no API keys${RESET}"
hint "Notes: local markdown notes the AI can read/write/search"
hint "Scheduler: natural language cron — 'every day at 9am', 'in 30 minutes'"
echo ""

update_config '{"plugins":{"notes":{"enabled":true},"cron":{"enabled":true}}}'
add_plugin "notes"; add_plugin "cron"
success "Notes and Scheduler enabled (stored in ~/.conductor/notes/ and ~/.conductor/scheduler.json)"

# ── STEP 13: TELEGRAM ──────────────────────────────────────────────────────────
step "13 / Telegram Bot  ${DIM}optional${RESET}"
hint "Chat with your AI from Telegram — @BotFather → /newbot to get a token"
echo ""

prompt_yn "Set up Telegram?" SETUP_TG "n"

if [[ "$SETUP_TG" == "true" ]]; then
  prompt_secret "Bot token" TG_TOKEN
  if [[ -n "$TG_TOKEN" ]]; then
    TG_VERIFIED="false"
    if command -v curl &>/dev/null; then
      info "Verifying token..."
      TG_RESP=$(curl -sf --max-time 8 --retry 2 --retry-delay 1 \
        "https://api.telegram.org/bot${TG_TOKEN}/getMe" 2>/dev/null || echo '{"ok":false}')
      TG_OK=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print('y' if d.get('ok') else 'n')" "$TG_RESP" 2>/dev/null || echo "n")
      TG_NAME=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('result',{}).get('username',''))" "$TG_RESP" 2>/dev/null || echo "")
      if [[ "$TG_OK" == "y" ]]; then
        save_cred "telegram" "bot_token" "$TG_TOKEN"
        update_config '{"telegram":{"enabled":true}}'
        success "Telegram connected — @${TG_NAME}"
        TG_VERIFIED="true"
      else
        warn "Token verification failed (bad token or no internet)."
        prompt_yn "Save token anyway?" SAVE_TG_ANYWAY "n"
        if [[ "$SAVE_TG_ANYWAY" == "true" ]]; then
          save_cred "telegram" "bot_token" "$TG_TOKEN"
          update_config '{"telegram":{"enabled":true}}'
          warn "Token saved unverified — run: conductor telegram start"
        fi
      fi
    else
      save_cred "telegram" "bot_token" "$TG_TOKEN"
      update_config '{"telegram":{"enabled":true}}'
      warn "Saved without verification (curl not found) — run: conductor telegram start"
    fi
  else
    warn "Skipped — run later: conductor telegram setup"
  fi
fi

# ── STEP 14: SLACK BOT ────────────────────────────────────────────────────────
step "14 / Slack Bot  ${DIM}optional${RESET}"
hint "Socket Mode — api.slack.com/apps → Create App → Event Subscriptons"
echo ""

prompt_yn "Set up Slack Bot?" SETUP_SLACK "n"
if [[ "$SETUP_SLACK" == "true" ]]; then
  echo -e "  To get tokens, go to ${BOLD}api.slack.com/apps${RESET}:"
  echo -e "  1. ${DIM}Create App (From Scratch)${RESET}"
  echo -e "  2. ${DIM}Bot User OAuth Token (xoxb-...) in 'OAuth & Permissions'${RESET}"
  echo -e "  3. ${DIM}App-Level Token (xapp-...) in 'Basic Information' -> 'App-Level Tokens'${RESET}"
  echo ""
  
  prompt_secret "Slack Bot OAuth Token (xoxb-)" SLACK_BOT_TOKEN
  prompt_secret "Slack App-Level Token (xapp-)" SLACK_APP_TOKEN
  
  if [[ -n "$SLACK_BOT_TOKEN" && -n "$SLACK_APP_TOKEN" ]]; then
    save_cred "slack" "bot_token" "$SLACK_BOT_TOKEN"
    save_cred "slack" "app_token" "$SLACK_APP_TOKEN"
    update_config '{"plugins":{"slack":{"enabled":true}}}'
    success "Slack tokens saved"
  else
    warn "Missing tokens — skipped Slack setup"
  fi
else
  warn "Skipped — run later: conductor slack setup"
fi

# ── STEP 15: MCP ───────────────────────────────────────────────────────────────
step "15 / MCP Server  ${DIM}Claude Desktop integration${RESET}"

prompt_yn "Configure MCP for Claude Desktop?" SETUP_MCP "y"

if [[ "$SETUP_MCP" == "true" ]]; then
  case "$PLATFORM" in
    macos)   MCP_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json" ;;
    linux)   MCP_CONFIG="$HOME/.config/Claude/claude_desktop_config.json" ;;
    windows) MCP_CONFIG="${APPDATA:-$HOME/AppData/Roaming}/Claude/claude_desktop_config.json" ;;
    *)       MCP_CONFIG="" ;;
  esac

  if [[ -n "$MCP_CONFIG" ]]; then
    mkdir -p "$(dirname "$MCP_CONFIG")"
    CONDUCTOR_CLI="${CONDUCTOR_BIN:-conductor}"

    # Backup existing config
    if [[ -f "$MCP_CONFIG" ]]; then
      cp "$MCP_CONFIG" "${MCP_CONFIG}.bak" 2>/dev/null && \
        hint "Backed up existing Claude Desktop config to ${MCP_CONFIG}.bak"
    fi

    # Atomic update via Node — no stdin/pipes
    node -e "
      const fs = require('fs');
      const [,, configPath, conductorCmd] = process.argv;
      let config = {};
      try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
      if (!config.mcpServers) config.mcpServers = {};
      if (conductorCmd.startsWith('node ')) {
        const scriptPath = conductorCmd.split(' ').slice(1).join(' ');
        config.mcpServers.conductor = { command: 'node', args: [scriptPath, 'mcp', 'start'] };
      } else {
        config.mcpServers.conductor = { command: conductorCmd, args: ['mcp', 'start'] };
      }
      const tmp = configPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
      fs.renameSync(tmp, configPath);
    " "$MCP_CONFIG" "$CONDUCTOR_CLI" && \
      success "MCP configured for Claude Desktop" && \
      hint "Restart Claude Desktop to connect" || \
      warn "MCP config update failed — run manually: conductor mcp setup"
  else
    warn "Could not detect Claude Desktop config path for: $PLATFORM"
    hint "Run manually: conductor mcp setup"
  fi
fi

# ── DONE ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}${CYAN}┌──────────────────────────────────────────────${RESET}"
echo -e "  ${BOLD}${CYAN}│  ${GREEN}✓  Installation Complete${RESET}"
echo -e "  ${BOLD}${CYAN}└──────────────────────────────────────────────${RESET}"
echo ""
echo -e "  ${BOLD}Get started:${RESET}"
echo ""
echo -e "    ${CYAN}conductor status${RESET}            — Check your setup"
echo -e "    ${CYAN}conductor ai test${RESET}            — Test AI provider"
echo -e "    ${CYAN}conductor telegram start${RESET}     — Start Telegram bot"
echo -e "    ${CYAN}conductor telegram start${RESET}     — Start Telegram bot"
echo -e "    ${CYAN}conductor slack start${RESET}        — Start Slack bot"
echo -e "    ${CYAN}conductor mcp start${RESET}           — Start MCP server"
echo ""
echo -e "  ${DIM}Docs: https://github.com/thealxlabs/conductor${RESET}"
echo ""
