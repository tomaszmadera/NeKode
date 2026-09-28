---
id: gui-ctrl-d-ctrl-u-diagnosis
schema_version: 2
status: completed
intent: debug
complexity: small
durability: recorded
current_phase: Phase 1
current_step: none
updated: 2026-09-28
branch: main
worktree: current
next_action: none
blockers: none
---

# Ctrl+D/Ctrl+U GUI diagnosis (mvp-core-shell deferred point)

## Objective

Ustalic, ktory punkt acceptance 3/5 mvp-core-shell (spec Behaviour 11 / AC9) nie przechodzi w realnym GUI dla Ctrl+D/Ctrl+U, i doprowadzic zachowanie do zgodnosci z kontraktem lub udokumentowac przyczyne. Zrodlo: wpis w BACKLOG.md (deferred-by-decision 2026-09-26), decyzja uzytkownika 2026-09-28: nastepne zadanie po review4-followups.

## Scope

Diagnostyka w realnym oknie (pnpm dev): sciezka klawisza od xterm textarea przez attachCustomKeyEventHandler (ChatTerminal.tsx) do bajtow w PTY (tmp/logs). Poza zakresem dopoki diagnoza nie wskaze inaczej: emulacja readline w rendererze, PTY/main, kontrakty IPC, klawaitura dolnego panelu.

## Phase 0 - Intake

- [x] Phase 0.1 - Pin why Ctrl+D at an empty prompt does not close a chat in the real GUI (user scenario; focused-key event and empty-line gate)

## Phase 1 - Verify and close

- [x] Phase 1.1 - Verify the focus-report correction and close the recorded task

## Decisions

- Nie iterowac po emulatorze bez nowego dowodu z zywego okna (testy jednostkowe i ConPTY-przechwytu sa zielone; luka jest miedzy mockiem/jsdom a realnym GUI).
- Przed jakakolwiek edycja produktu: skill systematic-debugging i czerwony dowod.
- Uzytkownik 2026-09-28 wskazal Ctrl+D na pustym promptcie; po Enter lub Ctrl+C skrot dzialal. Strumien ConPTY (`tmp/repro2-s5-single-bs.bin`) wlacza DECSET 1004 przed pierwszym promptem. Zainstalowany xterm 5.5 przy wlaczeniu trybu wysyla `ESC[O` albo `ESC[I` przez `onData`, a poprzedni kod zamrazal wtedy baze promptu. Test regresyjny pokazal blad (1/26 fail, `onClose` 0 zamiast 1). Poprawka nie zamraza bazy ani nie kasuje oczekiwania na bajt resetu dla tych dwoch raportow; oba nadal wysyla do PTY.
- Zakres poprawki dotyczy Ctrl+D na pustym promptcie. Reczny punkt acceptance Ctrl+U pozostaje niepotwierdzony i jest zapisany w BACKLOG.md.

## Changed files

- `src/renderer/src/components/terminal/ChatTerminal.tsx`
- `src/renderer/src/components/terminal/ChatTerminal.test.tsx`
- `BACKLOG.md`
- `.agents/lessons/index.json`, `.agents/lessons/items/debug-task-timing-element.md` (lekcja po bledzie walidacji rekordu)

## Verification

