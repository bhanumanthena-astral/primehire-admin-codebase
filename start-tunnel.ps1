<#
.SYNOPSIS
  Start the full PrimeHire stack (FastAPI backend + Express/Vite frontend)
  and expose it via a Cloudflare Quick Tunnel so others can access it.

.DESCRIPTION
  1. Starts the FastAPI backend (V2) on port 8002
  2. Starts the Express + Vite dev server on port 3000
  3. Launches a Cloudflare Quick Tunnel pointing to http://localhost:3000
  4. Prints the public *.trycloudflare.com URL for sharing

  Press Ctrl+C to stop everything.
#>

$ErrorActionPreference = "Stop"

# Colors
function Write-Step($msg) { Write-Host "[*] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[+] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[-] $msg" -ForegroundColor Red }

$projectRoot = $PSScriptRoot
$backendDir  = Join-Path $projectRoot "backend"
$scriptsDir  = Join-Path $projectRoot "scripts"

# Track child processes for cleanup
$global:childProcesses = @()

function Cleanup {
    Write-Host ""
    Write-Warn "Shutting down all services..."
    foreach ($proc in $global:childProcesses) {
        if ($proc -and !$proc.HasExited) {
            try {
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                Write-Ok "Stopped PID $($proc.Id)"
            } catch {}
        }
    }
    # Also kill any orphan processes on our ports
    Get-NetTCPConnection -LocalPort 3000,8002 -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Write-Ok "Cleanup complete."
}

# Register cleanup on script exit
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Cleanup } | Out-Null
trap { Cleanup; break }

Write-Host ""
Write-Host "========================================================" -ForegroundColor Magenta
Write-Host "     PrimeHire Admin - Cloudflare Tunnel Launcher       " -ForegroundColor Magenta
Write-Host "========================================================" -ForegroundColor Magenta
Write-Host ""

# --- Step 1: Verify prerequisites ---
Write-Step "Checking prerequisites..."

# Check Node.js
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Err "Node.js is not installed. Please install Node.js >= 20."
    exit 1
}
Write-Ok "Node.js $(node --version)"

# Check Python venv
$pythonExe = Join-Path $backendDir ".venv\Scripts\python.exe"
if (!(Test-Path $pythonExe)) {
    $pythonExe = Join-Path $backendDir ".venv-v2\Scripts\python.exe"
}
if (!(Test-Path $pythonExe)) {
    Write-Err "Python virtual environment not found in backend/.venv or backend/.venv-v2"
    exit 1
}
Write-Ok "Python venv: $pythonExe"

# Check cloudflared
$cloudflaredCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
$cloudflaredExe = if ($cloudflaredCmd) { $cloudflaredCmd.Source } else { "" }
if (!$cloudflaredExe) {
    $msiPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
    if (Test-Path $msiPath) {
        $cloudflaredExe = $msiPath
        $env:Path += ";C:\Program Files (x86)\cloudflared"
    } else {
        Write-Err "cloudflared is not installed. Install via: winget install Cloudflare.cloudflared"
        exit 1
    }
}
Write-Ok "cloudflared found: $cloudflaredExe"

# Free up ports and stop existing cloudflared instances
Write-Step "Ensuring ports 3000 and 8002 are free..."
Get-NetTCPConnection -LocalPort 3000,8002 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Write-Ok "Ports are ready"

# Check node_modules
if (!(Test-Path (Join-Path $projectRoot "node_modules"))) {
    Write-Step "Installing npm dependencies..."
    Push-Location $projectRoot
    npm ci
    Pop-Location
}
Write-Ok "npm dependencies ready"

# ─── Step 2: Start FastAPI backend (port 8002) ───
Write-Host ""
Write-Step "Starting FastAPI backend on port 8002..."

