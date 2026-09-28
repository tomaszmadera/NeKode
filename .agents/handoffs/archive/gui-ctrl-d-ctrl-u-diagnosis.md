---
task_id: gui-ctrl-d-ctrl-u-diagnosis
created: 2026-09-28T10:49:51Z
schema_version: 2
from: Main (Hermes, sesja 2026-09-28)
to: Main (kolejna sesja)
branch: main
worktree: current
checkpoint_subject: f3615b9d759bb38dfd78cc718fdee4f7d7e801f6+sha256:3c6fd081afedff936ed833d26bcc81d6ffee0b16ed332244a9daeb64dcf5b7c9
current_step: Phase 0.1
next_action: Preflight, then intake: reproduce the Ctrl+D/Ctrl+U flow in the real GUI (pnpm dev), identify which acceptance point fails before touching code.
blockers: none
---

# Handoff: Ctrl+D/Ctrl+U GUI diagnosis (mvp-core-shell deferred point)

## Repository snapshot

Task record: `.agents/tasks/gui-ctrl-d-ctrl-u-diagnosis/task.md` (status active, current_step Phase 0.1, utworzony razem z tym snapshotem — zadanie jest świeże, nic nie wystartowało). Powód handoffu: koniec sesji po zamknięciu review4-followups; decyzja użytkownika 2026-09-28 — kontynuacja w kolejnej sesji. Rola: Main do Main.

**Working** (HEAD `f3615b9d759bb38dfd78cc718fdee4f7d7e801f6`):

