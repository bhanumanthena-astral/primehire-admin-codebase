param(
    [string]$PrivateKeyPath,
    [string]$Server = '216.48.178.2',
    [switch]$RestartApi,
    [string]$TestEmailRecipient
)
$ErrorActionPreference = 'Stop'
# Normal local startup remains dry-run; live tests require one explicit recipient.
if ($TestEmailRecipient) {
    if ($TestEmailRecipient -notmatch '^[^\s<>,;@]+@[^\s<>,;@]+\.[^\s<>,;@]+$') { throw 'Pass one valid test email address.' }
    $TestEmailRecipient = $TestEmailRecipient.ToLowerInvariant()
    $env:ELITEHR_LOCAL_TEST_EMAIL = $TestEmailRecipient
    $env:EMAIL_DRY_RUN = 'false'
    $env:RECRUITMENT_EMAIL_DRY_RUN = 'false'
    $env:EMAIL_TEST_RECIPIENT_ALLOWLIST = $TestEmailRecipient
    $env:RECRUITMENT_EMAIL_TEST_RECIPIENT_ALLOWLIST = $TestEmailRecipient
    $RestartApi = $true
} else {
    $env:ELITEHR_LOCAL_TEST_EMAIL = ''
    $env:EMAIL_DRY_RUN = 'true'
    $env:RECRUITMENT_EMAIL_DRY_RUN = 'true'
}
$taskRoot = Split-Path $PSScriptRoot -Parent
$launchProfile = Join-Path $taskRoot 'backend/secrets/e2e-local-launch.json'
$taskLogs = Join-Path $taskRoot '.tmp'
New-Item -ItemType Directory -Force -Path $taskLogs | Out-Null
$mailModeFile = Join-Path $taskLogs 'local-mail-mode'
$requestedMailMode = if ($TestEmailRecipient) { 'test-recipient' } else { 'dry-run' }
if ((Test-Path -LiteralPath $mailModeFile) -and (Get-Content -LiteralPath $mailModeFile -Raw).Trim() -ne $requestedMailMode) { $RestartApi = $true }
if (-not $PrivateKeyPath -and (Test-Path -LiteralPath $launchProfile)) {
    $savedLaunchProfile = Get-Content -LiteralPath $launchProfile -Raw | ConvertFrom-Json
    $PrivateKeyPath = $savedLaunchProfile.privateKeyPath
    $Server = $savedLaunchProfile.server
}
if (-not $PrivateKeyPath -or -not (Test-Path -LiteralPath $PrivateKeyPath -PathType Leaf)) {
    throw 'Pass -PrivateKeyPath with your local .ppk path on the first run. The key is never copied.'
}
if ($Server -notmatch '^[A-Za-z0-9.-]+$') { throw 'Invalid E2E hostname.' }
$PrivateKeyPath = (Resolve-Path -LiteralPath $PrivateKeyPath).Path
$plink = Join-Path $env:ProgramFiles 'PuTTY/plink.exe'
$python = Join-Path $taskRoot 'backend/.venv-v2/Scripts/python.exe'
if (-not (Test-Path $plink) -or -not (Test-Path $python)) { throw 'Install PuTTY and the existing V2 Python environment first.' }
& $python (Join-Path $taskRoot 'scripts/verify_e2e_connection.py') --config-only
if ($LASTEXITCODE -ne 0) { throw 'Refusing to launch against an unverified local database configuration.' }
New-Item -ItemType Directory -Force -Path (Split-Path $launchProfile) | Out-Null
@{server=$Server;privateKeyPath=$PrivateKeyPath} | ConvertTo-Json | Set-Content -LiteralPath $launchProfile