$backendProcess = Start-Process -FilePath $pythonExe `
    -ArgumentList "scripts/run_v2_backend.py" `
    -WorkingDirectory $projectRoot `
    -PassThru -NoNewWindow `
    -RedirectStandardOutput (Join-Path $projectRoot "backend_tunnel.log") `
    -RedirectStandardError (Join-Path $projectRoot "backend_tunnel.err.log")

$global:childProcesses += $backendProcess
Write-Ok "FastAPI backend started (PID: $($backendProcess.Id))"

# Wait for backend to be ready
Write-Step "Waiting for backend to be ready..."
$maxWait = 30
$waited = 0
while ($waited -lt $maxWait) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:8002/api/health" -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            Write-Ok "Backend is ready!"
            break
        }
    } catch {}
    Start-Sleep -Seconds 1
    $waited++
    if ($waited % 5 -eq 0) { Write-Host "  Still waiting... ($waited/$maxWait seconds)" -ForegroundColor DarkGray }
}
if ($waited -ge $maxWait) {
    Write-Warn "Backend didn't respond within $maxWait seconds, continuing anyway..."
    Write-Warn "Check backend_tunnel.err.log for errors."
}

# ─── Step 3: Start Express + Vite dev server (port 3000) ───
Write-Host ""
Write-Step "Starting Express + Vite dev server on port 3000..."

$frontendProcess = Start-Process -FilePath "node" `
    -ArgumentList "node_modules/tsx/dist/cli.mjs", "server.ts" `
    -WorkingDirectory $projectRoot `
    -PassThru -NoNewWindow `
    -RedirectStandardOutput (Join-Path $projectRoot "server_tunnel.log") `
    -RedirectStandardError (Join-Path $projectRoot "server_tunnel.err.log")

$global:childProcesses += $frontendProcess
Write-Ok "Express + Vite server started (PID: $($frontendProcess.Id))"

# Wait for frontend to be ready
Write-Step "Waiting for frontend server to be ready..."
$waited = 0
while ($waited -lt $maxWait) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/health" -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            Write-Ok "Frontend server is ready!"
            break
        }
    } catch {}
    Start-Sleep -Seconds 1
    $waited++
    if ($waited % 5 -eq 0) { Write-Host "  Still waiting... ($waited/$maxWait seconds)" -ForegroundColor DarkGray }
}
if ($waited -ge $maxWait) {
    Write-Warn "Frontend server didn't respond within $maxWait seconds, continuing anyway..."
}

# ─── Step 4: Start Cloudflare Tunnel ───
Write-Host ""
Write-Step "Starting Cloudflare Tunnel..."

$tunnelLog = Join-Path $projectRoot "tunnel.log"
$tunnelUrlFile = Join-Path $projectRoot "tunnel_url.txt"
if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }
if (Test-Path $tunnelUrlFile) { Remove-Item $tunnelUrlFile -Force }

$cfProcess = Start-Process -FilePath $cloudflaredExe `
    -ArgumentList "tunnel", "--url", "http://127.0.0.1:3000", "--logfile", $tunnelLog `
    -WorkingDirectory $projectRoot `
    -PassThru -NoNewWindow

$global:childProcesses += $cfProcess
Write-Ok "Cloudflare tunnel started (PID: $($cfProcess.Id))"

Write-Step "Waiting for tunnel URL..."
$tunnelUrl = $null
$maxWait = 30
$waited = 0
while ($waited -lt $maxWait -and !$cfProcess.HasExited) {
    if (Test-Path $tunnelLog) {
        $content = Get-Content $tunnelLog -Raw -ErrorAction SilentlyContinue
        if ($content -match 'https://[a-zA-Z0-9-]+\.trycloudflare\.com') {
            $tunnelUrl = $matches[0]
            Set-Content -Path $tunnelUrlFile -Value $tunnelUrl
            break
        }
    }
    Start-Sleep -Seconds 1
    $waited++
}

if ($tunnelUrl) {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "  CLOUDFLARE TUNNEL ONLINE!                                     " -ForegroundColor Green
    Write-Host "                                                                " -ForegroundColor Green
    Write-Host "  Public URL: $tunnelUrl" -ForegroundColor Yellow
    Write-Host "  Local:      http://localhost:3000                             " -ForegroundColor Green
    Write-Host "                                                                " -ForegroundColor Green
    Write-Host "  Saved to:   tunnel_url.txt                                    " -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Warn "Could not detect tunnel URL in $tunnelLog within $maxWait seconds."
}

try {
    Wait-Process -Id $cfProcess.Id
} finally {
    Cleanup
}
