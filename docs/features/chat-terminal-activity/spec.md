# Chat terminal activity

Status: Delivered (recent terminal output dot on chat navigation rows, NEKODE-89).
Path: `docs/features/chat-terminal-activity/spec.md`.

## Goal

Show recent terminal output beside each chat name so the user can notice data arriving in hidden sessions without switching chats. The indicator describes terminal traffic only: it does not establish agent work, progress, completion, or requests for permission.

## Related requirements

- [NEKODE-89](http://<plane-host>:8087/private/projects/604c4810-978a-47b9-ab61-5e20ef360f3b/issues/db110d17-ad2d-48b8-b7c5-1b2460e6a61f/), including the user's requirements supplied on 2026-10-18.
- [Chat attention badge](../chat-attention-badge/spec.md) owns BEL / OSC 9 detection and attention clearing.
- [Attention alert settings](../attention-alert-settings/spec.md) owns the existing attention toggles and chime.

## Scope

Passive observation of the existing renderer PTY data subscription, transient activity for each mounted chat session, and a subtle indicator on that chat's navigation row. Selected and hidden chat sessions are included.

## Non-goals

Screen, spinner, prompt, or CPU inspection; agent-specific hooks; reliable agent status; completion notifications; new settings, dependencies, IPC channels, database writes, or bottom-panel indicators.

## Behaviour

1. Every non-empty PTY data fragment refreshes that chat session's last-output time, including while its view is hidden or waiting for fonts. Use the existing data subscription without changing terminal bytes or their delivery. Input alone does not count.
2. Activity appears within one 250 ms publication interval. It expires after 2,500 ms without output, with at most one additional 250 ms scheduling interval while renderer timers run normally. After timer throttling, recompute from elapsed time instead of counting ticks.
3. A muted dot beside the chat name means "Recent terminal output". Its English tooltip explains that it is not agent status. Expiry removes the dot without a finished, idle, successful, or completed state, sound, or notification. TUI redraws count as output; silence does not establish completion.
4. A visible amber BEL / OSC 9 attention badge takes precedence: render only that badge when both states apply. Activity keeps its independent deadline. Clearing attention reveals activity only if output is still recent; clearing attention never extends the deadline.
5. Preserve attention detection, tooltip, settings, chime, selection clearing, and delivered-input clearing. Attention settings govern attention only; recent-output activity is independent of those settings. Selection and delivered input do not clear recent output.
6. Share the attention badge's row position and yield while the close control is revealed by hover or keyboard focus. A collapsed project hides the row and dot without discarding activity. Do not promote activity to a project row.
7. A gentle opacity pulse is allowed only when motion is permitted. With `prefers-reduced-motion: reduce`, use a static dot without animated appearance/disappearance. Accessible text conveys recent output without live announcements per fragment.
8. Closing a chat, ending or failing its session, replacing its terminal view/session, or unmounting the workspace discards its old activity and scheduled work. A replacement starts inactive even when it reuses a chat id or generation number. Old callbacks or pending publications cannot reactivate it.

## Business rules

- Data from one chat cannot change another chat's activity.
- Fragments update transient timestamps outside React state. Batch activity publication at most once per 250 ms and publish only when the active-chat set changes. Lifecycle removal may clear state immediately.
- Use one bounded scheduler, without timers accumulating per fragment. Stop it when no activity remains and clean it up on disposal.
- Keep activity separate from attention state. Bottom-panel terminals never set chat activity.

## Authorization

None (local single-user application).

## Data / API

Renderer memory only: session identity and last-output time per chat, plus the active-chat snapshot needed by navigation. Reuse `terminals.onData`. Retain no terminal contents for this feature. No persistence, network calls, telemetry, IPC contract changes, or new subscriptions per render.

## Edge cases

Continuous bursts keep activity visible without repeated snapshot updates. A burst after expiry reactivates it. Chats expire independently. Empty fragments do not activate or extend activity. Output containing BEL / OSC 9 can set both states; rendering follows attention precedence. Failed-close restoration, held-launch retry, and explicit session retry start with fresh activity.

## Errors

Use existing terminal spawn, font, and close error surfaces. Activity introduces no retry or error suppression in the terminal data path. Session failure removes activity without a completion signal.

## Acceptance criteria

- AC1: Non-empty output activates only its chat, including hidden views and collapsed projects; expansion reveals still-recent activity.
- AC2: Activity expires after the silence deadline and publication tolerance. Further output extends the deadline. Silence produces no completion state.
- AC3: Visible attention wins; existing settings and clearing rules still pass. Revealing activity after attention clears does not reset its deadline.
- AC4: Close, exit, failure, replacement, and unmount clear activity. Old callbacks cannot leak into a replacement session or reopened chat.
- AC5: Bursts and sustained output do not publish per fragment. Snapshot changes are bounded by the publication interval; unchanged sets are not republished.
- AC6: Reduced motion renders a static accessible indicator. Hover/focus close controls retain their established behavior.
- AC7: No new IPC, persistence, bottom-terminal indicators, or terminal-byte changes.

## Required tests

- Fake timers: independent chats/sessions, deadline extension/expiry, empty fragments, burst coalescing, bounded sustained-output publication, unchanged snapshots, stale callbacks, and scheduler cleanup.
- Existing bridge/xterm mocks: visible/hidden data, initial font wait, close/exit/failure/retry/replacement, workspace unmount, bottom-terminal exclusion, and App-to-navigation propagation.
- Navigation/attention regressions: precedence, visibility settings, selection/input clearing without extending activity, collapse/expand, hover/focus, accessible wording, and motion-safe/reduced-motion styling.
- Run relevant existing tests before product edits, affected tests after implementation, then final changed verification (lint and typecheck). Run an isolated real-app smoke for the visual prototype when the supported runtime is available; record actual evidence or the exact limitation.

## Relevant SDD / ADR

- [MVP core shell](../mvp-core-shell/spec.md): hidden terminals and session lifecycle.
- [Bottom auxiliary terminal](../bottom-auxiliary-terminal/spec.md): bottom tabs are separate from chats.
- ADR: none.
