---
task_id: chat-attention-badge
spec: docs/features/chat-attention-badge/spec.md
status: approved
---

# Plan: Chat attention badge

This file is the execution strategy for one task. It is not live progress and must not replace the task record. Do not put checkboxes here. Link the spec; do not copy it.

`status` is `draft` until the user approves the plan, then `approved`. A Standard plan has exactly one stage. Do not run tests-and-preflight or product code while status is `draft`.

## Goal of this iteration

Znaczek „wymagana uwaga" na czacie w lewym drzewku, zapalany przez sygnały agenta CLI w jego terminalu (samotny BEL, OSC 9), gaszony wyborem czatu lub wejściem aplikacji do tego PTY. Kontrakt: `docs/features/chat-attention-badge/spec.md`. Podstawa pomiarowa: sonda ConPTY z 2026-10-01 potwierdziła passthrough BEL/OSC 9 przez node-pty na tej maszynie (fakt zapisany w skillu `terminal-lifecycle`).

## Spec

`docs/features/chat-attention-badge/spec.md`

## Out of scope

Wg Non-goals specyfikacji: rozróżnianie przyczyny dzwonka, parsowanie treści ekranu, konfiguracja plików agentów, dźwięki i powiadomienia systemowe, znaczek na wierszu projektu, dolne terminale, trwałość stanu między restartami, nowe kanały IPC i tabele.

## Stages

### Stage 1 - Detekcja sygnałów i znaczek na liście czatów

- Outcome: AC1-AC10. Detekcja w widoku terminala czatu przez callbacki parsera xterm (`onBell`, `registerOscHandler(9)`), stan uwagi per chat id w rendererze, bursztynowa kropka przy nazwie czatu w LeftNavigation z tooltipem z wiadomości OSC 9, czyszczenie przy zaznaczeniu czatu i przy udanym `terminals:write` tego czatu. Detekcja działa też dla ukrytych (odznaczonych) czatów — ich widoki pozostają zamontowane. Strumień danych do xterm pozostaje nietknięty; bramek Ctrl+D i kopiowania/wklejania nie dotykamy.
- Boundary: bez zmian w kontrakcie IPC, walidacji, serwisach main i bazie. Bez dotykania dolnego panelu. Bez trwałości stanu. Bez rozróżniania typu sygnału w UI.
- Verification: `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`. Testy z Required tests: mock xterm modeluje semantykę parsera (BEL-terminator nie odpala `onBell`), dyskryminujący test AC2 (sekwencja tytułu okna z BEL nie zapala znaczka), izolacja między czatami, wykluczenie dolnych zakładek, czyszczenie przez zaznaczenie i przez zapis do PTY. Bramki z `.agents/project-profile.yaml` jako weryfikacja końcowa.
- Expected evidence: zielone bramki z liczbą testów; test AC2, który pada, gdy detektor liczy surowe bajty 0x07 zamiast użyć parsera; test, że `printf '\a'` w jednym czacie nie zmienia stanu drugiego; test braku zapisów DB/`app_state` (asercja struktury). Smoke w dev run: `printf '\a'` w terminalu czatu pokazuje kropkę — jeśli środowisko nie pozwoli, odnotować jako niewykonany.
- Likely files: `src/renderer/src/components/terminal/ChatTerminal.tsx` (subskrypcje parsera, nowy callback prop), `src/renderer/src/components/workspace/ChatWorkspace.tsx` (przepięcie stanu), `src/renderer/src/App.tsx` (właściciel stanu uwagi obok `chatsByProject`), `src/renderer/src/components/layout/LeftNavigation.tsx` (kropka + tooltip), `src/renderer/src/test/xterm-mock.ts` (semantyka `onBell` i OSC 9), testy towarzyszące tych plików.

Etapy są indeksem do czasu startu. Po starcie rozwijany jest tylko bieżący nagłówek.

## Preflight before edits

- Skill: `preflight`
- Preflight command from `.agents/project-profile.yaml`: `commands.preflight` (`{python} .agents/scripts/preflight`)
- Przed pierwszą edycją produktu: `pnpm run test` i `pnpm run typecheck`. Wynik w tabeli Verification rekordu zadania.

## Risks

- Fałszywe pozytywy BEL-terminatorów (np. ustawianie tytułu okna przez PowerShell): jedyny akceptowalny detector to callbacki parsera terminala; test AC2 dyskryminuje to ryzyko.
- xterm mock w testach musi wiernie modelować `onBell`/OSC, inaczej testy weryfikują mock, nie zachowanie. Semantyka: BEL w środku terminatora OSC nie jest dzwonkiem.
- Ukryte widoki czatów muszą pozostać zamontowane (retencja sesji) — detekcja nie może skłonić nikogo do ich odmontowania; test retencji z mvp-core-shell jest strażnikiem.
- Stan uwagi nie może przeciekać między czatami ani do dolnych zakładek; kluczem jest wyłącznie chat id.
- Starsze hosty Windows ze starym ConPTY mogą nie dowieść OSC 9 — feature degraduje do BEL-only, spec na to pozwala; nie blokuje implementacji.

## Approval

Do not run tests-and-preflight or product code until the user approves this plan.
