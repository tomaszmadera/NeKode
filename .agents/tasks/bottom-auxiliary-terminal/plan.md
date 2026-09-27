---
task_id: bottom-auxiliary-terminal
spec: docs/features/bottom-auxiliary-terminal/spec.md
status: approved
---

# Plan: Bottom auxiliary terminal

This file is the execution strategy for one task. It is not live progress and must not replace the task record. Do not put checkboxes here. Link the spec; do not copy it.

`status` is `draft` until the user approves the plan, then `approved`. A Standard plan has exactly one stage. A Large plan has two or more stages. Do not run tests-and-preflight or product code while status is `draft`.

## Goal of this iteration

Dolny panel na całą szerokość okna, nad paskiem statusu, z wieloma zakładkami terminala na projekt, oraz tryb akcji `bottom-terminal`. Kontrakt: `docs/features/bottom-auxiliary-terminal/spec.md`. Decyzja użytkownika 2026-09-27: wiele zakładek, nie jeden terminal.

## Spec

`docs/features/bottom-auxiliary-terminal/spec.md`

## Out of scope

Wg Non-goals specyfikacji: zakładki w drzewku czatów, trwałość listy zakładek i procesów między restartami, zmiana nazwy, przeciąganie, podział panelu, limit liczby zakładek, kierowanie `Handoff` / `Resume` / `Stop` / `Continue` do dolnego terminala, automatyczna zmiana zapisanych akcji, wykrywanie końca polecenia w shellu, prawy panel, Kanban, encja Task, edycja plików, `.agentcode/actions.yaml`.

## Stages

### Stage 1 - Panel i zakładki terminali

- Outcome: AC1-AC8 specyfikacji bez trybu akcji. Panel pokazuje się i chowa skrótem `Ctrl + `` (także z fokusu terminala, bez wpisywania akordu do PTY), pamięta otwarcie i wysokość, przy otwarciu bierze fokus, po ukryciu przywraca poprzedni fokus i nie zabija PTY. Projekt ma wiele zakładek na czas uruchomienia aplikacji: tworzenie bez formularza nazwy, przełączanie, zamykanie, retencja przy zmianie projektu, pusty stan `New terminal`, brak zakładek po restarcie. Przyciski czatu nadal piszą tylko do aktywnego czatu.
- Boundary: formularz akcji nadal oferuje tylko `Background` i `New terminal`. Brak migracji `run_mode` i brak wykonania `bottom-terminal`. Istniejące zdania w `docs/features/center-layout-tabs-actions/spec.md`, które rezerwują ten tryb, zostają do etapu 2.
- Verification: `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`. Testy z sekcji Required tests, które dotyczą panelu, zakładek i skrótu, bez ścieżki `bottom-terminal`.
- Expected evidence: zielone bramki z liczbą testów; test, który pada, gdy akord Backquote+Ctrl wywołuje `terminals:write`; test retencji zakładek między projektami i braku odtworzenia listy po restarcie stanu.

### Stage 2 - Tryb akcji bottom-terminal

- Outcome: AC9 i AC10. Formularz zapisuje `Bottom terminal`. Wykonanie otwiera panel, dodaje nową zakładkę dolną, nie zmienia zaznaczonego czatu i wpisuje polecenie plus CR. Anulowanie potwierdzenia, brak projektu i brak katalogu roboczego nie tworzą zakładki. Stare akcje zostają przy swoim trybie. Sukces oznacza dostarczenie do terminala, nie kod wyjścia shella.
- Boundary: bez wykrywania końca polecenia w shellu i bez odświeżania Gita z tego powodu. Bez przepisywania istniejących wierszy `actions` na nowy tryb.
- Verification: te same cztery bramki. Testy migracji (pusta baza i baza z wierszami `background` oraz `new-terminal`), walidacji IPC, wykonania (dokładne bajty polecenia plus 0x0D, brak nowego czatu) i anulowania. Zdania rezerwujące tryb w `docs/features/center-layout-tabs-actions/spec.md` wskazują ten kontrakt zamiast go zabraniać. `docs/product/requirements.md` §2.5 i `docs/architecture/SDD.md` §23.2 / §25 nie nazywają już trybu zarezerwowanym.
- Expected evidence: zielone bramki; test dyskryminujący bajt CR; migracja nie zmienia starych `run_mode`; demo obu etapów w działającej aplikacji.

Etapy są indeksem do czasu startu. Po starcie rozwijany jest tylko bieżący nagłówek.

## Preflight before edits

- Skill: `preflight`
- Preflight command from `.agents/project-profile.yaml`: `commands.preflight` (`{python} .agents/scripts/preflight`)
- Przed pierwszą edycją produktu: `pnpm run test` i `pnpm run typecheck`. Wynik w tabeli Verification rekordu zadania.

## Risks

- Ukrycie panelu albo zakładki nie może zabijać PTY ani scrollbacku. Widoki terminali dolnych zostają zamontowane na czas uruchomienia, tak jak widoki czatów.
- Skrót musi wygrać z xterm i nie może trafić do PTY. Test asertuje brak `terminals:write`, nie sam wygląd.
- Migracja `run_mode` jest nową wersją. Wpis, który utworzył tabelę `actions`, nie jest edytowany. Stare wiersze zostają.
- Identyfikatory zakładek dolnych nie są identyfikatorami czatów. Zdarzenia terminala jednego id nie mogą dojść do drugiego. Usunięcie projektu i quit zabijają tylko własne PTY. Quit nie usuwa czatów.

## Approval

Standard and Large: do not run tests-and-preflight or product code until the user approves this plan.
