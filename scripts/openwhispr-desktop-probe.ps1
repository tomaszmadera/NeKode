[CmdletBinding()]
param(
    [switch]$Live,
    [switch]$OfflineCheck,
    [string]$Shortcut,
    [string]$ActivationMode,
    [string]$ProcessingMode,
    [ValidateSet('1', '2')]
    [string]$MaxTakes = '2'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ProbeKeys([string]$Value) {
    # This bounded probe supports the user's confirmed chord only. No inferred defaults.
    if ($Value -notmatch '^\s*Ctrl\s*\+\s*Super\s*$') {
        throw 'Unsupported shortcut. Confirm the actual Ctrl + Super configuration before using this probe.'
    }
    return @(0x11, 0x5B) # Control and left Windows (Super).
}

function Assert-ProbeConfiguration([bool]$IsLive, [string]$Chord, [string]$Mode, [string]$Processing, [int]$AttemptLimit = 2) {
    if ($AttemptLimit -notin @(1, 2)) { throw 'MaxTakes must be 1 or 2.' }
    if ($Chord) { $null = Get-ProbeKeys $Chord }
    if ($Mode -and $Mode -notin @('Tap', 'Hold')) { throw 'ActivationMode must be Tap or Hold.' }
    if ($Processing -and $Processing -notin @('Local', 'Cloud')) { throw 'ProcessingMode must be Local or Cloud.' }
    if ($IsLive -and (!$Chord -or !$Mode -or !$Processing)) {
        throw 'Live requires explicit Shortcut, ActivationMode and ProcessingMode from your actual settings.'
    }
}

function Release-ProbeKeys($State, [scriptblock]$Send) {
    if ($State.Releasing) { return }
    $State.Releasing = $true
    try {
        $failed = [System.Collections.Generic.List[int]]::new()
        $keys = @($State.Held.ToArray())
        [array]::Reverse($keys)
        foreach ($key in $keys) {
            try {
                & $Send $key $true
                $null = $State.Held.Remove($key)
            } catch {
                $failed.Add($key)
            }
        }
        if ($failed.Count) { throw 'Key release failed. Stop the test and release Ctrl and Super manually; retry Release.' }
    } finally { $State.Releasing = $false }
}

function Send-ProbeChord($State, [int[]]$Keys, [scriptblock]$Send, [scriptblock]$Foreground, [bool]$Hold) {
    if ($State.Held.Count) { throw 'Release the previous chord before activation.' }
    if (!(& $Foreground)) { throw 'Activation refused: the scratch window is not foreground.' }
    $completed = $false
    try {
        foreach ($key in $Keys) {
            if (!(& $Foreground)) { throw 'Focus changed during activation. External recording state is uncertain.' }
            # Track before sending so a partial/native failure still receives key-up.
            $State.Held.Add($key)
            & $Send $key $false
        }
        $completed = $true
    } finally {
        if (!$Hold -or !$completed) { Release-ProbeKeys $State $Send }
    }
}

function Release-ProbeSafely($State, [scriptblock]$Send, [scriptblock]$Update) {
    if (!$State.Held.Count) { return }
    $State.Phase = 'Uncertain: released on focus loss or close'
    if ($State.Releasing) { return }
    try { Release-ProbeKeys $State $Send } catch { $State.LastError = $_.Exception.Message }
    & $Update
}

function Get-ProbeControlState($State, [bool]$IsLive, [string]$Mode, [int]$AttemptLimit) {
    # One headless calculation owns both button eligibility and the visible reasons.
    $startReasons = @(); $observedReasons = @(); $stopReasons = @(); $resetReasons = @()
    if (!$IsLive) {
        $startReasons += 'preview sends no keys'; $observedReasons += 'preview sends no keys'
        $stopReasons += 'preview sends no keys'; $resetReasons += 'preview sends no keys'
    }
    if ($State.Phase -ne 'Ready') { $startReasons += "phase is $($State.Phase); confirm external stop first" }
    if ($State.StartAttempts -ge $AttemptLimit) { $startReasons += 'Start-attempt limit reached' }
    if ($State.Held.Count) { $startReasons += 'release held keys first'; $resetReasons += 'release held keys first' }
    if ($State.Phase -ne 'Start sent') { $observedReasons += 'requires Start sent' }
    if (!$State.Held.Count -and !($Mode -eq 'Tap' -and $State.Phase -eq 'Recording observed')) {
        $stopReasons += 'requires held keys or observed Tap recording'
    }
    if ($State.Phase -eq 'Ready') { $resetReasons += 'already Ready' }
    $modeText = if ($IsLive) { 'LIVE' } else { 'Preview' }
    $heldText = if ($State.Held.Count) { $State.Held -join ', ' } else { 'none' }
    $lines = @("Mode: $modeText. State: $($State.Phase). Start attempts: $($State.StartAttempts)/$AttemptLimit. Held keys: $heldText.")
    foreach ($pair in @(@('Start', $startReasons), @('Recording observed', $observedReasons), @('Stop / release', $stopReasons), @('Stopped confirmed', $resetReasons))) {
        $reason = if ($pair[1].Count) { 'disabled: ' + ($pair[1] -join '; ') } else { 'available' }
        $lines += "$($pair[0]): $reason."
    }
    $lines += 'This is probe state, not OpenWhispr telemetry.'
    $lines += 'If external recording is uncertain, stop OpenWhispr manually. Never retry a toggle automatically.'
    if ($State.LastError) { $lines += "Error: $($State.LastError)" }
    return @{
        StartEnabled = $startReasons.Count -eq 0; ObservedEnabled = $observedReasons.Count -eq 0
        StopEnabled = $stopReasons.Count -eq 0; ResetEnabled = $resetReasons.Count -eq 0
        StatusText = $lines -join "`r`n"
    }
}

function Test-ProbeOffline {
    function Assert([bool]$Condition, [string]$Message) {
        if (!$Condition) { throw "Offline check failed: $Message" }
    }
    function Reject([scriptblock]$Action) {
        $rejected = $false
        try { & $Action } catch { $rejected = $true }
        Assert $rejected 'invalid configuration/action was accepted'
    }
    Assert-ProbeConfiguration $false '' '' ''
    foreach ($mode in @('Tap', 'Hold')) { Assert-ProbeConfiguration $true 'Ctrl + Super' $mode 'Cloud' }
    Assert ((@(Get-ProbeKeys ' Ctrl + Super ') -join ',') -eq '17,91') 'shortcut parsing'
    Reject { Assert-ProbeConfiguration $true '' 'Tap' 'Local' }
    Reject { Assert-ProbeConfiguration $true 'Ctrl + Super' '' 'Local' }
    Reject { Assert-ProbeConfiguration $true 'Ctrl + Super' 'Hold' '' }
    Reject { Assert-ProbeConfiguration $true 'Ctrl + Win' 'Tap' 'Local' }
    Reject { Assert-ProbeConfiguration $true 'Ctrl + Super' 'Toggle' 'Local' }
    Reject { Assert-ProbeConfiguration $true 'Ctrl + Super' 'Tap' 'Unknown' }
    Reject { Assert-ProbeConfiguration $false '' '' '' 0 }
    Reject { Assert-ProbeConfiguration $false '' '' '' 3 }
    foreach ($limit in @('0', '3', '1.5', '')) { Reject { & $PSCommandPath -OfflineCheck -MaxTakes $limit } }
    foreach ($limit in @(1, 2)) { Assert-ProbeConfiguration $false '' '' '' $limit }
    $controlState = @{ Held = [System.Collections.Generic.List[int]]::new(); Phase = 'Ready'; StartAttempts = 0; LastError = '' }
    foreach ($attempt in @(0, 1, 2)) {
        $controlState.StartAttempts = $attempt
        $controls = Get-ProbeControlState $controlState $true 'Tap' 2
        Assert ($controls.StartEnabled -eq ($attempt -lt 2)) "Ready Start eligibility at attempt $attempt"
        Assert (!$controls.ObservedEnabled -and !$controls.StopEnabled -and !$controls.ResetEnabled) 'Ready enabled another action'
        Assert ($controls.StatusText.Contains("Start attempts: $attempt/2")) 'status omitted actual Start count'
        Assert ($controls.StatusText.Contains('State: Ready') -and $controls.StatusText.Contains('Held keys: none')) 'status omitted phase or held keys'
        if ($attempt -eq 2) { Assert ($controls.StatusText.Contains('Start-attempt limit reached')) 'exhausted limit reason missing' }
    }
    $controlState.StartAttempts = 1
    $controls = Get-ProbeControlState $controlState $true 'Tap' 1
    Assert (!$controls.StartEnabled -and $controls.StatusText.Contains('Start attempts: 1/1') -and $controls.StatusText.Contains('Start-attempt limit reached')) 'single-attempt limit was not exhausted'
    $controlState.StartAttempts = 0
    $controls = Get-ProbeControlState $controlState $false 'Tap' 2
    Assert (!$controls.StartEnabled -and !$controls.ObservedEnabled -and !$controls.StopEnabled -and !$controls.ResetEnabled) 'preview enabled an action'
    Assert ($controls.StatusText.Contains('Preview') -and $controls.StatusText.Contains('preview sends no keys')) 'preview reason missing'
    $controlState.Held.Add(17)
    $controls = Get-ProbeControlState $controlState $true 'Hold' 2
    Assert (!$controls.StartEnabled -and $controls.StopEnabled -and !$controls.ResetEnabled) 'held-key eligibility changed'
    Assert ($controls.StatusText.Contains('Held keys: 17') -and $controls.StatusText.Contains('release held keys first')) 'held-key reason missing'
    $controlState.Held.Clear(); $controlState.Phase = 'Uncertain'
    $controls = Get-ProbeControlState $controlState $true 'Tap' 2
    Assert (!$controls.StartEnabled -and !$controls.StopEnabled -and $controls.ResetEnabled) 'uncertain state permitted activation'
    Assert ($controls.StatusText.Contains('phase is Uncertain')) 'phase reason missing'
    $controlState.Phase = 'Start sent'
    $controls = Get-ProbeControlState $controlState $true 'Tap' 2
    Assert ($controls.ObservedEnabled -and !$controls.StopEnabled) 'unobserved Tap stop eligibility changed'
    $controlState.Phase = 'Recording observed'
    $controls = Get-ProbeControlState $controlState $true 'Tap' 2
    Assert ($controls.StopEnabled) 'observed Tap stop unavailable'
    $controls = Get-ProbeControlState $controlState $true 'Hold' 2
    Assert (!$controls.StopEnabled) 'released Hold allowed a toggle'
    function Test-StartHandlerBudget([int]$Limit) {
        # Exercise the actual UI handler with plain objects and injected key/focus functions.
        $tokens = $null; $parseErrors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($PSCommandPath, [ref]$tokens, [ref]$parseErrors)
        Assert ($parseErrors.Count -eq 0) 'probe syntax'
        $startHandler = $ast.Find({
            param($node)
            $node -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -and
                $node.Expression -is [System.Management.Automation.Language.VariableExpressionAst] -and
                $node.Expression.VariablePath.UserPath -eq 'start' -and $node.Member.Value -eq 'Add_Click'
        }, $true).Arguments[0].ScriptBlock.GetScriptBlock()
        $Live = $true; $ActivationMode = 'Tap'; $Shortcut = 'Ctrl + Super'; $MaxTakes = $Limit
        $field = [pscustomobject]@{}
        $field | Add-Member -MemberType ScriptMethod -Name Focus -Value { return $true }
        $state = @{ Held = [System.Collections.Generic.List[int]]::new(); Phase = 'Ready'; Field = $field; StartAttempts = 0; Releasing = $false; LastError = '' }
        $start = [pscustomobject]@{ Enabled = $true }
        function Update-ProbeControls { $start.Enabled = (Get-ProbeControlState $state $Live $ActivationMode $MaxTakes).StartEnabled }
        $events = [System.Collections.Generic.List[string]]::new()
        $send = { param($key, $up) $events.Add("${key}:$up"); if (!$up) { & $startHandler } }
        $foreground = { $true }
        for ($attempt = 1; $attempt -le $Limit; $attempt++) {
            & $startHandler
            Assert ($state.StartAttempts -eq $attempt) 'reentrant Start consumed another attempt'
            Assert ($state.Phase -eq 'Start sent' -and $state.Held.Count -eq 0) 'Start handler did not settle Tap'
            $state.Phase = 'Ready'; Update-ProbeControls
        }
        & $startHandler
        Assert ($state.StartAttempts -eq $Limit -and !$start.Enabled) 'Start exceeded configured hardcap'
        Assert ($events.Count -eq (4 * $Limit)) 'reentrant or exhausted Start sent extra keys'
        $state.StartAttempts = 0; $state.Phase = 'Ready'; Update-ProbeControls; $events.Clear()
        $send = { param($key, $up) $events.Add("${key}:$up"); if (!$up) { throw 'injected Start failure' } }
        & $startHandler
        Assert ($state.StartAttempts -eq 1 -and $state.Phase -eq 'Uncertain' -and $state.LastError) 'failed Start lost count or uncertain state'
        Assert (($events -join ',') -eq '17:False,17:True' -and $state.Held.Count -eq 0) 'failed Start did not release or retried'
        $state.Phase = 'Ready'; Update-ProbeControls
        Assert ($state.StartAttempts -eq 1 -and $start.Enabled -eq ($Limit -gt 1)) 'stopped confirmation reset attempt count'
    }
    Test-StartHandlerBudget 1
    Test-StartHandlerBudget 2
    $state = @{ Held = [System.Collections.Generic.List[int]]::new(); Releasing = $false }
    $events = [System.Collections.Generic.List[string]]::new()
    $send = { param($key, $up) $events.Add("${key}:$up") }
    Reject { Send-ProbeChord $state @(17, 91) $send { $false } $false }
    Assert ($events.Count -eq 0) 'foreground refusal sent a key'
    Send-ProbeChord $state @(17, 91) $send { $true } $false
    Assert (($events -join ',') -eq '17:False,91:False,91:True,17:True') 'Tap release order'
    Assert ($state.Held.Count -eq 0) 'Tap retained keys'
    $events.Clear()
    $failSend = { param($key, $up) $events.Add("${key}:$up"); if ($key -eq 91 -and !$up) { throw 'injected down failure' } }
    Reject { Send-ProbeChord $state @(17, 91) $failSend { $true } $true }
    Assert (($events -join ',') -eq '17:False,91:False,91:True,17:True') 'failure skipped release'
    $events.Clear()
    $focus = @{ Checks = 0 }
    Reject { Send-ProbeChord $state @(17, 91) $send { $focus.Checks++; $focus.Checks -lt 3 } $true }
    Assert (($events -join ',') -eq '17:False,17:True') 'focus loss skipped release'
    $events.Clear()
    Send-ProbeChord $state @(17, 91) $send { $true } $true
    Assert ($state.Held.Count -eq 2) 'Hold did not retain chord'
    Reject { Send-ProbeChord $state @(17, 91) $send { $true } $true }
    # Release has deliberately no foreground argument: close/deactivation use this same path.
    Release-ProbeKeys $state $send
    Assert ($state.Held.Count -eq 0) 'Hold release required foreground'
    $state.Held.Add(17); $state.Held.Add(91); $events.Clear()
    Reject { Release-ProbeKeys $state { param($key, $up) $events.Add("${key}:$up"); if ($key -eq 91) { throw 'injected up failure' } } }
    Assert (($events -join ',') -eq '91:True,17:True') 'release failure skipped another key'
    Assert (($state.Held -join ',') -eq '91') 'failed release was forgotten'
    Release-ProbeKeys $state $send
    $state.Releasing = $false; $state.LastError = ''; $state.Phase = 'Start sent'
    $state.Held.Add(17); $state.Held.Add(91); $events.Clear()
    $nested = @{ Attempted = $false }
    $reentrantSend = {
        param($key, $up)
        $events.Add("${key}:$up")
        if (!$nested.Attempted) {
            $nested.Attempted = $true
            # Key-up can reenter either direct Tap-finally release or focus-loss release.
            Release-ProbeKeys $state $reentrantSend
            Release-ProbeSafely $state $reentrantSend { }
        }
        if ($key -eq 91) { throw 'injected up failure' }
    }
    Release-ProbeSafely $state $reentrantSend { }
    Assert $nested.Attempted 'reentrant release was not exercised'
    Assert (($events -join ',') -eq '91:True,17:True') 'reentrant release sent duplicate keys'
    Assert ($state.Held.Count -eq 1 -and $state.Held[0] -eq 91) 'safe release forgot a failed key'
    Assert (!$state.Releasing -and $state.LastError.Length -gt 0) 'safe release did not settle its error state'
    Release-ProbeSafely $state $send { }
    Assert ($state.Held.Count -eq 0) 'safe release retry failed'
    Write-Output 'Offline checks passed: configuration and attempt limits, control eligibility/status, foreground refusal, Tap, Hold, partial send, focus loss, release retry and reentrant release. No native sender, window, microphone or network was created.'
}

if ($OfflineCheck) {
    if ($Live) { throw 'OfflineCheck and Live are mutually exclusive.' }
    Assert-ProbeConfiguration $false $Shortcut $ActivationMode $ProcessingMode $MaxTakes
    Test-ProbeOffline
    return
}
Assert-ProbeConfiguration ([bool]$Live) $Shortcut $ActivationMode $ProcessingMode $MaxTakes

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if ($Live) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OpenWhisprProbeNative {
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
        public ushort vk, scan; public uint flags, time; public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
        public int x, y; public uint data, flags, time; public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Explicit)] public struct UNION {
        [FieldOffset(0)] public KEYBDINPUT keyboard;
        [FieldOffset(0)] public MOUSEINPUT mouse;
    }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION union; }
    [DllImport("user32.dll", SetLastError=true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    public static void Send(int key, bool up) {
        var input = new INPUT { type = 1 };
        input.union.keyboard = new KEYBDINPUT { vk = (ushort)key, flags = up ? 2u : 0u };
        if (SendInput(1, new [] { input }, Marshal.SizeOf(typeof(INPUT))) != 1)
            throw new InvalidOperationException("Windows refused the simulated key.");
    }
}
'@
}

