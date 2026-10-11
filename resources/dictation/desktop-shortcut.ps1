param([string]$ExpectedWindow, [switch]$OfflineCheck)
$ErrorActionPreference = 'Stop'
# This production helper has no GUI, account/file/network/clipboard access.
# No native call executes until main explicitly sends GO after compilation.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public interface INeKodeKeys {
    bool Foreground();
    bool ModifierHeld();
    void Send(int key, bool up);
}
public static class NeKodeChord {
    public static string Dispatch(INeKodeKeys native) {
        var attempted = new List<int>();
        string outcome = "OK";
        bool releaseFailed = false;
        try {
            if (!native.Foreground()) return "FOREGROUND";
            if (native.ModifierHeld()) return "MODIFIERS";
            foreach (int key in new [] { 17, 91 }) {
                if (!native.Foreground()) {
                    outcome = attempted.Count == 0 ? "FOREGROUND" : "SEND_UNCERTAIN";
                    break;
                }
                // Record before calling: a partial/failed SendInput is uncertain.
                attempted.Add(key);
                native.Send(key, false);
            }
        } catch { outcome = "SEND_UNCERTAIN"; }
        finally {
            for (int i = attempted.Count - 1; i >= 0; i--) {
                try { native.Send(attempted[i], true); }
                catch { releaseFailed = true; }
            }
        }
        return releaseFailed ? "RELEASE_UNCERTAIN" : outcome;
    }
}
public sealed class NeKodeNativeKeys : INeKodeKeys {
    private readonly IntPtr expected;
    public NeKodeNativeKeys(long handle) { expected = new IntPtr(handle); }
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
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    public bool Foreground() { return GetForegroundWindow() == expected; }
    public bool ModifierHeld() {
        foreach (int key in new [] { 16, 17, 18, 91, 92 })
            if ((GetAsyncKeyState(key) & 0x8000) != 0) return true;
        return false;
    }
    public void Send(int key, bool up) {
        var input = new INPUT { type = 1 };
        input.union.keyboard = new KEYBDINPUT { vk = (ushort)key, flags = (up ? 2u : 0u) | (key == 91 ? 1u : 0u) };
        if (SendInput(1, new [] { input }, Marshal.SizeOf(typeof(INPUT))) != 1)
            throw new InvalidOperationException("SendInput failed");
    }
}
// The offline checks compile and exercise the exact dispatcher using this
// fake. They never instantiate NeKodeNativeKeys or call user32.dll.
public sealed class NeKodeFakeKeys : INeKodeKeys {
    public bool Held; public int LoseAt = -1; public int FailDown = -1; public int FailUp = -1;
    private int checks;
    public readonly List<string> Events = new List<string>();
    public bool Foreground() { return checks++ != LoseAt; }
    public bool ModifierHeld() { return Held; }
    public void Send(int key, bool up) {
        Events.Add(key + (up ? ":up" : ":down"));
        if ((!up && key == FailDown) || (up && key == FailUp)) throw new Exception("injected");
    }
}
'@
if ($OfflineCheck) {
    function Check-Chord($Fake, [string]$Outcome, [string]$Events) {
        $actual = [NeKodeChord]::Dispatch($Fake)
        if ($actual -ne $Outcome -or [string]::Join(',', $Fake.Events) -ne $Events) { throw "Offline chord check failed: $actual" }
    }
    Check-Chord ([NeKodeFakeKeys]::new()) 'OK' '17:down,91:down,91:up,17:up'
    $fake = [NeKodeFakeKeys]::new(); $fake.Held = $true
    Check-Chord $fake 'MODIFIERS' ''
    $fake = [NeKodeFakeKeys]::new(); $fake.LoseAt = 0
    Check-Chord $fake 'FOREGROUND' ''
    $fake = [NeKodeFakeKeys]::new(); $fake.LoseAt = 1
    Check-Chord $fake 'FOREGROUND' ''
    $fake = [NeKodeFakeKeys]::new(); $fake.LoseAt = 2
    Check-Chord $fake 'SEND_UNCERTAIN' '17:down,17:up'
    $fake = [NeKodeFakeKeys]::new(); $fake.FailDown = 91
    Check-Chord $fake 'SEND_UNCERTAIN' '17:down,91:down,91:up,17:up'
    $fake = [NeKodeFakeKeys]::new(); $fake.FailUp = 91
    Check-Chord $fake 'RELEASE_UNCERTAIN' '17:down,91:down,91:up,17:up'
    Write-Output 'Offline desktop sender checks passed (no native input).'
    exit 0
}
if ($ExpectedWindow -notmatch '^[1-9]\d*$') { exit 2 }
$window = [long]::Parse($ExpectedWindow)
Write-Output 'READY'
[Console]::Out.Flush()
if ([Console]::In.ReadLine() -cne 'GO') { exit 2 }
$result = [NeKodeChord]::Dispatch([NeKodeNativeKeys]::new($window))
Write-Output $result
[Console]::Out.Flush()
if ($result -eq 'OK') { exit 0 }
exit 1
