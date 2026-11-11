# Left panel

## Goal

Align the Projects and Sessions sidebar with the approved design in NEKODE-160 and the user's implementation prompt of 2026-11-08. That prompt owns exact dimensions and states.

## Related requirements

[Session labels](../session-labels/spec.md), [Project home](../project-home/spec.md), and [Project files](../project-files-view/spec.md). A later user decision of 2026-11-08 restores project-name selection inside the row: the name selects the project and opens its home tab, while the row button's chevron and avatar toggle expansion and the home tab stays available in the center tab strip.

## Scope

Header, project tree, shared session tiles, flat sessions list, Files slide frame, footer, Float and Flat themes, accessibility.

## Non-goals

Context telemetry for agents other than Claude Code and Codex CLI, last-activity timestamps, storage migrations, agent detection, terminal lifecycle changes, and release/publication.

## Behaviour

- Projects is the default. The segmented control has 26px buttons and a total Sessions count. Its Projects-only actions are collapse-all (32px, hover/focus/touch visible only with expanded projects) and Add project (32px).
- Several projects may expand. Rows are 34px with 4px action gaps, 14px chevrons, 22px avatars, mono 13px names, expanded Git labels and collapsed nonzero status counts. The active project has inset accent at 12%. New session and File tree retain existing handlers and disabled states.
- Projects layout decision of 2026-11-09 (NEKODE-165): expanded sections have 12px bottom padding. Show uppercase Recent sessions only when the project has sessions, aligned with the project avatar's left edge (28px inset). Empty expanded projects show only New session, without a heading or No active sessions caption. Sessions and New session have 46px minimum rows with 6px gaps, a shared 18px leading slot, 18px left padding and a 12px gap before the label, aligning status-dot and plus centers and session-name and action-label starts. Metadata gaps are 8px (4px when the session container is at most 220px wide). Metadata stays vertically centered, context aligns at the right, and long names truncate before badges and counts. Project action buttons keep their fixed columns. These presentation overrides apply only to Projects; Sessions retains its existing layout and global empty state.
- One SessionTile renders both views. Its button uses 8px 10px 8px 12px padding, 8px radius, 4px line gap, 13px sans name and aria-current. Rest is transparent with a transparent border; hover uses ink at 4%; active uses group surface and edge border, with no accent or glow.
- The first line has an 18px leading slot, name, lowercase agent badge or plain pwsh, spacer, task progress, the context count and available activity time. Second line uses 26px left padding; flat view adds a muted mono folder label. Shell sessions have no context or project-view second line.
- Flat sessions keep their source order: they never re-sort when a status or the attention badge changes, so selecting a tile never moves it. Their 18px project avatar has a 7px status badge at right/bottom -4px with a 2px background ring. Idle is hollow. Waiting pulses at 1.8s; reduced motion disables all sidebar animation.
- Agent colors have one overridable map: Claude #d97757, Codex/OpenAI #94a2ff, Gemini/Agy/Antigravity #6ea8fe, Grok #9aa7c7; unknown names hash lowercase characters with h*31+charCode into #a78bfa, #60a5fa, #f472b6, #22d3ee, #c084fc. Badges are 16px high, mono bold 10px, 6px horizontal padding, 4px radius, color at 10% background and 35% border.
- The tile shows the session's context use as a compact count with no denominator and no bar: `64.6k`, `160k`. It is the real number the agent reports, never a guess, and it is shown for Claude Code and Codex CLI sessions. Below 160,000 tokens the count uses muted ink; from 160,000 it uses the warning colour and from 180,000 the error colour. The thresholds are absolute counts, not a share of the model's window, because the user's limit of interest is 180k tokens. A chat whose transcript cannot be read, or whose agent reports no token counts, shows no count at all. Without a real last-activity timestamp, hide the time and record a TODO rather than claiming a status-change timer is last activity.
- Footer has 8px 14px 8px 16px padding, 6px gaps, edge top border, three 40px buttons with 18px icons: App settings (dialog), persisted Show/Hide mascot toggle, Report a bug using the existing issue flow. The real build version is right aligned, mono 13px.
- Float content row has 10px 10px 6px 10px padding and 6px gaps; sidebar has edge border and 10px radius. Preserve functional resizing. Files/Projects track is 200%, translateX(0/-50%), .32s cubic-bezier(.22,.8,.24,1), with the hidden pane aria-hidden and inert.
- Flat has no gutter/gap, only sidebar right border, and square non-button elements except circles. Buttons keep radius. Existing sans/mono font tokens and palette tokens are reused. No new shadows, gradients, accent bars or tile decoration.
- Session tile context menu decision of 2026-11-11 (NEKODE-179): the Sessions view has no empty-area context menu and never offers Add Project. Right-clicking a session tile, or pressing ContextMenu / Shift+F10 on it, opens `Open in file explorer` for the project root, a separator, then `Shell` and the project's agent profiles, which start a new session in that project. The Projects view keeps its project-row and empty-area menus unchanged.

## Business rules

