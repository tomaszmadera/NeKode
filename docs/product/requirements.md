# Wymagania Produktu: NeKode MVP

**Status:** Zaakceptowane wymagania produktu MVP  
**Wersja:** 0.1  
**Źródła nadrzędne:** [`SDD.md`](file:///mnt/f/projects/NeKode/docs/architecture/SDD.md), [`UX-UI.md`](file:///mnt/f/projects/NeKode/docs/UX-UI.md)

---

## 1. Cel produktu

NeKode to desktopowe środowisko pracy typu **agent-first coding workspace** na platformę Windows 11. Aplikacja służy jako centrum kontroli pracy z autonomicznymi agentami kodującymi uruchamianymi w terminalu (np. Codex CLI, Claude Code, OpenCode, agy, Gemini CLI).

W MVP agenci traktowani są jako standardowe procesy terminalowe (PTY) bez konieczności implementowania dedykowanych protokołów (ACP/MCP).

Centralnym pojęciem domeny jest **Task** (zadanie programistyczne), do którego przypisywane są zasoby: sesja terminala, katalog roboczy (workspace), stan Git oraz historia handoffów.

---

## 2. Wymagania funkcjonalne MVP

1. **Zarządzanie projektami:**
   - Rejestrowanie lokalnych projektów programistycznych.
   - Przełączanie aktywnego projektu w pasku bocznym.
   - Odczyt kontekstu projektu: ścieżka, wykryte runtimy, stan gałęzi Git oraz status worktree.

2. **Zarządzanie zadaniami (Tasks):**
   - Tworzenie i organizacja zadań w ramach projektu.
   - Przełączanie aktywnego zadania z zachowaniem stanu sesji roboczej.
   - Tworzenie i przeglądanie migawek przekazania prac (handoff).

3. **Sesje terminala (PTY):**
   - Uruchamianie agentów i narzędzi CLI w natywnych procesach terminalowych (node-pty) w procesie głównym.
   - Renderowanie terminala w widoku głównym za pomocą xterm.js.
   - Zachowanie aktywnych sesji terminala w czasie działania aplikacji przy przełączaniu zadań.
   - Pomocniczy dolny terminal (Bottom Terminal) przełączany skrótem klawiszowym `Ctrl + \``.

4. **Przeglądanie plików projektu:**
   - Drzewo plików projektu w lewym panelu z możliwością zwijania/rozwijania katalogów.
   - Podgląd zawartości plików w trybie tylko do odczytu (read-only) przy użyciu komponentu Monaco Editor.

5. **Pasek akcji projektu (Action Bar):**
   - Górny pasek z konfigurowalnymi przyciskami do uruchamiania zdefiniowanych poleceń projektu (np. dev server, testy, build, weryfikacja).

6. **Wizualny podgląd tablicy Kanban:**
   - Statyczny podgląd demonstracyjny tablicy Kanban z kolumnami stanu prac i kartami zadań (w MVP widok wyłącznie poglądowy, bez mechanizmu mutacji stanu).

7. **Persystencja danych:**
   - Zapisywanie konfiguracji projektów, zadań, historii i stanu layoutu w lokalnej bazie SQLite (`better-sqlite3`).

8. **Interfejs użytkownika:**
   - Ergonomiczny, ciemny interfejs zgodny ze specyfikacją [`UX-UI.md`](file:///mnt/f/projects/NeKode/docs/UX-UI.md).
   - Skalowalne i resizowalne panele robocze.
   - Interfejs w całości w języku angielskim.

---

## 3. Zakres wyłączony z MVP (Explicit Non-Goals)

- Brak bezpośredniej edycji kodu źródłowego w aplikacji (kod modyfikują agenci lub zewnętrzny edytor).
- Brak implementacji protokołu ACP (Agent Client Protocol) oraz MCP (Model Context Protocol).
- Brak bezpośrednich zapytań do API modeli LLM z poziomu aplikacji.
- Brak silnika LSP (Language Server Protocol) i mechanizmów IntelliSense.
- Brak automatycznego tworzenia i zarządzania Git worktrees per task.
- Brak synchronizacji chmurowej i kont użytkowników (dane przechowywane wyłącznie lokalnie).
