# Session labels and agent badges

Status: Approved by the user on 2026-10-18.

## Goal

Make left-navigation sessions identifiable by their Kanban task or session name, with a separate badge identifying the launched agent. Identify WSL projects beside their names.

## Related requirements

- User request of 2026-10-18: replace shell prefixes in left-navigation session labels with agent badges, use the Kanban slug when available, and mark WSL projects.
- User decision of 2026-10-18: sessions outside Kanban retain their session name and receive an agent badge.
- [Chat creation](../../UX-UI.md#46-chat-creation), [New chat agent profile menu](../new-chat-agent-menu/spec.md), and [Project shell selection](../project-shell-selection/spec.md) own the existing stored naming and launch behavior. This feature changes navigation presentation and adds launch metadata; it does not rename existing stored chats.
- [Kanban task launch](../kanban-adapter-interface/spec.md) owns Start and Resume.

## Scope

Left-navigation labels, agent badges, WSL project badges, persisted launch identity, and existing launch/list/get responses needed to render them.

## Non-goals

Chat renaming controls, detecting agents manually started inside a shell, new agent profile settings, terminal lifecycle changes, new Kanban requests for rendering, and changes to bottom-terminal labels.

## Behaviour

1. A session launched through Kanban Start or Resume displays the work item's full `ref`, such as `NEKODE-42`, as its main label. Use the launch-time work-item ref, not its UUID, URL, title, or progress counter.
2. A session without a Kanban ref displays its session name without the generated leading `[shell]` prefix. A generated shell-only name displays `Terminal`. Preserve the remainder of the name verbatim apart from surrounding whitespace.
3. A session launched with an agent displays a compact text badge beside the main label. Identify the launched CLI, independently of the profile display name. Known CLI names use their conventional display names, such as `Codex`, `Claude`, `Grok`, `Gemini`, `Hermes`, and `AntiGravity`. For other executables use the executable's basename without a launcher suffix. Recognize script-backed Node launches from their explicit script argument rather than calling the agent `Node`. Do not run commands or inspect terminal output to derive the name.
4. A plain shell session has no agent badge. No badge claims that an agent is currently running; it records the agent chosen at launch.
5. A project with a WSL project location displays a compact `WSL` badge immediately beside its name. Its tooltip identifies the distribution. Determine this from the established WSL path representation, not a saved chat prefix or `runtimeLabel`. Local projects receive no environment badge.
6. Preserve selection, project expansion, close controls, attention/activity/status indicators, time labels, and existing task-progress display. Long labels truncate; badges remain readable within the existing navigation width. Accessible session labels include the visible identity and agent name. Hover exposes the full label and existing status information.
7. Save the task ref and agent identity with the chat at launch so listing sessions after restart produces the same labels. A profile rename, edit, deletion, or project deselection does not rewrite an existing session's identity.

## Business rules

- Main owns launch identity and derives it from the revalidated work item and selected profile.
- Display labels are not chat ids; duplicates remain valid.
- Task ref and agent identity are independent of optional task progress.
- Failed task launches that retain a chat for retry retain that chat's identity. Existing rollback and retry behavior stays unchanged.

## Authorization

None beyond existing trusted IPC and project/profile validation. No new privilege or process execution.

## Data / API

Add optional launch identity fields to `ChatInfo` and persist their nullable equivalents with the chat using a forward migration. Include them in create, list, and get results. Existing IPC operations remain the transport; no new channel is required. Store only the task ref and display identity of the agent, not prompts or full command arguments.

## Edge cases

- Existing chats have no recoverable launch identity. Keep their saved name, hide the generated shell prefix in navigation, and omit the agent badge rather than guessing from a profile name. A shell-only legacy chat displays `Terminal`.
- A Kanban session without an available ref uses the same session-name rule.
- Multiple sessions for the same task may share a label and agent badge; existing ids and selection remain authoritative.
- Custom executable paths may use Windows or POSIX separators and launcher suffixes.

## Errors

Use the existing typed persistence and launch error paths. A failed identity write must not silently create an unlabelled substitute session. Navigation performs no asynchronous identity lookup or new network requests.

## Acceptance criteria

- AC1: Start and Resume render the full Kanban ref with the launched CLI badge.
- AC2: Non-Kanban agent sessions render their name without a shell prefix, plus the CLI badge even when the profile has a different name.
- AC3: Plain shell sessions render `Terminal` without an agent badge.
- AC4: Only WSL projects display `WSL`; the tooltip names their distribution.
- AC5: Identity survives database reopen and profile edits/deletion. Existing rows migrate without being renamed or assigned guessed metadata.
- AC6: Navigation actions and existing session indicators retain their behavior, including truncation and accessible labels.

## Required tests

- Persistence: forward migration of existing rows and create/list/get round-trip of optional launch identity.
- Launch services: agent identity differs from profile name; Kanban Start/Resume carry the ref; retries and spawn failures preserve existing behavior.
- Identity derivation: known CLIs, custom executable paths, Windows launcher suffixes, and explicit Node script entry points.
- Renderer: Kanban and non-Kanban labels, plain and legacy sessions, long names, accessible names, WSL/local projects, and navigation action regressions.
- Run existing affected tests before product edits, affected tests after edits, independent stage review, then recorded changed verification (lint and typecheck).

## Relevant SDD / ADR

[SDD](../../architecture/sdd.md): established main/preload/renderer boundaries and typed IPC. No new ADR.
