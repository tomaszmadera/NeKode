---
task_id: center-layout-tabs-actions
created: 2026-09-27T11:35:42Z
schema_version: 2
from: Main (Hermes, sesja coder CLI 2026-09-27)
to: Main (kolejna sesja)
branch: main
worktree: current
checkpoint_subject: 4cc4508ebfe2238bf88a60bbe69bdcdc3d268d6d+sha256:a79a6803ce2ca8d2d42a6c539064ca6cca272bad4a974e8bf4d9d676ba452dbc
current_step: Phase 3.1
next_action: User-gate demo AC5-AC8 w pnpm dev, potem task-close z final verification full. Stage 3 review re-review passed 2026-09-27. checkpoint_subject ponizej zostaje przy snapshocie 11:35Z i nie opisuje biezacego worktree.
blockers: none
---

# Handoff: Center Layout: Tab Strip, Action Row, and Status Bar

## Repository snapshot

Stan na 2026-09-27T18:04:34Z (wzniesienie po przerwanej sesji Codex, nie nowy checkpoint commit): Stage 2 jest zamkniety (re-review pass, commit 997f7dd). Stage 3 jest w worktree, niezacommitowany, review:3 mial 3 warningi, korekta:3 i re-review:3 daly `No significant issues found.` Bramki Main po korekcie: lint 0, typecheck 0, test 296/296 w 23 plikach, build 0. Biezacy krok to user-gate Phase 3.1. Ponizszy opis 11:35Z jest historia Stage 2, nie pierwsza akcja.

Task record: `.agents/tasks/center-layout-tabs-actions/task.md` (status active, current_step Phase 3.1). Rola: Main (koordynator sesji Hermes) → Main (kolejna sesja); powód: user stop — „jak subagent skończy to napisz handoff" (praca kontynuowana w innej sesji). Spec: `docs/features/center-layout-tabs-actions/spec.md` (kompletny kontrakt, AC1-11); plan: `.agents/tasks/center-layout-tabs-actions/plan.md` (approved 2026-09-26, Large, 3 etapy).

**Working** (scope checkpointu: rekord + rewizja docs Stage 1 + kod Stage 2 z korektą:3 w `src/` + ten snapshot; HEAD 4cc4508 — patrz checkpoint_subject):

- Stage 1 (rewizja docs) ZAMKNIĘTY — bez zmian względem poprzedniego snapshotu (review r3 clean, korekty 2/2 wykorzystane).
- Stage 2 (layout) PO REVIEW R1 I KOREKCIE:3. Review:2 (świeży subagent, implementation gate, skill `code-review`): 1 warning + 2 suggestion + 1 needs-confirmation; niezależne próby mutacji reviewera potwierdziły dyskryminację testów kolejności (5 fail), close-fallback (2), retencji per projekt (2) i hidden-views (1); 23/23 pliki diff deklarowane; `actionRowSlot` czysty (0 materiału Stage 3); renderer bez importów electron/node; brak dangling refs po TopBar/CenterHeader/ProjectFilesSurface; no-op patch w `git-service.test.ts` nieszkodliwy.
- Korekta:3 (świeży implementer — Large wg spec-driven-development; Main nie poprawia etapu): warning naprawiony wg rozstrzygnięcia w Decisions. Kod: `chatSurfaceDiverged = selectedProjectId !== null && selectedProjectId !== tabProjectId` (App.tsx); w splicie etykieta zakładki terminal-chat = neutralny fallback TabStrip (TabStrip.tsx nietknięty), powierzchnia = Behaviour 2 empty state przez `forceStartNewChat` na ChatWorkspace (host sesji zostaje zamontowany — bez respawny), `Start new chat` → `handleCreateChat(tabProjectId)` (adopcja zaznaczenia rozpuszcza split), `statusProject = tabProject` (fallback `?? selectedProject` usunięty jako martwy). Optional: `+ New chat` bez projektu = notice zamiast martwego klika (App.tsx); fixture niepersistencji w `CenterTabs.test.tsx` asertuje też wartości `state.set`. Nowe testy 5 + 1 wzmocniony; razem 269/269 w 22 plikach. Próby mutacji korekty (kopia scratch `nc-probe`, live worktree przywrócone bitowo): P0 3 fail / P1 2 / P2a 1 / P2b 3 / P3 1 / P4 1 / P5 1 / P6 1 / P6b 0 (= wzmocniony fixture jest guardem) / P4b 0 (= równoważność usuniętego fallbacku); 0 ocalonych.
- Bramki zielone, przeliczone przez koordynatora w main sesji 2026-09-27T11:34Z: `pnpm run lint` 0, `pnpm run typecheck` exit 0, `pnpm run test` 269/269 (22 pliki), `pnpm run build` exit 0 (bundle renderera bez electron/node). `git status` = dokładnie changed_files korekty + rekord (App.tsx, ChatWorkspace.tsx, CenterTabs.test.tsx, task.md).
- Rekord walidny (`python .agents/scripts/task-status --check .agents/tasks/center-layout-tabs-actions/task.md` = exit 0), snapshot walidny (`handoff-status --check` = exit 0).

