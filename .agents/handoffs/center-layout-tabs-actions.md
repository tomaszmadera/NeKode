---
task_id: center-layout-tabs-actions
created: 2026-09-26T19:38:31Z
schema_version: 2
from: Main (Hermes, sesja coder CLI 2026-09-26)
to: Main (kolejna sesja)
branch: main
worktree: current
checkpoint_subject: 94632158dcd1e6b818c54dd49464f4502cbf948c+sha256:34c7acb6400a2eb633accdf07315f0e843a0e37ff3dd7931c0d6cc281031292d
current_step: Phase 2.1
next_action: Preflight (skill preflight) + tests-before-edits (pnpm run test, pnpm run typecheck), zapis w Verification rekordu; potem Stage 1: rewizja docs wg planu
blockers: none
---

# Handoff: Center Layout: Tab Strip, Action Row, and Status Bar

## Repository snapshot

Task record: `.agents/tasks/center-layout-tabs-actions/task.md` (status active, current_step Phase 2.1 — preflight przed Stage 1). Rola: Main (koordynator sesji Hermes) → Main (kolejna sesja); powód: user stop — praca kontynuowana w innej sesji. Spec: `docs/features/center-layout-tabs-actions/spec.md` (kompletny kontrakt, AC1-11); plan: `.agents/tasks/center-layout-tabs-actions/plan.md` (status approved 2026-09-26, Large, 3 etapy).

**Working** (scope checkpointu: rekord + plan + spec + ten snapshot; HEAD 9463215):

