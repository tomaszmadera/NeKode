# Backlog

Ten plik przechowuje wyłącznie odłożone pomysły dotyczące projektu. Nie jest aktywnym planem realizacji.

Nowe pozycje dopisuj jako pojedyncze punkty. Gdy pomysł wchodzi do realizacji, usuń go stąd i utwórz właściwą specyfikację lub rekord zadania.

- TaskWorkspace (NeKode): ewikcja sesji usuniętych zadań jest kluczowana samą nieobecnością w `tasksByProject` — przejściowy zanik zadania w mapie (np. `tasks:list` nadpisuje listę wynikiem sprzed współczesnego `tasks:create` w App.loadTasks) niszczy widok żywej sesji (xterm/scrollback; sam PTY przeżywa w main). Robustne rozwiązanie: wymagać nieobecności w dwóch kolejnych snapshotach albo merge-not-replace list zadań. Źródło: review Stage 3 mvp-core-shell (non-blocking). Po Stage 4 nazwy identyfikatorów: ChatWorkspace/chatsByProject.

- Post-MVP: encja Task (zadanie) przypinana do czatu + panel zapisu postępu prac, niezależny od harnessa (wzorzec: `.agents/tasks/*/task.md` z project-template). Źródło: decyzja użytkownika 2026-09-25 (requirements.md §3).

- Post-MVP: funkcjonalność Kanban (wcześniej poglądowy podgląd w MVP — przeniesiona poza MVP razem z modelem zadań). Źródło: decyzja użytkownika 2026-09-25 (requirements.md §3).

- Post-MVP: ręczna zmiana nazwy czatu (pole `name` w bazie przygotowane; domyślnie nazwa = nazwa terminala/shella). Źródło: decyzja użytkownika 2026-09-25.

- Terminologia w UX-UI.md i SDD.md: dostosowanie do modelu PROJEKT → CZATY (task = przyszła encja z postępem prac) — dokumenty nadal opisują task z terminalem. Źródło: zmiana modelu 2026-09-25.

- Ctrl+D/Ctrl+U w terminalu czatu (GUI): punkty acceptance 3/5 mvp-core-shell pozostają niespełnione mimo poprawki emulacji readline (Ctrl+D = delete-char, Ctrl+U = unix-line-discard, commit `abc0219`) — użytkownik 2026-09-26: „nie działa", bez szczegółów; diagnostykę odłożono (decyzja: szkoda czasu teraz). Realizacja: odtworzyć przepływ w realnym GUI (`pnpm dev`), ustalić który punkt nie przechodzi (powtórka po wcześniejszym Ctrl+D? Ctrl+U?), sprawdzić czy klawisze w ogóle trafiają do handlera w realnym oknie (focus/IME/xterm textarea) i czy emulacja dociera do PTY (logi `tmp/logs/`). Dowody dotychczasowe: zachowanie powłoki potwierdzone przechwytami ConPTY (`tmp/repro*.bin`), testy regresyjne w `ChatTerminal.test.tsx` zielone — luka jest między mockiem/jsdom a realnym GUI. Kontrakt: `docs/features/mvp-core-shell/spec.md` Behaviour 11 / AC9 (wersja 2026-09-26). Źródło: user-gate retest runda 5 mvp-core-shell (deferred-by-decision).
- AC8 (project-files-view): demo „usunięty katalog projektu → inline error w trybie plików + działa ← Projects" — deferred-by-decision 2026-09-26 („wyjdzie w praniu"); przetestować przy naturalnym użytkowaniu widoku Files.

- Dolny panel (bottom-auxiliary-terminal): wpisy `pendingBottomCommandsRef` (App.tsx) są usuwane tylko przy udanym ready-write; zamknięcie zakładki, exit, spawn-error albo przerwane `createBottomTab` zostawiają wpis do końca sesji (nieszkodliwe funkcjonalnie — id zakładek nie są reuse). Fix: usuwać wpis w handleCloseBottomTab / handleBottomExit / onSpawnError / przy abort createBottomTab. Źródło: review:4 bottom-auxiliary-terminal (non-blocking suggestion).

- Dolny panel: wykonanie akcji `bottom-terminal` otwiera ukryty panel zwykłym open bez zapisu `focusBeforeOpenRef` — późniejszy Ctrl+` (hide) przywraca fokus na powierzchnię środkową zamiast na element sprzed otwarcia (odchylenie od Behaviour 4 na tej nowej ścieżce). Fix: przechwycić `document.activeElement` przy otwieraniu z ukrytego, z taką samą ochroną przed fokusem `body` jak w showBottomPanel. Źródło: review:4 (non-blocking suggestion).

- Test migracji v5 (`src/main/db/db.test.ts`): asercja „stare wiersze byte-for-byte" pomija kolumnę `icon` (wszystkie fixture mają NULL, INSERT...SELECT kopiuje) — dodać `icon` do SELECT i oczekiwanych wierszy z nie-NULL fixture, żeby realny drop kolumny padał. Źródło: review:4 (non-blocking suggestion).

- Dokumenty po bottom-auxiliary-terminal: `docs/features/bottom-auxiliary-terminal/spec.md` l. 13 (Related requirements) — nieaktualny dopisek opisujący requirements §2.5 jako rezerwację trybu (kontrakt już jest wskazywany); `docs/architecture/sdd.md` §62 MVP User Flow — „Git status refreshes when command ends" sprzeczne z Behaviour 18 (istniało wcześniej, dostosować przy następnej styczności). Źródło: review:4 (non-blocking suggestions).
