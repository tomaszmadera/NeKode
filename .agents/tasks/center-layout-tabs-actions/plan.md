---
task_id: center-layout-tabs-actions
spec: docs/features/center-layout-tabs-actions/spec.md
status: approved
---

# Plan: Center Layout: Tab Strip, Action Row, and Status Bar

This file is the execution strategy for one task. It is not live progress and must not replace the task record. Do not put checkboxes here. Link the spec; do not copy it.

`status` is `draft` until the user approves the plan, then `approved`. A Standard plan has exactly one stage. A Large plan has two or more stages. Do not run tests-and-preflight or product code while status is `draft`.

## Goal of this iteration

Układ środkowej kolumny zgodny ze specyfikacją: pasek zakładek (terminal-chat + zakładki plików + `+ New chat`), pasek akcji pod zakładkami (`Handoff | Resume`, `Stop | Continue` + akcje konfigurowalne z wykonaniem i konfiguracją), status bar na dole okna z kontekstem projektu. Realizuje wymaganie 5 requirements.md (Action Bar) w układzie z decyzji użytkownika 2026-09-26.

## Spec

`docs/features/center-layout-tabs-actions/spec.md`

## Out of scope

Wg Non-goals specyfikacji: dolny panel terminali i tryb `bottom-terminal`, bogaty model Handoff (formularz, rekordy, auto-resume), konfiguracja akcji w repozytorium (`.agentcode/actions.yaml`), edycja plików, drag-and-drop zakładek, persistencja zakładek między restartami, wiele terminali w zakładkach, logi outputu akcji w tle, Kanban, narzędzia right panel.

## Stages

### Stage 1 - Rewizja dokumentacji pod nowy układ

- Outcome: SDD §7/§9/§21, UX-UI §5/§7/§8/§14/§49/§50/§65/§68/§69, requirements §2.5/§2.7 oraz nadpisane części `docs/features/project-files-view/spec.md` opisują układ: pasek zakładek u góry środkowej kolumny, pasek akcji pod zakładkami, status bar na dole (kontekst projektu), brak pasa TOP i kontekstowego headera nad środkiem; wszędzie zachowane słownictwo zakładek i status bara.
- Boundary: tylko dokumentacja — zero kodu produktu i zero zmian testów; poprawki obejmują wyłącznie wskazane sekcje i ich bezpośrednie odwołania (w tym przykłady ASCII layoutu).
- Verification: `git diff --check`; wyszukanie w `docs/` pozostałych wzmianek o TOP Action Bar / context header w starym miejscu (zero trafień sprzecznych z nowym modelem); spójność odwołań między sekcjami.
- Expected evidence: lista poprawionych sekcji ze zmianami; wynik wyszukiwania sprzeczności; akceptacja modelu przez użytkownika (przy demo etapu).

### Stage 2 - Layout: pasek zakładek, pliki w zakładkach, status bar

- Outcome: spełnione AC1–AC4, AC9 i AC11 specyfikacji — pasek zakładek (jedna zakładka terminal-chat + zakładki plików + `+ New chat`), podgląd pliku w zakładce (read-only Monaco z fallbackami large/binary i `Open externally`), retencja zakładek per projekt w sesji, status bar z kontekstem projektu (nazwa, ścieżka, runtime, git wg UX-UI §15–§16), usunięty header kontekstowy i pas TOP.
- Boundary: bez wiersza akcji (Stage 3) — miejsce pod niego zarezerwowane w layoutie; bez bazy `actions`, IPC `actions:*` i jakiegokolwiek wykonywania poleceń.
- Verification: bramki `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`; nowe testy renderera (kolejność i przełączanie zakładek, open/focus/close zakładki pliku, fallback na zakładkę terminala, retencja per projekt, status bar + degradacja bez gita); bundle renderera bez `electron`/`node`.
- Expected evidence: zielone bramki z liczbami testów; testy dyskryminujące dla retencji i kolejności zakładek; demo w `pnpm dev` wskazujące AC1–AC4/AC9.

### Stage 3 - Pasek akcji: skróty terminalowe + akcje konfigurowalne

- Outcome: spełnione AC5–AC8 i AC10 — wiersz akcji (`Handoff | Resume`, `Stop | Continue` + akcje w kolejności), przyciski stałe piszące dokładne bajty (`Napisz handoff`/`Wznów z handoffu`/`Continue` + CR 0x0D; `Stop` = 0x03), model `ActionControl` + tabela `actions` (migracja), IPC `actions:list/create/update/delete/execute`, wykonanie `background` (stany idle/running/success/failed + hover) i `new-terminal` (nowy czat + polecenie + CR), Project Settings → Actions (lista + formularz wg UX-UI §49), flaga potwierdzenia.
- Boundary: bez trybu `bottom-terminal` (zarezerwowany w `run_mode` do zadania z panelem dolnym), bez konfiguracji z repozytorium, bez logów outputu akcji w tle (failed podaje exit code).
- Verification: bramki pełne; testy serwisu akcji (CRUD + persistencja przez migrację, cykl życia wykonania w tle, kody wyjścia, egzekwowanie potwierdzenia), testy handlerów IPC `actions:*` (walidacja + typed errors wg wzorca `ipc-handlers.test.ts`), testy renderera asertujące dokładne bajty przez `terminals:write` (dyskryminacja: zamiana 0x0D/0x03 na inne = fail wskazanych testów), regresja przepływów czatu/plików.
- Expected evidence: zielone bramki z liczbami testów; testy dyskryminujące bajtów; demo w `pnpm dev` wskazujące AC5–AC8.

Etapy są indeksem do czasu startu; po starcie rozwijany jest tylko bieżący nagłówek.

## Preflight before edits

- Skill: `preflight`
- Preflight command from `.agents/project-profile.yaml`: `commands.preflight` → `{python} .agents/scripts/preflight`
- Existing tests to run before product edits, and where to record results (task record Verification table): `pnpm run test` (baseline 232/232, 19 plików, po zamknięciu project-files-view) + `pnpm run typecheck`; wynik w wierszu Verification rekordu zadania.

## Risks

- Adaptacja techniki ukrytych widoków ChatWorkspace do modelu zakładek bez utraty sesji terminali i scrollbacku (spec Behaviour 2/6; regresja AC6 project-files-view).
- Dokładne bajty przycisków stałych (CR 0x0D, Ctrl+C 0x03) — muszą przechodzić przez `terminals:write` nietknięte; testy asertują bajty, nie tekst widoczny.
- Migracja SQLite `actions` — mechanizm migracji append-only (jak v2/v3 w mvp-core-shell); brak nowych natywnych zależności.
- Rewizja docs: rozproszone wzmianki o TOP Action Bar i context header w UX-UI/SDD (szukanie pełnym przeglądem `docs/`), ryzyko pominiętej sprzeczności między sekcjami.
- Tryb `new-terminal` = nowy czat (wyprowadzenie techniczne: jedna zakładka terminala nie ma trzeciej powierzchni na output); alternatywa wymagałaby decyzji użytkownika o dodatkowej powierzchni terminala.

## Approval

Standard and Large: do not run tests-and-preflight or product code until the user approves this plan.
