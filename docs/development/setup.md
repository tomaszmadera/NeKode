# Development environment setup

**App platform:** Windows 11 (supported). WSL2 is an optional shell integration, available only when NeKode runs on Windows.
**Linux (experimental):** NeKode builds and runs from source on Linux x64; the build-from-source scope is Ubuntu 22.04 and 24.04, CI tests on Ubuntu 24.04, and the release files need Ubuntu 24.04 or a distribution with the same or a newer glibc (details in [section 1a](#1a-linux-experimental)). The ready release files (Windows installer, AppImage for Linux) are built by the release workflow; the procedure is described in [releases.md](../operations/releases.md).
**Main technology stack:** Electron, React, TypeScript, Vite, Tailwind CSS, SQLite (`better-sqlite3`), `node-pty`

Read the current versions and commands from [package.json](../../package.json), [pnpm-lock.yaml](../../pnpm-lock.yaml), the [install policy](../../pnpm-workspace.yaml) and the [packaging configuration](../../electron-builder.yml). The [project contract](project-contract.md) defines the rules for changes and the sources of requirements.

The toolchain below is a historical **verified** measurement (stack-update-hardening, 2026-09-24): versions
installed and tested together with the installer build and running the app outside dev.

## 1. Prerequisites

1. **Node.js:** `^22.22.2 || ^24.15.0 || >=26.0.0` (the `engines` field in package.json).
   Verified host configuration: Node 24.18.0.
2. **Package manager:** `pnpm` **12.5.1** pinned through `packageManager` in package.json
   (Corepack or a global install; both work; verified: global 12.5.1).
3. **Visual Studio C++ Build Tools: NOT REQUIRED.** All native modules use
   ready N-API/prebuild binaries (see section 5). Their forced rebuild is turned off
   deliberately (`better-sqlite3: false` in `pnpm-workspace.yaml`, `npmRebuild: false`
   in `electron-builder.yml`).
4. **Git:** >= 2.40 (verified: 2.55).

## 1a. Linux (experimental)

Build-from-source scope: Ubuntu 22.04 and 24.04, x64 (NEKODE-13). Other distributions and ARM are not tested.
CI (`verify-linux`) tests on Ubuntu 24.04.
Running from source (`pnpm run dev`) and a local package work. Linux releases
are an x64 AppImage built by the release workflow on Ubuntu 24.04; it needs Ubuntu 24.04
or a distribution with the same or a newer glibc ([releases.md](../operations/releases.md)).
deb, rpm, Snap and Flatpak packages are out of scope.

Additional requirements on top of section 1:

- `build-essential` and `python3`: compiling `node-pty` from source (section 5);
- `libsecret-1-0` plus a working keyring (for example `gnome-keyring`): secret encryption
  (the Plane token) through Electron `safeStorage`. Without a keyring, NeKode keeps the secret only
  in memory until the app closes, never writes it to disk as plain text,
  and shows a warning about this in the Kanban settings.

```
sudo apt-get install build-essential python3 libsecret-1-0
pnpm install
pnpm rebuild node-pty
pnpm run dev
```

Behavior differences on Linux:

- shells: the default is `$SHELL`; the list in the settings adds the installed shells
  from `/etc/shells` (existing and executable);
- WSL is hidden (no WSL projects and no WSL shells), also when NeKode runs inside WSL;
- Ctrl+U and Ctrl+D go straight to the shell (the PSReadLine emulation applies only to Windows).

### Verified component versions

| Component | Version | Notes |
|---|---|---|
| Electron | 44.4.5 | Node 24.21.0 inside (NODE_MODULE_VERSION 149) |
| electron-vite | 5.0.0 | `externalizeDepsPlugin` removed (externalization is the default in v5) |
| Vite | 7.3.6 | the top branch of the electron-vite peer range (`^5 \|\| ^6 \|\| ^7`) |
| @vitejs/plugin-react | 5.2.0 | version 6.x needs Vite 8; do not use it with electron-vite 5 |
| TypeScript | 5.9.3 | two projects: `tsconfig.node.json`, `tsconfig.web.json` |
| React / ReactDOM | 19.3.0 | |
| Tailwind CSS + @tailwindcss/vite | 4.3.3 | |
| Zustand | 5.0.15 | |
| better-sqlite3 | 13.0.3 | N-API, built-in prebuilds (including `win32-x64.node`) |
| node-pty | 1.1.0 | stable line (1.2.0 is a beta series); prebuild staging through the install script |
| Vitest | 5.0.1 | `test.projects` (node + jsdom); `environmentMatchGlobs` removed in v4 |
| Biome | 2.5.14 | lint + format |
| electron-builder | 25.1.8 | NSIS, `npmRebuild: false` |

Note: `engines` in package.json comes from the most restrictive dependency (jsdom 30).
The host Node (24.18.0) and the Node inside Electron (24.21.0) have **different** `NODE_MODULE_VERSION` values
(137 vs 149). That is why native modules must be N-API (ABI-stable) and not built for
a specific runtime.

## 2. Process architecture

- **Main process (`src/main/`):**
  - The Electron app lifecycle.
  - Domain services (`ProjectService`, `ChatService`, `AppStateService`, `ActionService`, `TerminalService` and the modules for files, Git, shells, handoffs, Kanban and dictation).
  - Access to the SQLite database and system operations (PTY, file system).
- **Preload process (`src/preload/`):**
  - A secure IPC bridge (`contextBridge.exposeInMainWorld`).
  - A strictly typed API exposed to the renderer.
- **Renderer process (`src/renderer/`):**
  - A React 19 / TypeScript / Vite app.
  - UI components: work panels, xterm.js integration, file preview in Monaco Editor.
  - Styles: Tailwind CSS.

## 3. Installation and smoke tests

Sequence verified on a clean environment:

1. `pnpm install`: respects the script policy from `pnpm-workspace.yaml`
   (`allowBuilds`; see section 5). To reproduce from the lockfile: `pnpm install --frozen-lockfile`.
2. `pnpm run lint && pnpm run typecheck && pnpm run test`: static analysis, both typechecks, tests.
3. `pnpm run dev`: development mode (Vite HMR + Electron). **Note:** Electron 44 downloads
   its binaries only on the first start (not at install). This is normal
   and needs the network only the first time.
4. `pnpm run build`: production build (`out/`).
5. `pnpm run build:unpack`: a packaged app in `dist/win-unpacked/` (the fastest smoke outside dev).
6. `pnpm run build:win`: NSIS installer `dist/NeKode-Setup-<version>.exe`.
7. Linux: `pnpm run build:linux` (after `pnpm rebuild node-pty`): AppImage
   `dist/NeKode-<version>-x86_64.AppImage`. To run it: `chmod +x` on the file; the AppImage
   needs FUSE 2 (`sudo apt-get install libfuse2t64` on Ubuntu 24.04+) or a start
   with `--appimage-extract-and-run`.

Both packaging scripts run with `--publish never` and give the same file names as the
[release workflow](ci.md#release-workflow); local files are for testing, not for publishing.

Packaging includes `out/**/*`, `package.json`, and the production dependencies added by
electron-builder. Only `better-sqlite3` and `node-pty` are direct runtime dependencies;
the JavaScript libraries are bundled by electron-vite. The `afterPack` hook runs
`scripts/check-package.cjs` before building an installer or AppImage. It rejects project
sources, agent configuration, and environment files using ASAR metadata only. Its contract
is [package contents](../features/github-releases/spec.md#package-contents-nekode-134).
To inspect a package yourself, run
`pnpm run check:package dist/win-unpacked/resources/app.asar`.
`pnpm run test:package` exercises the validator and is included in `verify`.

For a packaged or installed Windows executable, run
`node scripts/package-smoke.mjs <absolute-path-to-nekode.exe>`. This uses a temporary
profile/project, checks renderer startup, SQLite persistence across restart, real PTY
output, bundled resources, RunAsNode adapter execution with invalid fixture configuration,
and process cleanup. It never installs the application. Keep installer and packaged
smoke evidence separate.

### Running the installer / install test

Run the NSIS installer through **PowerShell**
(`Start-Process -FilePath ... -ArgumentList "/S","/D=<directory>" -Wait`).
From bash/MSYS on this host, the installer hangs or fails (exit 139). That is a launcher problem,
not an installer problem. Silent uninstall: `<directory>\Uninstall nekode.exe /S`.

An explicit `/D` directory does not isolate an existing installation: NSIS still uses
the application's registry identity and can uninstall its previous version. Use a clean
test environment, or obtain approval before replacing an existing installation.

### Renderer verification (CSP/IPC)

`nekode.exe --remote-debugging-port=<port>` plus a CDP probe (`Runtime.evaluate`) lets you check
that the renderer mounted under the CSP (for example `document.getElementById('root').children.length > 0`).
The `userData` path on Windows does **not** respect the `APPDATA` variable (Known Folder). Do test
isolation with `app.setPath('userData', ...)`, not by redirecting `APPDATA`.
NeKode provides `NEKODE_USER_DATA`: [main](../../src/main/index.ts) sets this path
before the app is ready. For a dev smoke, set `$env:NEKODE_USER_DATA` to a new temporary
directory in PowerShell, then run `pnpm run dev`. For a packaged smoke, run
`dist/win-unpacked/nekode.exe` with the same explicitly isolated environment. Create
a separate fixture project; do not use the user's real database or project.
End and reap all started Electron, PTY and agent processes; check
that no processes from this test were orphaned. Delete only the checked fixture
directory. In the report, tell dev, packaged and installer smoke apart; a jsdom result is not e2e.
Do not add a second e2e framework or dependency before a concrete need. The current
repository has no e2e script in package.json; Playwright `_electron` is an option for
a future harness, not a condition for running the app.

## 4. Standard commands

`pnpm run test <file>...` runs only the matching Vitest files. The form
`pnpm run test -- <file>...` selects the same files; the test script removes the
package manager's leading separator before passing filters to Vitest. Check the
reported file and test counts to confirm the intended scope. `pnpm run test:runner`
checks filter forwarding and failure exits in an isolated Vitest project and is
included in `pnpm run verify`.

- `pnpm install`: install dependencies (the `allowBuilds` policy).
- `pnpm dev`: the app in development mode (Vite HMR + Electron watch).
- `pnpm build`: build the app (`out/`).
- `pnpm test` / `pnpm test:watch`: Vitest 5 (the `node` and `jsdom` projects).
- `pnpm lint` / `pnpm format`: Biome 2: static analysis and formatting.
- `pnpm run typecheck`: `tsc --noEmit` for tsconfig.node.json and tsconfig.web.json.
- `pnpm run build:unpack` / `pnpm run build:win` / `pnpm run build:linux`: package / Windows installer / Linux AppImage.
- CI: GitHub Actions runs automatically on every pull request and push to `main` (`pnpm install --frozen-lockfile` + `pnpm run verify` on `windows-latest` as the required check, and as an advisory check on `ubuntu-24.04`); how it works and how to read the result: [ci.md](ci.md).

## 5. Native modules and diagnostics

Rule: **only N-API with ready binaries** (no Build Tools on the host).

This policy applies to the supported Windows `win32-x64`; when a version changes, confirm the
prebuild for the specific version/platform pair. For the WSL integration, also check the
binaries of its tools if the change affects them. A missing prebuild blocks the change:
do not add a compiler, a fork or third-party binaries without an explicit user decision.
Review every new install script before allowing it in `allowBuilds`.

Exception for Linux (user decision of 2026-10-20): `node-pty` 1.1.0 has no
Linux prebuilds, so on Linux it is compiled from source. This needs
`build-essential` and `python3` (Debian/Ubuntu: `sudo apt-get install build-essential python3`),
and `pnpm rebuild node-pty` after `pnpm install`. The module is N-API, so one
binary works in Node (Vitest) and in Electron; `npmRebuild: false` stays. The CI job
`verify-linux` does the same on `ubuntu-24.04`, and so does the Linux build of the release workflow before `pnpm run build:linux`. Windows still uses only prebuilds.
`npmRebuild: false` stays correct as long as all native modules have
matching N-API binaries; moving to an ABI-dependent module needs a new assessment.

After a dependency change, run install, lint, typecheck and tests, and for native
changes also a dev or packaged smoke in real Electron. Loading a module
in the host Node or in Vitest does not prove compatibility with Electron. A packaging change
needs at least `pnpm run build:unpack` and starting the package; the installer has
a separate smoke. Record a test that was not run, with the reason, instead of a pass.

| Module | Where the binaries come from | Build policy |
|---|---|---|
| `better-sqlite3` 13.x | built-in `prebuilds/*.node` (N-API) | `better-sqlite3: false` (no node-gyp) |
| `node-pty` 1.1.0 | Windows: `prebuilds/win32-x64/` staged to `build/Release` by `install`; Linux: compiled from source (`node-gyp`, `pnpm rebuild node-pty`) | `node-pty: true` (staging/compile script required) |
| `@biomejs/biome` | per-platform optionalDependencies | `@biomejs/biome: true` (postinstall) |
| `esbuild` | per-platform postinstall | `esbuild: true` |
| `electron` 44.x | lazy download on the first start | no scripts, outside `allowBuilds` |

Common errors and how to recognize them:

- `was compiled against a different Node.js version using NODE_MODULE_VERSION X. This version
  of Node.js requires NODE_MODULE_VERSION Y`: the module was built for a different runtime (for example the host Node
  instead of Electron). Fix: an N-API version with prebuilds (example: better-sqlite3 12.x →
  13.x), never a random fork or a third-party binary artifact.
- `Could not find any Visual Studio installation` from `node-gyp`: something forces a rebuild of
  a module that has prebuilds. Check `pnpm-workspace.yaml` (`allowBuilds`) and
  `electron-builder.yml` (`npmRebuild: false`).
- `ERR_PNPM_IGNORED_BUILDS` during install: a new dependency with an install script is not
  listed in `allowBuilds`. Review the script and add an explicit `true` only if it is needed.
- The NSIS installer "disappears" after starting from bash: run it through PowerShell `Start-Process` (section 3).
- A missing prebuild for a given platform/architecture pair is a **blocker** (mark it BLOCKED); do not
  install Build Tools without authorization and do not work around the problem with a fork or random binaries.
