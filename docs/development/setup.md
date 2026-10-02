# Instrukcja Konfiguracji Środowiska Deweloperskiego (Setup)

**Platforma docelowa:** Windows 11 / WSL2
**Główny stos technologiczny:** Electron, React, TypeScript, Vite, Tailwind CSS, SQLite (`better-sqlite3`), `node-pty`

Toolchain poniżej jest **zweryfikowany** (stack-update-hardening, 2026-09-24): wersje
zainstalowane i przetestowane wraz z buildem instalatora i uruchomieniem aplikacji poza dev.

## 1. Wymagania wstępne

1. **Node.js:** `^22.22.2 || ^24.15.0 || >=26.0.0` (pole `engines` w package.json).
   Zweryfikowana konfiguracja hosta: Node 24.18.0.
2. **Menedżer pakietów:** `pnpm` **12.5.1** przypięty przez `packageManager` w package.json
   (Corepack albo instalacja globalna — obie działają; zweryfikowana: globalna 12.5.1).
3. **Visual Studio C++ Build Tools: NIE SĄ WYMAGANE.** Wszystkie moduły natywne korzystają
   z gotowych binariów N-API/prebuild (patrz sekcja 5). Ich wymuszoną przebudowę wyłączamy
   świadomie (`better-sqlite3: false` w `pnpm-workspace.yaml`, `npmRebuild: false`
   w `electron-builder.yml`).
4. **Git:** >= 2.40 (zweryfikowany: 2.55).

### Zweryfikowane wersje składowe

| Składnik | Wersja | Uwagi |
|---|---|---|
| Electron | 44.4.5 | w środku Node 24.21.0 (NODE_MODULE_VERSION 149) |
| electron-vite | 5.0.0 | `externalizeDepsPlugin` usunięty (externalizacja domyślna w v5) |
| Vite | 7.3.6 | górna gałąź z peer range electron-vite (`^5 \|\| ^6 \|\| ^7`) |
| @vitejs/plugin-react | 5.2.0 | wersja 6.x wymaga Vite 8 — nie używać z electron-vite 5 |
| TypeScript | 5.9.3 | dwa projekty: `tsconfig.node.json`, `tsconfig.web.json` |
| React / ReactDOM | 19.3.0 | |
| Tailwind CSS + @tailwindcss/vite | 4.3.3 | |
| Zustand | 5.0.15 | |
| better-sqlite3 | 13.0.3 | N-API, wbudowane prebuildy (także `win32-x64.node`) |
| node-pty | 1.1.0 | stabilna linia (1.2.0 to serie beta); prebuildy staging przez install script |
| Vitest | 5.0.1 | `test.projects` (node + jsdom); `environmentMatchGlobs` usunięte w v4 |
| Biome | 2.5.14 | lint + format |
| electron-builder | 25.1.8 | NSIS, `npmRebuild: false` |

Uwaga: `engines` w package.json pochodzi od najbardziej restrykcyjnej zależności (jsdom 30).
Host Node (24.18.0) i Node wewnątrz Electrona (24.21.0) mają **inne** `NODE_MODULE_VERSION`
(137 vs 149) — dlatego moduły natywne muszą być N-API (ABI-stabilne), a nie budowane pod
konkretny runtime.

## 2. Architektura procesu

- **Proces główny (`src/main/`):**
  - Cykl życia aplikacji Electron.
  - Usługi domenowe (`ProjectService`, `TaskService`, `WorkspaceService`, `TerminalService`).
  - Dostęp do bazy danych SQLite i operacji systemowych (PTY, system plików).
- **Proces preload (`src/preload/`):**
  - Bezpieczny mostek IPC (`contextBridge.exposeInMainWorld`).
  - Ściśle typowane API wystawiane dla renderera.
- **Proces renderera (`src/renderer/`):**
  - Aplikacja React 19 / TypeScript / Vite.
  - Komponenty UI: panele robocze, integracja xterm.js, podgląd plików w Monaco Editor.
  - Style: Tailwind CSS.

## 3. Instalacja i smoke testy

Sekwencja zweryfikowana na czystym środowisku:

1. `pnpm install` — respektuje politykę skryptów z `pnpm-workspace.yaml`
   (`allowBuilds`; patrz sekcja 5). Dla reprodukcji z lockfilem: `pnpm install --frozen-lockfile`.
