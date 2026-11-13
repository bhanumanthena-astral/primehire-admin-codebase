$ErrorActionPreference = 'Stop'
$ktProject = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $ktProject '.ua/knowledge-graph.json'))) {
    throw 'KT graph missing. Run python scripts/build_technical_kt_graph.py first.'
}
# Pin the inspected official viewer; no application dependencies are installed.
& npx.cmd --yes --package=https://github.com/Egonex-AI/Understand-Anything/releases/download/v2.9.0/understand-anything-viewer.tgz understand-anything-viewer $ktProject
if ($LASTEXITCODE -ne 0) { throw 'The KT viewer could not start.' }