$state = @{ Held = [System.Collections.Generic.List[int]]::new(); Phase = 'Ready'; Field = $null; StartAttempts = 0; Releasing = $false; LastError = '' }
$form = [System.Windows.Forms.Form]::new()
$form.Text = 'OpenWhispr desktop feasibility scratch probe'
$form.ClientSize = [System.Drawing.Size]::new(760, 650)
$form.StartPosition = 'CenterScreen'
$info = [System.Windows.Forms.Label]::new()
$info.SetBounds(16, 12, 720, 56)
$info.Text = "Preview: no keys sent. Live requires separate approval. No completion/cancellation API is observed.`r`nShortcut: $Shortcut; activation: $ActivationMode; processing: $ProcessingMode"
if ($Live) { $info.Text = "LIVE: OpenWhispr owns the microphone. Cloud sends audio through OpenWhispr.`r`nShortcut: $Shortcut; activation: $ActivationMode; processing: $ProcessingMode. At most $MaxTakes Start attempts." }
$form.Controls.Add($info)
$a = [System.Windows.Forms.TextBox]::new(); $a.Multiline = $true; $a.SetBounds(16, 96, 720, 100)
$b = [System.Windows.Forms.TextBox]::new(); $b.Multiline = $true; $b.SetBounds(16, 232, 720, 100)
foreach ($pair in @(@('Scratch A', 74), @('Scratch B', 210))) {
    $label = [System.Windows.Forms.Label]::new(); $label.Text = $pair[0]; $label.SetBounds(16, $pair[1], 200, 20); $form.Controls.Add($label)
}
$form.Controls.Add($a); $form.Controls.Add($b); $state.Field = $a
$a.Add_Enter({ $state.Field = $a }); $b.Add_Enter({ $state.Field = $b })
function New-ProbeButton([string]$Text, [int]$X, [int]$Width) {
    $button = [System.Windows.Forms.Button]::new(); $button.Text = $Text; $button.SetBounds($X, 350, $Width, 36)
    $form.Controls.Add($button); return $button
}
$start = New-ProbeButton 'Start' 16 85
$observed = New-ProbeButton 'Recording observed' 108 160
$stop = New-ProbeButton 'Stop / release' 276 120
$reset = New-ProbeButton 'Stopped confirmed' 404 160
$status = [System.Windows.Forms.Label]::new(); $status.SetBounds(16, 402, 720, 232); $form.Controls.Add($status)
$send = { param($key, $up) [OpenWhisprProbeNative]::Send($key, $up) }
$foreground = { [OpenWhisprProbeNative]::GetForegroundWindow() -eq $form.Handle }
function Update-ProbeControls {
    $controls = Get-ProbeControlState $state ([bool]$Live) $ActivationMode $MaxTakes
    $start.Enabled = $controls.StartEnabled; $observed.Enabled = $controls.ObservedEnabled
    $stop.Enabled = $controls.StopEnabled; $reset.Enabled = $controls.ResetEnabled
    $status.Text = $controls.StatusText
}
$start.Add_Click({
    if (!$start.Enabled) { return }
    $state.Phase = 'Uncertain'; $state.StartAttempts++; $state.LastError = ''
    Update-ProbeControls
    try {
        $state.Field.Focus() | Out-Null
        Send-ProbeChord $state (Get-ProbeKeys $Shortcut) $send $foreground ($ActivationMode -eq 'Hold')
        if ($state.Phase -eq 'Uncertain') { $state.Phase = 'Start sent' }
    } catch { $state.LastError = $_.Exception.Message }
    Update-ProbeControls
})
$observed.Add_Click({ if ($observed.Enabled) { $state.Phase = 'Recording observed'; $state.Field.Focus() | Out-Null; Update-ProbeControls } })
$stop.Add_Click({
    if (!$stop.Enabled) { return }
    $state.Phase = 'Uncertain'; $state.LastError = ''
    try {
        if ($state.Held.Count) { Release-ProbeKeys $state $send }
        elseif ($ActivationMode -eq 'Tap') {
            $state.Field.Focus() | Out-Null
            Send-ProbeChord $state (Get-ProbeKeys $Shortcut) $send $foreground $false
        }
        $state.Phase = 'Stop sent: verify OpenWhispr stopped'
    } catch { $state.LastError = $_.Exception.Message }
    Update-ProbeControls
})
$reset.Add_Click({
    if (!$reset.Enabled) { return }
    $answer = [System.Windows.Forms.MessageBox]::Show('Have you observed OpenWhispr stop recording and finish/cancel processing? If uncertain, stop it manually first.', 'Manual observation', 'YesNo')
    if ($answer -eq 'Yes') { $state.Phase = 'Ready'; $state.LastError = ''; Update-ProbeControls }
})
$form.Add_Deactivate({ Release-ProbeSafely $state $send { Update-ProbeControls } })
$form.Add_FormClosing({
    Release-ProbeSafely $state $send { Update-ProbeControls }
    if ($state.Held.Count) { $_.Cancel = $true; return }
    if ($Live -and $state.Phase -ne 'Ready') {
        $answer = [System.Windows.Forms.MessageBox]::Show('External recording/processing is unconfirmed. Stop OpenWhispr manually before closing. Have you confirmed it stopped?', 'Manual stop required', 'YesNo')
        if ($answer -ne 'Yes') { $_.Cancel = $true }
    }
})
Update-ProbeControls
try { $null = $form.ShowDialog() } finally { Release-ProbeSafely $state $send { Update-ProbeControls }; $form.Dispose() }
