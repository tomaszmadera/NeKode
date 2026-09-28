---
id: gui-ctrl-d-ctrl-u-diagnosis
schema_version: 2
status: active
intent: debug
complexity: small
durability: recorded
current_phase: Phase 0
current_step: Phase 0.1
updated: 2026-09-28
branch: main
worktree: current
next_action: Preflight, then intake: reproduce the Ctrl+D/Ctrl+U flow in the real GUI (pnpm dev), identify which acceptance point fails before touching code.
blockers: none
---

# Ctrl+D/Ctrl+U GUI diagnosis (mvp-core-shell deferred point)

## Objective

Ustalic, ktory punkt acceptance 3/5 mvp-core-shell (spec Behaviour 11 / AC9) nie przechodzi w realnym GUI dla Ctrl+D/Ctrl+U, i doprowadzic zachowanie do zgodnosci z kontraktem lub udokumentowac parszywa przyczyne. Zrodlo: wpis w BACKLOG.md (deferred-by-decision 2026-09-26), decyzja uzytkownika 2026-09-28: nastepne zadanie po review4-followups.

## Scope

Diagnostyka w realnym oknie (pnpm dev): sciezka klawisza od xterm textarea przez attachCustomKeyEventHandler (ChatTerminal.tsx) do bajtow w PTY (tmp/logs). Poza zakresem dopoki diagnoza nie wskaze inaczej: emulacja readline w rendererze, PTY/main, kontrakty IPC, klawaitura dolnego panelu.

## Phase 0 - Intake

- [ ] Phase 0.1 - Reproduce the failing flow in the real GUI and pin the failing acceptance point (pnpm dev; user scenario for 'nie dziala'; tmp/logs captures)

## Decisions

- Nie iterowac po emulatorze bez nowego dowodu z zywego okna (testy jednostkowe i ConPTY-przechwytu sa zielone; luka jest miedzy mockiem/jsdom a realnym GUI).
- Przed jakakolwiek edycja produktu: skill systematic-debugging i czerwony dowod.

## Changed files

- (pending)

## Verification

| Check | Result | Notes |
|---|---|---|

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-28T10:49:51Z | 2026-09-28T10:50:30Z |

## Risks and blockers

- Wymaga interakcji uzytkownika w realnym oknie (scenariusz reprodukcji).

## Resume instructions

Wznow z handoff snapshot .agents/handoffs/gui-ctrl-d-ctrl-u-diagnosis.md. Pierwsza akcja: preflight, potem intake-reprodukcja.