**Broken**: nic. Świadomie niezrobione (user stop): re-review korekty:3 (pierwsza akcja resume), Stage 3 (pasek akcji), user-gate demo AC (Phase 3.1), decyzja runtimeLabel (needs-confirmation review:2), task-close.

## Decisions

- Wszystkie decyzje użytkownika 2026-09-26 (layout z paskiem zakładek u góry środkowej kolumny i status barem na dole; grupy stałe `Handoff | Resume`, `Stop | Continue`; akcje konfigurowalne w SQLite + Project Settings → Actions; zakładki zastępują breadcrumb i etykietę „Files") — w rekordzie, sekcja Decisions; obowiązują bez zmian.
- Kontrakt bajtów przycisków stałych (Stage 3, do pilnowania co do bajtu): `Napisz handoff` / `Wznów z handoffu` / `Continue` + CR (0x0D) przez `terminals:write`; `Stop` = 0x03; NIGDY 0x04 (Ctrl+D zamyka czat w kontrakcie). Stringi to literalne dane, nie tłumaczenia.
- Rozstrzygnięcie review:2 (decyzja techniczna koordynatora 2026-09-27, w rekordzie Decisions): aktywnym projektem jest projekt paska zakładek (`tabProjectId = filesProjectId ?? selectedProjectId`) end-to-end — zakładka terminal-chat, powierzchnia terminala, empty state `Start new chat` i status bar; zakładka pokazuje aktywny czat TYLKO gdy `selectedProjectId === tabProjectId`, inaczej empty state Behaviour 2 z `Start new chat` tworzącym czat w projekcie paska (adopcja zaznaczenia w `handleCreateChat` rozpuszcza split). Semantyka akcji Files bez zmian (Behaviour 19). Kwalifikuje decyzję „Model czatów bez zmian”. Do potwierdzenia na demo user-gate.
- Decyzje techniczne korekty:3 (do zachowania): flaga `chatSurfaceDiverged` w App; `forceStartNewChat?: boolean` na ChatWorkspace (wymuszenie pustego stanu BEZ unmountu hosta sesji — inv-hidden-views-survival); neutralny fallback etykiety TabStrip zamiast nazwy cudzego czatu; `handleStartNewChat` i `handleTabNewChat` na `tabProjectId`; usunięty martwy fallback `statusProject ?? selectedProject` (P4b = 0 fail — nie przywracać).
- Decyzje in-boundary implementera korekty (do potwierdzenia na user-gate): (1) Files mode przy CAŁKOWITYM braku zaznaczenia NIE jest splitem — zostaje powierzchnia Welcome jak dziś (wymuszony istniejącym zielonym testem „← Projects keeps the Welcome surface when no chat was active"); (2) pusty stan w splicie pokazuje się bezwarunkowo (literalnie wg fix direction) — gdy projekt paska MA czaty, kopia mówi „No chats in this project" (powierzchnia Behaviour 11); pytanie o dedykowaną kopię na demo.

## Failed approaches

- Reprodukcja historycznego schematu `checkpoint_subject` z pary project-files-view (`946ab28+sha256:18a6d014…`) — NIEUDANA (ok. 20 wariantów). Nie powtarzać bez nowej hipotezy. Skutek: digesty liczone jawnym przepisem z sekcji Verification — samoopisne i odtwarzalne.
- Edycje wierszami przez skrypty z markerami: szerokie markery (`clean`, `Primary Terminal`) nie są unikalne — skrypty zatrzymywały się na asercjach (bez zapisu, bez szkód). Nie używać niejednoznacznych markerów; weryfikować edycje przez repr() i kontrolę szerokości ramek ASCII.
- Przywrócenie fallbacku `statusProject = tabProject ?? selectedProject` jako fix warningu review:2 — odrzucone (próba P4b = 0 fail; zachowanie martwe). Nie przywracać bez nowego stanu, który fallback uruchamia.

## Verification

- `python .agents/scripts/task-status --check .agents/tasks/center-layout-tabs-actions/task.md` = exit 0 (po domknięciu wierszy Timing dla handoffu).
- Review:2 (świeży subagent, implementation gate): 1 warning + 2 suggestion + 1 needs-confirmation; próby mutacji reviewera (kolejność/close-fallback/retencja/hidden-views) = dyskryminacja potwierdzona, 0 ocalonych; 23/23 pliki diff deklarowane; `actionRowSlot` czysty; renderer purity; brak dangling refs.
- Korekta:3: `pnpm run lint` 0, `pnpm run typecheck` exit 0, `pnpm run test` 269/269 (22 pliki), `pnpm run build` exit 0 — wszystko przeliczone przez koordynatora w main sesji 2026-09-27T11:34Z (nie tylko self-report). Próby mutacji P0-P6/P4b/P6b (wykaz w Repository snapshot; kopie scratch, live worktree przywrócone bitowo).
- Re-review korekty:3: NIE wykonany (user stop przed re-review). Dowody mutacji implementera = self-report z nazwami testów — re-review może je zakwestionować.
- `python .agents/scripts/handoff-status --check .agents/handoffs/center-layout-tabs-actions.md` = exit 0 (po zapisie tego snapshotu).
- checkpoint_subject policzony przepisem (jak w poprzednim snapshocie tego zadania): staged_diff_sha256 = sha256(`git diff --cached --binary --no-ext-diff -- <paths>`), unstaged_diff_sha256 = sha256(`git diff --binary --no-ext-diff -- <paths>`), untracked_files_sha256 = sha256(canonical_json(posortowanego manifestu {path, kind, sha256} dla `git ls-files --others --exclude-standard -- <paths>`)), digest = sha256(canonical_json({head, paths, staged_diff_sha256, unstaged_diff_sha256, untracked_files_sha256})); canonical_json = JSON posortowany po kluczach, separatory bez spacji, ASCII; pusta kategoria = e3b0c442… (sha256 pustego wejścia — także pusty manifest). paths = [`.agents/tasks/center-layout-tabs-actions`, `docs/features/center-layout-tabs-actions`, `docs/UX-UI.md`, `docs/architecture/sdd.md`, `docs/product/requirements.md`, `docs/features/project-files-view/spec.md`, `src`] (scope bez samego snapshotu). Wartości przy snapshotcie: head = 4cc4508…, staged = e3b0c442… (0 B), unstaged = 0d2dce7f… (24951 B), untracked = e3b0c442… (0 plików), digest = a79a6803….
- Ograniczenia środowiska: brak GUI w sesjach subagentów — demo `pnpm dev` niezrobione (user-gate Phase 3.1 po stronie użytkownika).

## Open product invariants

- `inv-tabs-per-session` — zakładki są stanem per-session UI, niepersistowane (Non-goals specu). Status: egzekwowane testem („tabs are per-session UI state"; fixture wzmocniony w korekcie:3 o wartości `state.set`). Impact: restart aplikacji gubi zakładki — zamierzone. Evidence do zmiany statusu: decyzja użytkownika + zmiana Non-goals w specie.
- `inv-hidden-views-survival` — sesje terminali i scrollback muszą przeżyć przełączania zakładek i round-tripy trybow (technika ukrytych widoków). Rozszerzenie po korekcie:3: wymuszony pusty stan splitu (`forceStartNewChat`) NIE może unmountować hosta sesji — bez respawny PTY. Status: pokryte testami (divergence tests korekty:3 + AC2/AC11). Impact: każda ingerencja Stage 3 w layout App może to zepsuć — regresja blokuje etap. Evidence do zmiany statusu: brak (obowiązuje bezwzględnie).
- `inv-action-row-slot` — wiersz akcji jest pustym zarezerwowanym slotem do czasu Stage 3. Status: otwarte (czeka na Stage 3). Impact: brak na AC1-4/9/11. Evidence do zmiany statusu: implementacja Stage 3 z testami (dokładne bajty 0x0D/0x03, tabela `actions` z migracją, IPC `actions:*`).

## Unresolved assumptions

- Re-review korekty:3 nie przeszedł — zakładamy poprawność fixa (bramki zielone niezależnie, próby mutacji z nazwami testów). Konsekwencja: możliwe findingsy w re-review. Rozstrzyga: pierwsza akcja resume (re-review).
- Decyzje user-gate (demo Phase 3.1) — zebrać i rozstrzygnąć na demo: (1) zachowanie splitu wg rozstrzygnięcia 2026-09-27 (empty state + `Start new chat` w projekcie paska) i brak splitu przy całkowitym braku zaznaczenia (Welcome surface — wymuszony istniejącym testem); (2) kopia pustego stanu w splicie, gdy projekt paska MA czaty („No chats in this project" — kandydat na dedykowaną kopię); (3) interpretacja 3 poprzedniego snapshotu (`← Projects` dla projektu niewybranego przełącza pasek na zestaw wybranego projektu); (4) decyzja (a) implementera Stage 2: tooltip zakładki w formie segmentowej `app / Services / Billing.php` vs surowa ścieżka względna (finding suggestion review:2 wstrzymany do demo). Konsekwencja: głównie kosmetyka i semantyka brzegowa.
- needs-confirmation review:2 — format listy runtimeLabel (badge runtime w status barze): producent `runtime_label` nie istnieje (zawsze null), format żyje tylko w komentarzu. Opcja A (rekomendacja koordynatora 2026-09-27): jawny format etykiet po przecinku (np. `Node.js,Python,Docker`) w Data/API specu + `ProjectInfo` — zero zmian w kodzie teraz; opcja B: `string[]` w kontrakcie + łączenie w rendererze. Nierozstrzygnięte — użytkownik nie odpowiedział. Rozstrzyga: decyzja użytkownika + zapis w specie i rekordzie PRZED jakimkolwiek kodem runtime detection (nie blokuje Stage 3).
- Tryb `new-terminal` akcji = nowy czat z poleceniem + CR (wyprowadzenie techniczne koordynatora) — może okazać się niewygodne w demo. Rozstrzyga: user-gate po Stage 3; alternatywa wymagałaby decyzji o osobnej powierzchni terminala.

## Resume instructions

1. Pierwsza akcja: user-gate Phase 3.1. Skill: nie implementowac Stage 3 od nowa. Uzytkownik uruchamia `pnpm dev` i potwierdza AC5-AC8 oraz punkty user-gate z Unresolved assumptions. Oczekiwane evidence: decyzja uzytkownika (akceptacja albo lista usterek). Nastepny skill po akceptacji: `task-close` z final verification `full`.
2. Stage 3 jest skonczony w worktree: self-review, review z 3 warningami, korekta i re-review `No significant issues found.` Nie powtarzac implementacji ani review bez nowej usterki z demo.
3. Przed edycja po demo: `git status`, `python .agents/scripts/task-status --check .agents/tasks/center-layout-tabs-actions/task.md`, spec i plan Stage 3. Kontrakt bajtow: CR 0x0D, Stop 0x03, nigdy 0x04.
4. Nie commitowac wpisu lekcji `project-scoped-mcp-ownership` razem z ta praca, jesli nie nalezy do zakresu. Nie ruszac `package.json`, gdy `git diff --numstat -- package.json` jest pusty.
5. Nie powtarzac: reprodukcja historycznego schematu `checkpoint_subject` (patrz Failed approaches) bez nowej hipotezy; edycje skryptowe z niejednoznacznymi markerami; przywracanie fallbacku `statusProject ?? selectedProject` (P4b: martwe); spawn PTY wewnatrz `ActionService.execute` dla `new-terminal`.

Repozytorium przy snapshotcie: HEAD 4cc4508, scope zadania zgodny z digestiem; checkpoint commit obejmuje wszystkie pliki task-owned łącznie z tym snapshotem.
