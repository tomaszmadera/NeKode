#Requires -Version 5.1
<#
.SYNOPSIS
  Starts the NeKode Electron app and records the run for scripts\stop.ps1.

.DESCRIPTION
  Dev mode (default): launches `pnpm run dev` detached from a hidden console,
  with stdout/stderr redirected to tmp\logs\ (tmp\ is gitignored).
  Unpacked mode: runs the packaged build from dist\win-unpacked\nekode.exe
  (build it first with `pnpm run build:unpack`).

  The root PID is recorded in tmp\nekode-run.json so scripts\stop.ps1 can kill
  the exact process tree (including PTY shells) and verify nothing is left.

.EXAMPLE
  scripts\start.ps1
  scripts\start.ps1 -Mode Unpacked
#>
[CmdletBinding()]
param(
    [ValidateSet('Dev', 'Unpacked')]
    [string]$Mode = 'Dev'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$StateFile = Join-Path $RepoRoot 'tmp\nekode-run.json'
$LogDir = Join-Path $RepoRoot 'tmp\logs'

function Test-RunActive {
    if (!(Test-Path $StateFile)) { return $false }
    $state = Get-Content -Raw $StateFile | ConvertFrom-Json
    return [bool](Get-Process -Id $state.rootPid -ErrorAction SilentlyContinue)
}

if (Test-RunActive) {
    $state = Get-Content -Raw $StateFile | ConvertFrom-Json
    Write-Host "NeKode already running (mode $($state.mode), root PID $($state.rootPid))."
    Write-Host 'Stop it first with: scripts\stop.ps1'
    exit 1
}

if (Test-Path $StateFile) {
    Write-Host 'Replacing stale run state (previous root process is gone).'
    Remove-Item $StateFile -Force
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$startedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

if ($Mode -eq 'Dev') {
    if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Write-Error 'pnpm not found in PATH.'
        exit 1
    }
    $outLog = Join-Path $LogDir 'nekode-dev.log'
    $errLog = Join-Path $LogDir 'nekode-dev.err.log'
    # cmd /c keeps pnpm.cmd resolution simple; the console stays hidden and
    # both streams land in tmp\logs.
    $proc = Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', 'pnpm run dev' `
        -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput $outLog `
        -RedirectStandardError $errLog `
        -WindowStyle Hidden `
        -PassThru
    $rootPid = $proc.Id
    $logFile = $outLog
}
else {
    $exe = Join-Path $RepoRoot 'dist\win-unpacked\nekode.exe'
    if (!(Test-Path $exe)) {
        Write-Error "Packaged build not found at $exe. Run 'pnpm run build:unpack' first."
        exit 1
    }
    $proc = Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -PassThru
    $rootPid = $proc.Id
    $logFile = $null
}

@{
    mode      = $Mode
    rootPid   = $rootPid
    startedAt = $startedAt
    logFile   = $logFile
    repoRoot  = $RepoRoot
} | ConvertTo-Json | Set-Content -Path $StateFile -Encoding UTF8

Start-Sleep -Seconds 3

if (Get-Process -Id $rootPid -ErrorAction SilentlyContinue) {
    Write-Host "NeKode started (mode $Mode, root PID $rootPid)."
    if ($logFile) { Write-Host "Dev output: $logFile" }
    Write-Host 'Stop with: scripts\stop.ps1'
}
else {
    Write-Warning "Root process exited within 3 seconds. Check logs in $LogDir (Unpacked mode: run the exe from a console to see errors)."
    exit 1
}
