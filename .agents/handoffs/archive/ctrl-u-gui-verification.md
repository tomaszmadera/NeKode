---
task_id: ctrl-u-gui-verification
created: 2026-09-28T13:46:20Z
schema_version: 2
from: Main (sesja 2026-09-28)
to: Main (następna sesja)
branch: main
worktree: current
checkpoint_subject: 3ad4f65d7c33a31e6169dca1c7314e85e0e70226+sha256:9bf2ab938340e4f578390850fd25c6622475faa2e240001377295e6edf0f91a7
current_step: Phase 1.1
next_action: Uruchom realne GUI NeKode i sprawdź Ctrl+U z kursorem w środku wpisanej linii czatu; zapisz wynik w rekordzie zadania.
blockers: none
---

# Handoff: Ctrl+U GUI acceptance

## Repository snapshot

Rekord zadania: `.agents/tasks/ctrl-u-gui-verification/task.md` (active, Phase 1.1). Rola: Main do Main, następna sesja. Powód: użytkownik kończy sesję po lokalnym commicie zmiany Ctrl+U. To jest Small/analysis bez nowego planu. Kontrakt: `docs/features/mvp-core-shell/spec.md` Behaviour 11 / AC9; wspólny komponent obsługuje też dolne terminale według `docs/features/bottom-auxiliary-terminal/spec.md` Behaviour 10.

### Working

- `HEAD` przed checkpointem: `3ad4f65d7c33a31e6169dca1c7314e85e0e70226` (`fix: clear full terminal input with Ctrl+U`). Commit zawiera dokładnie sześć plików: `BACKLOG.md`, dwie specyfikacje, `src/renderer/src/components/terminal/ChatTerminal.tsx`, jego test i `src/renderer/src/test/xterm-mock.ts`.
- W domyślnym PowerShellu NeKode `Ctrl+U` jest przechwytywany poza alternate buffer i wysyła do PTY `Ctrl+A` (`SelectAll`) oraz Backspace. Powinno to usuwać tekst przed kursorem i za nim. `Ctrl+D` i skróty w alternate buffer zachowują poprzedni kontrakt.
- Przed checkpointem pozostały dwa pliki lekcji z wcześniejszego odczytu statusu: `.agents/lessons/index.json` i `.agents/lessons/items/windows-python-harness-utf8-output.md`. Użytkownik wyraźnie zlecił commit wszystkiego po zapisaniu handoffu. Zawarto je w zakresie checkpointu obok rekordu i tej migawki. Zweryfikuj ostateczny commit przez `git show`, bo ten snapshot powstaje przed nim.
- `BACKLOG.md` nadal zawiera odłożone ręczne sprawdzenie Ctrl+U w GUI oraz osobny punkt AC8 widoku Files. Pozostałe wpisy są odłożonymi pomysłami, bez kolejności realizacji.

### Broken

- Zachowanie Ctrl+U w samym GUI NeKode nie zostało ręcznie potwierdzone. Test komponentu i osobna próba ConPTY potwierdzają kod i domyślny PowerShell, ale nie zastępują testu GUI.
- Pełne `cmd /c pnpm run lint` zwróciło exit 1: Biome zgłosił format niezmienionego `package.json` z CRLF. Błędy formatu zmienionego testu zostały poprawione i sprawdzenie Biome dla trzech zmienionych plików kodu przeszło. Nie zmieniano `package.json` w tym zadaniu. Powiązane lekcje: `.agents/lessons/items/windows-biome-package-json-eol.md` i `.agents/lessons/items/git-checkout-reintroduces-crlf.md`.

## Decisions

- Decyzja użytkownika 2026-09-28: Ctrl+U usuwa cały wpisany wiersz, jak domyślne `kill-whole-line` w zsh, także gdy kursor stoi w środku.
- W tej sesji użytkownik zaakceptował tylko lokalny commit zmiany Ctrl+U, a następnie wyraźnie zlecił handoff i commit całego pozostałego stanu. Brak zgody na tag, push lub wdrożenie. `publication-status --json` przed handoffem pokazał brak remote i upstream.
- Następna sesja zaczyna od ręcznej akceptacji Ctrl+U. Jeśli test przejdzie, usuń jego odłożony wpis z `BACKLOG.md` i zamknij zadanie zgodnie z workflow. Jeśli nie przejdzie, zachowaj wynik i przejdź do diagnozy przyczyny.

