# NeKode

Agent-First Coding Environment: desktopowe środowisko pracy z agentami kodującymi dla Windows 11. Agenty CLI (np. Codex, Claude Code, OpenCode, agy, Gemini CLI) działają jako sesje terminala (PTY) przypisane do czatów w drzewku projektów, a stan projektów, czatów i layoutu trzyma lokalna baza SQLite.

## Status

Aktywny rozwój MVP (wersja 0.4.10, patrz `package.json`). Aplikacja działa w trybie dev i buduje instalator NSIS.

## Co zawiera MVP

- Zarządzanie lokalnymi projektami i kontekstem pracy: ścieżka, wykryte runtimy, gałąź i status Git.
- Czaty jako sesje terminala (node-pty + xterm.js), jeden terminal główny na czat, z zachowaniem sesji przy przełączaniu czatów.
- Podgląd plików projektu: drzewo katalogów i podgląd read-only w Monaco Editor.
- Pasek akcji projektu: stałe `Handoff | Resume` i `Stop | Continue` oraz konfigurowalne przyciski poleceń.
- Persystencja w SQLite (better-sqlite3).

## Wymagania

- Windows 11.
- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` (pole `engines` w `package.json`).
- pnpm 12.5.1 (przypięty w `packageManager`; Corepack albo instalacja globalna).
- Python >= 3.11 (skrypty harnessu `.agents/`).
- Git >= 2.40.
- Visual Studio C++ Build Tools nie są wymagane: moduły natywne (better-sqlite3, node-pty) korzystają z prebuildów N-API.

Pełna, zweryfikowana instrukcja konfiguracji: [`docs/development/setup.md`](docs/development/setup.md).

## Uruchomienie lokalne

```
pnpm install
pnpm run dev
```

Przy pierwszym uruchomieniu Electron pobiera swoje binaria (wymagana sieć tylko za pierwszym razem).

Build poza trybem dev:

- `pnpm run build:unpack`: spakowana aplikacja w `dist/win-unpacked/` (najszybszy smoke test).
- `pnpm run build:win`: instalator NSIS w `dist/`.

## Testy i weryfikacja

- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test`
- `pnpm run verify` (lint + typecheck + test)
- `pnpm run format`

## Architektura

- `src/main`: proces główny Electron; usługi domenowe (ProjectService, TaskService, WorkspaceService, TerminalService), SQLite, PTY.
- `src/preload`: ściśle typowany mostek IPC (`contextBridge`).
- `src/renderer`: React 19, Tailwind CSS, xterm.js, Monaco Editor.

## Dokumentacja

- `docs/product/` - zatwierdzone wymagania produktu.
- `docs/features/` - kontrakty zachowania funkcji.
- `docs/architecture/` - decyzje i dokumentacja architektury.
- `docs/development/` - instrukcje dla osób rozwijających projekt.
- `docs/operations/` - runbooki wdrożenia i utrzymania.

## Praca z agentami

Zasady pracy znajdują się w [`AGENTS.md`](AGENTS.md), a aktualny stos i polecenia projektu w [`.agents/project-profile.yaml`](.agents/project-profile.yaml). Postęp większych zadań jest w `.agents/tasks/<id>/task.md`, plan w `.agents/tasks/<id>/plan.md`, a kontrakt zachowania w `docs/features/<nazwa>/spec.md`.

Używaj `implement` dla standardowej i większej implementacji, `systematic-debugging` dla nieoczywistych błędów oraz `code-review` do przeglądu bez modyfikowania zmian. W poleceniu dla agenta podaj nazwę skilla, kanoniczne źródło wymagań, zakres, wyłączenia i kryteria akceptacji.
