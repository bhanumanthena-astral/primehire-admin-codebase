param(
    [Parameter(Mandatory=$true)][string]$PrivateKeyPath,
    [Parameter(Mandatory=$true)][string]$Server
)
$ErrorActionPreference = 'Stop'
if ($Server -notmatch '^[A-Za-z0-9.-]+$') { throw 'Invalid E2E hostname.' }
if (-not (Test-Path -LiteralPath $PrivateKeyPath -PathType Leaf)) { throw 'SSH private key not found.' }
$plink = Join-Path $env:ProgramFiles 'PuTTY/plink.exe'
while ($true) {
    # Traffic keeps idle connections alive; reconnect after network interruptions.
    & $plink -batch -ssh -T -i $PrivateKeyPath `
        -L '127.0.0.1:25432:127.0.0.1:5432' -L '127.0.0.1:13310:127.0.0.1:3310' `
        -L '127.0.0.1:18080:127.0.0.1:9000' -L '127.0.0.1:18002:127.0.0.1:8002' `
        "root@$Server" 'while sleep 20; do echo tunnel-alive; done'
    Write-Warning 'Local E2E tunnel disconnected; retrying in 5 seconds.'
    Start-Sleep -Seconds 5
}
