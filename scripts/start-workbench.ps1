param([string]$SdkRoot = 'D:\Cangjie', [string]$NodePath)
$ErrorActionPreference = 'Stop'
$previousTheme = $env:DOCTOR_WORKBENCH_THEME
try {
    $env:DOCTOR_WORKBENCH_THEME = 'voxel'
    Write-Output 'Formal workbench: http://127.0.0.1:8765/tutorial'
    Write-Output 'Check environment status before live compilation. Saved reports remain readable if the runtime is unavailable.'
    & (Join-Path $PSScriptRoot 'preview.ps1') -SdkRoot $SdkRoot -NodePath $NodePath
} finally {
    $env:DOCTOR_WORKBENCH_THEME = $previousTheme
}
