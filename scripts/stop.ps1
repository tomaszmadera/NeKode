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

  The recorded root PID is used only while the live process still matches the
  run that recorded it: the executable implied by the recorded mode, and the
  creation instant saved as rootStartedAt. State written before rootStartedAt
  existed falls back to the window between startedAt and the write time of the
  state file, so a process that reuses the PID later is never attributed to the
  run. The same identity is re-checked immediately before every Stop-Process,
  which covers PID reuse between the process snapshot and the kill.

  Everything attributable is killed (shells first). Bare pwsh/powershell
  processes that cannot be attributed to the run are REPORTED, never killed.
  The calling shell and its ancestors are always protected.

  Useful for acceptance criterion "app quit leaves no orphaned shells".

.PARAMETER StateFile
  Run state file to read and remove. Defaults to tmp\nekode-run.json in the
  repository root. scripts\stop.test.ps1 points it at an isolated fixture.

.PARAMETER RepoRoot
  Repository root matched against process command lines. Defaults to the parent
  directory of this script. scripts\stop.test.ps1 points it at a fixture root.

.EXAMPLE
  scripts\stop.ps1
#>
[CmdletBinding()]
param(
    [string]$StateFile,
    [string]$RepoRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Split-Path -Parent $PSScriptRoot
}
$RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
if ([string]::IsNullOrWhiteSpace($StateFile)) {
    $StateFile = Join-Path $RepoRoot 'tmp\nekode-run.json'
}
$StateFile = [System.IO.Path]::GetFullPath($StateFile)

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

