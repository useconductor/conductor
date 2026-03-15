# ============================================================
# Conductor Install Script (Windows PowerShell)
# ============================================================
# Usage:
#   irm https://conductor.thealxlabs.ca/install.ps1 | iex
# Or locally:
#   .\install.ps1
# ============================================================

$ErrorActionPreference = "Stop"

function Info($msg)    { Write-Host "  ▶ $msg" -ForegroundColor Cyan }
function Success($msg) { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Warn($msg)    { Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Fail($msg)    { Write-Host "  ✗ FATAL: $msg" -ForegroundColor Red; exit 1 }
function Step($msg)    {
    Write-Host "`n  ┌──────────────────────────────────────────────" -ForegroundColor Cyan
    Write-Host "  │  $msg" -ForegroundColor Cyan
    Write-Host "  └──────────────────────────────────────────────" -ForegroundColor Cyan
}

# ── Secure credential helper ──────────────────────────────────
# Reads a SecureString, encrypts with AES-256-GCM using machine ID,
# saves to keychain. Value never passed as a process argument.
function Save-Cred {
    param(
        [string]$ConfigDir,
        [string]$Service,
        [string]$Key,
        [System.Security.SecureString]$SecureValue
    )
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        if (-not $plain) { return }

        # Write value to a temp file with restricted permissions instead of
        # passing as process argument (prevents Task Manager / event log exposure)
        $tmpFile = [System.IO.Path]::GetTempFileName()
        try {
            [System.IO.File]::WriteAllText($tmpFile, $plain, [System.Text.Encoding]::UTF8)

            $jsCode = @"
const crypto=require('crypto'),fs=require('fs'),path=require('path'),os=require('os'),{execSync}=require('child_process');
const [,,configDir,service,key,valFile]=process.argv;
const val=fs.readFileSync(valFile,'utf8').trim();
// Securely delete temp file immediately after reading
try{fs.writeFileSync(valFile,crypto.randomBytes(val.length).toString('hex'));fs.unlinkSync(valFile);}catch{}
const kd=path.join(configDir,'keychain');
fs.mkdirSync(kd,{recursive:true,mode:0o700});
function ms(){
  try{const o=execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',{encoding:'utf8',stdio:['pipe','pipe','pipe']});const m=o.match(/MachineGuid\s+REG_SZ\s+(.+)/);if(m&&m[1].trim())return m[1].trim()}catch{}
  const f=path.join(kd,'machine_secret');
  try{const d=fs.readFileSync(f,'utf8').trim();if(d)return d}catch{}
  try{const s=crypto.randomUUID();fs.writeFileSync(f,s,{mode:0o600});return s}catch{}
  throw new Error('Cannot derive machine ID for keychain encryption');
}
const salt=crypto.createHash('sha256').update('conductor:keychain:v1').digest();
const mk=crypto.scryptSync(ms(),salt,32,{N:16384,r:8,p:1});
const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',mk,iv);
let e=c.update(val,'utf8','hex');e+=c.final('hex');
const t=c.getAuthTag().toString('hex');
const out=['v2',iv.toString('hex'),t,e].join(':');
const fp=path.join(kd,service+'.'+key+'.enc');
const tmp=fp+'.tmp';
fs.writeFileSync(tmp,out,{mode:0o600});
fs.renameSync(tmp,fp);
"@
            node -e $jsCode $ConfigDir $Service $Key $tmpFile
        } finally {
            # Ensure temp file is wiped even if node fails
            if (Test-Path $tmpFile) {
                $bytes = [System.IO.File]::ReadAllBytes($tmpFile)
                [System.Runtime.InteropServices.Marshal]::Copy([byte[]]::new($bytes.Length), 0, [System.IntPtr]::Zero, 0)
                Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
            }
        }
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Save-CredPlain {
    param([string]$ConfigDir, [string]$Service, [string]$Key, [string]$Value)
    $ss = ConvertTo-SecureString $Value -AsPlainText -Force
    Save-Cred -ConfigDir $ConfigDir -Service $Service -Key $Key -SecureValue $ss
}

function Update-Config {
    param([string]$ConfigFile, [hashtable]$Updates)
    $config = @{}
    if (Test-Path $ConfigFile) {
        try { $config = Get-Content $ConfigFile -Raw | ConvertFrom-Json -AsHashtable } catch {}
    }
    foreach ($k in $Updates.Keys) { $config[$k] = $Updates[$k] }
    $config | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile -Encoding UTF8
}

# ── Header ────────────────────────────────────────────────────
Write-Host ""
Write-Host "   ██████╗ ██████╗ ███╗   ██╗██████╗ ██╗   ██╗ ██████╗████████╗ ██████╗ ██████╗" -ForegroundColor Cyan
Write-Host "  ██╔════╝██╔═══██╗████╗  ██║██╔══██╗██║   ██║██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗" -ForegroundColor Cyan
Write-Host "  ██║     ██║   ██║██╔██╗ ██║██║  ██║██║   ██║██║        ██║   ██║   ██║██████╔╝" -ForegroundColor Cyan
Write-Host "  ██║     ██║   ██║██║╚██╗██║██║  ██║██║   ██║██║        ██║   ██║   ██║██╔══██╗" -ForegroundColor Cyan
Write-Host "  ╚██████╗╚██████╔╝██║ ╚████║██████╔╝╚██████╔╝╚██████╗   ██║   ╚██████╔╝██║  ██║" -ForegroundColor Cyan
Write-Host "   ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚═════╝  ╚═════╝  ╚═════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "  your local AI integration hub  ·  by TheAlxLabs" -ForegroundColor DarkGray
Write-Host ""

# ── Step 1: Preflight ─────────────────────────────────────────
Step "01 / Preflight Check"

try {
    $nodeRaw = (node --version 2>&1).ToString().Trim()
    $nodeVersion = $nodeRaw.TrimStart('v').Split('.')[0]
    if ([int]$nodeVersion -lt 18) {
        Fail "Node.js v18+ required. You have $nodeRaw. Update at https://nodejs.org"
    }
    Success "Node.js $nodeRaw"
} catch {
    Fail "Node.js not found. Install from https://nodejs.org (v18+)"
}

try {
    $npmVersion = (npm --version 2>&1).ToString().Trim()
    Success "npm $npmVersion"
} catch {
    Fail "npm not found. Reinstall Node.js"
}

$ConfigDir  = "$env:USERPROFILE\.conductor"
$KeychainDir = "$ConfigDir\keychain"
$ConfigFile  = "$ConfigDir\config.json"

New-Item -ItemType Directory -Path $ConfigDir    -Force | Out-Null
New-Item -ItemType Directory -Path $KeychainDir  -Force | Out-Null
New-Item -ItemType Directory -Path "$ConfigDir\plugins" -Force | Out-Null
New-Item -ItemType Directory -Path "$ConfigDir\logs"    -Force | Out-Null
Success "Config dirs ready ($ConfigDir)"

# ── Step 2: Install & Build ───────────────────────────────────
Step "02 / Install & Build"

$ConductorDir = "$env:USERPROFILE\.conductor-src"

if (Test-Path "package.json") {
    $pkg = Get-Content "package.json" -Raw
    if ($pkg -match "conductor-hub") {
        $ConductorDir = (Get-Location).Path
        Info "Using current directory"
    }
}

if (-not (Test-Path "$ConductorDir\package.json")) {
    Info "Cloning from GitHub..."
    git clone --quiet https://github.com/thealxlabs/conductor.git $ConductorDir
    if ($LASTEXITCODE -ne 0) { Fail "Clone failed. Check your internet connection." }
}

Set-Location $ConductorDir

Info "Installing dependencies..."
npm install --no-fund --no-audit 2>$null
if ($LASTEXITCODE -ne 0) { Fail "npm install failed. Run 'npm install' in $ConductorDir to see the error." }
Success "Dependencies installed"

Info "Building TypeScript..."
npm run build 2>$null
if ($LASTEXITCODE -ne 0) { Fail "Build failed. Run 'npm run build' in $ConductorDir to see the error." }
Success "Build complete"

Info "Linking globally..."
try {
    npm link --silent 2>$null
    Success "conductor command available"
} catch {
    Warn "npm link failed — use 'node $ConductorDir\dist\cli\index.js' instead"
}

# ── Step 3: AI Provider ───────────────────────────────────────
Step "03 / AI Provider"

Write-Host ""
Write-Host "  1  Claude      · console.anthropic.com/settings/keys" -ForegroundColor White
Write-Host "  2  OpenAI      · platform.openai.com/api-keys"         -ForegroundColor White
Write-Host "  3  Gemini      · aistudio.google.com/apikey"           -ForegroundColor White
Write-Host "  4  OpenRouter  · openrouter.ai/keys"                   -ForegroundColor White
Write-Host "  5  Ollama      · local, no key needed"                 -ForegroundColor White
Write-Host "  6  Skip"                                               -ForegroundColor DarkGray
Write-Host ""

$choice = Read-Host "  ? Choose [6]"
if (-not $choice) { $choice = "6" }

$aiProviderSet = ""

switch ($choice) {
    "1" {
        $key = Read-Host "  ? Anthropic API key" -AsSecureString
        Save-Cred -ConfigDir $ConfigDir -Service "anthropic" -Key "api_key" -SecureValue $key
        Update-Config -ConfigFile $ConfigFile -Updates @{ "ai" = @{ "provider" = "claude" } }
        Success "Claude configured"
        $aiProviderSet = "claude"
    }
    "2" {
        $key = Read-Host "  ? OpenAI API key" -AsSecureString
        Save-Cred -ConfigDir $ConfigDir -Service "openai" -Key "api_key" -SecureValue $key
        Update-Config -ConfigFile $ConfigFile -Updates @{ "ai" = @{ "provider" = "openai" } }
        Success "OpenAI configured"
        $aiProviderSet = "openai"
    }
    "3" {
        $key = Read-Host "  ? Gemini API key" -AsSecureString
        Save-Cred -ConfigDir $ConfigDir -Service "gemini" -Key "api_key" -SecureValue $key
        Update-Config -ConfigFile $ConfigFile -Updates @{ "ai" = @{ "provider" = "gemini" } }
        Success "Gemini configured"
        $aiProviderSet = "gemini"
    }
    "4" {
        $key = Read-Host "  ? OpenRouter API key" -AsSecureString
        Save-Cred -ConfigDir $ConfigDir -Service "openrouter" -Key "api_key" -SecureValue $key
        Update-Config -ConfigFile $ConfigFile -Updates @{ "ai" = @{ "provider" = "openrouter" } }
        Success "OpenRouter configured"
        $aiProviderSet = "openrouter"
    }
    "5" {
        $model = Read-Host "  ? Ollama model [llama3.2]"
        if (-not $model) { $model = "llama3.2" }
        Update-Config -ConfigFile $ConfigFile -Updates @{
            "ai" = @{
                "provider" = "ollama"
                "model" = $model
                "local_config" = @{ "endpoint" = "http://localhost:11434" }
            }
        }
        Success "Ollama configured with $model"
        Warn "Make sure Ollama is running: ollama serve"
        $aiProviderSet = "ollama"
    }
    default {
        Warn "Skipped — run later: conductor ai setup"
    }
}

# ── Step 4: Google Services ───────────────────────────────────
Step "04 / Google Services  (Gmail · Calendar · Drive)"

$setupGoogle = Read-Host "  ? Enable Gmail, Calendar, and Drive plugins? [Y/n]"
if (-not $setupGoogle -or $setupGoogle -match "^[Yy]") {

    Info "Fetching Google OAuth configuration..."
    try {
        $oauthResponse = Invoke-RestMethod `
            -Uri "https://conductor.thealxlabs.ca/api/oauth-config" `
            -Method GET `
            -Headers @{
                "User-Agent"          = "Conductor-Installer/1.0"
                "X-Conductor-Install" = "true"
            } `
            -TimeoutSec 10 `
            -ErrorAction Stop

        if ($oauthResponse.client_id -and $oauthResponse.client_secret) {
            Save-CredPlain -ConfigDir $ConfigDir -Service "google_oauth" -Key "client_id"     -Value $oauthResponse.client_id
            Save-CredPlain -ConfigDir $ConfigDir -Service "google_oauth" -Key "client_secret" -Value $oauthResponse.client_secret
            # Clear from memory immediately
            $oauthResponse = $null
            [System.GC]::Collect()
            Success "Google OAuth app credentials saved to keychain"
        } else {
            Warn "Could not parse OAuth credentials — Google features may not work"
        }
    } catch {
        Warn "Could not fetch Google OAuth config: $_"
        Warn "Run later: conductor auth google"
    }

    # Update config to enable plugins
    $config = @{}
    if (Test-Path $ConfigFile) {
        try { $config = Get-Content $ConfigFile -Raw | ConvertFrom-Json -AsHashtable } catch {}
    }
    if (-not $config.ContainsKey("plugins")) { $config["plugins"] = @{} }
    $config["plugins"]["gmail"]  = @{ "enabled" = $true }
    $config["plugins"]["gcal"]   = @{ "enabled" = $true }
    $config["plugins"]["gdrive"] = @{ "enabled" = $true }
    $config | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile -Encoding UTF8
    Success "Gmail, Calendar, and Drive plugins enabled"
    Write-Host "  ℹ After install, run: conductor auth google" -ForegroundColor DarkGray
} else {
    Warn "Skipped — enable later: conductor plugins enable gmail gcal gdrive"
}

# ── Step 5: MCP Server ────────────────────────────────────────
Step "05 / MCP Server  (Claude Desktop integration)"

$mcpConfig = "$env:APPDATA\Claude\claude_desktop_config.json"
$setupMcp = Read-Host "  ? Configure for Claude Desktop? [Y/n]"
if (-not $setupMcp -or $setupMcp -match "^[Yy]") {
    $mcpDir = Split-Path $mcpConfig
    New-Item -ItemType Directory -Path $mcpDir -Force | Out-Null

    $existing = @{}
    if (Test-Path $mcpConfig) {
        # Backup first
        Copy-Item $mcpConfig "$mcpConfig.bak" -Force -ErrorAction SilentlyContinue
        try { $existing = Get-Content $mcpConfig -Raw | ConvertFrom-Json -AsHashtable } catch {}
    }
    if (-not $existing.ContainsKey("mcpServers")) { $existing["mcpServers"] = @{} }
    $existing["mcpServers"]["conductor"] = @{
        "command" = "conductor"
        "args"    = @("mcp", "start")
    }
    $tmp = "$mcpConfig.tmp"
    $existing | ConvertTo-Json -Depth 10 | Set-Content $tmp -Encoding UTF8
    Move-Item $tmp $mcpConfig -Force
    Success "MCP configured — restart Claude Desktop to connect"
}

# ── Done ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ┌──────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host "  │  ✓  Installation Complete"                     -ForegroundColor Green
Write-Host "  └──────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host ""
Write-Host "    conductor status          — Check your setup"    -ForegroundColor White
Write-Host "    conductor ai test         — Test AI provider"    -ForegroundColor White
Write-Host "    conductor auth google     — Connect Google"      -ForegroundColor White
Write-Host "    conductor plugins list    — Browse plugins"      -ForegroundColor White
Write-Host "    conductor dashboard       — Open web dashboard"  -ForegroundColor White
Write-Host ""
Write-Host "  Docs: https://conductor.thealxlabs.ca" -ForegroundColor DarkGray
Write-Host ""