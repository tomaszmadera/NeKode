# Minimal WSL project integration

Status: approved with the user's scope correction on 2026-10-08.

## Decision

Use the existing project path column to store a WSL UNC path. Windows already exposes Linux project files through that share. Add only a pure WSL location parser/converter and a small main-process WSL command helper. Do not introduce a database migration, plugin registry, filesystem RPC service, or runtime daemon.

The [feature specification](../features/project-environments/spec.md) owns behavior. NEKODE-33 will decide the SSH transport separately; this task records the necessary distinction between filesystem location and process runtime without implementing unused capabilities.

## Boundaries

- Project registration converts an explicit distribution and absolute Linux directory to `\\wsl.localhost\<distribution>\...` and uses current project validation/persistence.
- Existing file services use Node filesystem access to that UNC path. Preserve the server/share when joining relative paths, including nested file and handoff paths.
- Terminal preparation recognizes WSL UNC projects, passes the explicit distribution and Linux cwd to wsl.exe, and uses a valid Windows cwd for node-pty. Linux executables and argv are forwarded as arguments, not shell interpolation.
- Shell settings receive project context. For WSL, discover usable shells inside that distribution and validate custom Linux executables there. Never call host candidate scans or mutate/prune the host custom-shell list for a WSL project.
- Default WSL shell is the distribution default. Existing Local shell selection and fallback behavior remain scoped to Local.
- Existing integrations reuse these small boundaries when needed for correct project opening. Unsupported runtime operations fail visibly; broad redesigns are deferred.

## Compatibility and validation

No persisted project identity or foreign-key rebuild is required. Both wsl$ and wsl.localhost UNC aliases are recognized; new registration uses one canonical server spelling. Keep distribution/path components distinct and reject malformed inputs before registration.

Preserve the existing TerminalService session owner, IO/resize/events, and node-pty integration. Measure real WSL launch and teardown behavior; do not assume a mocked process proves Linux child cleanup, and never stop an entire distribution.

Microsoft documents [WSL command invocation](https://learn.microsoft.com/en-us/windows/wsl/basic-commands) and [Windows/Linux filesystem access](https://learn.microsoft.com/en-us/windows/dev-environment/wsl-interop). Check the installed runtime during preflight and use an isolated fixture during smoke.

## Deferred work

SSH, generic environment adapters, runtime hosts, broad Git/action/agent refactors, and installations. Add another abstraction only when a implemented requirement needs it.
