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
- Expanded sections have 10px bottom padding, an uppercase Recent sessions label, and tiles indented 28px with 6px gaps. Empty projects say No active sessions. New session follows the tiles, including empty projects.
- One SessionTile renders both views. Its button uses 8px 10px 8px 12px padding, 8px radius, 4px line gap, 13px sans name and aria-current. Rest is transparent with a transparent border; hover uses ink at 4%; active uses group surface and edge border, with no accent or glow.
- The first line has an 18px leading slot, name, lowercase agent badge or plain pwsh, spacer, task progress, the context count and available activity time. Second line uses 26px left padding; flat view adds a muted mono folder label. Shell sessions have no context or project-view second line.
- Flat sessions keep their source order: they never re-sort when a status or the attention badge changes, so selecting a tile never moves it. Their 18px project avatar has a 7px status badge at right/bottom -4px with a 2px background ring. Idle is hollow. Waiting pulses at 1.8s; reduced motion disables all sidebar animation.
- Agent colors have one overridable map: Claude #d97757, Codex/OpenAI #94a2ff, Gemini/Agy/Antigravity #6ea8fe, Grok #9aa7c7; unknown names hash lowercase characters with h*31+charCode into #a78bfa, #60a5fa, #f472b6, #22d3ee, #c084fc. Badges are 16px high, mono bold 10px, 6px horizontal padding, 4px radius, color at 10% background and 35% border.
- The tile shows the session's context use as a compact count with no denominator and no bar: `64.6k`, `160k`. It is the real number the agent reports, never a guess, and it is shown for Claude Code and Codex CLI sessions. Below 160,000 tokens the count uses muted ink; from 160,000 it uses the warning colour and from 180,000 the error colour. The thresholds are absolute counts, not a share of the model's window, because the user's limit of interest is 180k tokens. A chat whose transcript cannot be read, or whose agent reports no token counts, shows no count at all. Without a real last-activity timestamp, hide the time and record a TODO rather than claiming a status-change timer is last activity.
- Footer has 8px 14px 8px 16px padding, 6px gaps, edge top border, three 40px buttons with 18px icons: App settings (dialog), persisted Show/Hide mascot toggle, Report a bug using the existing issue flow. The real build version is right aligned, mono 13px.
- Float content row has 10px 10px 6px 10px padding and 6px gaps; sidebar has edge border and 10px radius. Preserve functional resizing. Files/Projects track is 200%, translateX(0/-50%), .32s cubic-bezier(.22,.8,.24,1), with the hidden pane aria-hidden and inert.
- Flat has no gutter/gap, only sidebar right border, and square non-button elements except circles. Buttons keep radius. Existing sans/mono font tokens and palette tokens are reused. No new shadows, gradients, accent bars or tile decoration.

## Business rules

Selection uses existing chat/project identifiers and expands the selected session's project. Status and task progress keep existing sources and attention preferences. Agent badges use launch identity only; legacy shell prefixes do not invent agent identity.

## Authorization

Existing renderer controls and trusted app API; no new privileges.

## Data / API

Use project/chat stores, session tasks, app.git.getStatus, persisted mascot setting, issue-report URL and __APP_VERSION__. The context count comes from the session's own agent transcript, read in main and exposed as `chats:contextUsage`. Claude Code launches carry a per-chat session id: the app passes `--session-id`, or reuses the id a profile names with `--resume`; `--continue` and `--fork-session` name no transcript, so those chats show no count. Codex CLI names its own sessions, so its rollout is matched by the cwd recorded in `session_meta` and by start time: only a rollout that started within 30 seconds after the launch can be that chat's, a rollout belongs to one chat, and when two chats compete the closer start wins. The launch record is kept in memory for the running app, so a chat listed after an application restart has no transcript mapping and shows no count. Account plan quota from the usage service is a different quantity and never stands in for session context. Never substitute fabricated data. Git errors are visible and do not prevent session navigation.

## Edge cases

Empty projects, no sessions, long names, WSL badges, stale task progress, disabled Files action in three-panel mode, missing Git repositories and Git failures, keyboard close controls, touch, reduced motion.

## Errors

Preserve existing error flows. Failed Git reads show an unavailable label with details; failed mascot persistence retains its visible error.

## Acceptance criteria

The NEKODE-160 checklist and prompt B/C are satisfied wherever supported by real data; the context count renders for Claude Code and Codex CLI sessions and is absent when its transcript is unreadable, and activity time stays hidden and explicitly tracked. Existing close/context menus, creation and selection flows remain usable. Float and Flat receive visual inspection and independent code review.

## Required tests

Affected navigation/footer/track and app integration tests; shared tile states in both views, source order preserved when a selection clears attention, collapse-all, accessible labels, brand mapping, the context count at both thresholds and its absence without a transcript, Codex rollout correlation keeping one rollout per chat, truthful missing activity time, footer actions. Final changed verification runs lint/typecheck and the targeted renderer application gate.

## Relevant SDD / ADR

[SDD](../../architecture/sdd.md). No new architecture decision.