- Artefakty zatwierdzenia kompletne: spec bez otwartych pytań, plan approved (decyzja użytkownika 2026-09-26, „Zgoda na wszystko"), rekord walidny (`python .agents/scripts/task-status --check .agents/tasks/center-layout-tabs-actions/task.md` = exit 0).
- Zero kodu produktu w zakresie zadania — etapy nie startowały (świadomie: plan zabrania kodu/testów przed approval, sesja skończyła się zaraz po approval).
- Drzewo poza scope zadania czyste; poprzednie zadanie project-files-view zamknięte (commit 9463215), jego snapshot w `.agents/handoffs/archive/`.

**Broken**: nic. Pozostały: preflight + trzy etapy implementacji + user-gate + task-close (patrz Resume instructions).

## Decisions

- Layout (decyzja użytkownika 2026-09-26): pasek zakładek u góry środkowej kolumny — pierwsza zawsze jedna zakładka terminal-chat (aktywny czat; jedna zakładka na terminal — „na razie"), potem zakładki otwartych plików, na prawym końcu zawsze `+ New chat`; pod zakładkami pasek akcji; status bar na samym dole okna (cała szerokość) z kontekstem projektu: nazwa, ścieżka, runtimes, git branch/status. Brak pasa TOP i kontekstowego headera nad środkiem.
- Przyciski stałe to skróty terminalowe piszące do PTY aktywnego czatu przez `terminals:write`: Handoff = `Napisz handoff` + CR (0x0D), Resume = `Wznów z handoffu` + CR, Continue = `Continue` + CR, Stop = Ctrl+C (0x03). NIGDY 0x04 (Ctrl+D zamyka czat w kontrakcie). Stringi to literalne dane, nie tłumaczenia.
- Wyprowadzenia koordynatora zaakceptowane przez użytkownika: (1) tryb `new-terminal` akcji = nowy czat w projekcie z poleceniem + CR (model „terminal = czat"); (2) tryb `bottom-terminal` odroczony do zadania z panelem dolnym (w formularzu tylko Background | New terminal); (3) akcje w SQLite (`actions`, migracja) + edytor Project Settings → Actions wg UX-UI §49; (4) zakładki zastępują breadcrumb i etykietę „Files" (ścieżka pliku = tooltip zakładki).
- Etapy (Large): 1 — rewizja docs (SDD §7/§9/§21, UX-UI §5/§7/§8/§14/§49/§50/§65/§68/§69, requirements §2.5/§2.7, poprawki w specie project-files-view); 2 — layout (zakładki + pliki w zakładkach + status bar); 3 — pasek akcji (skróty + akcje konfigurowalne + wykonanie + konfiguracja).

## Failed approaches

- Reprodukcja schematu `checkpoint_subject` z historycznej pary project-files-view (`946ab28+sha256:18a6d014…`) — NIEUDANA. Próbowano ok. 20 wariantów na odtworzonym stanie (worktree na 946ab28 + drzewo z 2d7d8f3): patche `git diff`/`--binary`/z normalizacją linii `index`, fold untracked jako surowa treść / nazwa+treść / manifest sha256, stan JSON wg canonicalizera `verification_subject.py` (capture_state + subject_digest, warianty list ścieżek i splitów staged/untracked). Żaden nie trafił. Nie powtarzać bez nowej hipotezy. Skutek: digest w tym snapshocie liczony jawnym, udokumentowanym przepisem (patrz Verification) — samoopisny i odtwarzalny, mimo że historyczny schemat pozostał nieznany.

## Verification

- `python .agents/scripts/task-status --check .agents/tasks/center-layout-tabs-actions/task.md` = exit 0 (po approval i po przejściu na Phase 2.1).
- Plan: status `approved` (2026-09-26). Spec: kompletny (11 AC, Required tests, Data/API).
- tests-before-edits: NIE wykonane — świadomie; sesja zakończyła się przed fazą implementacji. Pierwsza akcja po resume = preflight + baseline (`pnpm run test`, `pnpm run typecheck` — spodziewany baseline 232/232, 19 plików po project-files-view).
- checkpoint_subject policzony przepisem: staged_diff_sha256 = sha256(`git diff --cached --binary --no-ext-diff -- <paths>`), unstaged_diff_sha256 = sha256(`git diff --binary --no-ext-diff -- <paths>`), untracked_files_sha256 = sha256(canonical_json(posortowanego manifestu {path, kind, sha256})), digest = sha256(canonical_json({head, paths, staged_diff_sha256, unstaged_diff_sha256, untracked_files_sha256})) — dokłada semantyka `capture_state()` z `.agents/skills/task-record/scripts/verification_subject.py`; paths = [`.agents/tasks/center-layout-tabs-actions`, `docs/features/center-layout-tabs-actions`] (scope bez snapshotu); pusty input = e3b0c442… .

## Open product invariants

- `none` — zadanie nie zmieniło jeszcze produktu (tylko docs i rekordy); brak otwartego invariantu do pilnowania na tym etapie.

## Unresolved assumptions

- Historyczny schemat `checkpoint_subject` (project-files-view/mvp-core-shell) pozostaje nieznany — skutek: starych digestów nie da się zweryfikować wartościowo; nasz digest jest odtwarzalny z przepisu w Verification. Rozstrzyga: ewentualna nowa hipoteza reprodukcji (nie blokuje pracy).
- Tryb `new-terminal` jako nowy czat może okazać się niewygodny w demo — rozstrzyga user-gate Stage 3; alternatywa wymagałaby decyzji użytkownika o osobnej powierzchni terminala.
- Rewizja docs zakłada, że wskazane sekcje wyczerpują sprzeczności ze starym układem — rozstrzyga pełny przegląd `docs/` wyszukiwaniem w Stage 1.

## Resume instructions

1. Pierwsza akcja: preflight wg skillu `preflight` (`python .agents/scripts/preflight`) + tests-before-edits (`pnpm run test`, `pnpm run typecheck`) z wierszem w Verification rekordu; potem Stage 1 (rewizja docs wg planu, skill `implement`). Oczekiwane evidence: preflight exit 0 + baseline zgodny; po Stage 1 — poprawione sekcje i zero sprzecznych wzmianek o układzie w `docs/` (wyszukanie pełnym przeglądem).
2. Przed jakąkolwiek edycją: `git status` (scope checkpointu: rekord, plan, spec, ten snapshot — poza nim drzewo czyste), `python .agents/scripts/task-status --check .agents/tasks/center-layout-tabs-actions/task.md`, lektura `docs/features/center-layout-tabs-actions/spec.md` (kontrakt nadrzędny) oraz Decisions w rekordzie i wyżej.
3. Kolejność: Stage 1 (docs) → Stage 2 (layout: zakładki, pliki w zakładkach, status bar) → Stage 3 (pasek akcji). Large = każdy etap przez świeżego implementer (skill `implement`) + niezależny review (skill `code-review`, świeży subagent); korekty z CAP 2 rund korekt/re-review na etap, potem eskalacja do użytkownika. Po etapach produktowych user-gate demo AC; zamknięcie: skill `task-close` z final verification `full`.
4. Nie powtarzać: reprodukcja historycznego schematu `checkpoint_subject` (patrz Failed approaches) bez nowej hipotezy.

Repozytorium przy snapshotcie: HEAD 9463215, scope zadania nietknięty od digestu; wszystkie decyzje produktowe użytkownika z 2026-09-26 zatwierdzone („Zgoda na wszystko").