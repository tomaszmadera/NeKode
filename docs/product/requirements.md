# Wymagania Produktu: NeKode MVP

**Status:** Zaakceptowane wymagania produktu MVP  
**Wersja:** 0.2  
**Źródła nadrzędne:** [`SDD.md`](file:///mnt/f/projects/NeKode/docs/architecture/SDD.md), [`UX-UI.md`](file:///mnt/f/projects/NeKode/docs/UX-UI.md)

---

## 1. Cel produktu

NeKode to desktopowe środowisko pracy typu **agent-first coding workspace** na platformę Windows 11. Aplikacja służy jako centrum kontroli pracy z autonomicznymi agentami kodującymi uruchamianymi w terminalu (np. Codex CLI, Claude Code, OpenCode, agy, Gemini CLI).

W MVP agenci traktowani są jako standardowe procesy terminalowe (PTY) bez konieczności implementowania dedykowanych protokołów (ACP/MCP).

Centralnym pojęciem MVP jest **Chat (czat)** — sesja terminala przypisana do projektu, widoczna w drzewku po lewej (PROJEKT → CZATY). Z czatem powiązany jest kontekst pracy: katalog roboczy (workspace) oraz stan Git. Odrębną encją (post-MVP) jest **Task (zadanie)** — jednostka pracy z zapisem postępu, przypinana do czatu; jej śledzenie postępu ma być niezależne od konkretnego harnessa.

---

## 2. Wymagania funkcjonalne MVP

1. **Zarządzanie projektami:**
   - Rejestrowanie lokalnych projektów programistycznych.
   - Przełączanie aktywnego projektu w pasku bocznym.
   - Odczyt kontekstu projektu: ścieżka, wykryte runtimy, stan gałęzi Git oraz status worktree.

2. **Zarządzanie czatami (Chats):**
   - Drzewko w lewym panelu: PROJEKT → CZATY (czaty widoczne pod projektami).
   - Tworzenie nowego czatu bez formularza nazwy (nazwa = nazwa terminala/shella, np. „PowerShell"; nazwy mogą się powtarzać) i przełączanie między czatami z zachowaniem stanu sesji roboczej.
   - Zamykanie czatu wraz z zamknięciem jego terminala (`exit`, `Ctrl+D`): czat znika z drzewka, aplikacja przechodzi do kolejnego czatu w projekcie (gdy czatów nie zostanie — stan pusty z przyciskiem "Start new chat").

3. **Sesje terminala (PTY):**
   - Uruchamianie agentów i narzędzi CLI w natywnych procesach terminalowych (node-pty) w procesie głównym.
   - Renderowanie terminala w widoku głównym za pomocą xterm.js (jeden terminal główny na czat).
   - Zachowanie aktywnych sesji terminala w czasie działania aplikacji przy przełączaniu czatów; restarcie aplikacji drzewko czatów wraca do stanu sprzed restartu (jak w Zed), a terminale startują świeżo po otwarciu czatu.
   - Pomocniczy dolny panel terminali (możliwość otwierania wielu terminali/zakładek) — realizowany jako osobne zadanie.

4. **Przeglądanie plików projektu:**
   - Drzewo plików projektu w lewym panelu z możliwością zwijania/rozwijania katalogów.
   - Podgląd zawartości plików w trybie tylko do odczytu (read-only) przy użyciu komponentu Monaco Editor.

5. **Pasek akcji projektu (Action Bar):**
   - Pasek akcji w kolumnie środkowej, bezpośrednio pod paskiem zakładek (decyzja użytkownika 2026-09-26): stałe grupy `Handoff | Resume` i `Stop | Continue`, a następnie konfigurowalne przyciski do uruchamiania zdefiniowanych poleceń projektu (np. dev server, testy, build, weryfikacja).
   - Stałe przyciski wysyłają do terminala aktywnego czatu dokładne dane wejściowe (tekst + CR; `Stop` = Ctrl+C) przez istniejące IPC `terminals:write`.
   - Wykonywanie poleceń w trybie `background` albo `new-terminal` (nowy czat z poleceniem); tryb `bottom-terminal` zarezerwowany do czasu dolnego panelu terminali (wymaganie 3).

6. **Persystencja danych:**
   - Zapisywanie konfiguracji projektów, czatów, historii i stanu layoutu w lokalnej bazie SQLite (`better-sqlite3`).

7. **Interfejs użytkownika:**
   - Ergonomiczny, ciemny interfejs zgodny ze specyfikacją [`UX-UI.md`](file:///mnt/f/projects/NeKode/docs/UX-UI.md).
   - Skalowalne i resizowalne panele robocze.
   - Kolumna środkowa: pasek zakładek u góry (zakładka aktywnego czatu — niezamykalna; zakładki otwartych plików; `+ New chat`), pod nim pasek akcji (zob. 5), poniżej powierzchnia główna.
   - Pasek statusu na samym dole okna (cała szerokość) z kontekstem projektu: nazwa, ścieżka, wykryte runtimy oraz gałąź i status Git.
   - Interfejs w całości w języku angielskim; stałe ciągi wysyłane do terminala przez przyciski paska akcji (np. `Napisz handoff`) są danymi literałowymi i nie podlegają tłumaczeniu.

---

## 3. Zakres wyłączony z MVP (Explicit Non-Goals)

- Brak bezpośredniej edycji kodu źródłowego w aplikacji (kod modyfikują agenci lub zewnętrzny edytor).
- Brak implementacji protokołu ACP (Agent Client Protocol) oraz MCP (Model Context Protocol).
- Brak bezpośrednich zapytań do API modeli LLM z poziomu aplikacji.
- Brak silnika LSP (Language Server Protocol) i mechanizmów IntelliSense.
- Brak automatycznego tworzenia i zarządzania Git worktrees per task.
- Brak synchronizacji chmurowej i kont użytkowników (dane przechowywane wyłącznie lokalnie).
- Post-MVP: encja **Task (zadanie)** — jednostka pracy przypinana do czatu, z panelem zapisu postępu prac (wzorzem mogą być rekordy `.agents/tasks/*/task.md` z project-template, ale bez uzależnienia aplikacji od konkretnego harnessa).
- Post-MVP: migawki przekazania prac (handoff) powiązane z zadaniami.
- Post-MVP: ręczna zmiana nazwy czatu (pole `name` w bazie zostaje przygotowane; domyślnie nazwa = nazwa terminala/shella).
- Post-MVP: funkcjonalność tablicy **Kanban** (wcześniej planowana jako poglądowy podgląd w MVP — przeniesiona poza MVP w celu przemyślenia modelu razem z zadaniami).
