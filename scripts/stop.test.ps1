#Requires -Version 5.1
<#
.SYNOPSIS
  Regression tests for scripts\stop.ps1 run identification and kill targeting.

.DESCRIPTION
  Two layers:
    * identity cases run the functions extracted from stop.ps1 against fixture
      state files, so legacy and current state formats are compared without
      touching any process;
    * script cases run stop.ps1 itself with -StateFile/-RepoRoot pointed at a
      fixture, using only processes this test starts. The user's own
      tmp\nekode-run.json is fingerprinted, never used for attribution,
      replaced, or removed.

  No test stops a real NeKode session, an editor, or any shell the test does
  not own.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$StopScript = Join-Path $PSScriptRoot 'stop.ps1'
$RealStateFile = Join-Path $RepoRoot 'tmp\nekode-run.json'

$script:Passed = 0
$script:Failures = New-Object 'System.Collections.Generic.List[string]'
$script:LastStopOutput = ''

function Assert-True {
    param([bool]$Condition, [string]$Label)
    if ($Condition) {
        $script:Passed++
        Write-Host "PASS: $Label"
        return
    }
    $script:Failures.Add($Label)
    Write-Host "FAIL: $Label"
}

function Assert-SuitePassed {
    if ($script:Failures.Count -eq 0) {
        Write-Host "All $($script:Passed) stop.ps1 regression checks passed."
        return
    }
    throw "$($script:Failures.Count) stop.ps1 regression check(s) failed: " +
        ($script:Failures -join '; ') + [Environment]::NewLine + $script:LastStopOutput
}

# --- Identity functions, taken from the script under test -----------------
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $StopScript, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
$functionNodes = $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
}, $true)
foreach ($name in @(
        'Get-StateValue',
        'Get-UtcInstant',
        'Get-ExpectedRootName',
        'Test-SameInstant',
        'Test-WithinCreationWindow',
        'Test-RootProcessMatch',
        'Test-SnapshotIdentity')) {
    $node = $functionNodes | Where-Object { $_.Name -eq $name } | Select-Object -First 1
    if ($null -eq $node) { throw "$name was not found in stop.ps1." }
    Invoke-Expression $node.Extent.Text
}

# --- Fixture state --------------------------------------------------------
function New-FixtureState {
    param(
        [string]$Mode = 'Dev',
        [string]$StartedAt = '2026-11-03T12:00:00Z',
        [string]$RootStartedAt = '',
        [switch]$WithoutMode
    )
    $fields = [ordered]@{}
    if (-not $WithoutMode) { $fields.mode = $Mode }
    $fields.rootPid = 4100
    if ($StartedAt) { $fields.startedAt = $StartedAt }
    if ($RootStartedAt) { $fields.rootStartedAt = $RootStartedAt }
    return ($fields | ConvertTo-Json) | ConvertFrom-Json
}

function Assert-RootMatch {
    param(
        [string]$Label,
        [bool]$Expected,
        $State,
        [string]$ProcessName = 'cmd.exe',
        [string]$ProcessCreated = '2026-11-03T12:00:01Z',
        [string]$StateWrittenAt = '2026-11-03T12:00:02Z',
        [switch]$MissingProcess
    )
    $info = $null
    if (-not $MissingProcess) {
        $info = @{
            name        = $ProcessName
            parent      = 1
            commandLine = ''
            created     = ([datetimeoffset]$ProcessCreated).LocalDateTime
        }
    }
    $written = ([datetimeoffset]$StateWrittenAt).UtcDateTime
    $actual = Test-RootProcessMatch -Info $info -State $State -StateWrittenUtc $written
    Assert-True -Condition ($actual -eq $Expected) -Label $Label
}

Write-Host 'Identity of the recorded root (fixture state):'