| Check | Result | Notes |
|---|---|---|
| preflight (`python .agents/scripts/preflight`) | exit 0 | repo/Git/system OK, Python 3.11.16, Node 24.18.0, pnpm 12.5.1; branch main; worktree clean; artifacts node_modules, dist |
| task-status --check (ten rekord) | exit 0 | "task records valid: 1" |
| preflight (wznowienie 2026-09-28) | exit 0 | Python 3.13.5; main; 1 zastana zmiana w rekordzie zadania, bez zmian produktu |
| task-status --check (wznowienie) | fail, potem exit 0 | Zastany element Timing `repro-gui` byl niedozwolony; zmieniono nazwe na `work` bez zmiany czasu |
| handoff-status --check | exit 0 | `handoffs valid: 1` przed aktualizacja snapshotu |
| `verify-targeted -- cmd /c pnpm exec vitest run src/renderer/src/components/terminal/ChatTerminal.test.tsx` | exit 0 | 25/25 testow; baseline przed zmianami produktu |
| `cmd /c pnpm run build` | exit 0 | Build do `out/` uzyty w izolowanej probie Electrona |
| Izolowany Electron, `tmp/ctrl-d-probe.cjs`, port 9223 | fail AC9 | Pusty prompt PowerShell, fokus `xterm-helper-textarea`; po zdarzeniu Ctrl+D wyslanym przez CDP czat pozostal w bazie i widoku. Ta proba nie dowodzi jeszcze, czy natywne zdarzenie dotarlo do handlera. Profil i projekt w `tmp/ctrl-d-probe-*`. |
| Regresja przed poprawka, ChatTerminal.test.tsx | exit 1 | 1/26 fail: `focus reports before the first prompt...`, `onClose` 0 zamiast 1; pozostale 25 pass |
| Regresja po poprawce, ChatTerminal.test.tsx | exit 0 | 26/26 pass; raporty `ESC[O`/`ESC[I` docieraja do PTY |
| `cmd /c pnpm run build` po poprawce | exit 0 | Build izolowanego Electrona z nowym kodem |
| Izolowany Electron po poprawce, `tmp/ctrl-d-probe.cjs`, port 9223 | pass AC9 dla pustej linii | Fokus `xterm-helper-textarea`, Ctrl+D przez CDP na pustym promptcie: wiersze terminala zniknely, `chats: []` z API bazy. Glowny proces testowy zatrzymany. |
| `python .agents/scripts/verify-changed` (subject 1) | exit 0 | validate-config: 28 skills; Biome 90 plikow, 0 findings; typecheck node i web exit 0 |

### Verification subject 1

```json
{
  "attempt": 1,
  "head": "ab49caba33ffe77fdcfe361f158dc8f689f02785",
  "paths": [
    ".agents/lessons/index.json",
    ".agents/lessons/items/debug-task-timing-element.md",
    "BACKLOG.md",
    "src/renderer/src/components/terminal/ChatTerminal.test.tsx",
    "src/renderer/src/components/terminal/ChatTerminal.tsx"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "b74fba8c5de701169210f774cd986f0dbd73a9dbb39e29fdd31f397fcd21f319",
  "unstaged_diff_sha256": "858d1a5912f02c4403a6eb834b5a57205f8463c4ad6911c822d1f19ced8bdd09",
  "untracked_files_sha256": "89b1d5129ea2dcf5b9310ea3573acd0948149721b68bf1e2e33b87b7818114d0"
}
```

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-28T10:49:51Z | 2026-09-28T10:50:30Z |
| preflight | work | 2026-09-28T10:55:20Z | 2026-09-28T10:56:55Z |
| work | work | 2026-09-28T11:00:00Z | 2026-09-28T12:25:11Z |
| retro | work | 2026-09-28T12:25:11Z | 2026-09-28T12:26:53Z |
| verify | work | 2026-09-28T12:26:53Z | 2026-09-28T12:27:31Z |
| close | work | 2026-09-28T12:28:10Z | 2026-09-28T12:28:10Z |

## Risks and blockers

- Plugin Computer Use nie udostepnil okien natywnych (`apps: []`, `cua.listWindows is not a function`). Automatyczny przeglad odrzucil dodatkowa instrumentacje CDP z komunikatem o chronionym pliku; diagnoze oparto na odpowiedzi uzytkownika, kodzie xterm i czerwonym tescie.
- Automatyczny przeglad odrzucil usuniecie ignorowanych plikow `tmp/ctrl-d-probe*`, `tmp/cdp-probe.cjs`, `tmp/keyboard-probe.cjs` z powodu polityki. Glowny proces testowy zatrzymano; pliki scratch pozostaly.

## Resume instructions

Zadanie zamkniete. Wynik poprawki i ograniczenie recznego punktu Ctrl+U sa zapisane wyzej oraz w BACKLOG.md.
