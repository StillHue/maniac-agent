# Maniac Agent — Windows installer
# Usage: irm https://raw.githubusercontent.com/StillHue/maniac-agent/main/scripts/install.ps1 | iex

$ErrorActionPreference = "Stop"

$REPO     = "https://github.com/StillHue/maniac-agent.git"
$INSTALL  = "$env:USERPROFILE\.maniac"
$BIN_DIR  = "$env:USERPROFILE\.maniac\bin"

function Write-Step { param($msg) Write-Host "`n>> $msg" -ForegroundColor White }
function Write-Ok   { param($msg) Write-Host "   $msg" -ForegroundColor Gray }
function Write-Fail { param($msg) Write-Host "   ERROR: $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  MANIAC — the what the hell agent" -ForegroundColor White
Write-Host "  installing..." -ForegroundColor DarkGray
Write-Host ""

# ── Check Node ──────────────────────────────────────────────────────────────

Write-Step "Checking Node.js"
try {
    $nodeVer = (node --version 2>&1).Trim().TrimStart("v")
    $major = [int]($nodeVer.Split(".")[0])
    if ($major -lt 18) { Write-Fail "Node.js 18+ required (found v$nodeVer). Install from https://nodejs.org" }
    Write-Ok "Node.js v$nodeVer"
} catch {
    Write-Fail "Node.js not found. Install from https://nodejs.org"
}

# ── Check Git ───────────────────────────────────────────────────────────────

Write-Step "Checking Git"
try {
    $gitVer = (git --version 2>&1).Trim()
    Write-Ok $gitVer
} catch {
    Write-Fail "Git not found. Install from https://git-scm.com"
}

# ── Check Yarn ──────────────────────────────────────────────────────────────

Write-Step "Checking Yarn"
try {
    $yarnVer = (yarn --version 2>&1).Trim()
    Write-Ok "Yarn v$yarnVer"
} catch {
    Write-Step "Installing Yarn"
    npm install -g yarn | Out-Null
    Write-Ok "Yarn installed"
}

# ── Clone or update ─────────────────────────────────────────────────────────

Write-Step "Setting up Maniac"
if (Test-Path "$INSTALL\maniac-agent\.git") {
    Write-Ok "Updating existing install at $INSTALL\maniac-agent"
    Push-Location "$INSTALL\maniac-agent"
    git pull --quiet
    Pop-Location
} else {
    New-Item -ItemType Directory -Force -Path $INSTALL | Out-Null
    Write-Ok "Cloning into $INSTALL\maniac-agent"
    git clone --depth 1 $REPO "$INSTALL\maniac-agent" --quiet
}

# ── Install dependencies ─────────────────────────────────────────────────────

Write-Step "Installing dependencies"
Push-Location "$INSTALL\maniac-agent"
yarn install --frozen-lockfile --silent
Write-Ok "Dependencies installed"

# ── Build ────────────────────────────────────────────────────────────────────

Write-Step "Building"
yarn build:all --silent
yarn build:cli --silent
Write-Ok "Build complete"

# ── Create launcher ──────────────────────────────────────────────────────────

Write-Step "Creating maniac command"
New-Item -ItemType Directory -Force -Path $BIN_DIR | Out-Null

$launcher = @"
@echo off
node "$INSTALL\maniac-agent\packages\cli\dist\index.js" %*
"@
Set-Content -Path "$BIN_DIR\maniac.cmd" -Value $launcher

# ── Add to PATH ──────────────────────────────────────────────────────────────

$userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($userPath -notlike "*$BIN_DIR*") {
    [Environment]::SetEnvironmentVariable("PATH", "$userPath;$BIN_DIR", "User")
    Write-Ok "Added $BIN_DIR to PATH"
} else {
    Write-Ok "PATH already configured"
}

# ── Setup .env ───────────────────────────────────────────────────────────────

$envFile = "$INSTALL\maniac-agent\.env"
if (-not (Test-Path $envFile)) {
    Copy-Item "$INSTALL\maniac-agent\.env.example" $envFile
    Write-Ok "Created .env at $envFile — add your API keys there"
}

Pop-Location

# ── Done ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  Maniac installed." -ForegroundColor White
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor DarkGray
Write-Host "    1. Edit $envFile and add at least one API key (GROQ_API_KEY is free)" -ForegroundColor DarkGray
Write-Host "    2. Restart your terminal" -ForegroundColor DarkGray
Write-Host "    3. Run: maniac" -ForegroundColor White
Write-Host ""