Assert-RootMatch -Label 'The exact recorded root identity is accepted' -Expected $true `
    -State (New-FixtureState -RootStartedAt '2026-11-03T12:00:01Z')

Assert-RootMatch -Label 'A reused PID created later than rootStartedAt is rejected' -Expected $false `
    -State (New-FixtureState -RootStartedAt '2026-11-03T12:00:01Z') `
    -ProcessCreated '2026-11-03T12:05:00Z'

Assert-RootMatch -Label 'A matching rootStartedAt with the wrong executable is rejected' -Expected $false `
    -State (New-FixtureState -RootStartedAt '2026-11-03T12:00:01Z') `
    -ProcessName 'svchost.exe'

Assert-RootMatch -Label 'An Unpacked run accepts its recorded nekode.exe root' -Expected $true `
    -State (New-FixtureState -Mode 'Unpacked' -RootStartedAt '2026-11-03T12:00:01Z') `
    -ProcessName 'nekode.exe'

Assert-RootMatch -Label 'An Unpacked state does not accept a cmd.exe root' -Expected $false `
    -State (New-FixtureState -Mode 'Unpacked' -RootStartedAt '2026-11-03T12:00:01Z')

Assert-RootMatch -Label 'An unknown mode cannot identify a root' -Expected $false `
    -State (New-FixtureState -Mode 'Mystery' -RootStartedAt '2026-11-03T12:00:01Z')

Assert-RootMatch -Label 'State without a mode cannot identify a root' -Expected $false `
    -State (New-FixtureState -RootStartedAt '2026-11-03T12:00:01Z' -WithoutMode)

Assert-RootMatch -Label 'An unparseable rootStartedAt does not fall back to the legacy window' -Expected $false `
    -State (New-FixtureState -RootStartedAt 'not-a-timestamp')

Assert-RootMatch -Label 'Legacy state accepts a root created during the run' -Expected $true `
    -State (New-FixtureState)

Assert-RootMatch -Label 'Legacy state rejects a PID reused after the state was written' -Expected $false `
    -State (New-FixtureState) -ProcessCreated '2026-11-03T12:05:00Z'

Assert-RootMatch -Label 'Legacy state rejects a process predating the run' -Expected $false `
    -State (New-FixtureState) -ProcessCreated '2026-11-03T11:59:00Z'

Assert-RootMatch -Label 'Legacy state with an unparseable startedAt is rejected' -Expected $false `
    -State (New-FixtureState -StartedAt 'not-a-timestamp')

Assert-RootMatch -Label 'Legacy state without startedAt is rejected' -Expected $false `
    -State (New-FixtureState -StartedAt '')

