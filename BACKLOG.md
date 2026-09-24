# Backlog

Ten plik przechowuje wyłącznie odłożone pomysły dotyczące projektu. Nie jest aktywnym planem realizacji.

Nowe pozycje dopisuj jako pojedyncze punkty. Gdy pomysł wchodzi do realizacji, usuń go stąd i utwórz właściwą specyfikację lub rekord zadania.

- TaskWorkspace (NeKode): ewikcja sesji usuniętych zadań jest kluczowana samą nieobecnością w `tasksByProject` — przejściowy zanik zadania w mapie (np. `tasks:list` nadpisuje listę wynikiem sprzed współczesnego `tasks:create` w App.loadTasks) niszczy widok żywej sesji (xterm/scrollback; sam PTY przeżywa w main). Robustne rozwiązanie: wymagać nieobecności w dwóch kolejnych snapshotach albo merge-not-replace list zadań. Źródło: review Stage 3 mvp-core-shell (non-blocking).
