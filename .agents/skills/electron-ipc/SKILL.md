---
name: electron-ipc
description: Use when changing NeKode typed IPC (src/shared/ipc-contract.ts), the preload window.app bridge, IPC payload or sender validation, error transport, or OS-bound operations invoked from the renderer. Do not use for visual React changes that do not touch IPC.
---

# Electron IPC

Security and contract discipline for the NeKode IPC boundary. General safety
rules live in `AGENTS.md` and `.agents/safety.md`; this skill covers only the
IPC domain. Upstream reference:
https://www.electronjs.org/docs/latest/tutorial/security

## When to use and when not to use

Use for: adding or changing an IPC channel, changing `AppApi`, preload bridge
mapping, `window.app.*` call sites, payload or sender validation, `AppError`
transport, and any renderer request for file system, PTY, git, or dialog work.
Do not use for: renderer-only UI, styling, or component structure changes.

## Boundary rules (non-negotiable)

1. Three processes stay separate: main (`src/main`), preload (`src/preload`),
   renderer (`src/renderer`). Only preload touches `ipcRenderer`
   (`src/preload/index.ts`); the renderer only calls `window.app.*`, typed in
   `src/renderer/src/env.d.ts`.
2. `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` stay as
   set in `src/main/index.ts` webPreferences. Never weaken them to make a call
   work.
3. Every channel is declared once in `IPC_CHANNEL` and `AppApi`
   (`src/shared/ipc-contract.ts`), validated in
   `src/main/ipc/ipc-validation.ts`, and registered in
   `src/main/ipc/ipc-handlers.ts`. No ad-hoc `ipcMain.handle`.
4. Payload validation runs before any service call: arity via `requireArgs`,
   types via `assertString`/`assertFiniteNumber`, path arguments via
   `assertSafePath` (rejects NUL, relative paths, `..` segments). Sender
   validation is fail-closed: `isTrustedSender`
   (`src/main/security/sender-guard.ts`) requires the invoking frame to be
   the main frame with a trusted renderer URL from `getTrustedRendererUrls()`
   (`src/main/index.ts`); an empty list rejects everything.
5. Errors cross the bridge only as typed `AppError` payloads
   (`src/shared/ipc-error.ts`), codes `validation`, `not_found`, `conflict`,
   `sqlite`, `unknown`. Unknown errors are sanitized by `toTransportError`
   (generic message); originals are logged on the main side only.

## Sequence for a new or changed channel

1. Justify the channel with one concrete renderer need and minimal privilege.
   Do not add speculative API "for later".
2. Extend `IPC_CHANNEL` and `AppApi` in `src/shared/ipc-contract.ts` with
   typed arguments and result.
3. Add a validator entry in `buildValidatedChannels`
   (`src/main/ipc/ipc-validation.ts`): `serviceChannel` for real services,
   `stubChannel` only for documented stubs; write a strict parser when
   arguments are not all strings.
4. Implement or extend the service behind `AppServices`
   (`src/main/ipc/service-registry.ts`, wiring in
   `src/main/services/create-services.ts`) and map it in the preload bridge
   (`src/preload/app-api.ts`).
5. Keep dialogs and OS prompts in main (pattern: `projects:add` in
   `src/main/ipc/ipc-handlers.ts`); the renderer never supplies privileged OS
   input that skips `assertSafePath`.

## Checkpoints and verification

- Every channel change ships with tests: positive routing
  (`src/preload/app-api.test.ts` with `createIpcMock`), typed rejection
  (`src/main/ipc/ipc-validation.test.ts`), and for privileged channels
  sender-guard cases (`src/main/security/sender-guard.test.ts`). At least one
  negative case per validator rule.
- Stub channels stay listed in `STUB_CHANNELS` (`ipc-handlers.ts`); when a
  stub becomes real, remove its entry and the fixed value in the same change.
- Run `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, or the recorded
  `verify_changed` command from `.agents/project-profile.yaml`, before
  claiming the change works.