Assert-RootMatch -Label 'A missing root process cannot match' -Expected $false `
    -State (New-FixtureState -RootStartedAt '2026-11-03T12:00:01Z') -MissingProcess

# --- Fixture root and processes this test owns ----------------------------
$script:FixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('nekode-stop-' + [guid]::NewGuid().ToString('N'))
$script:FixtureTmp = Join-Path $script:FixtureRoot 'tmp'
$script:FixtureState = Join-Path $script:FixtureTmp 'nekode-run.json'
New-Item -ItemType Directory -Force -Path $script:FixtureTmp | Out-Null

$script:Spawned = New-Object 'System.Collections.Generic.List[int]'

function Start-TestProcess {
    param([string]$Arguments)
    $process = Start-Process -FilePath 'cmd.exe' -ArgumentList $Arguments -PassThru -WindowStyle Hidden
    $script:Spawned.Add($process.Id)
    return $process
}

function Get-CimProcess {
    param([int]$ProcId)
    return Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$ProcId" -ErrorAction SilentlyContinue
}

function Wait-ChildProcess {
    param([int]$ParentPid, [string]$Name)
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        $child = Get-CimInstance -ClassName Win32_Process -Filter "ParentProcessId=$ParentPid" -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq $Name } |
            Select-Object -First 1
        if ($null -ne $child) { return $child }
        Start-Sleep -Milliseconds 100
    }
    throw "no $Name child appeared under PID $ParentPid."
}

function Write-FixtureState {
    param(
        [int]$RootPid,
        [string]$RootStartedAt = '',
        [string]$StartedAt = '',
        [datetime]$WrittenUtc = ([datetime]::UtcNow),
        [string]$Mode = 'Dev'
    )
    $fields = [ordered]@{
        mode      = $Mode
        rootPid   = $RootPid
        startedAt = $StartedAt
        logFile   = $null
        repoRoot  = $script:FixtureRoot
    }
    if ($RootStartedAt) { $fields.rootStartedAt = $RootStartedAt }
    [System.IO.File]::WriteAllText($script:FixtureState, ($fields | ConvertTo-Json))
    (Get-Item -LiteralPath $script:FixtureState).LastWriteTimeUtc = $WrittenUtc
}

function Invoke-StopScript {
    $script:LastStopOutput = & $StopScript -StateFile $script:FixtureState -RepoRoot $script:FixtureRoot *>&1 | Out-String -Width 4096
}

function Test-Alive {
    param([int]$ProcId)
    return [bool](Get-Process -Id $ProcId -ErrorAction SilentlyContinue)
}

function Remove-TestProcesses {
    param([int[]]$ProcIds)
    foreach ($procId in $ProcIds) {
        foreach ($child in @(Get-CimInstance -ClassName Win32_Process -Filter "ParentProcessId=$procId" -ErrorAction SilentlyContinue)) {
            Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
        }
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
}

$realStateExisted = Test-Path -LiteralPath $RealStateFile
$realStateHashBefore = $null
$realStateWriteBefore = $null
if ($realStateExisted) {
    $realStateHashBefore = (Get-FileHash -LiteralPath $RealStateFile -Algorithm SHA256).Hash
    $realStateWriteBefore = (Get-Item -LiteralPath $RealStateFile).LastWriteTimeUtc
}

try {
    # --- Identity right before the kill, against real CIM timestamps ------
    Write-Host 'Pre-kill identity (real processes):'
    $guard = Start-TestProcess -Arguments '/c powershell.exe -NoProfile -Command Start-Sleep -Seconds 120'
    Start-Sleep -Milliseconds 300
    $guardCim = Get-CimProcess -ProcId $guard.Id
    $guardCreated = ([datetime]$guardCim.CreationDate).ToUniversalTime()

    Assert-True -Condition (Test-SnapshotIdentity -ProcId $guard.Id -ExpectedName 'cmd.exe' -ExpectedCreatedUtc $guardCreated) `
        -Label 'The live process still matches its snapshot'
    Assert-True -Condition (-not (Test-SnapshotIdentity -ProcId $guard.Id -ExpectedName 'cmd.exe' -ExpectedCreatedUtc $guardCreated.AddMinutes(5))) `
        -Label 'A creation instant from a later process rejects the PID'
    Assert-True -Condition (-not (Test-SnapshotIdentity -ProcId $guard.Id -ExpectedName 'powershell.exe' -ExpectedCreatedUtc $guardCreated)) `
        -Label 'A different executable at the same instant rejects the PID'

    $guardId = $guard.Id
    Remove-TestProcesses -ProcIds @($guardId)
    Start-Sleep -Milliseconds 300
    Assert-True -Condition (-not (Test-SnapshotIdentity -ProcId $guardId -ExpectedName 'cmd.exe' -ExpectedCreatedUtc $guardCreated)) `
        -Label 'A vanished PID is rejected'

    # --- A PID reused after a legacy run was recorded --------------------
    Write-Host 'A PID reused after the recorded run:'
    $alien = Start-TestProcess -Arguments '/c powershell.exe -NoProfile -Command Start-Sleep -Seconds 120'
    $alienChild = Wait-ChildProcess -ParentPid $alien.Id -Name 'powershell.exe'

    Write-FixtureState -RootPid $alien.Id `
        -StartedAt (Get-Date).ToUniversalTime().AddMinutes(-10).ToString('o') `
        -WrittenUtc (Get-Date).ToUniversalTime().AddMinutes(-5)
    Invoke-StopScript
    Assert-True -Condition (Test-Alive $alien.Id) -Label 'A legacy state whose PID was reused leaves the other process alone'
    Assert-True -Condition (Test-Alive $alienChild.ProcessId) -Label 'Children of the reused PID stay untouched'
    Assert-True -Condition (-not (Test-Path -LiteralPath $script:FixtureState)) -Label 'The consumed fixture state is removed'
    Remove-TestProcesses -ProcIds @($alien.Id)

    # --- A PID reused after a current-format run was recorded ------------
    Write-Host 'A PID reused after a current-format run:'
    $alien2 = Start-TestProcess -Arguments '/c powershell.exe -NoProfile -Command Start-Sleep -Seconds 120'
    $alien2Child = Wait-ChildProcess -ParentPid $alien2.Id -Name 'powershell.exe'

    Write-FixtureState -RootPid $alien2.Id `
        -RootStartedAt ([datetime]$alien2.StartTime).ToUniversalTime().AddMinutes(5).ToString('o') `
        -StartedAt (Get-Date).ToUniversalTime().AddMinutes(-10).ToString('o')
    Invoke-StopScript
    Assert-True -Condition (Test-Alive $alien2.Id) -Label 'A mismatched rootStartedAt does not stop the process'
    Assert-True -Condition (Test-Alive $alien2Child.ProcessId) -Label 'Children of a mismatched rootStartedAt survive'
    Remove-TestProcesses -ProcIds @($alien2.Id)

    Write-Host 'A recorded root with the wrong executable:'
    $alien3 = Start-TestProcess -Arguments '/c powershell.exe -NoProfile -Command Start-Sleep -Seconds 120'
    $alien3Child = Wait-ChildProcess -ParentPid $alien3.Id -Name 'powershell.exe'

    Write-FixtureState -RootPid $alien3.Id -Mode 'Unpacked' `
        -RootStartedAt ([datetime]$alien3.StartTime).ToUniversalTime().ToString('o') `
        -StartedAt (Get-Date).ToUniversalTime().AddMinutes(-10).ToString('o')
    Invoke-StopScript
    Assert-True -Condition (Test-Alive $alien3.Id) -Label 'A command-line process is not stopped as an Unpacked run root'
    Assert-True -Condition (Test-Alive $alien3Child.ProcessId) -Label 'Children of the rejected root survive'
    Remove-TestProcesses -ProcIds @($alien3.Id)

    # --- The current run is stopped --------------------------------------
    Write-Host 'The recorded current run:'
    # startedAt is recorded before the process exists, exactly like start.ps1.
    $runStartedAt = (Get-Date).ToUniversalTime().ToString('o')
    $run = Start-TestProcess -Arguments '/c powershell.exe -NoProfile -Command Start-Sleep -Seconds 120'
    $runChild = Wait-ChildProcess -ParentPid $run.Id -Name 'powershell.exe'

    Write-FixtureState -RootPid $run.Id -RootStartedAt $run.StartTime.ToUniversalTime().ToString('o') `
        -StartedAt $runStartedAt
    Invoke-StopScript
    Assert-True -Condition (-not (Test-Alive $run.Id)) -Label 'The recorded root of the current run is stopped'
    Assert-True -Condition (-not (Test-Alive $runChild.ProcessId)) -Label 'A child of the recorded root is stopped'
    Assert-True -Condition (-not (Test-Path -LiteralPath $script:FixtureState)) -Label 'Stopping the current run consumes its state'

    Write-Host 'A legacy-format current run:'
    $legacyRun = Start-TestProcess -Arguments '/c powershell.exe -NoProfile -Command Start-Sleep -Seconds 120'
    $legacyChild = Wait-ChildProcess -ParentPid $legacyRun.Id -Name 'powershell.exe'

    Write-FixtureState -RootPid $legacyRun.Id `
        -StartedAt (Get-Date).ToUniversalTime().AddMinutes(-2).ToString('o')
    Invoke-StopScript
    Assert-True -Condition (-not (Test-Alive $legacyRun.Id)) -Label 'A legacy-format run root created during the run is stopped'
    Assert-True -Condition (-not (Test-Alive $legacyChild.ProcessId)) -Label 'A legacy-format child of the run is stopped'

    # --- Leftovers and ambiguous state -----------------------------------
    Write-Host 'State whose root process is gone:'
    $unrelated = Start-TestProcess -Arguments '/c powershell.exe -NoProfile -Command Start-Sleep -Seconds 120'
    $leftover = Start-TestProcess -Arguments "/c cd /d $($script:FixtureRoot) && powershell.exe -NoProfile -Command Start-Sleep -Seconds 120"
    Start-Sleep -Milliseconds 400
    $gone = Start-TestProcess -Arguments '/c powershell.exe -NoProfile -Command Start-Sleep -Seconds 5'
    $goneId = $gone.Id
    Remove-TestProcesses -ProcIds @($goneId)
    Start-Sleep -Milliseconds 400

    Write-FixtureState -RootPid $goneId `
        -StartedAt (Get-Date).ToUniversalTime().AddMinutes(-10).ToString('o') `
        -WrittenUtc (Get-Date).ToUniversalTime().AddMinutes(-5)
    Invoke-StopScript
    Assert-True -Condition (Test-Alive $unrelated.Id) -Label 'A process outside the repository survives a sweep'
    Assert-True -Condition (-not (Test-Alive $leftover.Id)) -Label 'A repository-attributable leftover is swept'
    Remove-TestProcesses -ProcIds @($unrelated.Id)

    Write-Host 'An unreadable state file:'
    $sweepOnly = Start-TestProcess -Arguments "/c cd /d $($script:FixtureRoot) && powershell.exe -NoProfile -Command Start-Sleep -Seconds 120"
    $bystander = Start-TestProcess -Arguments '/c powershell.exe -NoProfile -Command Start-Sleep -Seconds 120'
    Start-Sleep -Milliseconds 400
    [System.IO.File]::WriteAllText($script:FixtureState, 'this is not json')
    Invoke-StopScript
    Assert-True -Condition ($script:LastStopOutput -match 'unreadable') -Label 'An unreadable state file is reported, not fatal'
    Assert-True -Condition (Test-Alive $bystander.Id) -Label 'An unreadable state file still leaves outside processes alone'
    Assert-True -Condition (-not (Test-Alive $sweepOnly.Id)) -Label 'An unreadable state file still sweeps repository leftovers'
    Remove-TestProcesses -ProcIds @($bystander.Id)

    Write-Host 'No state file at all:'
    if (Test-Path -LiteralPath $script:FixtureState) { Remove-Item -LiteralPath $script:FixtureState -Force }
    $noStateBystander = Start-TestProcess -Arguments '/c powershell.exe -NoProfile -Command Start-Sleep -Seconds 120'
    Start-Sleep -Milliseconds 300
    Invoke-StopScript
    Assert-True -Condition (Test-Alive $noStateBystander.Id) -Label 'Without state, no unrelated process is stopped'
    Remove-TestProcesses -ProcIds @($noStateBystander.Id)

    # --- The user's own run state is never part of verification ----------
    $realStateExistsNow = Test-Path -LiteralPath $RealStateFile
    Assert-True -Condition ($realStateExistsNow -eq $realStateExisted) -Label 'The real run state file is not created or removed'
    if ($realStateExisted) {
        Assert-True -Condition ((Get-FileHash -LiteralPath $RealStateFile -Algorithm SHA256).Hash -eq $realStateHashBefore) `
            -Label 'The real run state file content is unchanged'
        Assert-True -Condition ((Get-Item -LiteralPath $RealStateFile).LastWriteTimeUtc -eq $realStateWriteBefore) `
            -Label 'The real run state file timestamp is unchanged'
    }

    Assert-SuitePassed
}
finally {
    Remove-TestProcesses -ProcIds @($script:Spawned.ToArray())
    if (Test-Path -LiteralPath $script:FixtureRoot) {
        Remove-Item -LiteralPath $script:FixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
