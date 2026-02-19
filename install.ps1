# ============================================================
# Conductor Install Script (Windows PowerShell)
# ============================================================
# Usage:
#   irm https://raw.githubusercontent.com/thealxlabs/conductor/main/install.ps1 | iex
# Or locally:
#   .\install.ps1
# ============================================================

$ErrorActionPreference = "Stop"

function Info($msg)    { Write-Host "  ▶ $msg" -ForegroundColor Cyan }
function Success($msg) { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Warn($msg)    { Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Fail($msg)    { Write-Host "  ✗ FATAL: $msg" -ForegroundColor Red; exit 1 }
function Step($msg)    { Write-Host "`n  ┌──────────────────────────────────────────────" -ForegroundColor Cyan; Write-Host "  │  $msg" -ForegroundColor Cyan; Write-Host "  └──────────────────────────────────────────────" -ForegroundColor Cyan }

# ── Header ───────────────────────────────────────────────────
Write-Host ""
Write-Host "   ██████╗ ██████╗ ███╗   ██╗██████╗ ██╗   ██╗ ██████╗████████╗ ██████╗ ██████╗" -ForegroundColor Cyan
Write-Host "  ██╔════╝██╔═══██╗████╗  ██║██╔══██╗██║   ██║██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗" -ForegroundColor Cyan
Write-Host "  ██║     ██║   ██║██╔██╗ ██║██║  ██║██║   ██║██║        ██║   ██║   ██║██████╔╝" -ForegroundColor Cyan
Write-Host "  ██║     ██║   ██║██║╚██╗██║██║  ██║██║   ██║██║        ██║   ██║   ██║██╔══██╗" -ForegroundColor Cyan
Write-Host "  ╚██████╗╚██████╔╝██║ ╚████║██████╔╝╚██████╔╝╚██████╗   ██║   ╚██████╔╝██║  ██║" -ForegroundColor Cyan
Write-Host "   ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚═════╝  ╚═════╝  ╚═════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Your AI Integration Hub  ·  by TheAlxLabs" -ForegroundColor DarkGray
Write-Host ""

# ── Step 1: Preflight ────────────────────────────────────────
Step "01 / Preflight Check"

try {
    $nodeVersion = (node --version 2>&1).ToString().TrimStart('v').Split('.')[0]
    if ([int]$nodeVersion -lt 18) {
        Fail "Node.js v18+ required. You have $(node --version). Update at https://nodejs.org"
    }
    Success "Node.js $(node --version)"
} catch {
    Fail "Node.js not found. Install from https://nodejs.org (v18+)"
}

try {
    $npmVersion = (npm --version 2>&1).ToString()
    Success "npm $npmVersion"
} catch {
    Fail "npm not found. Reinstall Node.js"
}

# Config directories
$ConfigDir = "$env:USERPROFILE\.conductor"
$KeychainDir = "$ConfigDir\keychain"
New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
New-Item -ItemType Directory -Path $KeychainDir -Force | Out-Null
New-Item -ItemType Directory -Path "$ConfigDir\plugins" -Force | Out-Null
New-Item -ItemType Directory -Path "$ConfigDir\logs" -Force | Out-Null

# ── Step 2: Install ──────────────────────────────────────────
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
}

Set-Location $ConductorDir

Info "Installing dependencies..."
npm install --silent 2>$null
Success "Dependencies installed"

Info "Building..."
npm run build 2>$null
Success "Build complete"

Info "Linking globally..."
try {
    npm link --silent 2>$null
    Success "conductor command available"
} catch {
    Warn "npm link failed — use 'node $ConductorDir\dist\cli\index.js' instead"
}

# ── Step 3: AI Provider ──────────────────────────────────────
Step "03 / AI Provider"

Write-Host ""
Write-Host "  1  Claude   · console.anthropic.com/settings/keys" -ForegroundColor White
Write-Host "  2  OpenAI   · platform.openai.com/api-keys" -ForegroundColor White
Write-Host "  3  Gemini   · aistudio.google.com/apikey" -ForegroundColor White
Write-Host "  4  Ollama   · local, no key needed" -ForegroundColor White
Write-Host "  5  Skip" -ForegroundColor DarkGray
Write-Host ""

$choice = Read-Host "  ? Choose [1]"
if (-not $choice) { $choice = "1" }

$ConfigFile = "$ConfigDir\config.json"
$config = @{}
if (Test-Path $ConfigFile) {
    try { $config = Get-Content $ConfigFile -Raw | ConvertFrom-Json -AsHashtable } catch {}
}

switch ($choice) {
    "1" {
        $key = Read-Host "  ? Anthropic API key" -AsSecureString
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($key)
        $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        if ($plain) {
            # Save via Node.js to match keychain.ts format
            node -e "const crypto=require('crypto'),fs=require('fs'),os=require('os'),path=require('path'),{execSync}=require('child_process');function g(){try{const o=execSync('reg query `"HKLM\\SOFTWARE\\Microsoft\\Cryptography`" /v MachineGuid',{encoding:'utf8'});const m=o.match(/MachineGuid\s+REG_SZ\s+(.+)/);if(m)return m[1].trim()}catch{}return os.hostname()}const s=g(),salt=crypto.createHash('sha256').update('conductor:keychain:v1').digest(),mk=crypto.scryptSync(s,salt,32,{N:16384,r:8,p:1}),iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',mk,iv);let e=c.update(process.argv[1],'utf8','hex');e+=c.final('hex');const t=c.getAuthTag().toString('hex');fs.writeFileSync(path.join('$KeychainDir','anthropic.api_key.enc'),['v2',iv.toString('hex'),t,e].join(':'),{mode:0o600})" "$plain"
            $config["ai"] = @{ "provider" = "claude" }
            $config | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile
            Success "Claude configured"
        }
    }
    "2" {
        $key = Read-Host "  ? OpenAI API key" -AsSecureString
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($key)
        $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        if ($plain) {
            node -e "const crypto=require('crypto'),fs=require('fs'),os=require('os'),path=require('path'),{execSync}=require('child_process');function g(){try{const o=execSync('reg query `"HKLM\\SOFTWARE\\Microsoft\\Cryptography`" /v MachineGuid',{encoding:'utf8'});const m=o.match(/MachineGuid\s+REG_SZ\s+(.+)/);if(m)return m[1].trim()}catch{}return os.hostname()}const s=g(),salt=crypto.createHash('sha256').update('conductor:keychain:v1').digest(),mk=crypto.scryptSync(s,salt,32,{N:16384,r:8,p:1}),iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',mk,iv);let e=c.update(process.argv[1],'utf8','hex');e+=c.final('hex');const t=c.getAuthTag().toString('hex');fs.writeFileSync(path.join('$KeychainDir','openai.api_key.enc'),['v2',iv.toString('hex'),t,e].join(':'),{mode:0o600})" "$plain"
            $config["ai"] = @{ "provider" = "openai" }
            $config | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile
            Success "OpenAI configured"
        }
    }
    "3" {
        Warn "Skipped — run: conductor ai setup"
    }
    "4" {
        $config["ai"] = @{ "provider" = "ollama"; "model" = "llama3.2"; "local_config" = @{ "endpoint" = "http://localhost:11434" } }
        $config | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile
        Success "Ollama configured"
    }
    default {
        Warn "Skipped — run: conductor ai setup"
    }
}

