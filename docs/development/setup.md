# Instrukcja Konfiguracji Środowiska Deweloperskiego (Setup)

**Platforma docelowa:** Windows 11 / WSL2  
**Główny stos technologiczny:** Electron, React, TypeScript, Vite, Tailwind CSS, SQLite (`better-sqlite3`), `node-pty`

---

## 1. Wymagania wstępne

1. **Node.js:** wersja >= 22 (rekomendowana: 22.x LTS).
2. **Menedżer pakietów:** `pnpm` (rekomendowany) lub `npm`.
3. **Narzędzia kompilacji C/C++ (dla modułów natywnych node-pty i better-sqlite3):**
   - Na Windows: Visual Studio C++ Build Tools (`windows-build-tools` lub `vs_buildtools` z pakietem Desktop development with C++).
   - Python w wersji >= 3.11 (wymagany przez `node-gyp` oraz harness agentów).
4. **Git:** wersja >= 2.40.

---

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

---

## 3. Standardowe polecenia (po inicjalizacji projektu)

- `pnpm install` - instalacja zależności.
- `pnpm dev` - uruchomienie aplikacji w trybie deweloperskim (Vite HMR + Electron watch).
- `pnpm build` - budowanie aplikacji do paczki produkcyjnej.
- `pnpm test` - uruchomienie testów jednostkowych i integracyjnych (Vitest).
- `pnpm lint` / `pnpm format` - statyczna analiza kodu i formatowanie.
