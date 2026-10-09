# Per-project terminal shell selection with system shell detection

This file is the behavioral contract for the feature. Agents implement from it. Execution progress, file checklists, and architecture history live in the task record, not here.

## Goal

The user chooses the shell new terminals use, per project. Out of the box the app detects the shells actually installed on the machine (Windows PowerShell, PowerShell 7, cmd, WSL distributions, Git Bash) and offers them in a per-project setting; the default stays the platform default shell (unchanged behavior).

## Related requirements

User decisions 2026-10-03 (Plane card NEKODE-20, chat):

1. Scope of the choice is per project (not global, not per tab for now).
2. The picker lists shells detected on the system, plus a custom entry.
3. Shell detection runs in the main process; the renderer never passes executable paths.

User decisions 2026-10-04 (chat, plan review):

4. Detection lives in a dedicated Shell tab in Project Settings: every entry into the tab runs one detection automatically, with a visible in-progress indicator. There is no separate re-scan button, and nothing probes the machine at startup, on modal open of other tabs, or on a timer.
5. A custom shell is added by absolute path, appears in the list as a selectable entry, and persists app-level (shared across projects).
6. An uninstalled shell must never break anything: a stale stored choice falls back to the default at spawn, and the next detection run prunes dead entries.

## Scope

- Main: a new `ShellService` (`src/main/services/terminal/shell-service.ts`) with `detect()` (candidate-path probing plus WSL distribution enumeration, injectable filesystem/OS for tests), `resolve(setting)` (stored key → spawnable `ShellSpec`, unknown/missing → platform default), and a run-scoped detection cache refreshed on every Shell-tab entry, with prune-on-detect.
- Shared: IPC contract additions (`terminals.shellDetect()`, `terminals.shellName(projectId)`), the per-project key helper `projectShellKey(projectId)`, `ShellChoice` / `ShellInfo` types.
- TerminalService: `create()` accepts an optional shell override; project-shell resolution happens at spawn time in the composition root.
- ChatService: chat names derive from the project's shell at creation time (falls back to the platform default label).
- Renderer: a dedicated Shell tab in the Project Settings modal — entering the tab triggers one detection with a visible indicator; the tab shows the detected/custom list, the per-project shell selector, and a custom-path add input.
- Cleanup of the per-project shell key on `projects:remove`.
- No probing outside the Shell tab: no startup scan, no scan when other tabs or the modal open, no timers, no re-scan button.

## Non-goals

- No per-tab or per-session shell choice (post-MVP; the bottom-terminal "+" could grow a per-tab picker later).
- No shell management (install, update, PATH edits).
- No default-shell configuration for the OS.
- No change to existing sessions: they keep their running shell; the project setting affects only newly created chats/bottom terminals.
- No rename of existing chats when the project shell changes.
- Linux/macOS shell detection (non-win32 keeps `$SHELL`/`/bin/bash` and a fixed minimal list).

## Behaviour