Selection uses existing chat/project identifiers and expands the selected session's project. Visible attention has first status priority, followed by explicit session/chat status. Without an explicit status, non-empty terminal output makes the status green for five minutes after the last output; otherwise it is gray. This restores the earlier activity-driven status under the NEKODE-155 user correction. It describes recent terminal activity, not proof of agent work or completion. Task progress remains visible independently and alone never keeps a silent session green. Attention clearing and selection do not extend activity. Both views and collapsed-project counts use this resolution without reordering sessions. See [Chat terminal activity](../chat-terminal-activity/spec.md) for timing and lifecycle rules. Agent badges use launch identity only; legacy shell prefixes do not invent agent identity.

## Proposed session-tile amendment (NEKODE-155)

This amendment is pending approval of `.agents/tasks/nekode-155/plan.md`. It changes only the tile presentation described below; the current Behaviour remains authoritative until approval.

- Preserve the later explicit decisions of 2026-11-08: flat sessions keep source order; context remains a real compact token count without a bar, denominator or assumed 200k window, with warning at >=160,000 and critical at >=180,000; unavailable activity time remains hidden. The older NEKODE-155 card does not reverse those decisions.
- User decision during NEKODE-155 planning: Projects currently looks correct. Preserve its current layout, status indicators, typography and theme styling. Do not introduce a second line, move the badge/progress or change its glow/animation as part of this task. Shared-component edits must preserve the Projects appearance.
- In Sessions, preserve the avatar, name, badge or shell label, task progress and real context count on line 1, plus the muted folder name on line 2 at 26px indentation. A 56px context bar and moving the context count into its column are superseded by the later count-only decision.
- Both views keep the shared neutral rest/hover/active tile skin, exact padding/radius/gaps and existing selection, close and context-menu handlers. The badge keeps its current 10px bold mono font, line height and the existing brand map: a Sessions-only `line-height: 1` was proposed and withdrawn by the user on 2026-11-09, because the badge has a fixed 16px height with centred text and the change has no visible effect. User decision during NEKODE-155 planning: Flat project avatars and agent badges have border-radius 0. Preserve the current Flat rule for square non-button elements except circles; the earlier draft's proposed avatar/badge radius exception is withdrawn. This decision does not change Float or the round status dots.
- Accessibility is out of scope permanently (user decision 2026-11-09): the tile button keeps its current accessible name, and no accessible-name, screen-reader announcement or ARIA work belongs to this amendment or to the application. Existing `aria-label` and screen-reader-only markup stays as it is, is not a requirement, and is not extended.
- Verify both views and themes at narrow widths and with long names, available/missing context, stale task progress, keyboard close controls and reduced motion. No telemetry, IPC, persistence or terminal behavior changes belong to this amendment.

## Authorization

Existing renderer controls and trusted app API; no new privileges.

## Data / API

Use project/chat stores, session tasks, app.git.getStatus, persisted mascot setting, issue-report URL and __APP_VERSION__. The context count comes from the session's own agent transcript, read in main and exposed as `chats:contextUsage`. Claude Code launches carry a per-chat session id: the app passes `--session-id`, or reuses the id a profile names with `--resume`; `--continue` and `--fork-session` name no transcript, so those chats show no count. Codex CLI names its own sessions, so its rollout is matched by the cwd recorded in `session_meta` and by start time: a rollout is a candidate for a launch that started no more than 2 seconds after the rollout began and no more than 30 seconds before it, a rollout belongs to one chat, and the accepted pairing is the assignment with the smallest total start-time distance across all pending chats and rollouts. A count is shown only when the pairing is unambiguous: chats in one directory launched within 2 seconds of each other show no count, and when the best assignment is less than one second better than an alternative that pairs some chat differently, only the chats whose pairing differs show no count. Every other chat keeps the number its own start supports. A launch that resumes an older Codex session by passing `codex resume` as its prompt is a separate session and matches no earlier rollout. The launch record is kept in memory for the running app, so a chat listed after an application restart has no transcript mapping and shows no count. Account plan quota from the usage service is a different quantity and never stands in for session context. Never substitute fabricated data. Git errors are visible and do not prevent session navigation.

## Edge cases

Empty projects, no sessions, long names, WSL badges, stale task progress, disabled Files action in three-panel mode, missing Git repositories and Git failures, keyboard close controls, touch, reduced motion.

## Errors

Preserve existing error flows. Failed Git reads show an unavailable label with details; failed mascot persistence retains its visible error.

## Acceptance criteria

The NEKODE-160 checklist and prompt B/C are satisfied wherever supported by real data; the context count renders for Claude Code and Codex CLI sessions and is absent when its transcript is unreadable, and activity time stays hidden and explicitly tracked. Existing close/context menus, creation and selection flows remain usable. Float and Flat receive visual inspection and independent code review.

## Required tests

Affected navigation/footer/track and app integration tests; shared tile states in both views, source order preserved when a selection clears attention, collapse-all, brand mapping, the context count at both thresholds and its absence without a transcript, Codex rollout correlation keeping one rollout per chat with its minimum-total-distance pairing and both ambiguity guards, truthful missing activity time, footer actions. Final changed verification runs lint/typecheck and the targeted renderer application gate.

## Relevant SDD / ADR

[SDD](../../architecture/sdd.md). No new architecture decision.
