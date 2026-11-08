# Left panel

## Goal

Align the Projects and Sessions sidebar with the approved design in NEKODE-160 and the user's implementation prompt of 2026-11-08. That prompt owns exact dimensions and states.

## Related requirements

[Session labels](../session-labels/spec.md), [Project home](../project-home/spec.md), and [Project files](../project-files-view/spec.md). The current user decision replaces project-name selection with a single project-row expansion toggle; the home tab remains available in the center tab strip.

## Scope

Header, project tree, shared session tiles, flat sessions list, Files slide frame, footer, Float and Flat themes, accessibility.

## Non-goals

New session telemetry, token collection, IPC channels, storage migrations, agent detection, terminal lifecycle changes, and release/publication.

## Behaviour

- Projects is the default. The segmented control has 26px buttons and a total Sessions count. Its Projects-only actions are collapse-all (32px, hover/focus/touch visible only with expanded projects) and Add project (32px).
- Several projects may expand. Rows are 34px with 4px action gaps, 14px chevrons, 22px avatars, mono 13px names, expanded Git labels and collapsed nonzero status counts. The active project has inset accent at 12%. New session and File tree retain existing handlers and disabled states.
- Expanded sections have 10px bottom padding, an uppercase Recent sessions label, and tiles indented 28px with 6px gaps. Empty projects say No active sessions. New session follows the tiles, including empty projects.
- One SessionTile renders both views. Its button uses 8px 10px 8px 12px padding, 8px radius, 4px line gap, 13px sans name and aria-current. Rest is transparent with a transparent border; hover uses ink at 4%; active uses group surface and edge border, with no accent or glow.
- The first line has an 18px leading slot, name, lowercase agent badge or plain pwsh, spacer, task progress and available activity time. Second line uses 26px left padding; flat view adds a muted mono folder label. Shell sessions have no context or project-view second line.
- Flat sessions sort waiting, running, idle, preserving source order within a status. Their 18px project avatar has a 7px status badge at right/bottom -4px with a 2px background ring. Idle is hollow. Waiting pulses at 1.8s; reduced motion disables all sidebar animation.
- Agent colors have one overridable map: Claude #d97757, Codex/OpenAI #94a2ff, Gemini/Agy/Antigravity #6ea8fe, Grok #9aa7c7; unknown names hash lowercase characters with h*31+charCode into #a78bfa, #60a5fa, #f472b6, #22d3ee, #c084fc. Badges are 16px high, mono bold 10px, 6px horizontal padding, 4px radius, color at 10% background and 35% border.
- A context meter may render only for real session token usage: fixed 56x4px bar, 32px right-aligned number, 200k denominator, warning at 160k through 180k, critical above 180k. Suitable warning/error tokens are reused. Without telemetry, hide it and record a TODO. Without a real last-activity timestamp, hide the time and record a TODO rather than claiming a status-change timer is last activity.
- Footer has 8px 14px 8px 16px padding, 6px gaps, edge top border, three 40px buttons with 18px icons: App settings (dialog), persisted Show/Hide mascot toggle, Report a bug using the existing issue flow. The real build version is right aligned, mono 13px.
- Float content row has 10px 10px 6px 10px padding and 6px gaps; sidebar has edge border and 10px radius. Preserve functional resizing. Files/Projects track is 200%, translateX(0/-50%), .32s cubic-bezier(.22,.8,.24,1), with the hidden pane aria-hidden and inert.
- Flat has no gutter/gap, only sidebar right border, and square non-button elements except circles. Buttons keep radius. Existing sans/mono font tokens and palette tokens are reused. No new shadows, gradients, accent bars or tile decoration.

## Business rules

Selection uses existing chat/project identifiers and expands the selected session's project. Status and task progress keep existing sources and attention preferences. Agent badges use launch identity only; legacy shell prefixes do not invent agent identity.

## Authorization

Existing renderer controls and trusted app API; no new privileges.

## Data / API

Use project/chat stores, session tasks, app.git.getStatus, persisted mascot setting, issue-report URL and __APP_VERSION__. ChatInfo currently lacks token usage and activity timestamps. Never substitute account quota or fabricated data. Git errors are visible and do not prevent session navigation.

## Edge cases

Empty projects, no sessions, long names, WSL badges, stale task progress, disabled Files action in three-panel mode, missing Git repositories and Git failures, keyboard close controls, touch, reduced motion.

## Errors

Preserve existing error flows. Failed Git reads show an unavailable label with details; failed mascot persistence retains its visible error.

## Acceptance criteria

The NEKODE-160 checklist and prompt B/C are satisfied wherever supported by real data; unavailable context/time remain hidden and explicitly tracked. Existing close/context menus, creation and selection flows remain usable. Float and Flat receive visual inspection and independent code review.

## Required tests

Affected navigation/footer/track and app integration tests; shared tile states in both views, attention-first order, collapse-all, accessible labels, brand mapping, truthful missing telemetry, footer actions. Final changed verification runs lint/typecheck and the targeted renderer application gate.

## Relevant SDD / ADR

[SDD](../../architecture/sdd.md). No new architecture decision.