1. Detection is bound to entering the Shell tab: the renderer calls detection exactly once per tab entry (re-entry re-runs it; concurrent invokes coalesce into one run). During a run the tab shows a visible working indicator and its controls are disabled. There is no manual re-scan button, no detection on app start, no detection when other tabs or the modal itself open, and no timers.
2. A detection run (main): builds the candidate list from fixed locations (`fs.existsSync`, no processes): Windows PowerShell (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`), PowerShell 7 (`%ProgramFiles%\PowerShell\7\pwsh.exe`, then `%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe`), cmd (`%SystemRoot%\System32\cmd.exe`), Git Bash (`%ProgramFiles%\Git\bin\bash.exe`). Then enumerates WSL distributions: `wsl.exe --list --quiet` (the only subprocess, UTF-16LE output, decode before parsing, short timeout) — one `WSL: <distro>` entry per distribution, spawning `wsl.exe -d <distro>`. When `wsl.exe` is missing or the command fails, WSL contributes no entries (no error surfaced).
3. The detection result replaces the previous in-memory cache (main-side). The Shell tab always shows the freshest result because it re-detects on every entry; between detections the cache serves label/name resolution without probing. `Default` always exists as choice id `default` and is listed without detection.
4. Custom shell (app-level): the user enters an absolute path to an executable in the Shell tab; main validates existence (file check) and adds it to the cached list as a `custom:<absolute path>` entry (label: the file's base name). Entries persist in app_state under `shells.custom` (a JSON array of absolute paths, shared across projects), so they reappear after an app restart — displayed immediately (from the stored list, existence re-checked on detect; a path that no longer exists is pruned from `shells.custom` by the next detection run). Invalid or non-file paths reject with a validation error and are not added.
5. Per-project setting `project.shell:<projectId>` (app_state, same mechanics as `project.handoffDir:<projectId>`): stored value is a `ShellChoice` id — `default`, a detected id (`powershell`, `pwsh`, `cmd`, `wsl:<distro>`, `gitbash`), or `custom:<absolute path>`. Missing/empty value means `default`.
6. New chat creation uses `[shell] profile name`, or just `[shell]` without an agent profile. The prefix is the project's compact shell code: `PS5`, `PS7`, `cmd`, `bash`, or `WSL`; for a `custom:<path>` choice it is the file's base name. It resolves with the same fallback rule as `resolve()`, so the prefix and the spawned shell can never disagree. The verbose label (`PowerShell 7`, `WSL: Ubuntu-24.04`) stays the Shell settings and bottom-tab text. The name is saved at creation time; existing chats keep their saved names. Duplicates within one project stay allowed.
7. New terminal spawn (chat or bottom tab) resolves the project's shell setting in main at spawn time: a detected/custom id resolves to the executable path and arguments recorded by detection (e.g. `-NoLogo` for PowerShell, `-d <distro>` for WSL); unknown or stale ids (shell uninstalled, distribution removed, detection never run this app session) fall back to the platform default without an error — a terminal always opens.
8. `terminals:shellName(projectId)` returns the display label of the project's resolved shell: bottom-tab labels use it. The new-chat prefix uses the compact code instead (`chatLabel()`).
9. `projects:remove` deletes `project.shell:<projectId>` together with the existing handoff-dir cleanup.

## Business rules

- Stored setting values are opaque ids or `custom:<absolute path>`; executable paths resolved from detection never cross IPC to the renderer as part of the setting (they may appear in `ShellInfo` as display data).
- The renderer sends only choice ids (or `custom:<path>` entered by the user); main resolves every id to a path at spawn/label time. A renderer-supplied custom path is validated to exist as a file at add time and at spawn time.
- Fallback rule: any value that does not resolve (unknown id, deleted executable, removed WSL distribution) behaves as `default` at spawn and label time. No error, no failed terminal.
- Default remains `powershell.exe -NoLogo` on win32 (unchanged from the mvp-core-shell spec), `$SHELL`/`/bin/bash` elsewhere.
- The detection cache lives in main per app run; it is never persisted (except the user-added custom paths) and is refreshed only by entering the Shell tab. Detection cost: a handful of `fs.existsSync` calls plus at most one short WSL subprocess per tab entry.
- The `shells.custom` list is validated lazily: stored paths are shown after restart without probing, re-validated on the next detection run (dead paths pruned) and at spawn time (dead path → default shell).

## Authorization

All channels stay behind the trusted-sender guard. `terminals:shellList` and `terminals:shellName` are read-only (existence probing and a WSL enumeration; they spawn no processes). WSL enumeration runs `wsl.exe --list --quiet` with a short timeout; a failure degrades to "no WSL entries", never an IPC error. The per-project key stays keyed by project id; project removal cleans it up.

## Data / API

- `APP_STATE_KEY` addition: `customShells: 'shells.custom'` (JSON array of absolute paths; app-level, user-added only). Helper: `projectShellKey(projectId)` → `project.shell:<projectId>`.
- `ShellChoice = 'default' | 'powershell' | 'pwsh' | 'cmd' | 'gitbash' | `wsl:${string}` | `custom:${string}`` (serialized form of the stored setting).
- `ShellInfo { id: ShellChoice; label: string; }` — `label` is the display name (`PowerShell`, `PowerShell 7`, `cmd`, `WSL: Ubuntu-24.04`, `Git Bash`, or the base name of a custom path).
- `ShellService.chatLabel(choice, projectPath?)` — the compact chat-prefix code (`PS5`, `PS7`, `cmd`, `bash`, `WSL`, or a `custom:<path>` file's base name); same fallback rule as `resolve()` and `label()`.
- `AppApi.terminals.shellDetect(): Promise<ShellInfo[]>` (new channel `terminals:shellDetect`; runs one detection, updates the main-side cache, returns the full list including `default` and persisted custom entries). Before the first detection in an app run, the renderer list is empty except `default` plus persisted custom entries (`terminals:shellList` returns the cached state without probing — read-only counterpart used to render the section).
- `AppApi.terminals.shellName(projectId: string): Promise<string>` (replaces the no-arg form; the no-arg call is removed with its callers in the same change).
- `TerminalService.create(chatId, cwd, shell?: ShellSpec)` — optional per-spawn override; absent → service default (platform default, unchanged).

## Verification

- Unit (vitest, fake fs/OS, no real processes in unit tests): detection composition and ordering, UTF-16LE WSL decoding, custom-path validation and `shells.custom` persistence/prune, resolve/fallback rules (stale id, dead path, never-detected), per-project key helper, chat naming via project shell, `projects:remove` key cleanup, shellName(projectId) behavior.
- Renderer tests: entering the Shell tab triggers exactly one detection with a visible pending state; the list renders after detection; saved choice round-trips via `state:set`; custom-path add validates and persists; bottom-tab label from the project shell.
- Real-machine probe (dev smoke on Windows, this host): one explicit detection run returns the machine's real set (expected: PowerShell, PowerShell 7 via WindowsApps alias, cmd, Git Bash at `Program Files`, `WSL: Ubuntu-24.04`); spawning each detected shell yields a working prompt; recorded as observed output when the environment allows.
- Fallback smoke: store a bogus `project.shell` value, open a terminal — the default shell spawns, no error (spec Business rules).
