# Attention alert settings

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

Path: `docs/features/attention-alert-settings/spec.md`.

## Goal

A developer running agent sessions in NeKode chat terminals — including one full-screen, watched from across the room — decides per channel how attention signals surface: a badge on the chat row, an audible chime, or both. Signal detection and clearing semantics are unchanged; only the surfacing becomes configurable, so the alerts work during normal use and stay silent or hidden when the user turns them off.

## Related requirements

- No item in `docs/product/requirements.md`. User request 2026-10-02: attention alerts must be always on while the console is open, default-enabled, and disableable in settings; the active chat's signals must be configurable separately (chime yes/no, indicator yes/no); no visual surface beyond the existing badge and the chime.
- Builds on `docs/features/chat-attention-badge/spec.md` (detection, suppression, clearing, in-memory state). This feature adds persisted presentation settings and an audio output path on top of it.

## Scope

- Four app-global persisted toggles (App Settings, General tab, all default enabled): badge on chat rows for unselected chats; chime for unselected chats; chime for the selected (active) chat; attention indicator on the selected chat's row.
- A short chime played in the renderer at the moment a chat's attention signal sets or re-sets attention state (new signal only, never on clears).
- The indicator reuses the existing amber attention dot on the chat row; it is not a separate visual element.

## Non-goals

- Changing detection semantics (parser-based BEL/OSC 9), suppression, clear-on-selection/input rules, or bottom-tab exclusion: `chat-attention-badge` remains authoritative.
- OS notifications, window flash, tray, project-row counters, any new visual surface (user decision B: nothing beyond the dot and the chime).
- Volume, sound-choice, or per-project/per-chat configuration.
- Sound for bottom-panel tabs; persistence of attention state itself (state stays in-memory for one run).
- New IPC channels or database tables; no new renderer dependencies (the chime is synthesized with the Web Audio API).

## Behaviour

1. Settings live in the flat `app_state` store under four keys, read at startup and applied live on change (no restart). Missing key or any value other than `'0'` means enabled: the toggles are off-switches (`'0'` = off, `'1'` or missing = on). Changes persist immediately and survive application restarts.
2. A BEL or OSC 9 signal in an unselected chat plays the chime when "chime for background chats" is on, and sets the attention state regardless of any setting — the badge rendering itself is what the badge toggle gates.
3. When "attention indicator on the active chat" is on, a signal in the selected chat sets its attention state and its row shows the same amber dot; when off, the selected chat's signals set no visible indicator. Clearing rules are unchanged (selection, delivered input).
4. A signal in the selected chat plays the chime when "chime for the active chat" is on, independently of the indicator toggle.
5. The chime is one short synthesized tone (Web Audio, renderer-side, sub-second, quiet default volume) fired once per state-setting signal. Clearing an attention state never sounds. Repeated signals while attention is already set may re-sound (each detected signal is one potential chime); no retry, no timeout.
6. With every toggle off the app behaves exactly as before this feature except that no badge, indicator, or chime is produced; detection and state clearing still run.
7. Web Audio unavailable or a failed chime attempt degrades silently to no sound; detection, state, and badges are unaffected. Errors never surface to the notice banner.

## Business rules

- The four toggles are independent; no combination is coerced (e.g. indicator off + active chime on is valid and sounds without showing a dot).
- The selected-chat indicator uses the same amber dot and tooltip contract as the background badge (`chat-attention-badge` Behaviour 5); no second visual language.
- Settings persistence uses the existing `app.state` bridge only; no new IPC, no database.
- UI labels are English; the toggles live on the General tab of App Settings and participate in the dialog's Tab focus cycle.
- The chime never blocks or touches the terminal data path; it is fired from the same passive detection callbacks, after (or independent of) the state update.

## Authorization

none (local single-user application).

## Data / API

Four `app_state` keys (flat strings; `'0'` = off, otherwise on), added to `APP_STATE_KEY`:

- `attention.badgeEnabled` — badge on unselected chat rows
- `attention.chimeEnabled` — chime for unselected chats
- `attention.activeChimeEnabled` — chime for the selected chat
- `attention.activeIndicatorEnabled` — indicator dot for the selected chat

Renderer in-memory state (`chatAttention`) stays keyed by chat id with the same shape; the chime is a renderer-side Web Audio module (`lib/chime.ts`) with no persistence and no dependencies.

## Edge cases

- All toggles off: detection and clearing run, nothing is ever shown or heard.
- Indicator off, active chime on: the active chat's signals sound but never show a dot; the dot must not linger from a previously shown state after the toggle flips off (live apply).
- A signal arrives while App Settings is open: toggles apply live; the chime fires per the current in-memory values.
- A chat with an active badge becomes selected: selection still clears its state (unchanged), and no chime fires for the clear.
- Restart: settings persist (app_state), attention state does not — a fresh run shows no dots until a new signal.

## Errors

A failed `app.state.set` surfaces through the existing notice banner (same as other settings). A failed or unavailable Web Audio context degrades silently: no notice, no retry, no state change. All other failure behavior inherits `chat-attention-badge` (passive detection degrades to no badge without error surfaces).

## Acceptance criteria

- AC1: Default state — with no persisted values, a signal in an unselected chat shows the badge AND plays the chime; a signal in the selected chat shows the indicator dot AND plays the chime (all four default on).
- AC2: Badge toggle off — a signal in an unselected chat sets attention state but renders no dot; the chime (if on) still sounds; turning the toggle back on re-renders existing state without a new signal.
- AC3: Active indicator toggle off — a signal in the selected chat sets no visible dot; the active chime (if on) still sounds.
- AC4: Active chime toggle off — a signal in the selected chat never sounds; the indicator (if on) still shows.
- AC5: Background chime toggle off — a signal in an unselected chat never sounds; the badge (if on) still shows.
- AC6: The chime fires once per state-setting signal and never on clears (selection or delivered input produce no sound).
- AC7: All four settings persist: after a restart with a toggle previously turned off, the off state survives (`app_state` read at startup); structure assertion — exactly the four new keys are written on toggle changes.
- AC8: Changing a toggle takes effect without restart, including rendering changes for attention state that already exists.
- AC9: `chat-attention-badge` regressions hold: bottom tabs still set nothing, cross-chat isolation intact, clearing unchanged.

## Required tests

- Renderer (vitest + jsdom, xterm mock): the four toggles gate rendering/sound at the App level (end to end through App, mirroring the existing attention describe): default-on for all four; each off-switch gates its channel; chime spy asserts call/no-call per toggle and no call on clears; toggle change live-applies to already-set state; restart reads persisted values; bottom-tab exclusion re-checked with chime on.
- The chime module is stubbed at its module boundary in component tests (no real Web Audio in jsdom); the module itself gets one direct unit test for its guard behavior (no AudioContext → no throw, no sound).
- Structure assertion for AC7 mirroring the badge spec's AC8 pattern (state.set keys enumerated).
- jsdom only; tests never spawn PTYs or real audio devices.
- Real-app smoke (dev run): toggle each setting, trigger BEL/OSC 9 in a chat, confirm dot and sound behavior; record as not run when the environment cannot.

## Relevant SDD / ADR

- `docs/features/chat-attention-badge/spec.md` — detection, suppression, clearing, in-memory state (all inherited unchanged).
- `docs/features/mvp-core-shell/spec.md` — chat terminal lifecycle.
- `docs/references/NeKode-Design-System.md` §2.4 (amber = attention).
- ADR: none.