function Listener([int]$port) {
    Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
}
function Background([string]$exe,[string[]]$arguments,[string]$name) {
    $quotedArguments = @($arguments | ForEach-Object { if ($_ -match '\s' -and -not $_.StartsWith('"')) { '"'+$_+'"' } else { $_ } })
    $process = Start-Process -FilePath $exe -ArgumentList $quotedArguments -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $taskLogs "$name.out.log") -RedirectStandardError (Join-Path $taskLogs "$name.err.log")
    $process.Id | Set-Content (Join-Path $taskLogs "$name.pid")
    return $process
}
$dbListener = Listener 25432
if ($dbListener) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($dbListener.OwningProcess)"
    if ($owner.Name -ne 'plink.exe' -or $owner.CommandLine -notlike "*root@$Server*") {
        throw 'Port 25432 belongs to another service; refusing to replace it.'
    }
} else {
    foreach ($port in @(13310,18080,18002)) {
        if (Listener $port) { throw "Local E2E port $port is already occupied; inspect it before reconnecting." }
    }
    $powershell = (Get-Command powershell.exe).Source
    $tunnel = Background $powershell @('-NoProfile','-ExecutionPolicy','Bypass','-File',
        (Join-Path $taskRoot 'scripts/keep_e2e_tunnel.ps1'),'-PrivateKeyPath',$PrivateKeyPath,'-Server',$Server) 'e2e-tunnel'
    for ($attempt=0; $attempt -lt 30 -and -not (Listener 25432); $attempt++) {
        if ($tunnel.HasExited) { throw 'SSH connection failed. Check .tmp/e2e-tunnel.err.log and your SSH agent.' }
        Start-Sleep -Milliseconds 300
    }
    if (-not (Listener 25432)) { throw 'E2E database tunnel did not become ready.' }
}
$api = Listener 8002
if ($api -and $RestartApi) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($api.OwningProcess)"
    if ($owner.Name -ne 'python.exe' -or $owner.CommandLine -notmatch 'run_v2_backend\.py') {
        throw 'Port 8002 is not the V2 launcher; refusing to stop it.'
    }
    Stop-Process -Id $api.OwningProcess
    $api = $null
}
if (-not $api) {
    Background $python @((Join-Path $taskRoot 'scripts/run_v2_backend.py')) 'e2e-local-backend' | Out-Null
}
if (-not (Listener 3000)) {
    $node = (Get-Command node.exe).Source
    $previousLocalProxy = $env:FASTAPI_URL
    try {
        $env:FASTAPI_URL = 'http://127.0.0.1:8002'
        Background $node @((Join-Path $taskRoot 'frontend/node_modules/vite/bin/vite.js'),
            '--config',(Join-Path $taskRoot 'frontend/vite.config.ts'),'--host','127.0.0.1','--port','3000','--strictPort') 'e2e-local-frontend' | Out-Null
    } finally { $env:FASTAPI_URL = $previousLocalProxy }
}
$apiReady = $false
# PostgreSQL index checks can take longer than 20 connection-refused retries after reconnecting.
$startupDeadline = [DateTime]::UtcNow.AddMinutes(2)
while ([DateTime]::UtcNow -lt $startupDeadline) {
    try {
        $ready = Invoke-RestMethod 'http://127.0.0.1:8002/api/ready' -TimeoutSec 2
        if ($ready.status -eq 'ready' -and $ready.checks.postgres -eq 'ok') {
            $apiReady = $true
            break
        }
    } catch { }
    Start-Sleep -Milliseconds 500
}
if (-not $apiReady) { throw 'Local API did not become ready. Check .tmp/e2e-local-backend.err.log; no database fallback was used.' }
foreach ($role in @('resume_worker','assessment_worker','recruitment_worker')) {
    $scriptName = "run_v2_$role.py"
    $existingWorker = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'python.exe' -and $_.CommandLine.Contains($taskRoot) -and $_.CommandLine -match [regex]::Escape($scriptName)
    } | Select-Object -First 1
    if ($existingWorker -and $RestartApi) {
        Stop-Process -Id $existingWorker.ProcessId
        $existingWorker = $null
    }
    if (-not $existingWorker) {
        Background $python @((Join-Path $taskRoot "scripts/$scriptName")) "e2e-local-$role" | Out-Null
    }
}
$requestedMailMode | Set-Content -LiteralPath $mailModeFile
if ($TestEmailRecipient) { Write-Host 'Ready: http://localhost:3000 (live email restricted to the explicit test recipient).' }
else { Write-Host 'Ready: http://localhost:3000 (isolated E2E PostgreSQL test database; email dry-run).' }