function Get-StateValue {
    param($State, [string]$Name)
    if ($null -eq $State) { return $null }
    $property = $State.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-UtcInstant {
    param($Value)
    if ($null -eq $Value) { return $null }
    try {
        if ($Value -is [datetime]) { return ([datetime]$Value).ToUniversalTime() }
        if ($Value -is [datetimeoffset]) { return ([datetimeoffset]$Value).UtcDateTime }
        return ([datetimeoffset][string]$Value).UtcDateTime
    }
    catch { return $null }
}

function Get-ExpectedRootName {
    param([string]$Mode)
    switch ($Mode) {
        'Dev' { return 'cmd.exe' }
        'Unpacked' { return 'nekode.exe' }
        default { return $null }
    }
}

function Test-SameInstant {
    param([datetime]$Left, [datetime]$Right)
    # System.Diagnostics and CIM report one creation instant with different
    # sub-millisecond rounding (observed 5 ticks apart), so identity compares
    # instants. A 1 s tolerance stays far below any real run lifetime, which is
    # what separates a reused PID from the recorded process.
    $deltaMs = [math]::Abs(
        (([datetime]$Left).ToUniversalTime() - ([datetime]$Right).ToUniversalTime()).TotalMilliseconds)
    return $deltaMs -lt 1000
}

function Test-WithinCreationWindow {
    param([datetime]$Created, [datetime]$From, [datetime]$To)
    $tolerance = [TimeSpan]::FromMilliseconds(1000)
    $instant = ([datetime]$Created).ToUniversalTime()
    return ($instant -ge $From.ToUniversalTime().Subtract($tolerance)) -and
        ($instant -le $To.ToUniversalTime().Add($tolerance))
}

function Test-RootProcessMatch {
    # Identity of the recorded root: the executable implied by the recorded
    # mode and the creation instant saved with the run.
    param(
        [hashtable]$Info,
        $State,
        [datetime]$StateWrittenUtc
    )
    if ($null -eq $Info -or $null -eq $State) { return $false }

    $expectedName = Get-ExpectedRootName -Mode ([string](Get-StateValue $State 'mode'))
    if (-not $expectedName) { return $false }
    if ([string]$Info.name -ne $expectedName) { return $false }

    $recordedStartValue = Get-StateValue $State 'rootStartedAt'
    $recordedStart = Get-UtcInstant $recordedStartValue
    if ($null -ne $recordedStart) {
        return Test-SameInstant -Left $Info.created -Right $recordedStart
    }
    # A present but unparseable rootStartedAt is not a licence to fall back to
    # the weaker legacy window.
    if ($null -ne $recordedStartValue) { return $false }

    # Legacy state: the root was created between the recorded start and the
    # moment the state file was written. A process created after that write is
    # a later PID reuse, not the recorded run.
    $runStart = Get-UtcInstant (Get-StateValue $State 'startedAt')
    if ($null -eq $runStart) { return $false }
    return Test-WithinCreationWindow -Created $Info.created -From $runStart -To $StateWrittenUtc
}

function Test-SnapshotIdentity {
    # Re-reads a live process and compares it with its snapshot entry, so a PID
    # reused between the snapshot and the kill is not terminated. Returns $null
    # when the process is already gone, so callers can tell "exited" from
    # "something else answers to this PID now".
    param(
        [int]$ProcId,
        [string]$ExpectedName,
        [datetime]$ExpectedCreatedUtc
    )
    $live = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$ProcId" -ErrorAction SilentlyContinue
    if ($null -eq $live) { return $null }
    if ([string]$live.Name -ne $ExpectedName) { return $false }
    return Test-SameInstant -Left ([datetime]$live.CreationDate) -Right $ExpectedCreatedUtc
}

function Stop-Safe {
    param([int]$ProcId, [string]$Reason)
    if ($protected.Contains($ProcId)) { return $false }
    if (-not $byPid.ContainsKey($ProcId)) { return $false }
    $info = $byPid[$ProcId]
    $stillTheSame = Test-SnapshotIdentity -ProcId $ProcId `
        -ExpectedName ([string]$info.name) `
        -ExpectedCreatedUtc ([datetime]$info.created).ToUniversalTime()
    if ($null -eq $stillTheSame) { return $false }
    if (-not $stillTheSame) {
        Write-Host "  skipped PID $ProcId - a different process now answers to this PID."
        return $false
    }
    # The check and Stop-Process are not atomic; the gap is microseconds and a
    # process reusing the PID there would also have to reuse name and creation
    # time to be mistaken for this one.
    Stop-Process -Id $ProcId -Force -ErrorAction SilentlyContinue
    Write-Host "  killed PID $ProcId ($($info.name)) - $Reason"
    return $true
}

$state = $null
$stateWrittenUtc = $null
$stateUnreadable = $false
if (Test-Path -LiteralPath $StateFile) {
    $stateWrittenUtc = (Get-Item -LiteralPath $StateFile).LastWriteTimeUtc
    try {
        $state = Get-Content -Raw -LiteralPath $StateFile | ConvertFrom-Json
    }
    catch {
        Write-Host "Run state at $StateFile is unreadable; sweeping leftovers only."
        $state = $null
        $stateUnreadable = $true
    }
}

# --- Attribution ---------------------------------------------------------
$attributable = New-Object 'System.Collections.Generic.HashSet[int]'

$rootPid = 0
$rootInfo = $null
$rootValid = $false
if ($state) {
    $parsedPid = 0
    if ([int]::TryParse([string](Get-StateValue $state 'rootPid'), [ref]$parsedPid) -and $parsedPid -gt 0) {
        $rootPid = $parsedPid
        if ($byPid.ContainsKey($rootPid)) {
            $rootInfo = $byPid[$rootPid]
        }
    }
    if ($rootInfo -and $null -ne $stateWrittenUtc) {
        $rootValid = Test-RootProcessMatch -Info $rootInfo -State $state -StateWrittenUtc $stateWrittenUtc
    }
}

if ($rootValid) {
    Write-Host "Stopping NeKode run (mode $(Get-StateValue $state 'mode'), root PID $rootPid)..."
    [void]$attributable.Add($rootPid)
    foreach ($d in Get-Descendants -Root $rootPid) { [void]$attributable.Add($d) }
}
elseif ($state) {
    if ($rootInfo) {
        $expectedName = Get-ExpectedRootName -Mode ([string](Get-StateValue $state 'mode'))
        $recordedStart = Get-StateValue $state 'rootStartedAt'
        $expected = if ($expectedName) {
            "$expectedName created $recordedStart"
        }
        else {
            'an executable named by the recorded mode'
        }
        Write-Host "Run state found but root PID $rootPid is not the recorded run (expected $expected); treating as stale and sweeping leftovers."
    }
    else {
        Write-Host 'Run state found but the root process is already gone; sweeping leftovers.'
    }
}
else {
    if (-not $stateUnreadable) {
        Write-Host "No run state ($StateFile); sweeping for repo-attributable leftovers only."
    }
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
$startedAt = Get-UtcInstant (Get-StateValue $state 'startedAt')
$orphanReport = New-Object 'System.Collections.Generic.List[object]'
$runStart = $null
if ($null -ne $startedAt) {
    $runStart = $startedAt.AddMinutes(-1)
}
foreach ($procId in @($byPid.Keys)) {
    if ($protected.Contains($procId) -or $attributable.Contains($procId)) { continue }
    $info = $byPid[$procId]
    if ($info.name -notmatch $ShellPattern) { continue }
    if (!(Get-Process -Id $procId -ErrorAction SilentlyContinue)) { continue }
    $candidate = $false
    if ($runStart -and $info.created) {
        $candidate = ([datetime]$info.created).ToUniversalTime() -ge $runStart
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

if (Test-Path -LiteralPath $StateFile) { Remove-Item -LiteralPath $StateFile -Force }

Write-Host ''
Write-Host "Done. Attributable processes processed: $($attributable.Count)."
if ($orphanReport.Count -gt 0) {
    Write-Host 'Shells left running (NOT killed - reviewed manually; they are not attributable to this run):'
    $orphanReport | Format-Table -AutoSize | Out-String | Write-Host
}
else {
    Write-Host 'No unattributable shells remain.'
}
