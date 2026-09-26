---
task_id: center-layout-tabs-actions
created: 2026-09-26T23:35:17Z
schema_version: 2
from: Main (Hermes, sesja coder CLI 2026-09-26/27)
to: Main (kolejna sesja)
branch: main
worktree: current
checkpoint_subject: 3140f3315c9523edabc3e268be3580a876059d86+sha256:3585e1be7628ef4c9e98a9fb62be739c3967071e08f01f8d92cf7f8d03cca972
current_step: Phase 2.3
next_action: Niezależny review Stage 2 (skill code-review, implementation gate, świeży subagent) — diff Stage 2 wobec specu (AC1-AC4, AC9, AC11) i planu Stage 2; korekty z CAP 2 rund, potem Stage 3
blockers: none
---

# Handoff: Center Layout: Tab Strip, Action Row, and Status Bar

## Repository snapshot

Task record: `.agents/tasks/center-layout-tabs-actions/task.md` (status active, current_step Phase 2.3 — Stage 2 po implementacji, review nie wykonany). Rola: Main (koordynator sesji Hermes) → Main (kolejna sesja); powód: user stop — „napisz handoff po zakończeniu subagenta Stage 2" (praca kontynuowana w innej sesji). Spec: `docs/features/center-layout-tabs-actions/spec.md` (kompletny kontrakt, AC1-11); plan: `.agents/tasks/center-layout-tabs-actions/plan.md` (approved 2026-09-26, Large, 3 etapy).

**Working** (scope checkpointu: rekord + plan + spec + rewizja docs Stage 1 + kod Stage 2; HEAD 3140f33; cały scope task-owned w commicie checkpointu wraz z tym snapshotem):