2. `pnpm run lint && pnpm run typecheck && pnpm run test` — statyczna analiza, oba typechecki, testy.
3. `pnpm run dev` — tryb deweloperski (Vite HMR + Electron). **Uwaga:** Electron 44 pobiera
   swoje binaria dopiero przy pierwszym uruchomieniu (nie przy install) — to normalne
   i wymaga sieci tylko za pierwszym razem.
4. `pnpm run build` — build produkcyjny (`out/`).
5. `pnpm run build:unpack` — spakowana aplikacja w `dist/win-unpacked/` (najszybszy smoke poza dev).
6. `pnpm run build:win` — instalator NSIS `dist/nekode Setup <wersja>.exe`.

### Uruchomienie instalatora / test instalacji

Instalator NSIS uruchamiaj przez **PowerShell**
(`Start-Process -FilePath ... -ArgumentList "/S","/D=<katalog>" -Wait`).
Z poziomu bash/MSYS na tym hoście instalator wisi albo pada (exit 139) — to problem launchera,
nie instalatora. Cicha deinstalacja: `<katalog>\Uninstall nekode.exe /S`.

### Weryfikacja renderera (CSP/IPC)

`nekode.exe --remote-debugging-port=<port>` + sonda CDP (`Runtime.evaluate`) pozwala sprawdzić,
że renderer zamontował się pod CSP (np. `document.getElementById('root').children.length > 0`).
Ścieżka `userData` na Windows **nie** respektuje zmiennej `APPDATA` (Known Folder) — izolację
testową rób przez `app.setPath('userData', ...)`, nie przez środowisko.

## 4. Standardowe polecenia

- `pnpm install` — instalacja zależności (polityka `allowBuilds`).
- `pnpm dev` — aplikacja w trybie deweloperskim (Vite HMR + Electron watch).
- `pnpm build` — budowanie aplikacji (`out/`).
- `pnpm test` / `pnpm test:watch` — Vitest 5 (projekty `node` i `jsdom`).
- `pnpm lint` / `pnpm format` — Biome 2: statyczna analiza i formatowanie.
- `pnpm run typecheck` — `tsc --noEmit` dla tsconfig.node.json i tsconfig.web.json.
- `pnpm run build:unpack` / `pnpm run build:win` — paczka / instalator Windows.

## 5. Moduły natywne i diagnostyka

Zasada: **tylko N-API z gotowymi binariami** (brak Build Tools na hoście).

| Moduł | Skąd binaria | Polityka build |
|---|---|---|
| `better-sqlite3` 13.x | wbudowane `prebuilds/*.node` (N-API) | `better-sqlite3: false` (bez node-gyp) |
| `node-pty` 1.1.0 | `prebuilds/win32-x64/` staging do `build/Release` przez `install` | `node-pty: true` (skrypt staging wymagany) |
| `@biomejs/biome` | optionalDependencies per-platforma | `@biomejs/biome: true` (postinstall) |
| `esbuild` | postinstall per-platforma | `esbuild: true` |
| `electron` 44.x | lazy download przy pierwszym uruchomieniu | brak skryptów — poza `allowBuilds` |

Typowe błędy i rozpoznawanie:

- `was compiled against a different Node.js version using NODE_MODULE_VERSION X. This version
  of Node.js requires NODE_MODULE_VERSION Y` — moduł zbudowany pod inny runtime (np. host Node
  zamiast Electron). Rozwiązanie: wersja N-API z prebuildami (przykład: better-sqlite3 12.x →
  13.x), nigdy losowy fork ani obcy binarny artefakt.
- `Could not find any Visual Studio installation` z `node-gyp` — ktoś wymusza przebudowę
  modułu, który ma prebuildy. Sprawdź `pnpm-workspace.yaml` (`allowBuilds`) i
  `electron-builder.yml` (`npmRebuild: false`).
- `ERR_PNPM_IGNORED_BUILDS` przy instalacji — nowa zależność ze skryptem instalacyjnym nie jest
  wpisana w `allowBuilds`. Przejrzyj skrypt i dopisz jawne `true` tylko jeśli jest potrzebny.
- Instalator NSIS „znika" po starcie z basha — uruchom przez PowerShell `Start-Process` (sekcja 3).
- Brak prebuilda dla danej pary platforma/architektura = **blokada** (oznacz BLOCKED); nie
  instaluj Build Tools bez autoryzacji i nie obchodź problemu forkiem/losowymi binariami.
