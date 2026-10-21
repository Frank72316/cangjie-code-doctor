param([string]$NodePath)
$ErrorActionPreference = 'Stop'
if (-not $NodePath) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand) { $NodePath = $nodeCommand.Source }
}
if (-not $NodePath) {
    $bundled = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    if (Test-Path -LiteralPath $bundled) { $NodePath = $bundled }
}
if (-not $NodePath) { throw 'Install Node.js 22 or newer, or pass -NodePath with a node.exe path.' }
& $NodePath (Join-Path $PSScriptRoot 'preview.mjs')
if ($LASTEXITCODE -ne 0) { throw "Preview stopped with exit $LASTEXITCODE" }
