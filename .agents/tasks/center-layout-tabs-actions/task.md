---
id: center-layout-tabs-actions
schema_version: 2
status: active
intent: feature
complexity: large
durability: recorded
current_phase: Phase 2
current_step: Phase 2.1
updated: 2026-09-26
branch: main
worktree: current
next_action: Preflight (skill preflight) + Stage 1: rewizja docs wg planu (plan approved 2026-09-26)
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

- [ ] Phase 2.1 - Preflight gate
- [ ] Phase 2.2 - Stage 1: Rewizja docs (UX-UI §7-8, SDD §7, requirements §2.5/2.7)
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
- (pliki produktu i rewizji docs — uzupełniane w miarę postępu)

## Verification

| Check | Result | Notes |
|---|---|---|

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-26T18:44:26Z | 2026-09-26T18:46:29Z |
| spec | work | 2026-09-26T18:46:29Z | 2026-09-26T18:58:58Z |
| plan | work | 2026-09-26T18:58:58Z | 2026-09-26T19:01:56Z |
| approval | wait | 2026-09-26T19:01:56Z | 2026-09-26T19:27:49Z |
| handoff | wait | 2026-09-26T19:27:49Z | |

## Risks and blockers

- Rewizja docs: UX-UI.md §7-8 i SDD.md §7 opisują Action Bar na TOP i kontekst header nad środkiem — sprzeczność z decyzją użytkownika 2026-09-26; rozstrzyga etap rewizji docs (nadrzędność: decyzja użytkownika).
- Adaptacja istniejących feature'ów do modelu zakładek (Project Files, ChatWorkspace) bez utraty sesji terminali i bez regresji przepływów czatu.
- Dolny panel terminali nie istnieje — §8 (bottom terminal jako domyślne miejsce wykonania) wymaga świadomego odroczenia trybu.
- Konfiguracja akcji konfigurowalnych: źródło (SQLite vs plik projektu) i zakres edytora w UI — do rozstrzygnięcia w specyfikacji.

## Resume instructions

Następny krok: Phase 1.1 — specyfikacja `docs/features/center-layout-tabs-actions/spec.md` (skill `specification`). Przed edycją: `git status`, lektura UX-UI.md §7-8, SDD.md §7, requirements.md §2 oraz Decisions powyżej.
