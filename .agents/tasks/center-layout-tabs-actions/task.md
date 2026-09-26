---
id: center-layout-tabs-actions
schema_version: 2
status: active
intent: feature
complexity: large
durability: recorded
current_phase: Phase 2
current_step: Phase 2.3
updated: 2026-09-26
branch: main
worktree: current
next_action: Niezależny review Stage 2 (skill code-review, swiezy subagent) + korekty; potem Stage 3 wg planu
blockers: none
---

# Center Layout: Tab Strip, Action Row, and Status Bar

## Objective

Przebudowa górnej części środkowej kolumny i dolnego paska aplikacji NeKode: pasek zakładek (jedna zakładka terminal-chat + zakładki otwartych plików + przycisk „+ New chat"), pasek akcji pod zakładkami (stałe grupy „Handoff | Resume", „Stop | Continue" + akcje konfigurowalne) oraz status bar na dole okna z kontekstem projektu (nazwa, ścieżka, git). Użytkownik: programista na Windows 11 pracujący z agentami CLI. Realizuje wymaganie 5 requirements.md (Action Bar) w układzie z decyzji użytkownika 2026-09-26.

## Scope

Spec: `docs/features/center-layout-tabs-actions/spec.md`. Plan: `.agents/tasks/center-layout-tabs-actions/plan.md`. Zadanie obejmuje: rewizję docs (UX-UI.md §7-8, SDD.md §7, requirements.md §2.5/2.7) pod nowy układ, restrukturyzację layoutu (status bar, pasek zakładek, usunięcie kontekstowego headera nad środkiem, adaptacja widoku Project Files do modelu zakładek), pasek akcji z wykonywaniem poleceń i konfiguracją akcji. Poza zakresem: dolny panel terminali (osobne zadanie, wymaganie 3), edycja plików, oraz non-goals z requirements.md §3.

## Phase 0 - Intake

- [x] Phase 0.1 - Inspect the repository and refine the provisional classification (branch main, drzewo czyste poza rekordem zadania, brak kolizji id; klasyfikacja podtrzymana: large)

## Phase 1 - Specification and Plan

- [x] Phase 1.1 - Specification (docs/features/center-layout-tabs-actions/spec.md)
- [x] Phase 1.2 - Plan approval (plan status: draft -> approved; zatwierdzony przez użytkownika 2026-09-26)

## Phase 2 - Preflight and Implementation

- [x] Phase 2.1 - Preflight gate
- [x] Phase 2.2 - Stage 1: Rewizja docs (UX-UI §7-8, SDD §7, requirements §2.5/2.7)
- [ ] Phase 2.3 - Stage 2: Layout (status bar, pasek zakladek, Project Files w modelu zakladek)
- [ ] Phase 2.4 - Stage 3: Pasek akcji (Handoff/Resume, Stop/Continue, akcje konfigurowalne + wykonanie + konfiguracja)

## Phase 3 - Acceptance and closure

- [ ] Phase 3.1 - User-gate: demo AC w realnym GUI (pnpm dev)
- [ ] Phase 3.2 - task-close z final verification `full`

## Decisions

- Layout (decyzja użytkownika 2026-09-26): Action Bar NIE na samej górze okna. Pasek zakładek u góry środkowej kolumny: pierwsza zawsze zakładka terminal-chat (aktywny czat; jedna zakładka na terminal — decyzja A, „na razie"), potem zakładki otwartych plików, na prawym końcu paska zakładek zawsze przycisk „+ New chat". Pod zakładkami wiersz paska akcji. Kontekst projektu (`<nazwa-projektu>`, ścieżka, git) przenosi się z headera nad środkiem do status bara na samym dole okna (cała szerokość; pasek statusu — nazwa jak w VS Code); na start bez wskaźników stanu (decyzja C). Dotychczasowy kontekst header nad środkiem znika.
- Pasek akcji (decyzja użytkownika 2026-09-26): najpierw grupy stałe „Handoff | Resume", „Stop | Continue", dalej akcje konfigurowalne (np. „Preview"). Przyciski skrótowe wklepują tekst do terminala aktywnego czatu i zatwierdzają Enterem (CR, 0x0D): Handoff = `Napisz handoff`, Resume = `Wznów z handoffu`, Continue = `Continue`. Stop = interrupt sesji PTY przez Ctrl+C (0x03) — wyprowadzenie techniczne koordynatora: NIE Ctrl+D, bo w kontrakcie (mvp-core-shell Behaviour 11) Ctrl+D zamyka czat.
- Akcje konfigurowalne wykonują się wg UX-UI §8 (tło / bottom terminal / nowy terminal), ale tryb bottom terminal odroczony do osobnego zadania (dolny panel) — w tym zadaniu do dyspozycji tło i/lub nowy terminal; bez toastów sukcesu przy rutynowych operacjach.
- Model czatów bez zmian względem mvp-core-shell: przełączanie czatów drzewkiem po lewej; zakładka terminal-chat pokazuje aktywny czat (sesje żyją w ukrytych widokach — dotychczasowa technika ChatWorkspace).

## Changed files

- `docs/features/center-layout-tabs-actions/spec.md`
- `.agents/tasks/center-layout-tabs-actions/plan.md`
- `.agents/tasks/center-layout-tabs-actions/task.md`
- `docs/UX-UI.md`, `docs/architecture/sdd.md`, `docs/product/requirements.md`, `docs/features/project-files-view/spec.md` (rewizja docs, Stage 1)
- `src/` — Stage 2 (layout): `src/renderer/src/App.tsx`, `src/renderer/src/components/tabs/` (TabStrip.tsx, tabs-session.ts + testy — NOWE), `src/renderer/src/components/layout/StatusBar.tsx` + test (NOWE), usuniete `TopBar.tsx`/`CenterHeader.tsx`/`ProjectFilesSurface.tsx`, `src/shared/ipc-contract.ts` + `src/main/services/git/git-service.ts` (GitStatus.worktree, parser porcelain v2), adaptacje testow (22 pliki testowe ogolem)

## Verification

| Check | Result | Notes |
|---|---|---|
| preflight | pass (exit 0) | 2026-09-26T19:52Z resume z handoffu: `python .agents/scripts/preflight` = exit 0 (repo, Git, system, Python 3.11.16, local env, venv, verification commands, branch main) |
| tests-before-edits | pass (exit 0, exit 0) | 2026-09-26T19:52Z `pnpm run test` = 232/232, 19 plikow (baseline zgodny), `pnpm run typecheck` = exit 0 |
| stage-1 docs | pass | Rewizja docs (implementer subagent Hermes): SDD §7/§9/§21 + §64/§69/§70, UX-UI §5/§7/§8/§14/§17/§49/§50/§51/§65/§68/§69 + §77/§78, requirements §2.5/§2.7, project-files-view spec (Behaviour 4/7/9/12, AC 1/4/6, Required tests). `git diff --check` = exit 0; przeglad docs/ katalog-po-katalogu + grep terminalowy: 0 sprzecznych wzmianek o TOP Action Bar / starym context header (pozostalosci uzasadnione: mvp-core-shell = opis historyczny zamknietej funkcji, docs/references = materialy mockupowe sprzed decyzji, przełącznik Files/Kanban §18 = post-MVP) |
| stage-1 review | pass (r3 clean) | review:1 (swiezy subagent, implementation gate): 5 warningow + 3 sugestie + 1 needs-confirmation; korekta:1 (Main); review:1:r2: 3 nowe warningi; korekta:2 (Main; CAP 2/2 wykorzystany); review:1:r3: 'No significant issues found.' (3/3 resolved, 0 nowych). needs-confirmation 'project tab state' w UX-UI §6 rozstrzygniety przez Main: usuniete (zakladki niepersistowane wg Non-goals specu; slowownik Files/Kanban zniesiony) |
| stage-2 implement | pass (gates green; review pending) | Layout (implementer subagent Hermes): pasek zakladek + pliki w zakladkach (read-only Monaco z fallbackami) + retencja per projekt + status bar + usuniecie headera kontekstowego i pasa TOP; wiersz akcji = pusty zarezerwowany slot (Stage 3). Bramki: `pnpm run lint` 0 bledow, `pnpm run typecheck` exit 0, `pnpm run test` 264/264 (22 pliki; niezależnie przeliczone przez koordynatora 2026-09-26T23:32Z), `pnpm run build` exit 0 (bundle renderera bez electron/node). Testy dyskryminujace (kolejnosc/retencja/fallback zamkniecia) weryfikowane mutacjami przez implementera, przywrocone bitowo (sha256 zgodne). Review Stage 2 NIE wykonany — user stop przed review (handoff). Walidator edycji zglosil 1 no-op patch w git-service.test.ts (old==new; plik i jego testy OK). |

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-26T18:44:26Z | 2026-09-26T18:46:29Z |
| spec | work | 2026-09-26T18:46:29Z | 2026-09-26T18:58:58Z |
| plan | work | 2026-09-26T18:58:58Z | 2026-09-26T19:01:56Z |
| approval | wait | 2026-09-26T19:01:56Z | 2026-09-26T19:27:49Z |
| handoff | wait | 2026-09-26T19:27:49Z | 2026-09-26T19:52:18Z |
| preflight | work | 2026-09-26T19:52:18Z | 2026-09-26T19:53:17Z |
| implement:1 | work | 2026-09-26T19:53:17Z | 2026-09-26T20:29:15Z |
| review:1 | work | 2026-09-26T20:30:55Z | 2026-09-26T20:51:40Z |
| correction:1 | work | 2026-09-26T20:53:07Z | 2026-09-26T21:20:38Z |
| review:1 | work | 2026-09-26T21:20:38Z | 2026-09-26T21:38:37Z |
| correction:2 | work | 2026-09-26T21:39:21Z | 2026-09-26T21:46:10Z |
| review:1 | work | 2026-09-26T21:46:10Z | 2026-09-26T21:51:48Z |
| implement:2 | work | 2026-09-26T21:51:48Z | 2026-09-26T23:30:37Z |
| handoff | wait | 2026-09-26T23:34:25Z | |

## Risks and blockers

- ~~Rewizja docs~~ — rozstrzygnięte w Stage 1 (rewizja wykonana, review r3 clean; nadrzędność: decyzja użytkownika 2026-09-26).
- ~~Adaptacja feature'ów do modelu zakładek~~ — rozstrzygnięte w Stage 2 (sesje w ukrytych widokach przetrwują przelączania; testy AC2/AC11 zielone).
- Dolny panel terminali nie istnieje — §8 (bottom terminal jako domyślne miejsce wykonania) wymaga świadomego odroczenia trybu.
- Konfiguracja akcji konfigurowalnych: źródło (SQLite vs plik projektu) i zakres edytora w UI — do rozstrzygnięcia w specyfikacji.

## Resume instructions

Następny krok: Phase 2.3 — dokończyć Stage 2: niezależny review implementacji layoutu (skill `code-review`, implementation gate, świeży subagent; acceptance base: spec AC1-AC4/AC9/AC11 + plan Stage 2), korekty z CAP 2 rund, POTEM Stage 3 (pasek akcji). Przed edycją: `git status`, lektura specu i Decisions powyżej. Wiersz akcji jest pustym slotem — rusza go dopiero Stage 3. Kontrakt bajtów przycisków stałych: CR = 0x0D, Stop = 0x03, NIGDY 0x04.
