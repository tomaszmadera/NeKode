---
id: center-layout-tabs-actions
schema_version: 2
status: completed
intent: feature
complexity: large
durability: recorded
current_phase: Phase 3
current_step: none
updated: 2026-09-27
branch: main
worktree: current
next_action: none
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
- [x] Phase 2.3 - Stage 2: Layout (status bar, pasek zakladek, Project Files w modelu zakladek)
- [x] Phase 2.4 - Stage 3: Pasek akcji (Handoff/Resume, Stop/Continue, akcje konfigurowalne + wykonanie + konfiguracja)

## Phase 3 - Acceptance and closure

- [x] Phase 3.1 - User-gate: demo AC w realnym GUI (pnpm dev)
- [x] Phase 3.2 - task-close z final verification `full`

## Decisions

- Layout (decyzja użytkownika 2026-09-26): Action Bar NIE na samej górze okna. Pasek zakładek u góry środkowej kolumny: pierwsza zawsze zakładka terminal-chat (aktywny czat; jedna zakładka na terminal — decyzja A, „na razie"), potem zakładki otwartych plików, na prawym końcu paska zakładek zawsze przycisk „+ New chat". Pod zakładkami wiersz paska akcji. Kontekst projektu (`<nazwa-projektu>`, ścieżka, git) przenosi się z headera nad środkiem do status bara na samym dole okna (cała szerokość; pasek statusu — nazwa jak w VS Code); na start bez wskaźników stanu (decyzja C). Dotychczasowy kontekst header nad środkiem znika.
- Pasek akcji (decyzja użytkownika 2026-09-26): najpierw grupy stałe „Handoff | Resume", „Stop | Continue", dalej akcje konfigurowalne (np. „Preview"). Przyciski skrótowe wklepują tekst do terminala aktywnego czatu i zatwierdzają Enterem (CR, 0x0D): Handoff = `Napisz handoff`, Resume = `Wznów z handoffu`, Continue = `Continue`. Stop = interrupt sesji PTY przez Ctrl+C (0x03) — wyprowadzenie techniczne koordynatora: NIE Ctrl+D, bo w kontrakcie (mvp-core-shell Behaviour 11) Ctrl+D zamyka czat.
- Akcje konfigurowalne wykonują się wg UX-UI §8 (tło / bottom terminal / nowy terminal), ale tryb bottom terminal odroczony do osobnego zadania (dolny panel) — w tym zadaniu do dyspozycji tło i/lub nowy terminal; bez toastów sukcesu przy rutynowych operacjach.
- Model czatów bez zmian względem mvp-core-shell: przełączanie czatów drzewkiem po lewej; zakładka terminal-chat pokazuje aktywny czat (sesje żyją w ukrytych widokach — dotychczasowa technika ChatWorkspace).
- Rozstrzygnięcie review Stage 2 (decyzja techniczna koordynatora 2026-09-27, finding warning App.tsx:231 — rozjazd aktywnego projektu w trybie plików): aktywnym projektem jest projekt paska zakładek (`tabProjectId = filesProjectId ?? selectedProjectId`) end-to-end — zakładka terminal-chat, powierzchnia terminala, empty state `Start new chat` i status bar wyprowadzone z `tabProjectId`; zakładka terminal-chat pokazuje aktywny czat TYLKO gdy należy do projektu paska (selectedProjectId === tabProjectId), inaczej empty state Behaviour 2 z `Start new chat` tworzącym czat w projekcie paska (przepływ adopcji zaznaczenia w handleCreateChat bez zmian). Semantyka akcji Files bez zmian (Behaviour 19). Kwalifikuje decyzję „Model czatów bez zmian” (zakładka terminal-chat pokazuje aktywny czat — w granicach projektu paska). Do potwierdzenia na demo user-gate (Phase 3.1) razem z interpretacją 3.
- 2026-09-27 user zaakceptowal status bar, zakladke czatu i przycisk `+ New chat`, zlecajac implementacje pozostalej czesci. Nie jest to akceptacja Stage 3 ani zamkniecie user-gate.
- 2026-09-27 user po demo AC5-AC8: "Jest wszystko dobrze". Zamyka user-gate Phase 3.1. Nie rozstrzyga formatu runtimeLabel ani osobnej kopii empty state, gdy projekt paska ma czaty.

## Changed files

- `docs/features/center-layout-tabs-actions/spec.md`
- `.agents/tasks/center-layout-tabs-actions/plan.md`
- `.agents/tasks/center-layout-tabs-actions/task.md`
- `docs/UX-UI.md`, `docs/architecture/sdd.md`, `docs/product/requirements.md`, `docs/features/project-files-view/spec.md` (rewizja docs, Stage 1)
- `src/` — Stage 2 (layout): `src/renderer/src/App.tsx`, `src/renderer/src/components/tabs/` (TabStrip.tsx, tabs-session.ts + testy — NOWE), `src/renderer/src/components/layout/StatusBar.tsx` + test (NOWE), usuniete `TopBar.tsx`/`CenterHeader.tsx`/`ProjectFilesSurface.tsx`, `src/shared/ipc-contract.ts` + `src/main/services/git/git-service.ts` (GitStatus.worktree, parser porcelain v2), adaptacje testow (22 pliki testowe ogolem)
- Stage 3 (niezacommitowane, HEAD d375afd): `src/main/services/action-service.ts` + test, migracja `actions` w `src/main/db/migrations.ts`, IPC `actions:*` (`ipc-contract.ts`, `ipc-validation.ts`, `ipc-handlers.ts`, preload), `src/renderer/src/components/actions/` (ActionBar, ActionSettings), podpiecie w `App.tsx` i attach PTY w `ChatTerminal.tsx`, `.gitattributes` (LF dla `package.json`)

## Verification

| Check | Result | Notes |
|---|---|---|
| preflight | pass (exit 0) | 2026-09-26T19:52Z resume z handoffu: `python .agents/scripts/preflight` = exit 0 (repo, Git, system, Python 3.11.16, local env, venv, verification commands, branch main) |
| tests-before-edits | pass (exit 0, exit 0) | 2026-09-26T19:52Z `pnpm run test` = 232/232, 19 plikow (baseline zgodny), `pnpm run typecheck` = exit 0 |
| stage-1 docs | pass | Rewizja docs (implementer subagent Hermes): SDD §7/§9/§21 + §64/§69/§70, UX-UI §5/§7/§8/§14/§17/§49/§50/§51/§65/§68/§69 + §77/§78, requirements §2.5/§2.7, project-files-view spec (Behaviour 4/7/9/12, AC 1/4/6, Required tests). `git diff --check` = exit 0; przeglad docs/ katalog-po-katalogu + grep terminalowy: 0 sprzecznych wzmianek o TOP Action Bar / starym context header (pozostalosci uzasadnione: mvp-core-shell = opis historyczny zamknietej funkcji, docs/references = materialy mockupowe sprzed decyzji, przełącznik Files/Kanban §18 = post-MVP) |
| stage-1 review | pass (r3 clean) | review:1 (swiezy subagent, implementation gate): 5 warningow + 3 sugestie + 1 needs-confirmation; korekta:1 (Main); review:1:r2: 3 nowe warningi; korekta:2 (Main; CAP 2/2 wykorzystany); review:1:r3: 'No significant issues found.' (3/3 resolved, 0 nowych). needs-confirmation 'project tab state' w UX-UI §6 rozstrzygniety przez Main: usuniete (zakladki niepersistowane wg Non-goals specu; slowownik Files/Kanban zniesiony) |
| stage-2 implement | pass (gates green; review pending) | Layout (implementer subagent Hermes): pasek zakladek + pliki w zakladkach (read-only Monaco z fallbackami) + retencja per projekt + status bar + usuniecie headera kontekstowego i pasa TOP; wiersz akcji = pusty zarezerwowany slot (Stage 3). Bramki: `pnpm run lint` 0 bledow, `pnpm run typecheck` exit 0, `pnpm run test` 264/264 (22 pliki; niezależnie przeliczone przez koordynatora 2026-09-26T23:32Z), `pnpm run build` exit 0 (bundle renderera bez electron/node). Testy dyskryminujace (kolejnosc/retencja/fallback zamkniecia) weryfikowane mutacjami przez implementera, przywrocone bitowo (sha256 zgodne). Review Stage 2 NIE wykonany — user stop przed review (handoff). Walidator edycji zglosil 1 no-op patch w git-service.test.ts (old==new; plik i jego testy OK). |
| stage-2 review:2 | blocking (r1; korekta otwarta) | 2026-09-27 niezalezny review (swiezy subagent, implementation gate, skill code-review): 1 warning + 2 suggestion + 1 needs-confirmation. Blocking: rozjazd aktywnego projektu w trybie plikow (strip+status za filesProjectId, terminal/empty-state za selectedProjectId; App.tsx:231) — rozstrzygniecie w Decisions. Dyskryminacja testow niezaleznie potwierdzona 4 probami mutacji w kopii scratch (kolejnosc 5 fail / close-fallback 2 / retencja 2 / hidden-views 1; 0 surviving). 23/23 plikow diff deklarowane; actionRowSlot czysty (0 materialu Stage 3); renderer purity; brak dangling refs; no-op patch git-service.test.ts potwierdzony nieszkodliwy. Poza korekta: suggestion (tooltip sciezkowy w TabStrip, disabled/notice dla + New chat bez projektu — czesciowo optional, fixture non-persistence) + needs-confirmation (format runtimeLabel — decyzja uzytkownika). CAP r1/2 otwarty. |
| stage-2 correction:3 | pass (bramki zielone; re-review pending) | Korekta warningu review:2 (implementer subagent Hermes, wg fix direction w Decisions): split active project — chatSurfaceDiverged w App, terminal-chat tab/surface/empty state wyprowadzone z tabProjectId, Start new chat tworzy w projekcie paska (adopcja zaznaczenia rozpuszcza split), statusProject = tabProject (fallback ?? selectedProject usuniety jako martwy, P4b=0 fail). Optional: + New chat bez projektu = notice; fixture non-persistence asertuje tez wartosci state.set. Nowe testy 5 + 1 wzmocniony (269/269, 22 pliki). Proby mutacji w kopii scratch (P0 3 fail / P1 2 / P2a 1 / P2b 3 / P3 1 / P4 1 / P5 1 / P6 1 / P6b 0 = guard potwierdzony; 0 surviving). Deklaracja changed_files = git status (App.tsx, ChatWorkspace.tsx, CenterTabs.test.tsx). Bramki przeliczone przez koordynatora w main sesji 2026-09-27T11:34Z: lint 0, typecheck 0, test 269/269, build 0. Odchylenia do user-gate: brak splitu przy calkowitym braku zaznaczenia (Welcome surface — wymuszony istniejacym testem), kopia empty state w splicie gdy projekt paska MA czaty. |
| resume preflight | pass | 2026-09-27: `python .agents/scripts/preflight` exit 0 (Python 3.13.5, Windows, branch main); `pnpm run test` exit 0, 269/269 w 22 plikach; `pnpm run typecheck` exit 0. User zaakceptowal status bar, zakladke czatu i `+ New chat`, zlecil implementacje reszty. Dwa niezalezne od zadania pliki lekcji sa dirty; korekta Stage 2 jest w commit 997f7dd. |
| stage-2 re-review:3 | pass | 2026-09-27 niezalezny subagent, implementation gate, named diff `git diff 4cc4508 -- src`: `No significant issues found.` Korekta spina etykiete zakladki, widocznosc terminala, cel empty state i status context przez `tabProjectId`; ukryte widoki terminali pozostaja zamontowane. |
| stage-3 implement (paused) | checks reported; self-review interrupted | 2026-09-27 extra implementer: usluga akcji, migracja SQLite, typed IPC/preload, ActionBar, Project Settings -> Actions i integracja terminala sa w worktree. Implementer zglosil `pnpm run typecheck` exit 0, `pnpm run test` exit 0 (287/287, 23 pliki), `pnpm run build` exit 0, `pnpm run lint` exit 0 (84 pliki) po regule `.gitattributes` dla LF `package.json`. To sa wyniki implementera, nie final verification. `git diff --check` exit 0 przeliczony przez Main przy handoffie. Self-review i niezalezny review Stage 3 nie zakonczone; user stop. |
| resume preflight | partial | 2026-09-27T16:41:52Z: `python .agents/scripts/preflight` exit 0 (Python 3.13.5, Windows, branch main, worktree dirty). `pnpm run typecheck` exit 0. `pnpm run test` exit 1: 286/287 w 23 plikach. Fail: `App.test.tsx` "orders configured actions after both fixed groups and polls completion" oczekiwal tekstu `▶ Build`, dostal `✕ Build` (hydracja `actions.status` przy montowaniu vs mock, ktory od razu zwraca failed). To nie jest baseline sprzed Stage 3; blad jest w niezacommitowanym diffie Stage 3. |
| stage-3 implement self-review | pass (coordinator recount) | 2026-09-27 extra implementer poprawil wyscig statusu (`idle` przed kliknieciem, potem `running`, poll do `failed` z kodem 7), notice po nieudanym zapisie `new-terminal` i nadpisywanie nowszego uruchomienia starszym procesem. Bramki przeliczone przez Main 2026-09-27T17:06Z: `pnpm run lint` exit 0 (84 pliki), `pnpm run typecheck` exit 0, `pnpm run test` exit 0 (290/290, 23 pliki), `pnpm run build` exit 0. Niezalezny review jeszcze nie. |
| stage-3 review:3 | blocking (3 warning + 1 needs-confirmation) | 2026-09-27 niezalezny subagent, implementation gate, diff wobec HEAD d375afd plus nieśledzone pliki akcji. Warning: (1) `action-service.ts:219` new-terminal spawnuje PTY w `execute` zanim widok zasubskrybuje `terminals:data`, wiec startup output znika; (2) `ActionBar.tsx:78` dziecko w tle nie jest trzymane, a cascade delete akcji po usunieciu projektu zostawia proces i poll "Action not found"; (3) `ActionSettings.tsx:142` `sortOrder = actions.length` koliduje po delete. needs-confirmation: `ChatTerminal.tsx:293` `onReady` bez guarda disposed. CAP r1/2 otwarty. |
| stage-3 correction:3 | pass (coordinator recount; re-review pending) | Korekta trzech warningow i wyscigu onReady. `execute` new-terminal tworzy tylko czat; PTY wstaje w attach po `onData`; `sortOrder` to max+1; dziecko w tle jest zatrzymywane (`taskkill /T /F` na Windows) przy delete i `stopForProject`; poll konczy sie na `not_found`. Bramki Main 2026-09-27T17:51Z: lint exit 0, typecheck exit 0, test exit 0 (296/296, 23 pliki), build exit 0. |
| stage-3 re-review:3 | pass | 2026-09-27 niezalezny subagent, implementation gate, tylko korekta i poprzednie findings: `No significant issues found.` |
| user-gate | pass | 2026-09-27T18:19:47Z user: "Jest wszystko dobrze" dla demo AC5-AC8 w realnym GUI. Wczesniej zaakceptowany layout (status bar, zakladka czatu, `+ New chat`). |
| retro | no new lesson | Brak nowego kandydata. Lekcja `windows-biome-package-json-eol` jest juz zapisana. `project-scoped-mcp-ownership` zostaje poza tym zamknieciem. |
| verify-full (subject 1, attempt 1) | fail | 2026-09-27T18:20:34Z `python .agents/scripts/verify-full` exit 1. validate-config exit 0 (28 skills). SKIP harness tests (template-only). `cmd /c pnpm run verify` exit 1: lint 0 (84 pliki), typecheck 0, vitest 295/296. Fail: `action-service.test.ts` "kills the retained shell process when the action is deleted" rzuca `EPERM` na `rmSync` katalogu tymczasowego w `finally` (linia 408), nie na asercji ubicia PID. Subject 1 zostaje bez zmian. |
| correction (verify fail) | pass (recount pending review) | Test sprzatania ponawia `rmSync` do 5 s tylko gdy PID jest martwy (`EPERM`/`EBUSY`/`ENOTEMPTY`). Zywy PID nie wchodzi w `rmSync`. Implementer: biome 0, piec przebiegow pliku testu 0, `pnpm run test` 296/296. Main: jeden przebieg `vitest run src/main/services/action-service.test.ts` exit 0 (9/9). |
| review (verify correction) | pass | 2026-09-27 niezalezny subagent, implementation gate, tylko korekta `action-service.test.ts`: `No significant issues found.` |
| verify-full (subject 2, attempt 2) | pass | 2026-09-27T18:44:52Z `python .agents/scripts/verify-full` exit 0. validate-config exit 0 (28 skills). SKIP harness tests (template-only). `cmd /c pnpm run verify` exit 0: lint 0 (84 pliki), typecheck 0, vitest 296/296 (23 pliki). Subject 2 sprawdzony przed close: match true, `8bc7049b9d1e171c4f70371b618514055463be19973772189af6c1bf0420f20f`. |

### Verification subject 1

```json
{
  "attempt": 1,
  "head": "d375afd29b94f46b935bd490e8f1eedf95fcfa88",
  "paths": [
    ".agents/handoffs/center-layout-tabs-actions.md",
    ".agents/lessons/index.json",
    ".agents/lessons/items/windows-biome-package-json-eol.md",
    ".gitattributes",
    "package.json",
    "src/main/db/db.test.ts",
    "src/main/db/migrations.ts",
    "src/main/ipc/ipc-handlers.test.ts",
    "src/main/ipc/ipc-handlers.ts",
    "src/main/ipc/ipc-validation.test.ts",
    "src/main/ipc/ipc-validation.ts",
    "src/main/ipc/service-registry.ts",
    "src/main/services/action-service.test.ts",
    "src/main/services/action-service.ts",
    "src/main/services/create-services.ts",
    "src/preload/app-api.test.ts",
    "src/preload/app-api.ts",
    "src/renderer/src/App.test.tsx",
    "src/renderer/src/App.tsx",
    "src/renderer/src/components/actions",
    "src/renderer/src/components/files/ProjectFiles.test.tsx",
    "src/renderer/src/components/layout/LeftNavigation.tsx",
    "src/renderer/src/components/layout/StatusBar.test.tsx",
    "src/renderer/src/components/tabs/CenterTabs.test.tsx",
    "src/renderer/src/components/terminal/ChatTerminal.test.tsx",
    "src/renderer/src/components/terminal/ChatTerminal.tsx",
    "src/renderer/src/components/workspace/ChatWorkspace.test.tsx",
    "src/renderer/src/components/workspace/ChatWorkspace.tsx",
    "src/renderer/src/hooks/useResizableRegion.test.tsx",
    "src/shared/ipc-contract.ts"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "db42b7384d6036e35aaf8442ac68690dbb4e3a2cc3ffbfed487a54ed0b80dcaf",
  "unstaged_diff_sha256": "0bf72f03f1e016395f715059fe6a11dbf73c8a1d47f8dda8e62ad37cdcdced58",
  "untracked_files_sha256": "6ccd6ce10cf0294e5a8c597133573963235604e1426a3cf38c31805068c0258a"
}
```

### Verification subject 2

```json
{
  "attempt": 2,
  "head": "d375afd29b94f46b935bd490e8f1eedf95fcfa88",
  "paths": [
    ".agents/handoffs/center-layout-tabs-actions.md",
    ".agents/lessons/index.json",
    ".agents/lessons/items/windows-biome-package-json-eol.md",
    ".gitattributes",
    "package.json",
    "src/main/db/db.test.ts",
    "src/main/db/migrations.ts",
    "src/main/ipc/ipc-handlers.test.ts",
    "src/main/ipc/ipc-handlers.ts",
    "src/main/ipc/ipc-validation.test.ts",
    "src/main/ipc/ipc-validation.ts",
    "src/main/ipc/service-registry.ts",
    "src/main/services/action-service.test.ts",
    "src/main/services/action-service.ts",
    "src/main/services/create-services.ts",
    "src/preload/app-api.test.ts",
    "src/preload/app-api.ts",
    "src/renderer/src/App.test.tsx",
    "src/renderer/src/App.tsx",
    "src/renderer/src/components/actions",
    "src/renderer/src/components/files/ProjectFiles.test.tsx",
    "src/renderer/src/components/layout/LeftNavigation.tsx",
    "src/renderer/src/components/layout/StatusBar.test.tsx",
    "src/renderer/src/components/tabs/CenterTabs.test.tsx",
    "src/renderer/src/components/terminal/ChatTerminal.test.tsx",
    "src/renderer/src/components/terminal/ChatTerminal.tsx",
    "src/renderer/src/components/workspace/ChatWorkspace.test.tsx",
    "src/renderer/src/components/workspace/ChatWorkspace.tsx",
    "src/renderer/src/hooks/useResizableRegion.test.tsx",
    "src/shared/ipc-contract.ts"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "8bc7049b9d1e171c4f70371b618514055463be19973772189af6c1bf0420f20f",
  "unstaged_diff_sha256": "0bf72f03f1e016395f715059fe6a11dbf73c8a1d47f8dda8e62ad37cdcdced58",
  "untracked_files_sha256": "270675d270c0a03d21ab9ccbb5917707ab6e256ea9dbbfdd8faf157009734f15"
}
```

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
| handoff | wait | 2026-09-26T23:34:25Z | 2026-09-27T08:35:54Z |
| review:2 | work | 2026-09-27T08:35:54Z | 2026-09-27T09:35:08Z |
| correction:3 | work | 2026-09-27T09:49:00Z | 2026-09-27T11:31:03Z |
| handoff | wait | 2026-09-27T11:35:42Z | 2026-09-27T15:27:24Z |
| preflight | work | 2026-09-27T15:27:24Z | 2026-09-27T15:27:48Z |
| review:2 | work | 2026-09-27T15:27:48Z | 2026-09-27T15:29:10Z |
| implement:3 | work | 2026-09-27T15:29:10Z | 2026-09-27T15:51:36Z |
| handoff | wait | 2026-09-27T15:51:36Z | 2026-09-27T16:41:52Z |
| preflight | work | 2026-09-27T16:41:52Z | 2026-09-27T16:43:17Z |
| implement:3 | work | 2026-09-27T16:43:17Z | 2026-09-27T17:06:28Z |
| review:3 | work | 2026-09-27T17:06:28Z | 2026-09-27T17:27:28Z |
| correction:3 | work | 2026-09-27T17:27:28Z | 2026-09-27T17:51:10Z |
| review:3 | work | 2026-09-27T17:51:10Z | 2026-09-27T18:04:34Z |
| user-gate | wait | 2026-09-27T18:04:34Z | 2026-09-27T18:19:47Z |
| retro | work | 2026-09-27T18:19:47Z | 2026-09-27T18:19:47Z |
| verify | work | 2026-09-27T18:20:34Z | 2026-09-27T18:21:33Z |
| correction | work | 2026-09-27T18:21:33Z | 2026-09-27T18:39:18Z |
| review | work | 2026-09-27T18:39:18Z | 2026-09-27T18:44:19Z |
| verify | work | 2026-09-27T18:44:52Z | 2026-09-27T18:45:52Z |
| close | work | 2026-09-27T18:45:52Z | 2026-09-27T18:45:52Z |

## Risks and blockers

- ~~Rewizja docs~~ — rozstrzygnięte w Stage 1 (rewizja wykonana, review r3 clean; nadrzędność: decyzja użytkownika 2026-09-26).
- ~~Adaptacja feature'ów do modelu zakładek~~ — rozstrzygnięte w Stage 2 (sesje w ukrytych widokach przetrwują przelączania; testy AC2/AC11 zielone).
- Dolny panel terminali nie istnieje — §8 (bottom terminal jako domyślne miejsce wykonania) wymaga świadomego odroczenia trybu.
- Konfiguracja akcji konfigurowalnych: źródło (SQLite vs plik projektu) i zakres edytora w UI — do rozstrzygnięcia w specyfikacji.

## Resume instructions

Zadanie zamkniete 2026-09-27 po akceptacji user-gate i `verify-full` subject 2. Nie ma nastepnego kroku w tym rekordzie. Kontrakt bajtow zostaje: CR = 0x0D, Stop = 0x03, nigdy 0x04. Format runtimeLabel i osobna kopia empty state, gdy projekt paska ma czaty, nie zostaly rozstrzygniete. Nie commitowac cudzego wpisu lekcji `project-scoped-mcp-ownership` razem z ta praca.
