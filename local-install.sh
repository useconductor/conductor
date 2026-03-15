#!/usr/bin/env bash
# ============================================================
# Conductor Local Install Script — by TheAlxLabs
# ============================================================
# Use this if you have modified the code and want to install
# your local version globally.
#
#   bash local-install.sh
# ============================================================
set -euo pipefail
IFS=$'\n\t'

# ── Terminal colours ──────────────────────────────────────────
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

# ── Cleanup ───────────────────────────────────────────────────
_TMPFILES=()
cleanup() {
  for f in "${_TMPFILES[@]:-}"; do
    if [[ -f "$f" ]]; then
      dd if=/dev/zero of="$f" bs=1 count="$(wc -c < "$f")" 2>/dev/null || true
      rm -f "$f" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT

# ── Prompt helpers ────────────────────────────────────────────
prompt_yn() {
  local prompt="$1" varname="$2" default="${3:-y}"
  local hint_str="Y/n"; [[ "$default" == "n" ]] && hint_str="y/N"
  printf "  ${CYAN}?${RESET} ${BOLD}%s${RESET} ${DIM}[%s]${RESET}: " "$prompt" "$hint_str" >/dev/tty
  local _val; IFS= read -r _val </dev/tty || _val=""
  _val="${_val:-$default}"
  if [[ "$_val" =~ ^[Yy] ]]; then printf -v "$varname" '%s' "true"
  else printf -v "$varname" '%s' "false"; fi
}

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

prompt_secret() {
  local prompt="$1" varname="$2"
  printf "  ${CYAN}?${RESET} ${BOLD}%s${RESET}: " "$prompt" >/dev/tty
  local _sec; IFS= read -rs _sec </dev/tty || _sec=""
  echo "" >/dev/tty
  printf -v "$varname" '%s' "$_sec"
}

# ── Config helpers ────────────────────────────────────────────
CONFIG_DIR="$HOME/.conductor"
CONFIG_FILE="$CONFIG_DIR/config.json"

ensure_dirs() {
  mkdir -p "$CONFIG_DIR"/{keychain,plugins,logs}
  chmod 700 "$CONFIG_DIR/keychain"
  chmod 700 "$CONFIG_DIR"
}

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

# Pipes value via stdin — never exposed in process list (ps aux fix)
save_cred_val() {
  local service="$1" key="$2" value="$3"
  printf '%s' "$value" | node - "$CONFIG_DIR" "$service" "$key" << 'JSEOF'
const crypto=require('crypto'),fs=require('fs'),path=require('path'),os=require('os'),{execSync}=require('child_process');
const [,,configDir,service,key]=process.argv;
let val='';
try{val=fs.readFileSync('/dev/stdin','utf8').trim();}catch{process.exit(1);}
const kd=path.join(configDir,'keychain'); fs.mkdirSync(kd,{recursive:true,mode:0o700});
function ms(){
  for(const s of['/etc/machine-id','/var/lib/dbus/machine-id'])try{const d=fs.readFileSync(s,'utf8').trim();if(d)return d}catch{}
  if(process.platform==='darwin')try{const o=execSync("ioreg -rd1 -c IOPlatformExpertDevice|awk '/IOPlatformUUID/{print $NF}'",{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim().replace(/"/g,'');if(o)return o}catch{}
  const f=path.join(kd,'machine_secret');
  try{const d=fs.readFileSync(f,'utf8').trim();if(d)return d}catch{}
  try{const s=crypto.randomUUID();fs.writeFileSync(f,s,{mode:0o600});return s}catch{}
  throw new Error('Cannot derive machine ID for keychain encryption');
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

# ── Header ────────────────────────────────────────────────────
clear 2>/dev/null || true
echo -e "  ${BOLD}${CYAN}Conductor Local Installer${RESET}"
echo -e "  ${DIM}Installing from: $(pwd)${RESET}"
echo ""

# ── Step 1: Preflight ─────────────────────────────────────────
step "01 / Preflight Check"

[[ -f "package.json" ]] || fail "No package.json found. Run this script in the conductor source directory."

command -v node &>/dev/null || fail "Node.js not found. Install v18+ from https://nodejs.org"
NODE_RAW=$(node --version 2>/dev/null || echo "v0")
NODE_VER="${NODE_RAW#v}"; NODE_MAJOR="${NODE_VER%%.*}"
[[ -z "$NODE_MAJOR" ]] && fail "Could not determine Node.js version from: $NODE_RAW"
[[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] && (( NODE_MAJOR >= 18 )) || \
  fail "Node.js v18+ required (found $NODE_RAW). Upgrade at https://nodejs.org"
success "Node.js $NODE_RAW"

command -v npm &>/dev/null || fail "npm not found. Reinstall Node.js from https://nodejs.org"
success "npm $(npm --version)"

ensure_dirs
success "Config dirs ready ($CONFIG_DIR)"

# ── Step 2: Build ─────────────────────────────────────────────
step "02 / Build from Source"

info "Installing dependencies..."
npm install || fail "npm install failed"

info "Building project..."
npm run build || fail "Build failed"

chmod +x "dist/cli/index.js" 2>/dev/null || true
success "Build complete"

# ── Step 3: Link ──────────────────────────────────────────────
step "03 / Global Install"

info "Linking globally..."
if npm link --silent 2>/dev/null || sudo npm link --silent 2>/dev/null; then
  success "Linked globally via 'npm link'"
else
  warn "npm link failed. Attempting global install..."
  if npm install -g . 2>/dev/null || sudo npm install -g . 2>/dev/null; then
    success "Installed globally via 'npm install -g .'"
  else
    LOCAL_BIN="$HOME/.local/bin"
    mkdir -p "$LOCAL_BIN"
    printf '#!/usr/bin/env bash\nexec node "%s/dist/cli/index.js" "$@"\n' "$(pwd)" > "$LOCAL_BIN/conductor"
    chmod +x "$LOCAL_BIN/conductor"
    export PATH="$LOCAL_BIN:$PATH"
    success "Installed to ~/.local/bin/conductor"
    hint "Add to PATH permanently: export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi
fi

# ── Step 4: Configuration ─────────────────────────────────────
step "04 / Configuration"

echo ""
echo -e "  ${CYAN}1${RESET}  ${BOLD}Claude${RESET}       ${DIM}· console.anthropic.com/settings/keys${RESET}
  ${CYAN}2${RESET}  ${BOLD}OpenAI${RESET}       ${DIM}· platform.openai.com/api-keys${RESET}
  ${CYAN}3${RESET}  ${BOLD}Gemini${RESET}       ${DIM}· aistudio.google.com/apikey${RESET}
  ${CYAN}4${RESET}  ${BOLD}OpenRouter${RESET}   ${DIM}· openrouter.ai/keys${RESET}
  ${CYAN}5${RESET}  ${BOLD}Ollama${RESET}       ${DIM}· local, no key needed${RESET}
  ${CYAN}6${RESET}  ${BOLD}Skip${RESET}
"
prompt_input "Choose AI Provider" AI_CHOICE "6"

case "$AI_CHOICE" in
1)
  prompt_secret "Anthropic API key" API_KEY
  if [[ -n "$API_KEY" ]]; then
    save_cred_val "anthropic" "api_key" "$API_KEY"
    update_config '{"ai":{"provider":"claude"}}'
    success "Claude configured"
  else warn "Skipped"; fi ;;
2)
  prompt_secret "OpenAI API key" API_KEY
  if [[ -n "$API_KEY" ]]; then
    save_cred_val "openai" "api_key" "$API_KEY"
    update_config '{"ai":{"provider":"openai"}}'
    success "OpenAI configured"
  else warn "Skipped"; fi ;;
3)
  prompt_secret "Gemini API key" API_KEY
  if [[ -n "$API_KEY" ]]; then
    save_cred_val "gemini" "api_key" "$API_KEY"
    update_config '{"ai":{"provider":"gemini"}}'
    success "Gemini configured"
  else warn "Skipped"; fi ;;
4)
  prompt_secret "OpenRouter API key" API_KEY
  if [[ -n "$API_KEY" ]]; then
    save_cred_val "openrouter" "api_key" "$API_KEY"
    update_config '{"ai":{"provider":"openrouter"}}'
    success "OpenRouter configured"
  else warn "Skipped"; fi ;;
5)
  prompt_input "Ollama model" OLLAMA_MODEL "llama3.2"
  OLLAMA_JSON=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$OLLAMA_MODEL")
  update_config "{\"ai\":{\"provider\":\"ollama\",\"model\":${OLLAMA_JSON}}}"
  success "Ollama configured ($OLLAMA_MODEL)"
  hint "Make sure Ollama is running: ollama serve" ;;
*)
  warn "Skipped — run later: conductor ai setup" ;;
esac

# ── Step 5: Bots ──────────────────────────────────────────────
step "05 / Bot Setup  ${DIM}optional${RESET}"

prompt_yn "Set up Telegram bot?" SETUP_TG "n"
if [[ "$SETUP_TG" == "true" ]]; then
  prompt_secret "Telegram Bot Token" TG_TOKEN
  if [[ -n "$TG_TOKEN" ]]; then
    save_cred_val "telegram" "bot_token" "$TG_TOKEN"
    update_config '{"telegram":{"enabled":true}}'
    success "Telegram configured"
    hint "Start with: conductor telegram start"
  fi
fi

prompt_yn "Set up Slack bot?" SETUP_SLACK "n"
if [[ "$SETUP_SLACK" == "true" ]]; then
  prompt_secret "Slack Bot OAuth Token (xoxb-)" SLACK_BOT_TOKEN
  prompt_secret "Slack App-Level Token (xapp-)" SLACK_APP_TOKEN
  if [[ -n "$SLACK_BOT_TOKEN" && -n "$SLACK_APP_TOKEN" ]]; then
    save_cred_val "slack" "bot_token" "$SLACK_BOT_TOKEN"
    save_cred_val "slack" "app_token" "$SLACK_APP_TOKEN"
    update_config '{"plugins":{"slack":{"enabled":true}}}'
    success "Slack configured"
    hint "Start with: conductor slack start"
  fi
fi

# ── Done ──────────────────────────────────────────────────────
echo ""
echo -e "  ${GREEN}${BOLD}✓ Local installation complete!${RESET}"
echo ""
echo -e "  ${CYAN}conductor status${RESET}         — check your setup"
echo -e "  ${CYAN}conductor auth google${RESET}    — connect Gmail/Calendar/Drive"
echo -e "  ${CYAN}conductor dashboard${RESET}      — open web dashboard"
echo -e "  ${CYAN}conductor ai test${RESET}        — test AI provider"
echo ""