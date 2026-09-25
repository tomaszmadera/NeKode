#Requires -Version 5.1
<#
.SYNOPSIS
  Stops the NeKode run started by scripts\start.ps1 and reaps leftovers.

.DESCRIPTION
  The dev process chain is not strictly rooted at the recorded PID (pnpm
  re-spawns through intermediate shells), so attribution is three-fold:
    1) the recorded run tree (root PID + descendants),
    2) processes named node/cmd/electron/nekode whose command line mentions
       the repository root,
    3) transitive children of (1) and (2) - this is what captures node-pty
       shells, whose only link to the app is their parent process.

  Everything attributable is killed (shells first). Bare pwsh/powershell
  processes that cannot be attributed to the run are REPORTED, never killed.
  The calling shell and its ancestors are always protected.

  Useful for acceptance criterion "app quit leaves no orphaned shells".

.EXAMPLE
  scripts\stop.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$StateFile = Join-Path $RepoRoot 'tmp\nekode-run.json'
$ShellPattern = '^(pwsh|powershell|powershell_ise)\.exe$'
$AppProcessPattern = '^(node|cmd|electron|nekode)\.exe$'

# Snapshot of the process table: pid -> @{name; parent; commandLine; created}.
$byPid = @{}
foreach ($p in Get-CimInstance Win32_Process) {
    $byPid[[int]$p.ProcessId] = @{
        name        = [string]$p.Name
        parent      = [int]$p.ParentProcessId
        commandLine = [string]$p.CommandLine
        created     = $p.CreationDate
    }
}

# Protected: the process running this script and its ancestors (never kill
# the user's console host, even when its command line mentions the repo).
$protected = New-Object 'System.Collections.Generic.HashSet[int]'
$walk = $PID
while ($walk -gt 0 -and $byPid.ContainsKey($walk)) {
    [void]$protected.Add($walk)
    $walk = $byPid[$walk].parent
}

function Test-CommandMentionsRepo {
    param([string]$CommandLine)
    if ([string]::IsNullOrEmpty($CommandLine)) { return $false }
    return $CommandLine.IndexOf($RepoRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Get-Descendants {
    param([int]$Root)
    $found = New-Object 'System.Collections.Generic.List[int]'
    $queue = New-Object 'System.Collections.Generic.Queue[int]'
    $queue.Enqueue($Root)
    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        foreach ($procId in @($byPid.Keys)) {
            if ($byPid[$procId].parent -eq $current -and -not $found.Contains($procId)) {
                $found.Add($procId)
                $queue.Enqueue($procId)
            }
        }
    }
    return $found
}

function Stop-Safe {
    param([int]$ProcId, [string]$Reason)
    if ($protected.Contains($ProcId)) { return $false }
    if (!(Get-Process -Id $ProcId -ErrorAction SilentlyContinue)) { return $false }
    $label = 'unknown'
    if ($byPid.ContainsKey($ProcId)) { $label = $byPid[$ProcId].name }
    Stop-Process -Id $ProcId -Force -ErrorAction SilentlyContinue
    Write-Host "  killed PID $ProcId ($label) - $Reason"
    return $true
}

$state = $null
if (Test-Path $StateFile) {
    $state = Get-Content -Raw $StateFile | ConvertFrom-Json
}

# --- Attribution ---------------------------------------------------------
$attributable = New-Object 'System.Collections.Generic.HashSet[int]'

if ($state -and (Get-Process -Id $state.rootPid -ErrorAction SilentlyContinue)) {
    Write-Host "Stopping NeKode run (mode $($state.mode), root PID $($state.rootPid))..."
    [void]$attributable.Add([int]$state.rootPid)
    foreach ($d in Get-Descendants -Root ([int]$state.rootPid)) { [void]$attributable.Add($d) }
}
elseif ($state) {
    Write-Host 'Run state found but the root process is already gone; sweeping leftovers.'
}
else {
    Write-Host 'No run state (tmp\nekode-run.json); sweeping for repo-attributable leftovers only.'
}

foreach ($procId in @($byPid.Keys)) {
    $info = $byPid[$procId]
    if ($info.name -match $AppProcessPattern -and (Test-CommandMentionsRepo $info.commandLine)) {
        [void]$attributable.Add($procId)
    }
}

# Transitive children of everything attributable (catches PTY shells and
# detached intermediates). Iterate to a fixed point.
do {
    $added = 0
    foreach ($procId in @($byPid.Keys)) {
        if (-not $attributable.Contains($procId) -and $attributable.Contains($byPid[$procId].parent)) {
            [void]$attributable.Add($procId)
            $added++
        }
    }
} while ($added -gt 0)

# --- Kill (shells first, then the rest) ---------------------------------
foreach ($procId in @($attributable)) {
    if ($byPid.ContainsKey($procId) -and $byPid[$procId].name -match $ShellPattern) {
        [void](Stop-Safe -ProcId $procId -Reason 'PTY shell of the run')
    }
}
foreach ($procId in @($attributable)) {
    [void](Stop-Safe -ProcId $procId -Reason 'run process')
}

# Leftover shells that could NOT be attributed: report only, never kill.
# With run state, only shells that started around/after the run are candidates;
# without it, only true orphans (dead parent) are. Pre-existing user shells
# (e.g. Windows Terminal sessions) are never reported.
$orphanReport = New-Object 'System.Collections.Generic.List[object]'
$runStart = $null
if ($state -and $state.startedAt) {
    try { $runStart = ([datetime]$state.startedAt).AddMinutes(-1) } catch { $runStart = $null }
}
foreach ($procId in @($byPid.Keys)) {
    if ($protected.Contains($procId) -or $attributable.Contains($procId)) { continue }
    $info = $byPid[$procId]
    if ($info.name -notmatch $ShellPattern) { continue }
    if (!(Get-Process -Id $procId -ErrorAction SilentlyContinue)) { continue }
    $candidate = $false
    if ($runStart -and $info.created) {
        $candidate = ([datetime]$info.created) -ge $runStart
    }
    elseif (-not $runStart) {
        $candidate = -not (Get-Process -Id $info.parent -ErrorAction SilentlyContinue)
    }
    if ($candidate) {
        $orphanReport.Add([pscustomobject]@{
            PID         = $procId
            Name        = $info.name
            ParentPID   = $info.parent
            Started     = $info.created
            CommandLine = $info.commandLine
        })
    }
}

if (Test-Path $StateFile) { Remove-Item $StateFile -Force }

Write-Host ''
Write-Host "Done. Attributable processes processed: $($attributable.Count)."
if ($orphanReport.Count -gt 0) {
    Write-Host 'Shells left running (NOT killed - reviewed manually; they are not attributable to this run):'
    $orphanReport | Format-Table -AutoSize | Out-String | Write-Host
}
else {
    Write-Host 'No unattributable shells remain.'
}
