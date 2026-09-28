---
task_id: review4-followups
created: 2026-09-28T02:11:31Z
schema_version: 2
from: Main (Hermes, sesja 2026-09-28)
to: Main (kolejna sesja)
branch: main
worktree: current
checkpoint_subject: d2e00a8e4ce573ba01ac360812745e95555eaf8f+sha256:0599521f5ebf5dae00f8cb5670c0842916792a0118970ebc6553493732533912
current_step: Phase 1.1
next_action: Preflight, then one implementer for all four review:4 follow-ups with discriminating tests. Do not start the Ctrl+D/Ctrl+U GUI diagnosis in this task.
blockers: none
---

# Handoff: Review:4 follow-ups

## Repository snapshot

Task record: `.agents/tasks/review4-followups/task.md` (status active, current_step Phase 1.1). Rola: Main do Main (kolejna sesja). Powod: koniec sesji po zamknięciu bottom-auxiliary-terminal. Zakres: cztery nieblokujące sugestie review:4 tego zadania; spec i plan nie istnieją i nie są wymagane (Small/refactor).

**Working** (HEAD przed tym checkpointem `d2e00a8e4ce573ba01ac360812745e95555eaf8f`):

- bottom-auxiliary-terminal zamknięte i wydane: feat commit `436a34b`, bump 0.4.0 + tag `1596a0b`, sprzątnięcie BACKLOG `d2e00a8`. Worktree clean. Final gate `verify-full` exit 0 (lint 0/89, typecheck 0, vitest 327/327 w 24 plikach).
- Cztery elementy tego zadania są opisane w sekcji Scope rekordu wraz z plikami docelowymi: (1) wyciek wpisów `pendingBottomCommandsRef` w `src/renderer/src/App.tsx` — usuwać wpis w handleCloseBottomTab / handleBottomExit / onSpawnError / przy abort createBottomTab; (2) brak zapisu `focusBeforeOpenRef` przy otwarciu panelu z wykonania akcji `bottom-terminal` — przechwycić document.activeElement z ochroną przed fokusem body jak w showBottomPanel; (3) test migracji v5 w `src/main/db/db.test.ts` pomija kolumnę `icon` — dodać do SELECT i oczekiwanych wierszy z nie-NULL fixture; (4) dokumenty: `docs/features/bottom-auxiliary-terminal/spec.md` l. 13 oraz `docs/architecture/sdd.md` §62 („Git status refreshes when command ends") do korekty treści.
- Kontekst review:4 w rekordzie bottom-auxiliary-terminal (`.agents/tasks/bottom-auxiliary-terminal/task.md`, wiersz review:4 w Verification) — tam są sygnatury i uzasadnienia; snapshot w `.agents/handoffs/archive/bottom-auxiliary-terminal.md`.
- Cztery odpowiadające wpisy istnieją w `BACKLOG.md` (sekcja dolnego panelu); po realizacji należy je z niego usunąć wg reguły pliku.

**Broken**:

- Nic nie wystartowało: brak preflight, brak edycji produktu, brak testów-before-edits w tym zadaniu. Baseline: verify-full zielone na `d2e00a8` (dowód w rekordzie bottom-auxiliary-terminal, subject 2).

## Decisions

- Kolejność pracy ustalona z użytkownikiem 2026-09-28: follow-upy z review:4 przed diagnozą Ctrl+D/Ctrl+U w GUI (ta pozostaje w BACKLOG jako deferred-by-decision; NIE zaczynać jej w tym zadaniu).
- Jeden implementer robi wszystkie cztery elementy naraz (Small); osobny niezależny review (implementation gate, skill `code-review`); final verification w trybie `changed` (profil: `commands.verify_changed`); bez pliku planu.
- Zakres plików: `src/renderer/src/App.tsx` + testy renderera, `src/main/db/db.test.ts`, dwa dokumenty, BACKLOG.md, rekord. Bez zmian kontraktów IPC i bez migracji bazy.
- Zachować niezmienione kontrakty zamkniętego zadania: id `bottom:<projectId>:<uuid>`, dostarczenie command + 0x0D dokładnie raz, brak czatu, brak PTY ze ścieżki execute, tombstone rules, `Ctrl + Backquote` połykany. Testy dyskryminujące: każda poprawka ma regresję, która pada na kodzie sprzed fixa; po fixie całość 327+ zielona.

## Failed approaches

- none

## Verification

- `python .agents/scripts/task-status --check .agents/tasks/review4-followups/task.md` exit 0 przed tym snapshotem (rekord po intake, 1 wiersz timing: intake zamknięty, handoff otwarty).
- `python .agents/scripts/handoff-status --check` na drzewie bez tego pliku: „handoffs valid: 0" (brak snapshotów przed tym).
- checkpoint_subject liczony przed zapisem tego pliku wg przepisu: staged = sha256(`git diff --cached --binary --no-ext-diff -- <paths>`), unstaged = sha256(`git diff --binary --no-ext-diff -- <paths>`), untracked = sha256 pustego wejścia (obie ścieżki task-owned są poza diffe: rekord identyczny z HEAD w treści i brany jako untracked o pustym wkładzie, snapshot jeszcze nie istniał), digest = sha256(canonical JSON `{head, paths, staged_diff_sha256, unstaged_diff_sha256, untracked_files_sha256}`, klucze sortowane, separatory bez spacji, ensure_ascii=False). Wartości: head `d2e00a8e4ce573ba01ac360812745e95555eaf8f`, paths = [`.agents/tasks/review4-followups/task.md`, `.agents/handoffs/review4-followups.md`], staged len 0, unstaged len 0, digest `0599521f5ebf5dae00f8cb5670c0842916792a0118970ebc6553493732533912`.

## Open product invariants

- Rejestr produktowych niezmienników nie istnieje (brak `docs/product/invariants.md`) — wg task-close nie ogłasza się niezmienników jako spełnionych. Kontrakty do zachowania są wyliczone w Decisions; ich jedyny dowód to testy renderera i main (baseline 327).

## Unresolved assumptions

- Zakłada się, że cztery wpisy w BACKLOG.md odpowiadają 1:1 sugestiom review:4 (spójność sprawdzona przy intake: 4 wpisy obecne). Rozstrzyga: diff realizacji musi usunąć dokładnie te cztery wpisy.
- `focusBeforeOpenRef` wymaga czytania istniejącej konwencji showBottomPanel (ochrona przed body); dokładne zachowanie przy focusie na elemencie w ukrytym regionie dolnym definiuje Behaviour 4 spec bottom-auxiliary-terminal. Rozstrzyga: review ścieżki.

## Resume instructions

1. Pierwsza akcja: `python .agents/scripts/preflight`, potem `git status` i `python .agents/scripts/task-status --check .agents/tasks/review4-followups/task.md`. Oczekiwany dowód: preflight exit 0, drzewo clean, rekord valid z otwartym wierszem handoff.
2. Zamknij wiersz timing `handoff` (otwarty 2026-09-28T01:12:00Z), otwórz `preflight`, po preflight `implement` (Small: elementy `plan` nie przewidziano — brak pliku planu; rekord ma pojedynczą fazę implementacji).
3. Skill do załadowania: `implement` (jeden implementer subagent, wszystkie cztery elementy, testy dyskryminujące; po nim niezależny review skill `code-review`, tryb implementation gate).
4. Przed edycją produktu: czerwone testy dla elementów 1-3 (nowe regresje muszą padać przed fixem; zanotuj komendę i exit), potem implementacja, bramki `cmd /c pnpm run lint`, `cmd /c pnpm run typecheck`, `cmd /c pnpm run test`.
5. Po implementacji: usunąć z BACKLOG.md dokładnie cztery zrealizowane wpisy; zamknąć task przez `task-close` z verification `changed` (capture subject przed verify; wzorzec prób jak w rekordzie bottom-auxiliary-terminal).