- Stage 1 (rewizja docs) ZAMKNIĘTY: SDD §7/§9/§21 (+ §64/§69/§70), UX-UI §5/§7/§8/§14/§17/§49/§50/§51/§65/§68/§69 (+ §77/§78), requirements §2.5/§2.7, project-files-view spec (Behaviour 4/7/9/12, AC 1/4/6, Required tests). Review w 3 rundach (5 warningów + 3 sugestie + 1 needs-confirmation → 3 warningi → „No significant issues found."), 2 korekty (Main; obie rundy CAP wykorzystane). Zero sprzecznych wzmianek o TOP Action Bar / starym context header w `docs/` (pozostałości uzasadnione: mvp-core-shell = opis historyczny zamkniętej funkcji, docs/references = materiały mockupowe sprzed decyzji, przełącznik Files/Kanban §18 = post-MVP).
- Stage 2 (layout) ZAIMPLEMENTOWANY (implementer subagent Hermes): pasek zakładek (terminal-chat pierwsza i niezamykalna, zakładki plików w kolejności otwarcia, `+ New chat` po prawej), pliki w zakładkach (read-only Monaco z numerami i syntax highlightingiem, fallbacki large/binary + `Open externally`, stan błędu przy usunięciu pliku w tej zakładce), retencja zakładek per projekt w sesji, status bar na dole okna (nazwa, ścieżka z truncacją i hover, badge runtime z `+N`, gałąź U+E0A0 + status wg form §16 z hover details, degradacja bez gita), usunięte `TopBar.tsx` / `CenterHeader.tsx` / `ProjectFilesSurface.tsx`; wiersz akcji = pusty zarezerwowany slot `actionRowSlot` (do Stage 3).
- Bramki zielone: lint 0 błędów, typecheck exit 0, test 264/264 w 22 plikach (baseline przed etapem: 232/232 w 19 plikach; ponownie przeliczone przez koordynatora), build exit 0 (bundle renderera bez importów electron/node). Testy dyskryminujące (kolejność zakładek, retencja per projekt, fallback zamknięcia) weryfikowane mutacjami przez implementera, przywrócone bitowo (sha256 zgodne).
- Rekord walidny (`python .agents/scripts/task-status --check .agents/tasks/center-layout-tabs-actions/task.md` = exit 0).

**Broken**: nic. Świadomie niezrobione: review Stage 2 (user stop przed review — nie startować w tej sesji bez potrzeby), Stage 3 (pasek akcji), user-gate demo AC, task-close. Uwaga walidatora edycji implementera: 1 no-op patch w `src/main/services/git/git-service.test.ts` (old_string == new_string) — plik kompletny, jego testy zielone; nic nie brakuje.

## Decisions

- Wszystkie decyzje użytkownika 2026-09-26 (layout z paskiem zakładek u góry środkowej kolumny i status barem na dole; grupy stałe `Handoff | Resume`, `Stop | Continue`; akcje konfigurowalne w SQLite + Project Settings → Actions; zakładki zastępują breadcrumb i etykietę „Files") — w rekordzie, sekcja Decisions; obowiązują bez zmian.
- Kontrakt bajtów przycisków stałych (Stage 3, do pilnowania co do bajtu): `Napisz handoff` / `Wznów z handoffu` / `Continue` + CR (0x0D) przez `terminals:write`; `Stop` = 0x03; NIGDY 0x04 (Ctrl+D zamyka czat w kontrakcie). Stringi to literalne dane, nie tłumaczenia.
- Decyzje techniczne Stage 2 (do zachowania): czyste reducery zakładek w `src/renderer/src/components/tabs/tabs-session.ts` (open/focus/close/previous — testowalne bez DOM); stan `tabsByProject` w App, klucz = id projektu (Remove Project czyści też sesję zakładek; per-session UI state, bez zapisu do app_state); zamknięcie aktywnej zakładki wybiera poprzednio aktywną, fallback = zakładka terminal-chat; podglady plików żyją w ukrytych widokach per otwarta zakładka aktywnego projektu (technika ChatWorkspace — terminale i scrollback przetrwają przełączenia); `GitStatus` rozszerzone o `worktree` (parser porcelain v2: Modified/Added/Deleted/Untracked/Conflicts/Ahead/Behind) — wymuszone przez AC9; gałąź/status w formach §16: gałąź = U+E0A0 + spacja + nazwa, status priorytetem `! N conflicts` > `● N changes` > `✓ clean`, hover = tabela 7 wierszy; badge runtime = lista etykiet po przecinku, maks. 3 widoczne, `+N` z hoverem; wiersz akcji = pusty slot do Stage 3 — nie wypełniać wcześniej.

## Failed approaches

- Reprodukcja historycznego schematu `checkpoint_subject` z pary project-files-view (`946ab28+sha256:18a6d014…`) — NIEUDANA (ok. 20 wariantów na odtworzonym stanie). Nie powtarzać bez nowej hipotezy. Skutek: digesty w snapshotach tego zadania liczone jawnym przepisem z sekcji Verification — samoopisne i odtwarzalne.
- Edycje wierszami przez skrypty z markerami: szerokie markery (`clean`, `Primary Terminal`) nie są unikalne — skrypty zatrzymywały się na asercjach (bez zapisu, bez szkód). Nie używać niejednoznacznych markerów; weryfikować edycje przez repr() i kontrolę szerokości ramek ASCII.

## Verification

- `python .agents/scripts/task-status --check .agents/tasks/center-layout-tabs-actions/task.md` = exit 0 (po domknięciu wierszy Timing dla handoffu).
- Stage 1: `git diff --check` = exit 0; przegląd `docs/` katalog-po-katalogu + grep terminalowy = 0 sprzecznych wzmianek o TOP Action Bar / starym context header; re-review runda 3 = „No significant issues found.".
- Stage 2: `pnpm run lint` 0 błędów, `pnpm run typecheck` exit 0, `pnpm run test` 264/264 (22 pliki), `pnpm run build` exit 0 (renderer bundle bez electron/node); testy dyskryminujące potwierdzone mutacjami (przywrócone bitowo). Review Stage 2: NIE wykonany (user stop przed review).
- `python .agents/scripts/handoff-status --check .agents/handoffs/center-layout-tabs-actions.md` = exit 0 (po zapisie tego snapshotu).
- checkpoint_subject policzony przepisem (jak w poprzednim snapshocie tego zadania, rozszerzony zakres paths): staged_diff_sha256 = sha256(`git diff --cached --binary --no-ext-diff -- <paths>`), unstaged_diff_sha256 = sha256(`git diff --binary --no-ext-diff -- <paths>`), untracked_files_sha256 = sha256(canonical_json(posortowanego manifestu {path, kind, sha256} dla `git ls-files --others --exclude-standard -- <paths>`)), digest = sha256(canonical_json({head, paths, staged_diff_sha256, unstaged_diff_sha256, untracked_files_sha256})); canonical_json = JSON posortowany po kluczach, separatory bez spacji; pusty input = e3b0c442… (kategoria staged pusta). paths = [`.agents/tasks/center-layout-tabs-actions`, `docs/features/center-layout-tabs-actions`, `docs/UX-UI.md`, `docs/architecture/sdd.md`, `docs/product/requirements.md`, `docs/features/project-files-view/spec.md`, `src`] (scope bez samego snapshotu). Wartości przy snapshotcie: head = 3140f33…, staged = e3b0c442…, unstaged = 1a8299f6…, untracked = 6d65288c… (6 plików w `src/renderer/src/components/{tabs,layout}`), digest = 3585e1be….
- Ograniczenia środowiska: brak GUI w sesjach subagentów — demo `pnpm dev` niezrobione (user-gate Phase 3.1 po stronie użytkownika).

## Open product invariants

- `inv-tabs-per-session` — zakładki są stanem per-session UI, niepersistowane (Non-goals specu). Status: egzekwowane testem („tabs are per-session UI state"). Impact: restart aplikacji gubi zakładki — zamierzone. Evidence do zmiany statusu: decyzja użytkownika + zmiana Non-goals w specie.
- `inv-hidden-views-survival` — sesje terminali i scrollback muszą przetrwać przełączenia zakładek i round-tripy trybow (technika ukrytych widoków). Status: pokryte testami AC2/AC11. Impact: każda ingerencja Stage 3 w layout App może to zepsuć — regresja blokuje etap. Evidence do zmiany statusu: brak (obowiązuje bezwzględnie).
- `inv-action-row-slot` — wiersz akcji jest pustym zarezerwowanym slotem do czasu Stage 3. Status: otwarte (czeka na Stage 3). Impact: brak na AC1-4/9/11. Evidence do zmiany statusu: implementacja Stage 3 z testami (dokładne bajty 0x0D/0x03, tabela `actions` z migracją, IPC `actions:*`).

## Unresolved assumptions

- Review Stage 2 nie przeszedł — zakładamy poprawność implementacji layoutu względem specu (bramki i testy zielone). Konsekwencja: możliwe findingsy review w kolejnej sesji. Rozstrzyga: pierwsza akcja resume (review Stage 2).
- Interpretacje implementera do potwierdzenia na demo (źródło: spec_deviations Stage 2): (1) tooltip zakładki w formie segmentowej `app / Services / Billing.php`; (2) usunięty pasek tytułowy ChatWorkspace — nazwa żyje w etykiecie zakładki terminal-chat; (3) niszowy przypadek `← Projects` dla projektu niewybranego przełącza pasek na zestaw wybranego projektu; (4) `+ New chat` tworzy czat w projekcie paska zakładek; (5) widoki podglądów zakładek innych projektów unmountują się i odświeżają odczytem przy powrocie. Konsekwencja: głównie kosmetyka i semantyka brzegowa. Rozstrzyga: user-gate demo (Phase 3.1).
- Tryb `new-terminal` akcji = nowy czat z poleceniem + CR (wyprowadzenie techniczne koordynatora) — może okazać się niewygodne w demo. Rozstrzyga: user-gate po Stage 3; alternatywa wymagałaby decyzji o osobnej powierzchni terminala.

## Resume instructions

1. Pierwsza akcja: niezależny review Stage 2 (skill `code-review`, implementation gate, świeży subagent) — diff Stage 2 (`src/`, lista ścieżek w Changed files rekordu) wobec specu (AC1-AC4, AC9, AC11) i planu Stage 2; korekty z CAP 2 rund korekt/re-review, potem dopiero Stage 3. Oczekiwane evidence: findingsy review albo „No significant issues found."; wynik do wiersza Verification rekordu.
2. Przed jakąkolwiek edycją: `git status`, `python .agents/scripts/task-status --check .agents/tasks/center-layout-tabs-actions/task.md`, lektura specu (kontrakt nadrzędny), planu (Stage 3) oraz Decisions w rekordzie i wyżej.
3. Kolejność: review Stage 2 → Stage 3 (pasek akcji; świeży implementer wg skillu `implement` + niezależny review `code-review`; CAP 2 rund korekt/re-review na etap, potem eskalacja do użytkownika) → user-gate demo AC (Phase 3.1, `pnpm dev`, realne GUI) → task-close z final verification `full` (skill `task-close`).
4. Nie powtarzać: reprodukcja historycznego schematu `checkpoint_subject` (patrz Failed approaches) bez nowej hipotezy; edycje skryptowe z niejednoznacznymi markerami.

Repozytorium przy snapshotcie: HEAD 3140f33, scope zadania zgodny z digestiem; checkpoint commit obejmuje wszystkie pliki task-owned łącznie z tym snapshotem.
