# Chat attention badge

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

Path: `docs/features/chat-attention-badge/spec.md`.

## Goal

When an agent CLI running inside a chat terminal (Claude Code, Codex CLI, OpenCode, or any program that rings the terminal bell or emits an OSC 9 notification) needs the user's attention — it finished its turn or is blocked on a prompt — that chat shows a badge in the left chat tree. A developer running several agent sessions in parallel sees which one needs them without switching chats.

## Related requirements

- No item in `docs/product/requirements.md`. User request 2026-10-01 (analysis session): detect attention requests of agent CLIs running in the app's terminal chats and surface them on the chat list.
- Measured fact (2026-10-01, dev machine, probe per the `terminal-io-debugging` skill): ConPTY forwards BEL, OSC 9, and OSC 777 byte-for-byte into the node-pty stream of a spawned PowerShell. Historic ConPTY stripped OSC sequences (microsoft/node-pty#714); the fix shipped with the ConPTY of Windows Terminal 1.23 (late 2024). Detection therefore sees what the agent sent on current Windows hosts; older hosts degrade to BEL-only, which this feature tolerates.
- Agent-side signal sources are external configuration the app never edits: Claude Code `preferredNotifChannel: "terminal_bell"` (code.claude.com/docs/en/terminal-config), Codex CLI `[tui] notifications` with `notification_method = "bel"` or `"osc9"` (github.com/openai/codex `docs/config.md`), OpenCode bell plugins.
- Chat terminal contract reused, not redefined: `docs/features/mvp-core-shell/spec.md` (hidden terminals keep receiving their data; terminal-exit close flow).
- Visual language: `docs/references/NeKode-Design-System.md` §2.4 — amber indicates attention.

## Scope

- Passive detection of attention signals in chat terminals' PTY output: the BEL character as a standalone bell, and OSC 9 notifications.
- A per-chat, in-memory attention state and an amber badge on that chat's row in the left tree, with a tooltip when a message text is available.
- Clearing the badge on chat selection and on any input the app delivers to that chat's PTY.

## Non-goals

- Distinguishing why the agent rang (permission prompt vs finished turn): the badge is one state.
- Parsing screen content, prompts, or agent TUI rendering to infer attention.
- Reading, writing, or verifying agent CLIs' configuration files. Absence of a configured signal source is not an app error and is not surfaced.
- Sounds, OS notifications, window flash, tray indicators, or a counter badge on the project row.
- Badges for bottom-panel tabs; persistence of attention state across application runs.
- New IPC channels, database tables, or `app_state` keys.

## Behaviour

1. The only monitored streams are chat terminals' PTY output. Detection is passive: bytes reach the xterm view unchanged, and detection never consumes, blocks, delays, or rewrites them.
2. A BEL (0x07) that the terminal parser reports as a bell raises attention for that chat. A BEL that merely terminates another escape sequence (for example a window-title set) must not: the detector relies on the terminal's parser callbacks, never on counting bytes in the raw stream.
3. An OSC 9 notification (`ESC ] 9 ; <message>` terminated by BEL or ST) raises attention for that chat. The message text is kept for the tooltip, truncated to 120 characters. An empty message keeps the badge without a tooltip. An unterminated (malformed) OSC 9 raises nothing.
4. A signal received while the chat is not selected sets the attention state. A signal received while the chat is selected is ignored: the user is already looking at it.
5. The badge shows on the chat's row in the left tree, next to the chat name, as an amber dot (Design-System §2.4). When message text exists, the badge tooltip shows it. A collapsed project hides the badge until expanded; no badge is promoted to the project row.
6. The attention state clears when the user selects the chat, or when input is delivered to that chat's PTY through the app (typed, pasted, or submitted — any successful `terminals:write` for that chat id). Once cleared it stays clear until a new signal.
7. Closing the chat removes the chat and its attention state with it (exit close flow unchanged). A replaced session generation starts with no attention state.
8. Attention state lives in memory for one application run. After a restart no chat shows a badge.
9. Bottom-panel terminals never set chat badges. Attention state is keyed by chat id; events of one id never affect another chat.

## Business rules

- Detection attaches per mounted chat view; hidden views stay mounted and keep detecting (mvp-core-shell session preservation).
- BEL-vs-terminator discrimination must come from the terminal parser (for example xterm `onBell` / `registerOscHandler`), not raw byte scanning.
- The badge is passive: no retry, no timeout, no auto-clear.
- UI labels and tooltips are English.

## Authorization

none (local single-user application).

## Data / API

No IPC changes, no database tables, no `app_state` keys. In-memory renderer state keyed by chat id (chat id → `{ message: string | null }`). xterm APIs used: `onBell`, `registerOscHandler(9)`.

## Edge cases

- Several signals in a row: the badge stays set; a newer OSC 9 message replaces the tooltip text.
- A signal from a hidden chat or a chat under a collapsed project: state is set and becomes visible on selection or expansion respectively.
- A signal between the view's subscription and the lazy create resolving cannot be missed: the view subscribes before create resolves (mvp-core-shell contract).
- A full-screen program in the alternate buffer (for example vim) rings BEL: it still counts; the badge appears when the chat is not selected.
- A session exits while its badge is active: the existing close flow removes the chat and the state with it; nothing else to clear.

## Errors

Detection is passive observation. A failed or unsupported detection hook (for example in a test mock without parser callbacks) degrades to "no badge" without an error surface; this spec explicitly requires that silent degrade. Detection must never break the terminal view, its data path, or the Ctrl+D emptiness gate.

## Acceptance criteria

- AC1: A standalone BEL written to a chat's PTY sets that chat's attention state and shows the badge (assert no badge before, badge after).
- AC2: A window-title OSC sequence terminated by BEL written to a chat's PTY does not set the state (discriminating test against the false-positive source).
- AC3: OSC 9 with message text sets the state and the tooltip carries the truncated message; OSC 9 with an empty message sets the badge without a tooltip; unterminated OSC 9 sets nothing.
- AC4: While the chat is selected, a signal does not set the attention state.
- AC5: Selecting a badged chat clears its badge.
- AC6: Delivering input to a badged chat's PTY clears its badge.
- AC7: A BEL or OSC 9 in a bottom-panel tab sets no chat badge.
- AC8: Attention state is in-memory only: restart shows no badges, and the implementation performs no database or `app_state` writes for it (structure assertion).
- AC9: A signal on one chat never changes another chat's attention state (cross-chat isolation).
- AC10: A signal received while the chat is hidden (deselected) sets the badge.

## Required tests

- Renderer unit tests against the xterm mock: standalone BEL between writes; OSC-terminator sequence; OSC 9 forms (BEL-terminated, ST-terminated, empty message, unterminated); badge rendering in the left tree; clearing on selection and on write; selected-chat suppression; bottom-tab exclusion; cross-chat isolation. The mock must model parser semantics: a BEL inside an OSC terminator does not fire `onBell`.
- jsdom only; tests never spawn PTYs.
- Real-app smoke (dev run): `printf '\a'` in a chat terminal shows the badge; optional manual check with a configured Claude Code or Codex session. When the environment cannot run it, record it as not run.

## Relevant SDD / ADR

- `docs/features/mvp-core-shell/spec.md` — chat terminal lifecycle (hidden views stay mounted; exit close flow).
- `docs/features/bottom-auxiliary-terminal/spec.md` — bottom tabs are not chats.
- `docs/references/NeKode-Design-System.md` §2.4 (amber = attention).
- ADR: none.
