---
name: electron-native
description: Use when changing Electron, Node, pnpm, better-sqlite3, node-pty, electron-builder, asarUnpack, Windows packaging or installers, or any native module or install script. Do not use for pure JavaScript dependency or application-logic changes.
---

# Electron native modules and packaging

Binary compatibility and packaging rules for the NeKode desktop app.
References: https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
and https://www.electron.build/ . Verified host facts live in
`docs/development/setup.md` and `.agents/lessons/items/`.

## When to use and when not to use

Use for: Electron, Node, or pnpm version changes, native dependencies
(`better-sqlite3`, `node-pty`), `pnpm-workspace.yaml` `allowBuilds`,
`electron-builder.yml`, `asarUnpack`, installers, and any failure mentioning
NODE_MODULE_VERSION or node-gyp. Do not use for dependency-free refactors or
renderer-only code.

## Ground rules

1. Host Node ABI is not the Electron ABI. Host Node 24.18 is
   NODE_MODULE_VERSION 137; Electron 44 embeds Node 24.21 with 149. Only
   N-API modules shipping prebuilds for the target (win32-x64) are acceptable
   (.agents/lessons/items/native-deps-prebuilt-binaries.md).
2. This host has no Visual Studio C++ Build Tools: `node-gyp rebuild` always
   fails. Never work around that with toolchain installs, forks, or foreign
   binaries without explicit user authorization.
3. `pnpm-workspace.yaml` `allowBuilds` is the standing gate for install
   scripts (current entries: `@biomejs/biome` true, `esbuild` true,
   `node-pty` true, `better-sqlite3` false). A new dependency with install
   scripts fails with `ERR_PNPM_IGNORED_BUILDS`: review the script first,
   then add an explicit entry.
4. `electron-builder.yml` keeps `npmRebuild: false` while all natives are
   N-API. Moving any native to a non-N-API build invalidates that setting.
5. Verify native modules inside the real Electron runtime, not only in host
   `node` or Vitest: `pnpm run dev`, or `pnpm run build:unpack` and run
   `dist/win-unpacked/nekode.exe`. A prebuild that loads in host Node can
   still fail in Electron.

## Sequence

1. Read current versions from `package.json` and `pnpm-lock.yaml`; do not
   trust documentation snapshots of versions.
2. Check the candidate version for N-API prebuilds covering win32-x64 (plus
   linux x64 when WSL matters). No prebuild for a target means blocked:
   report it, do not improvise.
3. After dependency changes run `pnpm install`, then `pnpm run lint`,
   `pnpm run typecheck`, `pnpm run test`.
4. Run the Electron runtime smoke from Ground rule 5. For packaging changes
   `pnpm run build:unpack` is the minimum; installer smoke is its own step.

## Installer and Windows notes

- Launch NSIS installers through PowerShell `Start-Process ... -Wait`
  (.agents/lessons/items/windows-gui-launchers-powershell.md); bash/MSYS
  launchers hang or exit 139.
- `userData` ignores `%APPDATA%` redirection on Windows; isolate test data
  with `app.setPath('userData', ...)`
  (.agents/lessons/items/electron-userdata-not-appdata.md).
- Never write claims of the form "prebuilds are always available". Each
  version-target pair is verified, or the claim is marked unverified.
