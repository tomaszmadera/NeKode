#Requires -Version 5.1
<#
.SYNOPSIS
  Regression tests for start.ps1 run identification without launching an app.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot 'start.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
$functionAst = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Test-RunActive'
}, $false)
if ($null -eq $functionAst) { throw 'Test-RunActive was not found in start.ps1.' }
Invoke-Expression $functionAst.Extent.Text

# Only process lookup is mocked. The production function reads actual fixture
# files and timestamps; neither an app nor an unrelated process is started/stopped.
$script:MockProcess = $null
function Get-Process {
    [CmdletBinding()]
    param([int]$Id)
    if ($null -ne $script:MockProcess -and $script:MockProcess.Id -eq $Id) {
        return $script:MockProcess
    }
    return $null
}

$fixtureDir = Join-Path ([System.IO.Path]::GetTempPath()) ('nekode-start-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $fixtureDir | Out-Null
$StateFile = Join-Path $fixtureDir 'nekode-run.json'
$script:Passed = 0

function Assert-RunActive {
    param(
        [string]$Label,
        [bool]$Expected,
        [string]$ProcessName = 'cmd',
        [string]$ProcessStart = '2026-11-03T12:00:01Z',
        [string]$RecordedStart = '',
        [string]$Mode = 'Dev',
        [switch]$MissingProcess
    )
    $state = @{
        rootPid = 4100
        mode = $Mode
        startedAt = '2026-11-03T12:00:00Z'
        repoRoot = $RepoRoot
    }
    if ($RecordedStart) { $state.rootStartedAt = $RecordedStart }
    [System.IO.File]::WriteAllText($StateFile, ($state | ConvertTo-Json))
    (Get-Item -LiteralPath $StateFile).LastWriteTimeUtc = [datetime]'2026-11-03T12:00:02Z'
    $script:MockProcess = if ($MissingProcess) { $null } else {
        [pscustomobject]@{
            Id = 4100
            ProcessName = $ProcessName
            StartTime = ([datetimeoffset]$ProcessStart).UtcDateTime
        }
    }
    $actual = Test-RunActive
    if ($actual -ne $Expected) {
        throw "$Label failed: expected active=$Expected, got $actual."
    }
    $script:Passed++
    Write-Host "PASS: $Label"
}

try {
    Assert-RunActive -Label 'A reused PID created after the legacy state is stale' `
        -Expected $false -ProcessStart '2026-11-03T12:05:00Z'
    Assert-RunActive -Label 'A system process with the saved PID is not NeKode' `
        -Expected $false -ProcessName 'svchost'
    Assert-RunActive -Label 'A process predating the run is stale' `
        -Expected $false -ProcessStart '2026-11-03T11:59:00Z'
    Assert-RunActive -Label 'An active legacy Dev run still blocks a duplicate' -Expected $true
    Assert-RunActive -Label 'The exact recorded Dev process is active' `
        -Expected $true -RecordedStart '2026-11-03T12:00:01Z'
    Assert-RunActive -Label 'A different creation time invalidates the saved identity' `
        -Expected $false -RecordedStart '2026-11-03T12:00:00.5000000Z'
    Assert-RunActive -Label 'An exact timestamp with the wrong executable is stale' `
        -Expected $false -ProcessName 'svchost' -RecordedStart '2026-11-03T12:00:01Z'
    Assert-RunActive -Label 'An active Unpacked run blocks a duplicate' `
        -Expected $true -Mode 'Unpacked' -ProcessName 'nekode' `
        -RecordedStart '2026-11-03T12:00:01Z'
    Assert-RunActive -Label 'An exited root is inactive' -Expected $false -MissingProcess
    Remove-Item -LiteralPath $StateFile
    if (Test-RunActive) { throw 'A missing state file must be inactive.' }
    $script:Passed++
    Write-Host "All $script:Passed start.ps1 regression tests passed."
}
finally {
    if (Test-Path -LiteralPath $StateFile) { Remove-Item -LiteralPath $StateFile }
    Remove-Item -LiteralPath $fixtureDir
}