## Failed approaches

- `python .agents/scripts/task-status --json` bez `PYTHONIOENCODING=utf-8` zakończył się `UnicodeEncodeError` w `encodings/cp1250.py` dla U+2190. Z ustawionym UTF-8 zadziałał. Lekcja o tym jest w checkpoincie.
- `handoff-status --json` nie jest obsługiwane; użyj zwykłego `handoff-status` lub `--check`.
- Odczyt lokalnych przypisań PSReadLine został zablokowany przez hook. Oficjalna dokumentacja Microsoft potwierdziła `Ctrl+A` jako `SelectAll` w trybie Windows, a osobna próba ConPTY potwierdziła sekwencję. Nie ponawiaj zablokowanego polecenia bez nowej potrzeby i uprawnienia.

## Verification

- `python .agents/scripts/verify-targeted -- cmd /c pnpm exec vitest run src/renderer/src/components/terminal/ChatTerminal.test.tsx`: exit 0, 28/28 testów.
- `cmd /c pnpm run typecheck`: exit 0. `cmd /c pnpm exec biome check` dla `ChatTerminal.tsx`, `ChatTerminal.test.tsx` i `xterm-mock.ts`: exit 0.
- Oddzielna próba z `node-pty` i `powershell.exe -NoLogo -NoProfile`: po wpisaniu komendy, przesunięciu kursora w lewo i wysłaniu `Ctrl+A` + Backspace pierwsza komenda nie została wykonana; kolejna dała oczekiwany wynik. Proces wyszedł z kodem 0.
- `git diff --check`: exit 0 przed handoffem. `python .agents/scripts/task-status --check .agents/tasks/ctrl-u-gui-verification/task.md`: exit 0 podczas przygotowania rekordu. Walidacja tej migawki i końcowy commit należą do dalszych kroków bieżącej sesji.
- Test ręczny GUI: nie wykonano. Pełny lint: exit 1 z powodu CRLF w `package.json`.

## Open product invariants

- `CTRL-U-WHOLE-LINE`: status `implemented, GUI unverified`. Wpływ: kod i kontrakt mówią, że znika cały wpisany wiersz, ale akceptacja w prawdziwym oknie aplikacji jest otwarta. Dowód do zmiany statusu: w czacie wpisz `abcXYZ`, ustaw kursor między `c` i `X`, naciśnij Ctrl+U; prompt zostaje, a `abcXYZ` znika. Zapisz wynik i sprawdź, czy `Ctrl+D` na pustym promptcie nadal zamyka czat.

## Unresolved assumptions

- Domyślny PowerShell uruchamiany przez `src/main/services/terminal/terminal-service.ts` użyje PSReadLine w trybie Windows, gdzie `Ctrl+A` oznacza `SelectAll`. Źródło: domyślna konfiguracja powłoki w kodzie, dokumentacja PSReadLine oraz próba ConPTY bez profilu. Konsekwencja: profil użytkownika może zmienić przypisanie klawiszy, a GUI nie było ręcznie sprawdzone. Rozstrzyga test w realnej aplikacji z normalnym profilem.

## Resume instructions

Pierwsza akcja: aktywuj skill `handoff` w trybie resume dla `.agents/handoffs/ctrl-u-gui-verification.md`, sprawdź `git status`, obiekt końcowego commita i rekord zadania, następnie wykonaj `preflight`. Oczekiwany dowód: snapshot i rekord są poprawne, a checkpoint zawiera wszystkie cztery pozostałe ścieżki (`.agents/lessons/index.json`, plik lekcji, rekord i snapshot). Potem uruchom NeKode GUI, wykonaj test `abc|XYZ` opisany wyżej i zapisz rzeczywisty wynik przed jakąkolwiek zmianą produktu. Spec i istniejące testy są pod ścieżkami wskazanymi w `Repository snapshot`; nowego planu ani zatwierdzenia nie potrzeba dla samego odczytu i testu.
