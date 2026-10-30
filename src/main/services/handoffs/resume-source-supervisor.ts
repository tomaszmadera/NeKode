import { lstatSync, statSync } from 'node:fs'
import { win32 } from 'node:path'
import type { ResumeCommandSource } from '@shared/contracts/resume-sources-contract'
import { AppError } from '@shared/ipc-error'

/** Exit codes reserved by both supervisors; a supervised source cannot report them distinctly. */
export const SUPERVISOR_START_FAILED = 253
export const SUPERVISOR_CONTAINMENT_FAILED = 254

// Fixed supervisor code; source configuration is JSON data and is never evaluated.
// JOB_LIST associates the process atomically, even if cancellation interrupts creation.
const windowsSupervisor = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class ResumeSourceJob {
  [StructLayout(LayoutKind.Sequential)] struct Limits {
    public long User, Job; public uint Flags; public UIntPtr Min, Max;
    public uint Count; public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public Limits Basic; public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public int Size; public string Reserved, Desktop, Title;
    public uint X, Y, Width, Height, CharsX, CharsY, Fill, Flags;
    public short Show, ReservedSize; public IntPtr ReservedData, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Info; public IntPtr Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Id, ThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long User, Kernel, PeriodUser, PeriodKernel;
    public uint Faults, Total, Active, Terminated;
  }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimits info, int size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int type, out Accounting info, int size, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string directory, ref StartupEx startup, out ProcessInfo info);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static string Quote(string value) {
    var text = new StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { text.Append('\\', slashes * 2 + 1); text.Append(c); }
      else { text.Append('\\', slashes); text.Append(c); }
      slashes = 0;
    }
    text.Append('\\', slashes * 2); text.Append('"'); return text.ToString();
  }
  public static int Run(string application, string executable, string[] arguments) {
    IntPtr job = IntPtr.Zero, attributes = IntPtr.Zero, jobValue = IntPtr.Zero;
    bool initialized = false; ProcessInfo child = new ProcessInfo();
    try {
      job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
      var limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000;
      Check(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(ExtendedLimits))));
      IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
      attributes = Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref size)); initialized = true;
      jobValue = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobValue, job);
      Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000D), jobValue, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
      var startup = new StartupEx(); startup.Info.Size = Marshal.SizeOf(typeof(StartupEx));
      startup.Info.Flags = 0x100; startup.Info.Input = GetStdHandle(-10);
      startup.Info.Output = GetStdHandle(-11); startup.Info.Error = GetStdHandle(-12);
      Check(SetHandleInformation(startup.Info.Input, 1, 1)); Check(SetHandleInformation(startup.Info.Output, 1, 1)); Check(SetHandleInformation(startup.Info.Error, 1, 1));
      startup.Attributes = attributes;
      var command = new StringBuilder(Quote(executable)); if (arguments != null) foreach (var arg in arguments) command.Append(" ").Append(Quote(arg));
      if (!CreateProcessW(application, command, IntPtr.Zero, IntPtr.Zero, true, 0x8080004, IntPtr.Zero, null, ref startup, out child)) return ${SUPERVISOR_START_FAILED};
      Check(ResumeThread(child.Thread) != UInt32.MaxValue);
      Check(WaitForSingleObject(child.Process, UInt32.MaxValue) == 0);
      uint code; Check(GetExitCodeProcess(child.Process, out code));
      Check(TerminateJobObject(job, 1));
      var elapsed = Stopwatch.StartNew(); Accounting accounting;
      do {
        Check(QueryInformationJobObject(job, 1, out accounting, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
        if (accounting.Active == 0) break;
        if (elapsed.ElapsedMilliseconds > 3000) return ${SUPERVISOR_CONTAINMENT_FAILED};
        Thread.Sleep(10);
      } while (true);
      return unchecked((int)code);
    } finally {
      if (job != IntPtr.Zero) CloseHandle(job);
      if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
      if (child.Process != IntPtr.Zero) CloseHandle(child.Process);
      if (initialized) DeleteProcThreadAttributeList(attributes);
      if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
      if (jobValue != IntPtr.Zero) Marshal.FreeHGlobal(jobValue);
    }
  }
}
'@
`

// libuv accepts any existing non-directory. Store app execution aliases (for example
// WindowsApps\python.exe) are reparse points that stat rejects with EACCES, so lstat decides.
const isFile = (path: string) => {
  for (const read of [statSync, lstatSync]) {
    try {
      return !read(path).isDirectory()
    } catch {
      // Try the link itself next; both failing means the candidate does not exist.
    }
  }
  return false
}

/**
 * Mirrors libuv's Windows search (cwd, then PATH; exact name, then .com and .exe) so the
 * supervisor starts the same program Node would, not CreateProcessW's System32-first order.
 */
export function resolveWindowsExecutable(
  executable: string,
  cwd: string,
  path: string | undefined,
  exists: (path: string) => boolean = isFile,
): string | null {
  const names = (win32.extname(executable) === '' ? [] : [executable]).concat(
    `${executable}.com`,
    `${executable}.exe`,
  )
  // A name with a path component resolves against cwd only; a bare name also searches PATH.
  const directories =
    /[\\/]/.test(executable) || win32.isAbsolute(executable)
      ? [cwd]
      : [cwd, ...(path ?? '').split(';').map((entry) => entry.replaceAll('"', ''))]
  for (const directory of directories) {
    if (directory.trim() === '') continue
    for (const name of names) {
      const candidate = win32.resolve(cwd, directory, name)
      if (exists(candidate)) return candidate
    }
  }
  return null
}

export function windowsResumeInvocation(
  source: ResumeCommandSource,
  systemRoot: string | undefined,
  application: string,
) {
  // An absolute path keeps a project-local powershell.exe in the cwd from being started.
  if (!systemRoot)
    throw new AppError('config', 'Windows system directory is unavailable for Resume discovery.')
  const config = Buffer.from(
    JSON.stringify({ application, executable: source.executable, args: source.args }),
    'utf8',
  ).toString('base64')
  // Compilation, configuration and Win32 failures all report containment failure.
  const stdin = `$ErrorActionPreference = 'Stop'
try {
${windowsSupervisor}
  $config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${config}')) | ConvertFrom-Json
  exit [ResumeSourceJob]::Run($config.application, $config.executable, [string[]]$config.args)
} catch { exit ${SUPERVISOR_CONTAINMENT_FAILED} }
`
  // Read the fixed script completely first, leaving EOF on the source's inherited stdin.
  const bootstrap = '$s=[Console]::In.ReadToEnd(); & ([ScriptBlock]::Create($s))'
  return {
    file: win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(bootstrap, 'utf16le').toString('base64'),
    ],
    stdin,
  }
}

// "$@" preserves configured argv literally. The fixed supervisor retains its marker/group.
export const WSL_RESUME_SUPERVISOR = `
"$@" &
source_pid=$!
wait "$source_pid"
source_code=$?
attempt=0
while :; do
  members=$(pgrep -g "$$") || exit ${SUPERVISOR_CONTAINMENT_FAILED}
  remaining=0
  for member in $members; do
    if [ "$member" != "$$" ]; then
      remaining=1
      kill -KILL "$member" 2>/dev/null || :
    fi
  done
  [ "$remaining" = 0 ] && exit "$source_code"
  attempt=$((attempt + 1))
  [ "$attempt" -ge 300 ] && exit ${SUPERVISOR_CONTAINMENT_FAILED}
  sleep 0.01
done
`
