# New chat agent profile menu

Status: Delivered (New Chat context menu, `chats:createWithAgent`, and interactive arguments).
Path: `docs/features/new-chat-agent-menu/spec.md`.

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

Let the user start a chat with a configured agent directly from the left panel: right-clicking the per-project `New Chat` button opens a context menu listing the project's agent profiles, and choosing one starts a new chat with that agent running. For users who keep several agent CLIs configured per project.

## Related requirements

- NEKODE-42 (Plane work item `354e0221-94dd-4ff9-a692-4cda6eb3e1dd`): "In the left panel, add a right-click context menu on 'New chat'. It should list the agent profiles. After a profile is chosen, a new chat starts with the agent loaded." (translated from Polish)
- NEKODE-78 (Plane work item `f7589e3c-daeb-47a2-af5f-552a78ff4d40`): explicit interactive arguments for profiles whose task prompt is an option value, including Hermes and AntiGravity (AGY).
- [Global agent profiles](../global-agent-profiles/spec.md): accepted user decision 2026-10-14, replacing per-project definitions with a global library and explicit project opt-in. It owns configuration and migration, and that library is in the application. [Kanban task launch amendment](../kanban-adapter-interface/spec.md#agent-profiles) owns the task prompt contract.
- [mvp-core-shell](../mvp-core-shell/spec.md) and [project-shell-selection](../project-shell-selection/spec.md): chat naming `[shell] profile name`.
- `docs/UX-UI.md` §22-25 (console agent model, agent selection; the future selector surface stays out of scope here).

## Scope

- The context-menu gesture on the left panel's per-project `New Chat` button (right click, plus keyboard context-menu invocation).
- A context menu listing the project's agent profiles by name, with its loading, empty, and error states.
- Starting exactly one new chat of that project with the chosen profile: named `[shell] <profile name>`, agent process running in the chat terminal at the project root.
- Failure behavior of the launch.

## Non-goals

- The plain left-click `New Chat` flow (stays a `[shell]` chat with the project shell).
- The tab-strip `+ New chat` and the empty-state `Start new chat` controls.
- A default-profile marker, profile management inside the menu, an initial prompt/task for the agent, chat renaming, agent auto-detection, a global default agent (UX-UI §23-24), ACP.

## Behaviour

1. The left panel's `New Chat` button keeps its left-click behavior unchanged. Right-clicking it (or pressing ContextMenu / Shift+F10 on the focused button, matching the project-row context-menu convention) opens a context menu and creates no chat. Keyboard invocation positions the menu below the button; the pointer gesture positions it at the pointer.
2. The menu opens immediately and lists only the global profiles explicitly selected for that button's project, in global library order, one menu item per profile. An empty project selection remains empty even when the global library contains profiles.
3. Choosing a profile creates exactly one chat in that project and adopts it like a Kanban Start chat: it becomes the selected chat, its project node expands, and the terminal-chat tab activates. The chat name is `[shell] <profile name>` with the shell prefix resolved at creation time (existing naming contract).
4. The profile's agent process starts in the chat's terminal, spawned by main together with the chat, at the project root. The executable and argv are passed as a process argv, never typed through a shell. When the profile defines `interactiveArgs`, that complete array replaces its task arguments for this launch, including when it is empty. Otherwise, only the single `{prompt}` argv element is removed from `args`, preserving every other element. The agent starts without an initial prompt. NeKode does not infer option ownership or remove neighbouring arguments.
5. With no profiles configured, the menu shows one item `Configure agents`, which opens Project Settings on the Agents tab and creates no chat (the accepted Start-modal behavior).
6. While the profile list loads, the menu shows a non-actionable `Loading…` row; a failed load shows a non-actionable `Failed to load agent profiles.` row. Neither state creates a chat.
7. The menu closes on item activation, an outside click, Escape, or a further context-menu gesture (same overlay behavior as the project-row menu). A gesture while a menu is open closes the old menu first.

## Business rules

- One gesture creates at most one chat. Chat-name duplicates within a project stay allowed; identity is the chat id.
- Chat naming and the compact shell prefix follow the existing `[shell] profile name` contract, resolved at creation time.
- The application never writes a prompt into the shell; the agent receives its startup only as a process argv.
- Existing chats, project shell selection, Kanban Start/Resume prompt and launch semantics, and the plain `New Chat` flow stay unchanged. Profile availability follows the project opt-in contract.

## Authorization

`none` (local single-user app; same as the rest of the chat surface).

## Data / API

- [Session labels](../session-labels/spec.md) adds persisted launch-time agent identity to `ChatInfo` and owns left-navigation presentation. Stored `[shell] <profile name>` names and the launch argv rules below remain unchanged.

- Input: the gesture target (the per-project `New Chat` button) identifies the project; the profile choice is an `AgentProfile.id`.
- New typed IPC channel `chats:createWithAgent(projectId, profileId)` returning `ChatInfo`: main validates the project and profile, creates the named chat through the existing chat rules, spawns the profile in the chat's terminal (the same terminal launch path `kanban:launchTask` uses), and returns the created chat.
- The renderer reads effective project profiles through the typed bridge. The global-agent-profiles contract owns the API changes needed to resolve selected global definitions; main revalidates project selection before launch.
- Chat persistence uses the existing `chats` table. Profile persistence and migration are owned by global-agent-profiles.

### Interactive profile arguments (NEKODE-78)

- `AgentProfile` and `AgentProfilePut` support optional `interactiveArgs: string[]`. Absence retains the existing prompt-removal behavior; `[]` explicitly starts the executable without arguments. The field is the entire interactive argv, not a suffix appended to `args`.
- The executable is shared by task and interactive launches. For a Node-based CLI, interactive arguments must include its script path and any other required startup arguments.
- Profile configuration, validation, copying, and persistence follow [global agent profiles](../global-agent-profiles/spec.md#interactive-arguments-nekode-78). Saving a profile never starts its CLI.
- Profiles with prompt flags require explicit configuration: task `args: ['-q', '{prompt}']` with `interactiveArgs: []` launches Hermes without `-q`; task `args: ['-i', '{prompt}', '--model', 'configured-model']` with `interactiveArgs: ['--model', 'configured-model']` launches AGY without `-i`. These illustrate argv selection using the task's reported CLI forms, not new bundled templates or a guarantee about installed CLI versions.
- Existing profiles receive no automatic rewrite or inferred arguments. Codex and Grok profiles without `interactiveArgs` keep their existing positional-prompt behavior. Kanban Start/Resume always uses `args` with its task prompt substituted, even when `interactiveArgs` is present.

## Edge cases

- Profile removed between menu open and selection: typed `not_found` error, no chat created, notice shown.
- Project removed before the selection resolves: typed `not_found` error, no chat created.
- Spawn failure (missing executable, OS refusal): the just-created chat row is removed in the same main flow (rollback) and a typed error is surfaced as a notice; no chat or terminal remains and the `New Chat` affordance stays usable.
- The agent process exits right after start: the existing terminal-exit close flow applies to the chat like to any chat.

## Errors

Typed `AppError` payloads over the existing error transport; the renderer surfaces them through the notice banner with the typed message (fallback `Failed to start the agent chat.`). No silent fallback to a plain shell chat when the agent fails to start.

## Acceptance criteria

1. Right-click on the left panel's `New Chat` button opens a context menu listing the project's agent profile names; the gesture itself creates no chat.
2. ContextMenu / Shift+F10 on the focused button opens the same menu below the button.
3. Choosing a profile creates exactly one chat named `[shell] <profile name>` in that project, selects it, expands the project, activates the terminal-chat tab, and runs the profile's executable at the project root with `interactiveArgs` when defined, otherwise with only the `{prompt}` argv element removed.
4. Left-click on `New Chat` still creates a plain `[shell]` chat exactly as before.
5. With no profiles the menu shows `Configure agents`; activating it opens Project Settings on the Agents tab and creates no chat.
6. A failed launch (missing profile, removed project, spawn failure) creates no chat and surfaces a typed error in the notice banner.
7. The required tests below pass, and lint and typecheck pass.
8. Configured Hermes and AGY profiles launch from New Chat without their task-only prompt flags. An explicit empty override produces an empty argv; quoted values and required script paths survive unchanged.
9. Kanban Start and Resume keep the prompt flag and substitute exactly one prompt argument despite an interactive override. Codex and Grok without an override keep their existing argv selection.
10. The optional override survives save, reload, edit, and copy; disabling it restores the absent-field behavior. Invalid overrides are rejected before persistence or chat creation.

## Required tests

- Renderer (vitest): the menu opens on right-click and on keyboard invocation with the profile names; closes on Escape and outside click; selection calls `chats:createWithAgent` and adopts the chat (selected chat + terminal-chat tab); the empty state shows `Configure agents` and opens the Agents settings without creating a chat; loading and load-failure rows; the left-click regression (plain chat) stays green.
- Main: the launch path creates the named chat, uses explicit interactive arguments including `[]`, otherwise removes only `{prompt}`, rolls the chat back on spawn failure, and returns typed errors for a missing project or profile. Cover Hermes `-q`, AGY `-i` followed by another option, positional Codex/Grok prompts, and a Node script path. Prove Kanban Start/Resume ignores the override and preserves prompt substitution.
- Contract: IPC validation rejects malformed payloads; the preload routes the channel with the typed shape.
- Configuration: optional-array validation at IPC, service write, and stored-document read; UI enable/disable, empty override, quoting round-trip, edit/copy, and reload. A regression test must fail on the previous launch implementation.

## Relevant SDD / ADR

- `docs/architecture/sdd.md` §6, §44 (typed IPC pattern, main-process services). ADR: none.
