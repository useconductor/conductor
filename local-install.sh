#!/usr/bin/env bash
# ============================================================
# Conductor Local Install Script — by TheAlxLabs
# ============================================================
# This script installs Conductor from the current source directory.
# Use this if you have modified the code and want to install your 
# local version globally.
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
  RESET='\033[0m'
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

# ── Cleanup ───────────────────────────────────────────────────────────────────
_TMPFILES=()
cleanup() {
  for f in "${_TMPFILES[@]:-}"; do
    [[ -f "$f" ]] && rm -f "$f" 2>/dev/null || true
  done
}
trap cleanup EXIT

# ── Prompt helpers ────────────────────────────────────────────────────────────
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

# Encrypt with AES-256-GCM, machine-keyed, v2 format
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

# ── HEADER ────────────────────────────────────────────────────────────────────
clear 2>/dev/null || true
echo -e "  ${BOLD}${CYAN}Conductor Local Installer${RESET}"
echo -e "  ${DIM}Installing from: $(pwd)${RESET}"
echo ""

# ── STEP 1: PREFLIGHT ─────────────────────────────────────────────────────────
step "01 / Preflight Check"

[[ -f "package.json" ]] || fail "No package.json found. Run this script in the conductor directory."

command -v node &>/dev/null || fail "Node.js not found."
command -v npm &>/dev/null || fail "npm not found."

# ── STEP 2: BUILD ─────────────────────────────────────────────────────────────
step "02 / Build from Source"

info "Installing dependencies..."
npm install || fail "npm install failed"

info "Building project..."
npm run build || fail "Build failed"

# Ensure CLI is executable
chmod +x "dist/cli/index.js" 2>/dev/null || true

# ── STEP 3: LINK ──────────────────────────────────────────────────────────────
step "03 / Global Install"

info "Linking globally..."
if npm link --silent 2>/dev/null || sudo npm link --silent 2>/dev/null; then
  success "Linked globally via 'npm link'"
else
  warn "npm link failed. Attempting global install..."
  if npm install -g . || sudo npm install -g .; then
    success "Installed globally via 'npm install -g .'"
  else
    fail "Could not install globally. Try running: sudo npm link"
  fi
fi

# ── STEP 4: CONFIG ────────────────────────────────────────────────────────────
step "04 / Configuration"
ensure_dirs
success "Configuration directories ready ($CONFIG_DIR)"

echo ""
echo -e "  ${CYAN}1${RESET}  ${BOLD}Claude${RESET}       ${DIM}· Anthropic   · console.anthropic.com/settings/keys${RESET}
  ${CYAN}2${RESET}  ${BOLD}OpenAI${RESET}       ${DIM}· GPT-4o      · platform.openai.com/api-keys${RESET}
  ${CYAN}3${RESET}  ${BOLD}Gemini${RESET}       ${DIM}· Google      · aistudio.google.com/apikey${RESET}
  ${CYAN}4${RESET}  ${BOLD}OpenRouter${RESET}   ${DIM}· Multi-model · openrouter.ai/keys${RESET}
  ${CYAN}5${RESET}  ${BOLD}Ollama${RESET}       ${DIM}· Local       · no API key needed${RESET}
  ${CYAN}6${RESET}  ${BOLD}Skip${RESET}         ${DIM}· configure later: conductor ai setup${RESET}
"
echo ""

prompt_input "Choose AI Provider" AI_CHOICE "6"
AI_PROVIDER_SET=""

case "$AI_CHOICE" in
1)
  prompt_secret "Anthropic API key" API_KEY
  if [[ -n "$API_KEY" ]]; then
    save_cred "anthropic" "api_key" "$API_KEY"
    update_config '{"ai":{"provider":"claude"}}'
    success "Claude configured"; AI_PROVIDER_SET="claude"
  else warn "Skipped"; fi ;;
2)
  prompt_secret "OpenAI API key" API_KEY
  if [[ -n "$API_KEY" ]]; then
    save_cred "openai" "api_key" "$API_KEY"
    update_config '{"ai":{"provider":"openai"}}'
    success "OpenAI configured"; AI_PROVIDER_SET="openai"
  else warn "Skipped"; fi ;;
3)
  prompt_secret "Gemini API key" API_KEY
  if [[ -n "$API_KEY" ]]; then
    save_cred "gemini" "api_key" "$API_KEY"
    update_config '{"ai":{"provider":"gemini"}}'
    success "Gemini configured"; AI_PROVIDER_SET="gemini"
  else warn "Skipped"; fi ;;
4)
  prompt_secret "OpenRouter API key" API_KEY
  if [[ -n "$API_KEY" ]]; then
    save_cred "openrouter" "api_key" "$API_KEY"
    update_config '{"ai":{"provider":"openrouter"}}'
    success "OpenRouter configured"; AI_PROVIDER_SET="openrouter"
  else warn "Skipped"; fi ;;
5)
  prompt_input "Ollama model" OLLAMA_MODEL "llama3.2"
  update_config "{\"ai\":{\"provider\":\"ollama\",\"model\":\"$OLLAMA_MODEL\"}}"
  success "Ollama configured"; AI_PROVIDER_SET="ollama" ;;
*)
  warn "Skipped" ;;
esac

# ── STEP 5: BOT SETUP ─────────────────────────────────────────────────────────
step "05 / Bot Setup"
prompt_yn "Set up Telegram bot?" SETUP_TG "n"
if [[ "$SETUP_TG" == "true" ]]; then
  prompt_secret "Telegram Bot Token" TG_TOKEN
  if [[ -n "$TG_TOKEN" ]]; then
    save_cred "telegram" "bot_token" "$TG_TOKEN"
    update_config '{"telegram":{"enabled":true}}'
    success "Telegram configured"
  fi
fi

prompt_yn "Set up Slack bot?" SETUP_SLACK "n"
if [[ "$SETUP_SLACK" == "true" ]]; then
  prompt_secret "Slack Bot OAuth Token (xoxb-)" SLACK_BOT_TOKEN
  prompt_secret "Slack App-Level Token (xapp-)" SLACK_APP_TOKEN
  if [[ -n "$SLACK_BOT_TOKEN" && -n "$SLACK_APP_TOKEN" ]]; then
    save_cred "slack" "bot_token" "$SLACK_BOT_TOKEN"
    save_cred "slack" "app_token" "$SLACK_APP_TOKEN"
    update_config '{"plugins":{"slack":{"enabled":true}}}'
    success "Slack configured"
  fi
fi

# ── DONE ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${GREEN}${BOLD}✓ Local installation complete!${RESET}"
echo ""
echo -e "  You can now run ${CYAN}conductor${RESET} from anywhere."
echo -e "  Try ${CYAN}conductor status${RESET} to check your settings."
echo ""
