param([string]$SdkRoot = $env:CANGJIE_HOME)
$ErrorActionPreference = 'Stop'
if (-not $SdkRoot) { throw 'Set CANGJIE_HOME or pass -SdkRoot with the installed SDK directory.' }
$sdk = (Resolve-Path -LiteralPath $SdkRoot).Path
. (Join-Path $sdk 'envsetup.ps1')
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'target/debug'
New-Item -ItemType Directory -Path $target -Force | Out-Null
$compiler = Join-Path $sdk 'bin/cjc.exe'
$version = (& $compiler --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $version -notmatch 'Compiler: 1\.0\.5\b') { throw "Expected SDK 1.0.5. Found: $version" }
$pending = Join-Path $target 'doctor.pending.exe'
Push-Location $root
try {
    & $compiler -p src -o $pending --diagnostic-format=noColor
    if ($LASTEXITCODE -ne 0) { throw "Compilation failed ($LASTEXITCODE). Existing doctor.exe, if any, is an older build." }
    Move-Item -LiteralPath $pending -Destination (Join-Path $target 'doctor.exe') -Force
    Write-Output 'Build succeeded. This confirms compilation only; run --self-test to check the runtime.'
} finally { Pop-Location }
