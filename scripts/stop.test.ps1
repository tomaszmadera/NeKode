#Requires -Version 5.1
<#
.SYNOPSIS
  Regression tests for scripts\stop.ps1 PID reuse protection.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$StopScript = Join-Path $PSScriptRoot 'stop.ps1'
$StateFile = Join-Path $RepoRoot 'tmp\nekode-run.json'
$TmpDir = Join-Path $RepoRoot 'tmp'

New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null

function Cleanup-State {
    if (Test-Path $StateFile) { Remove-Item $StateFile -Force }
}

Write-Host "Running stop.ps1 regression tests..."

# -----------------------------------------------------------------------------
# Test 1: Stale rootPid with CreationDate before startedAt is NOT killed
# -----------------------------------------------------------------------------
Write-Host "Test 1: Stale rootPid (created before startedAt) must survive..."
Cleanup-State
$dummy1 = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -Command Start-Sleep -Seconds 120" -PassThru
$pid1 = $dummy1.Id
try {
    $futureStart = (Get-Date).AddMinutes(5).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    @{
        mode      = "Dev"
        rootPid   = $pid1
        startedAt = $futureStart
        logFile   = $null
        repoRoot  = $RepoRoot
    } | ConvertTo-Json | Set-Content -Path $StateFile -Encoding UTF8

    & $StopScript

    $alive = [bool](Get-Process -Id $pid1 -ErrorAction SilentlyContinue)
    if (-not $alive) {
        throw "Test 1 FAILED: Unrelated process $pid1 was killed by stop.ps1!"
    }
    Write-Host "  -> PASS: Unrelated process survived."
}
finally {
    Stop-Process -Id $pid1 -Force -ErrorAction SilentlyContinue
    Cleanup-State
}

# -----------------------------------------------------------------------------
# Test 2: Valid current run process IS killed
# -----------------------------------------------------------------------------
Write-Host "Test 2: Valid run rootPid (created after startedAt) must be stopped..."
Cleanup-State
$startedAt2 = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$dummy2 = Start-Process -FilePath "cmd.exe" -ArgumentList "/c powershell.exe -NoProfile -Command Start-Sleep -Seconds 60" -PassThru
$pid2 = $dummy2.Id
try {
    @{
        mode      = "Dev"
        rootPid   = $pid2
        startedAt = $startedAt2
        logFile   = $null
        repoRoot  = $RepoRoot
    } | ConvertTo-Json | Set-Content -Path $StateFile -Encoding UTF8

    & $StopScript

    $alive2 = [bool](Get-Process -Id $pid2 -ErrorAction SilentlyContinue)
    if ($alive2) {
        throw "Test 2 FAILED: Valid run process $pid2 was NOT stopped by stop.ps1!"
    }
    Write-Host "  -> PASS: Valid run process stopped."
}
finally {
    Stop-Process -Id $pid2 -Force -ErrorAction SilentlyContinue
    Cleanup-State
}

# -----------------------------------------------------------------------------
# Test 3: Stale state falls back to command-line attribution for repo leftovers
# -----------------------------------------------------------------------------
Write-Host "Test 3: Stale state with repo-attributable leftover..."
Cleanup-State
$unrelated = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -Command Start-Sleep -Seconds 120" -PassThru
$unrelatedPid = $unrelated.Id
$repoLeftover = Start-Process -FilePath "cmd.exe" -ArgumentList "/c echo $RepoRoot && powershell.exe -NoProfile -Command Start-Sleep -Seconds 120" -PassThru
$repoLeftoverPid = $repoLeftover.Id

Start-Sleep -Milliseconds 500

try {
    $futureStart3 = (Get-Date).AddMinutes(5).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    @{
        mode      = "Dev"
        rootPid   = $unrelatedPid
        startedAt = $futureStart3
        logFile   = $null
        repoRoot  = $RepoRoot
    } | ConvertTo-Json | Set-Content -Path $StateFile -Encoding UTF8

    & $StopScript

    $unrelatedAlive = [bool](Get-Process -Id $unrelatedPid -ErrorAction SilentlyContinue)
    $repoLeftoverAlive = [bool](Get-Process -Id $repoLeftoverPid -ErrorAction SilentlyContinue)

    if (-not $unrelatedAlive) {
        throw "Test 3 FAILED: Unrelated process $unrelatedPid was killed!"
    }
    if ($repoLeftoverAlive) {
        throw "Test 3 FAILED: Repo-attributable process $repoLeftoverPid was not swept!"
    }
    Write-Host "  -> PASS: Unrelated process survived, repo leftover killed."
}
finally {
    Stop-Process -Id $unrelatedPid -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $repoLeftoverPid -Force -ErrorAction SilentlyContinue
    Cleanup-State
}

# -----------------------------------------------------------------------------
# Test 4: Missing or invalid startedAt is treated as stale (process not killed)
# -----------------------------------------------------------------------------
Write-Host "Test 4: Invalid startedAt is treated as stale..."
Cleanup-State
$dummy4 = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -Command Start-Sleep -Seconds 120" -PassThru
$pid4 = $dummy4.Id
try {
    @{
        mode      = "Dev"
        rootPid   = $pid4
        startedAt = "invalid-date-string"
        logFile   = $null
        repoRoot  = $RepoRoot
    } | ConvertTo-Json | Set-Content -Path $StateFile -Encoding UTF8

    & $StopScript

    $alive4 = [bool](Get-Process -Id $pid4 -ErrorAction SilentlyContinue)
    if (-not $alive4) {
        throw "Test 4 FAILED: Process $pid4 with invalid startedAt was killed!"
    }
    Write-Host "  -> PASS: Process with invalid startedAt survived."
}
finally {
    Stop-Process -Id $pid4 -Force -ErrorAction SilentlyContinue
    Cleanup-State
}

Write-Host "`nAll 4 regression tests PASSED!"
