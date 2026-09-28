# Backlog

Ten plik przechowuje wyłącznie odłożone pomysły dotyczące projektu. Nie jest aktywnym planem realizacji.

Nowe pozycje dopisuj jako pojedyncze punkty. Gdy pomysł wchodzi do realizacji, usuń go stąd i utwórz właściwą specyfikację lub rekord zadania.

- TaskWorkspace (NeKode): ewikcja sesji usuniętych zadań jest kluczowana samą nieobecnością w `tasksByProject` — przejściowy zanik zadania w mapie (np. `tasks:list` nadpisuje listę wynikiem sprzed współczesnego `tasks:create` w App.loadTasks) niszczy widok żywej sesji (xterm/scrollback; sam PTY przeżywa w main). Robustne rozwiązanie: wymagać nieobecności w dwóch kolejnych snapshotach albo merge-not-replace list zadań. Źródło: review Stage 3 mvp-core-shell (non-blocking). Po Stage 4 nazwy identyfikatorów: ChatWorkspace/chatsByProject.

- Post-MVP: encja Task (zadanie) przypinana do czatu + panel zapisu postępu prac, niezależny od harnessa (wzorzec: `.agents/tasks/*/task.md` z project-template). Źródło: decyzja użytkownika 2026-09-25 (requirements.md §3).

- Post-MVP: funkcjonalność Kanban (wcześniej poglądowy podgląd w MVP — przeniesiona poza MVP razem z modelem zadań). Źródło: decyzja użytkownika 2026-09-25 (requirements.md §3).

- Post-MVP: ręczna zmiana nazwy czatu (pole `name` w bazie przygotowane; domyślnie nazwa = nazwa terminala/shella). Źródło: decyzja użytkownika 2026-09-25.

- Terminologia w UX-UI.md i SDD.md: dostosowanie do modelu PROJEKT → CZATY (task = przyszła encja z postępem prac) — dokumenty nadal opisują task z terminalem. Źródło: zmiana modelu 2026-09-25.

- Ctrl+U w terminalu czatu (GUI): ręczny punkt acceptance 5 z mvp-core-shell pozostaje niepotwierdzony. W zadaniu `gui-ctrl-d-ctrl-u-diagnosis` użytkownik wskazał konkretnie Ctrl+D na pustym promptcie; poprawka raportowania fokusu xterm usunęła ten błąd w izolowanym Electronie, ale nie stanowi ręcznego potwierdzenia Ctrl+U. Przy następnym teście GUI sprawdzić Ctrl+U z tekstem przed kursorem i zachowanie tekstu za kursorem. Kontrakt: `docs/features/mvp-core-shell/spec.md` Behaviour 11 / AC9. Źródło: user-gate retest runda 5 mvp-core-shell (deferred-by-decision).
- AC8 (project-files-view): demo „usunięty katalog projektu → inline error w trybie plików + działa ← Projects" — deferred-by-decision 2026-09-26 („wyjdzie w praniu"); przetestować przy naturalnym użytkowaniu widoku Files.
