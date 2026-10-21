param([string]$NodePath, [string]$SdkRoot = $env:CANGJIE_HOME)
$ErrorActionPreference = 'Stop'
if (-not $SdkRoot) {
    $compilerCommand = Get-Command cjc -ErrorAction SilentlyContinue
    if ($compilerCommand) { $SdkRoot = Split-Path -Parent (Split-Path -Parent $compilerCommand.Source) }
}
if ($SdkRoot -and (Test-Path -LiteralPath (Join-Path $SdkRoot 'envsetup.ps1'))) { . (Join-Path $SdkRoot 'envsetup.ps1') }
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
