param([string]$SdkRoot = $env:CANGJIE_HOME)
$ErrorActionPreference = 'Stop'
if (-not $SdkRoot) { throw 'Set CANGJIE_HOME or pass -SdkRoot.' }
. (Join-Path (Resolve-Path -LiteralPath $SdkRoot).Path 'envsetup.ps1')
$root = Split-Path -Parent $PSScriptRoot
$doctor = Join-Path $root 'target/debug/doctor.exe'
if (-not (Test-Path -LiteralPath $doctor)) { throw 'Run scripts/build.ps1 first.' }
& $doctor --self-test
if ($LASTEXITCODE -ne 0) { throw "Native self-test did not pass (exit $LASTEXITCODE). This may be a startup/runtime failure; do not report native tests as passed." }
$run = Join-Path $root ('runs/native-tests-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $run | Out-Null
$utf8 = New-Object Text.UTF8Encoding($false)
foreach ($name in @('type_mismatch', 'undefined_name', 'argument_count', 'hello')) {
    $record = Get-Content -LiteralPath (Join-Path $root "tests/fixtures/$name.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $inputPath = Join-Path $run "$name.json"
    [IO.File]::WriteAllText($inputPath, ($record.compiler.stderr + $record.compiler.stdout), $utf8)
    $output = & $doctor parse $inputPath $record.compiler.exitCode
    if ($LASTEXITCODE -ne 0) { throw "Native parser failed for $name ($LASTEXITCODE)" }
    $parsed = $output | ConvertFrom-Json
    $expected = if ($name -eq 'hello') { 'compile_passed' } else { 'compile_failed' }
    if ($parsed.status -ne $expected -or $parsed.testStatus -ne 'not_run') { throw "Unexpected native result for $name" }
    Write-Output "PASS: native fixture $name"
}