# ── Step 4: MCP ──────────────────────────────────────────────
Step "04 / MCP Server"

$mcpConfig = "$env:APPDATA\Claude\claude_desktop_config.json"
$setupMcp = Read-Host "  ? Configure for Claude Desktop? [Y/n]"
if (-not $setupMcp -or $setupMcp -match "^[Yy]") {
    $mcpDir = Split-Path $mcpConfig
    New-Item -ItemType Directory -Path $mcpDir -Force | Out-Null

    $existing = @{}
    if (Test-Path $mcpConfig) {
        try { $existing = Get-Content $mcpConfig -Raw | ConvertFrom-Json -AsHashtable } catch {}
    }
    if (-not $existing.ContainsKey("mcpServers")) { $existing["mcpServers"] = @{} }
    $existing["mcpServers"]["conductor"] = @{
        "command" = "conductor"
        "args" = @("mcp", "start")
    }
    $existing | ConvertTo-Json -Depth 10 | Set-Content $mcpConfig
    Success "MCP configured — restart Claude Desktop"
}

# ── Done ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ┌──────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host "  │  ✓  Installation Complete" -ForegroundColor Green
Write-Host "  └──────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host ""
Write-Host "    conductor status          — Check your setup" -ForegroundColor White
Write-Host "    conductor ai test         — Test AI provider" -ForegroundColor White
Write-Host "    conductor plugins list    — Browse plugins" -ForegroundColor White
Write-Host ""
Write-Host "  Docs: https://github.com/thealxlabs/conductor" -ForegroundColor DarkGray
Write-Host ""
