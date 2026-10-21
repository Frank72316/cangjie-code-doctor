param([string]$SdkRoot = $env:CANGJIE_HOME)
# Development evidence capture only. No imported source, model candidate, or executable is run.
$ErrorActionPreference = 'Stop'
if (-not $SdkRoot) { throw 'Set CANGJIE_HOME or pass -SdkRoot.' }
$sdk = (Resolve-Path -LiteralPath $SdkRoot).Path
. (Join-Path $sdk 'envsetup.ps1')
$root = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false, $true)
$compiler = Join-Path $sdk 'bin/cjc.exe'
$version = (& $compiler --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $version -notmatch 'Compiler: 1\.0\.5\b') { throw "Expected SDK 1.0.5. Found: $version" }
$manifest = Get-Content -LiteralPath (Join-Path $root 'examples/manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$fixtureDir = Join-Path $root 'tests/fixtures'
New-Item -ItemType Directory -Path $fixtureDir -Force | Out-Null
foreach ($name in @('type_mismatch.cj', 'undefined_name.cj', 'argument_count.cj', 'hello.cj')) {
    $original = Join-Path $root "examples/$name"
    $bytes = [IO.File]::ReadAllBytes($original)
    $hash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
    if ($hash -ne $manifest.sha256.$name) { throw "Sample changed since review: $name. Review it before updating the manifest." }
    $text = $utf8.GetString($bytes)
    $runDir = Join-Path $root ('runs/capture-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $runDir | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $runDir 'input.cj'), $bytes)
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $compiler
    $start.Arguments = '--diagnostic-format=json --error-count-limit 8 input.cj -o program.exe'
    $start.WorkingDirectory = $runDir
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = $utf8
    $start.StandardErrorEncoding = $utf8
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { throw 'Compiler did not start.' }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $finished = $process.WaitForExit(30000)
        if (-not $finished) {
            # Best effort cleanup of this compiler PID; this is not a sandbox.
            & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null
            throw "Trusted sample compilation timed out: $name. No fixture was published."
        }
        $process.WaitForExit()
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        $exitCode = $process.ExitCode
        if ($utf8.GetByteCount($stdout) + $utf8.GetByteCount($stderr) -gt 1048576) { throw 'Compiler output exceeded fixture limit.' }
        if ((Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw 'Original source changed during capture.' }
        $record = [ordered]@{
            schemaVersion = 1
            kind = 'trusted-development-capture'
            capturedAt = [DateTime]::UtcNow.ToString('o')
            source = [ordered]@{ name = $name; text = $text; sha256 = $hash }
            compiler = [ordered]@{
                version = $version
                inputName = 'input.cj'
                arguments = @('--diagnostic-format=json', '--error-count-limit', '8', 'input.cj', '-o', 'program.exe')
                exitCode = $exitCode
                stdout = $stdout
                stderr = $stderr
                timedOut = $false
                artifactCreated = (Test-Path -LiteralPath (Join-Path $runDir 'program.exe'))
            }
            execution = [ordered]@{ attempted = $false; testStatus = 'not_run' }
        }
        $json = $record | ConvertTo-Json -Depth 12
        [IO.File]::WriteAllText((Join-Path $runDir 'record.json'), $json, $utf8)
        [IO.File]::WriteAllText((Join-Path $runDir 'compiler.json'), ($stderr + $stdout), $utf8)
        $stem = [IO.Path]::GetFileNameWithoutExtension($name)
        [IO.File]::WriteAllText((Join-Path $fixtureDir "$stem.json"), $json, $utf8)
        Write-Output "$name : compiler exit $exitCode; original SHA-256 unchanged; executable not run"
    } finally { $process.Dispose() }
}