- review4-followups zamknięte: rekord `status: completed`, snapshot w `.agents/handoffs/archive/review4-followups.md`, checkpoint `f3615b9` zawiera całość scope (verify `changed` 2× exit 0, subject check `matches`, vitest 332/332, lint/typecheck 0). Worktree clean.
- Dwa odchylecia od pierwotnej sugestii review:4 są w rekordzie i potwierdzone mutacyjnie: (1) spawn-error NIE kasuje wpisu `pendingBottomCommandsRef` (retry remount musi móc redeliverować komendę); (2) close/exit/abort ścieżki czyszczone higienicznie, testy pinują kontrakt, nie dyskryminują kasowania (guard `disposed` w ChatTerminal i tak blokuje późne write'y).
- Lekcja `git-checkout-reintroduces-crlf` w `.agents/lessons/items/` (index.json zaktualizowany): po `git checkout --` przy `core.autocrlf=true` plik wraca z CRLF mimo czystego bloba — przywracać przez zapis bajtów `git show HEAD:<path>`, weryfikować zero CR.

**Broken / deferred (przedmiot przyszłego zadania):**

- Ctrl+D/Ctrl+U w realnym GUI: punkty acceptance 3/5 mvp-core-shell (spec `docs/features/mvp-core-shell/spec.md` Behaviour 11 / AC9, wersja 2026-09-26) pozostają niespełnione mimo poprawki emulacji readline (commit `abc0219`). Użytkownik 2026-09-26: „nie działa" bez szczegółów. Luka jest między mockiem/jsdom a realnym GUI: `ChatTerminal.test.tsx` zielone, zachowanie powłoki potwierdzone przechwytami ConPTY (`tmp/repro*.bin`). Entry w BACKLOG.md ma pełny plan diagnostyki: odtworzyć przepływ w `pnpm dev`, ustalić który punkt nie przechodzi (powtórka Ctrl+D? Ctrl+U?), sprawdzić czy klawisze trafiają do handlera w realnym oknie (focus/IME/xterm textarea) i czy emulacja dociera do PTY (logi `tmp/logs/`).
- Niższe priorytety w BACKLOG: ewikcja sesji usuniętych zadań (merge-not-replace), post-MVP Task/Kanban/rename czatu, terminologia UX-UI/SDD, AC8 project-files-view demo.

## Decisions

- Kolejność z użytkownika (2026-09-28): follow-upy review:4 najpierw — ZROBIONE; diagnoza Ctrl+D/Ctrl+U jest następna, w świeżym zadaniu (proponowane: intent `debug`, size dopiero po intake — ścieżka diagnostyczna może nie wymagać zmian w produkcie).
- Nie naprawiać na ślepo: najpierw reprodukcja w realnym GUI i identyfikacja failującego punktu; ConPTY-przechwytów nie powtarzać (powłoka jest oczyszczona — luka nie jest w PTY bytes).
- Założenia kontraktowe niezmienne (z zamkniętych zadań): `Ctrl+Backquote` połykany przez terminal; emulacje czytelne dla readline-shell (Ctrl+D = `ESC[3~` na niepustej linii, zamknięcie czatu na pustej; Ctrl+U = backspace-repeat nad wejściem przed kursorem); alternate buffer przepuszcza klawisze bez zmian.

## Failed approaches

- Emulacja readline w rendererze (commit `abc0219`): testy jednostkowe i ConPTY-przechwytu zielone, ale użytkownik nadal widzi błąd w realnym GUI — nie iterować dalej po ścieżce emulatora bez nowego dowodu z żywego okna.
- Poprzednie user-gate rundy 1–5 mvp-core-shell nie wyizolowały punktu awarii; wymagane są nowe dane od użytkownika przy reprodukcji (który klawisz, jaki stan linii, jaki focus).

## Verification

- `python .agents/scripts/task-status --check .agents/tasks/review4-followups/task.md` exit 0 (rekord completed, walidacja po close).
- `python .agents/scripts/handoff-status --check` exit 0, „handoffs valid: 0" przed zapisem tego pliku.
- `python .agents/skills/task-record/scripts/verification_subject.py check --record .agents/tasks/review4-followups/task.md` → „matches: attempt 2" (subject 2, 11 task-owned paths).
- `python .agents/scripts/verify-changed` exit 0 (dwa biegi: po implementacji i po lekcji; lint 90 plików 0 findings, tsc node+web 0).
- `cmd /c pnpm run test` exit 0 — 332/327+5, 25 plików (po implementacji; pełny bieg nie powtarzany po samym close — close zmieniał tylko rekord i archiwizację snapshotu).
- Checkpoint `f3615b9` (`git show --stat`): 11 plików, 466+/21-, drzewo po nim clean; `git diff f3615b9^ f3615b9 -- package.json src/main/db/migrations.ts` = 0 bajtów (stat-dirty only).

## Open product invariants

- Rejestr produktowych niezmienników nie istnieje (brak `docs/product/invariants.md`) — wg task-close nie ogłasza się niezmienników jako spełnionych. Otwarty punkt kontraktowy: mvp-core-shell Behaviour 11 / AC9 (Ctrl+D/Ctrl+U) ma status niespełniony w realnym GUI (deferred-by-decision, BACKLOG) — jedyny dowód to testy jednostkowe i ConPTY; zmiana statusu wymaga potwierdzenia użytkownika w żywym oknie.

## Unresolved assumptions

- Zakłada się, że diagnoza wykaże lukę integracyjną (focus/IME/textarea w realnym oknie), a nie błąd semantyki emulacji — założenie z review ConPTY-przechwytów; rozstrzyga pierwsza sesja z `pnpm dev` i logami.
- Zakłada się, że punkty 3/5 acceptance oznaczają sekwencję (np. powtórny Ctrl+D po restarcie powłoki), a nie pojedyncze naciśnięcia — rozstrzyga użytkownik przy reprodukcji.

## Resume instructions

1. Pierwsza akcja: `python .agents/scripts/preflight`, potem `git status` i `python .agents/scripts/task-status --check` (drzewo clean, brak rekordu tego zadania). Oczekiwany dowód: preflight exit 0, „task records valid".
2. Utwórz rekord przez `task-record` (proponowane `intent: debug`; `size: none` dopóki diagnostyka nie wykaże potrzeby zmiany produktu), fazę intake z reprodukcją: `pnpm dev`, fokus na terminal czatu, Ctrl+D na pustej i niepustej linii, Ctrl+U z tekstem przed kursorem; zebrać od użytkownika dokładny scenariusz „nie działa" i logi `tmp/logs/`.
3. Skill do załadowania: `systematic-debugging` (przed jakąkolwiek edycją produktu). Dopóki brak diagnozy — nie modyfikować `ChatTerminal.tsx` ani emulacji klawiszy.
4. Dowody wejściowe: `docs/features/mvp-core-shell/spec.md` Behaviour 11 / AC9; wiersz review:4 i user-gate w `.agents/tasks/mvp-core-shell/task.md`; BACKLOG.md (wpis Ctrl+D/Ctrl+U); `tmp/repro*.bin` (archiwalne przechwyty ConPTY).
