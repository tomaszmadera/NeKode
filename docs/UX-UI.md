# UX/UI Design Specification

## Agent-First Coding Workspace

**Status:** UX/UI Specification  
**Version:** 0.1  
**Language:** English only  
**Target platform:** Windows 11  
**Primary UI reference direction:** ZCode-inspired  
**Product model:** Project → Chat (Task is the post-MVP progress entity)  
**Primary MVP interaction model:** terminal-first agentic coding  
**Companion technical document:** `SDD.md`

---

# 1. Purpose

This document defines the user experience and user interface for a desktop application designed for **agentic software development**.

The application should feel like a focused coding control surface rather than a traditional IDE.

Its purpose is to make it easy to:

- switch between projects,
- switch between chats,
- resume existing chat work,
- launch coding agents in terminal sessions,
- inspect project files,
- see runtime and Git context,
- execute common project actions,
- organize work through Kanban,
- hand work off between sessions or agents,
- and resume from a handoff with one action.

The MVP remains terminal-first.

The application must not depend on ACP or another agent protocol for its core workflow.

Agents are primarily started and controlled through terminal sessions.

---

# 2. Product Experience Goal

The application should feel:

- calm,
- fast,
- deliberate,
- compact,
- modern,
- technical,
- satisfying to navigate,
- and visually quieter than a traditional IDE.

The experience should avoid:

- excessive chrome,
- deeply nested sidebars,
- visual clutter,
- permanently visible secondary panels,
- noisy animations,
- unnecessary badges,
- oversized toolbars,
- and dashboard overload.

The application should feel like:

> a workspace for managing coding work and agents

rather than:

> an IDE that happens to contain AI tools.

---

# 3. Core UX Principle

The central conceptual object in the MVP is the **Chat** (PROJEKT → CZATY; model change 2026-09-25).

A Chat appears as:

- an entry in the project tree,
- an active terminal workspace,
- a handoff target.

The **Task** is the future post-MVP entity for tracking work progress, pinned to a chat. It adds further representations:

- as a Kanban card,
- as a future Git worktree,
- as a future agent execution unit.

Task is reserved for that future entity; Kanban, worktree and progress sections use it in that sense.

---

# 4. Language

The entire application UI must use **English**.

Use:

- Projects
- Chats
- Files
- Kanban
- Resume
- Implement
- Execute
- Run
- Open
- Changes
- Worktree
- Runtime
- Branch
- Terminal
- Handoff
- Settings

Do not mix English and Polish labels.

---

# 5. Global Layout

The window has no top action band and no context header above the main surface (user decision 2026-09-26). The center column is one vertical stack: tab strip, action bar, main surface; the status bar spans the full window width at the very bottom.

```text
┌────────────────┬──────────────────────────────────────────┬──────────────┐
│ LEFT           │ CENTER                                   │ RIGHT        │
│ Navigation     │ Tab Strip                                │ hidden       │
│                │ [chat][files…][+ New chat]               │ by default   │
├────────────────┼──────────────────────────────────────────┼──────────────┤
│                │ Action Bar                               │              │
│                │ [Handoff|Resume] [Stop|Continue] ▶ …     │              │
├────────────────┼──────────────────────────────────────────┼──────────────┤
│                │ Main Surface                             │              │
│                │                                          │              │
├────────────────┴──────────────────────────────────────────┴──────────────┤
│ BOTTOM: Auxiliary Terminal / Tools                                       │
├──────────────────────────────────────────────────────────────────────────┤
│ STATUS BAR: gerde.pl · D:\Projects\gerde.pl · PHP 8.5 · [git icon] main · ● 4     │
└──────────────────────────────────────────────────────────────────────────┘
```

Semantics:

- **Left** — navigation between projects, chats and project contents.
- **Center** — one column, top-down: **tab strip** (the terminal-chat tab is always first, never closable, its label is the active chat's name; then open-file tabs, `+ New chat`), **action bar** (action row), the main active work surface.
- **Bottom** — auxiliary terminal and future tool panels.
- **Right** — secondary tools such as Browser or second Terminal.
- **Status bar** — project context: name, path, runtimes, Git branch and worktree status (§14–§16).

---

# 6. Default Application State

On startup, restore the most recent useful state when possible:

- last selected project,
- last selected chat,
- active center surface,
- left panel width,
- bottom panel state,
- bottom terminal height,
- right panel state,
- active terminal association.

If no prior state exists:

```text
Title bar:
NeKode (brand, full window width)

Left:
Projects

Center:
Welcome / empty state

Right:
Hidden

Bottom:
Hidden
```

---

# 7. Action Bar

The action bar (action row) sits directly below the tab strip in the center column, full width of the center column. Placement per user decision 2026-09-26: it is not a window-top band.

It is not a generic toolbar.

Its purpose is to expose frequently used actions for the current project.

Layout:

```text
[Handoff | Resume]   [Stop | Continue]   ▶ Docker Up   🧪 Tests   🚀 Deploy
```

The fixed groups come first, then the configurable actions.

Possible actions:

- Docker Up
- Docker Down
- Tests
- PHPStan
- Build
- Deploy
- Start Dev Server
- Open Logs
- Migrate
- Seed
- Lint

Actions may be global or project-specific.

Project-specific actions should change automatically when the selected project changes.

---

# 8. Action Bar Interaction

Buttons should be compact:

```text
[icon] Label
```

Do not require icons.

The fixed buttons write terminal input to the active chat terminal (through `terminals:write`):

```text
Handoff     Napisz handoff        + CR (0x0D)
Resume      Wznów z handoffu  + CR (0x0D)
Continue    Continue             + CR (0x0D)
Stop        Ctrl+C (0x03)
```

These strings are literal data; they are never localized or altered. `Stop` never sends Ctrl+D (0x04 closes chats). The four fixed buttons are enabled only while the active chat has a live terminal session.

Recommended states for configurable action buttons:

```text
▶ Docker Up      idle
◌ Docker Up      running
✓ Docker Up      success
✕ Docker Up      failed
```

Hover details show the command, exit code and completion time.

Do not show success toasts.

Actions may run:

- in background,
- in a new terminal (a new chat whose terminal receives the command).

The bottom-terminal run mode is no longer reserved: with the bottom auxiliary terminal panel shipped it is offered in the action form, and its execution contract lives in `docs/features/bottom-auxiliary-terminal/spec.md`.

---

# 9. Left Navigation — Default Mode

The default left navigation shows Projects and Chats. The application brand
lives in the continuous full-width window title bar with the Windows caption
buttons at the right end (user decision 2026-10-01); the left panel starts
with the "Projects" section header carrying an icon-only Add Project button
on the right.

```text
Projects                        +

▼ gerde.pl
    Fix Meta Pixel
    SEO Cleanup
    Hero Redesign

▼ knajpy
    Authentication
    Reviews
```

The hierarchy should remain intentionally shallow.

Do not reproduce a VS Code-style permanent Activity Bar.

---

# 10. Project and Chat Rows

Project row example:

```text
▼ gerde.pl
```

Possible context actions:

- Open
- New Chat
- Kanban
- Project Settings
- Remove Project
- Reveal in Explorer

Chat row examples:

```text
Fix Meta Pixel
● Fix Meta Pixel
✓ Fix Meta Pixel
◌ Fix Meta Pixel
```

Use compact status markers only when useful.

---

# 11. Left Navigation Modes

The left column may switch contextually between:

```text
Projects / Chats
Project Files
```

When entering the file tree:

```text
[icon] NeKode   ← (back affordance, "Back to Projects")

▼ app
  ▼ Http
    Controllers
  ▼ Models

▼ resources
▼ routes
composer.json
```

The user should always have a clear way back.

---

# 12. Navigation Animations

Transitions should feel polished but not distracting.

Target feeling:

> the interface understands where I am going

Recommended duration:

```text
140–220 ms
```

Recommended motion:

- 8–20 px horizontal movement,
- subtle opacity shift,
- ease-out deceleration.

Avoid:

- bounce,
- elastic motion,
- overshoot,
- large scale changes,
- long fades.

Projects/Chats → File Tree:

1. old content moves slightly left,
2. fades slightly,
3. new content enters from right,
4. header crossfades/morphs,
5. panel width remains stable.

Back navigation reverses the direction.

Respect reduced-motion settings.

---

# 13. Microinteractions

Use subtle motion for:

- project expansion,
- Chat switching,
- Files/Kanban switching,
- bottom terminal toggle,
- right panel toggle,
- Action execution state,
- Handoff opening,
- Handoff Resume.

Recommended movement:

```text
2–16 px
```

Avoid animated terminal text or large viewport movement.

---

# 14. Status Bar

The status bar sits at the very bottom of the window and spans its full width, below all other regions. It carries the project context previously shown in the center context header (relocation per user decision 2026-09-26 — there is no context header above the main surface).

Whenever the active center surface belongs to a Project, show a compact project/workspace context.

Example:

```text
gerde.pl
D:\Projects\gerde.pl   PHP 8.5   Node 24   Docker   [git icon] feature/meta-pixel   ● 4
```

Minimum data:

- Project name,
- path,
- runtime(s),
- Git branch,
- worktree/Git status.

Long paths should be truncated visually but shown fully on hover.

With no active project the project section is empty; the bar itself stays.

---

# 15. Runtime Display

Use compact badges:

```text
PHP 8.5
Node 24
Docker
Python 3.14
Unity 6
```

If there are too many:

```text
PHP 8.5   Node 24   Docker   +2
```

Runtime information is secondary context, not a headline.

---

# 16. Git Branch and Worktree Status

Branch:

```text
[git icon] main
[git icon] feature/meta-pixel
```

Status:

```text
✓ clean
● 7 changes
! 2 conflicts
```

Optional hover:

```text
Modified      4
Added         2
Deleted       0
Untracked     1
Conflicts     0
Ahead         3
Behind        0
```

---

# 17. Center Surface — Chat

When a Chat is selected, the center displays the Chat workspace.

MVP default:

```text
Primary Terminal
```

Example (the tab strip and action bar sit above the surface per §5; the project context lives in the status bar per §14):

```text
┌──────────────────────────────────────────────────────────────┐
│ Fix Meta Pixel                                               │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ PS D:\Projects\gerde.pl> codex                               │
│                                                              │
│ > Fix the invalid Meta Pixel currency warning                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

# 18. Center Surface — Project

When a Project is selected, show project-level navigation:

```text
Files   Kanban
```

Default:

```text
Files
```

Files and Kanban are sibling project views.

---

# 19. File Tree and File Preview

The Project Files view supports:

- expanding/collapsing folders,
- selecting files,
- read-only file preview,
- syntax highlighting,
- line numbers.

MVP does not require editing.

File transitions should be immediate with only a short crossfade when needed.

Large or binary files should show a safe fallback:

```text
This file is too large for preview.

Open externally
```

or:

```text
Binary file

Open externally
```

---

# 20. Bottom Auxiliary Terminal

Default shortcut:

```text
Ctrl + `
```

Behavior:

- open if hidden,
- hide if visible,
- preserve terminal process,
- preserve height,
- restore focus sensibly.

Recommended vertical animation:

```text
180–220 ms
```

Typical use:

- php artisan test
- git diff
- docker compose logs
- npm run lint

The primary chat terminal remains dedicated to the main coding session.

---

# 21. Right Panel

The right panel is hidden by default.

Future tools may include:

- Browser
- Second Terminal
- Changes
- Git
- Context
- Documentation
- Preview
- Agent Activity

When opened:

- slide in from the right,
- compress center surface,
- preserve left panel,
- preserve previous width.

---

# 22. Console Agent Model

The MVP treats coding agents as console applications.

Examples:

```text
codex
claude
opencode
agy
gemini
```

No ACP is required.

The app should introduce the concept of a **Console Agent** with:

- name,
- command,
- optional arguments,
- optional preferred working-directory behavior.

---

# 23. Default Console Agent

The user can configure a global default.

Example:

```text
Default Agent
Codex
```

Definition:

```text
Name:
Codex

Command:
codex
```

Whenever the user starts or resumes a chat without choosing another agent, use the default.

---

# 24. Agent Selection

Compact selector:

```text
Agent: Codex ▾
```

Dropdown:

```text
Codex              Default
Claude Code
OpenCode
agy
Gemini CLI
────────────────────────
Manage Agents…
```

Agent choice may exist:

- globally,
- at Project level,
- at Chat level,
- as a one-time override when implementing,
- as a one-time override when resuming a Handoff.

Resolution priority:

```text
Explicit one-time choice
↓
Chat preferred agent
↓
Project preferred agent
↓
Global default console agent
```

---

# 25. Starting and Resuming Chats

New Chat:

```text
Chat
Fix Meta Pixel

Agent
Codex ▾

[Start]
```

Chat with an active or resumable session:

```text
[Resume]
```

If the terminal exited and no Handoff exists:

```text
Session ended

[Restart]
[Choose Agent ▾]
```

If a Handoff exists:

```text
Session ended

[Resume from Handoff]
```

---

# 26. Kanban as a Primary Product Surface

Kanban is intended to become one of the major features of the application.

In the MVP, Kanban is a **visual-only preview of the future product**. The page should already communicate the intended information hierarchy, columns, realistic card designs, metadata, primary actions and visual states, but it must use static demonstration data rather than real Task records.

The goal is to let the user open Kanban and accurately judge how the future workflow will look and feel before that workflow is implemented.

Only navigation to/from the Kanban surface is functional in the MVP. Card-level workflow actions are post-MVP.

Project navigation:

```text
Files   Kanban
```

Future global navigation may also expose:

```text
Projects   Kanban
```

---

# 27. Project Kanban

Example:

```text
BACKLOG           TODO             IN PROGRESS        DONE

┌─────────────┐   ┌─────────────┐  ┌─────────────┐   ┌─────────────┐
│ SEO Audit   │   │ Fix Pixel   │  │ Auth Cleanup│   │ Docker Setup│
│             │   │             │  │             │   │             │
│ [Implement] │   │ [Implement] │  │ [Resume]    │   │             │
└─────────────┘   └─────────────┘  └─────────────┘   └─────────────┘
```

Initial columns:

- Backlog
- Todo
- In Progress
- Done

Likely future column:

- Review

---

# 28. Kanban Card

In the **functional post-MVP Kanban**, a Kanban card represents the Task entity pinned to a chat (see §3).

In the MVP, cards only **simulate** that future representation. They are static demonstration cards, are not backed by real Tasks, and do not need to stay synchronized with the project tree.

Possible compact metadata:

- preferred agent,
- branch,
- worktree,
- Handoff status,
- last activity,
- change count.

Do not show all metadata simultaneously.

Example:

```text
Fix Meta Pixel

[git icon] feature/meta-pixel
Codex

[Implement]
```

---

# 29. Kanban Primary Actions

The MVP should **show** the future primary actions in their intended locations so the complete card UX can be evaluated. These controls are demonstration UI only in MVP and must not start, resume, open or mutate real work.

Their functional behavior begins post-MVP.

For new coding work:

```text
Implement
```

For a generic non-coding Task, a future alternate label may be:

```text
Execute
```

For active or handed-off work:

```text
Resume
```

For completed work:

```text
Open
```

or no large primary action.

For coding-oriented Tasks, **Implement** should be the default label.

---

# 30. Post-MVP Implement Flow from Kanban

This section specifies the behavior to implement **after MVP**. In MVP, the `Implement` control may be visible on demonstration cards but does not execute this flow.

Post-MVP, clicking:

```text
Implement
```

should:

1. resolve the Task,
2. resolve/create the Workspace,
3. determine the agent,
4. open the Task in the center,
5. create the primary terminal if needed,
6. set the working directory,
7. start the selected Console Agent,
8. optionally prepare Task context,
9. later move the Task to In Progress when Kanban persistence is active.

If a default agent exists, one click should be enough.

For alternate agent choice:

```text
Implement ▾
```

or:

```text
Implement with…
```

Do not show an agent-selection modal every time.

---

# 31. Project Integration

Adding a Project should integrate a local development directory into the application.

Flow:

1. select local directory,
2. save Project,
3. detect Git repository,
4. detect runtime(s),
5. detect available project configuration,
6. load Chats,
7. load Actions,
8. expose Files and Kanban.

Primary empty-state action:

```text
Add Project
```

Future:

```text
Clone Repository
```

---

# 32. Project Settings

App Settings -> General includes "Uppercase project names in the tree"
(NEKODE-10), enabled by default. It changes only project labels in the
navigation tree; disabling it restores the original folder-name spelling.
The choice persists as `projects.namesUppercase` (`1` on, `0` off).

Application settings are separate from Project Settings. The App Settings
opener (gear icon with the label "App Settings") sits at the very bottom of
the left panel (user decision 2026-10-02, after Zed), in both modes that host
the panel: the projects navigation and the project files view. It opens App
Settings including when no project is selected or the project files view is
open. The dialog has two tabs: **General** (theme selector: `default` shown
as "NeKode Light", `default-beta-1` (the Cozy Dark palette: indigo surfaces,
lavender primary accent) and `nekode-float` shown as "NeKode Float", which
switches the shell to the floating layout: the title bar strip without its
separating hairline (the app name stays at the top-left beside the Windows
caption buttons), a detached rounded left panel with a gap to the center
column, file tabs attached to the top of the rounded frame around the center
content (the frame's top-left corner stays square where the first tab
attaches, and the shell panels round at 10px; user decision 2026-10-04),
and a terminal surface matching the app background color; terminal
font size; the "Switch chats with Ctrl+Tab" on/off
switch)
and **Shortcuts** (read-only documentation of every global and terminal
keyboard shortcut). Theme selection applies immediately and is remembered
locally across application restarts. Escape or the close button dismisses the
dialog and returns focus to the opener; Tab keeps focus inside the dialog and
cycles only the active tab's controls.

Possible sections:

```text
General
Agent
Actions
Terminal
Git
Kanban
Integrations
```

MVP may expose only:

```text
General
Agent
Actions
```

Project agent setting example:

```text
Preferred Agent

Use global default
Codex
Claude Code
OpenCode
agy
Gemini CLI
```

---

# 33. Handoffs

Handoffs are a first-class continuation mechanism.

A Handoff belongs to a Chat.

It captures enough information to continue work later or with another agent.

A Handoff should answer:

- What was being done?
- What is the current state?
- What remains?
- What should happen next?
- Which Project and Chat does it belong to?
- Which agent/session was used?
- Which branch/worktree is relevant?

Handoffs are not standalone notes detached from chats.

---

# 34. Handoff Placement

Handoffs may appear in:

1. Chat header,
2. Chat context menu,
3. Kanban card indicator,
4. Chat details,
5. Resume flow.

Kanban example:

```text
Fix Meta Pixel

Handoff available
Codex · 18 min ago

[Resume]
```

In the MVP Kanban, this is a **demonstration state only**. The card and its `Resume` button are not connected to a real Handoff. Functional Handoff Resume may exist elsewhere in the MVP, but **Resume from a Kanban card is post-MVP**.

---

# 35. Handoff Creation

Possible action:

```text
Create Handoff
```

Manual MVP-compatible form:

```text
Create Handoff

Summary
[................................]

Current State
[................................]

Next Steps
[................................]

Agent
Codex

[Save Handoff]
```

Future versions may generate Handoffs automatically from agent/session state.

Suggested data:

- Title
- Summary
- Current State
- Next Steps
- Relevant Files
- Branch
- Worktree
- Agent
- Created At
- Source Session
- Optional Resume Command
- Optional Agent Prompt

---

# 36. Resume from Handoff

This is a critical interaction.

Clicking:

```text
Resume
```

should automatically:

1. select the corresponding Project,
2. select the corresponding Chat,
3. restore/open the Chat workspace,
4. restore or create the primary terminal,
5. resolve the agent,
6. start the agent if required,
7. prepare Handoff context,
8. continue the Chat with minimal user interaction.

The user should not need to manually navigate through the application.

---

# 37. Handoff Agent Resolution

Priority:

```text
Explicitly selected agent
↓
Handoff preferred/source agent
↓
Chat preferred agent
↓
Project preferred agent
↓
Global default console agent
```

If the original agent is unavailable:

```text
Original agent is unavailable.

Resume with:
Codex ▾

[Resume]
```

---

# 38. Console-Agent Handoff Resume

Because MVP is terminal-first, Resume must not require ACP.

Possible implementation strategies:

### Prepared prompt

Generate continuation text and paste it into the agent terminal.

### Startup arguments

Use them if a specific agent supports them.

### Temporary Handoff file

Example:

```text
.agent-work/handoffs/<handoff-id>.md
```

Then start the agent with instructions to read it.

### Terminal paste after startup

Start the agent and inject the Handoff prompt when ready.

The UX should hide these implementation differences.

---

# 39. Handoff Resume UX

Preferred fast path:

```text
[Resume]
```

Immediate feedback:

```text
Resuming…
```

Then:

- Project selection updates,
- Chat selection updates,
- center surface transitions,
- terminal appears,
- agent startup begins.

Avoid a modal unless a required choice is missing.

Optional Resume preview:

```text
Resume Chat

Chat
Fix Meta Pixel

Agent
Codex

Branch
[git icon] feature/meta-pixel

Handoff
"Currency warning identified in checkout tracking.
Next: normalize currency value and rerun browser test."

[Resume]
```

---

# 40. Handoff History

Future Task detail:

```text
Handoffs

Sep 20 · 00:11
Sep 19 · 22:48
Sep 19 · 18:30
```

The most recent Handoff should be the default Resume target.

Older Handoffs remain inspectable.

---

# 41. Post-MVP Handoff + Kanban Behavior

This behavior applies when Kanban becomes Task-backed post-MVP. The MVP may visually demonstrate the same state using static cards, but no real Handoff resolution occurs from Kanban.

If a Task has an actionable Handoff, Kanban should prioritize:

```text
Resume
```

over:

```text
Implement
```

A paused Task may remain in:

```text
In Progress
```

Do not add a dedicated Paused column in the MVP.

---

# 42. Chat Header

Example:

```text
Fix Meta Pixel
gerde.pl · [git icon] feature/meta-pixel · PHP 8.5 · ● 3 changes

Agent: Codex ▾        Handoff ▾
```

Keep controls compact.

Possible Handoff menu:

```text
View Latest
Create New
Copy
Resume
History
```

---

# 43. Chat Context Menu

Recommended:

```text
Open
Resume
Rename
Change Agent
Create Handoff
Open Project Files
Open Kanban
Reveal Workspace
Terminate Terminal
Delete Chat
```

Only show actions relevant to the current state.

---

# 44. Kanban Navigation Animation

Files ↔ Kanban:

- smooth tab underline,
- short crossfade,
- optional 8–12 px horizontal shift.

Recommended duration:

```text
140–180 ms
```

Kanban hover should increase contrast and optionally reveal secondary actions.

Avoid large card scaling or spring animations.

---

# 45. Global Kanban — Future

A global Kanban may eventually aggregate Tasks from all Projects.

Example:

```text
BACKLOG            TODO              IN PROGRESS          DONE

[gerde] SEO        [knajpy] Auth     [neko] Settings      [gerde] Docker
[game] Terrain     [bot] Animations  [site] Refactor
```

Global cards should include Project identity.

Project Kanban cards do not need to repeat it.

---

# 46. Chat Creation

From Project:

```text
New Chat
```

The chat is created immediately, without a naming form: the name comes from the shell and duplicates are allowed.

Future from Kanban (post-MVP Task entity):

```text
+ Add Task
```

A future Task creation form may stay compact:

```text
New Task

Title
[ Fix Meta Pixel ]

Status
Todo

Agent
Use project default

[Create Task]
```

Description should remain optional.

---

# 47. Terminal Visual Design

Terminal should visually belong to the app:

- same background family,
- minimal chrome,
- compact title/header only if needed,
- clear focus state,
- normal xterm selection behavior.

Status examples:

```text
● Running
○ Exited
! Failed
```

Do not let status dominate the terminal surface.

---

# 48. Agent Switching

Changing agent on an active chat should be explicit.

If a process is running:

```text
A terminal session is currently active.

Start another agent in a new session?
```

Do not silently replace a running agent process.

---

# 49. Action Configuration

Project Settings → Actions.

Example:

```text
Actions

Docker Up
docker compose up -d
Background

Tests
php artisan test
New terminal

Deploy
bash scripts/deploy.sh
Background

[Add Action]
```

Add form:

```text
Add Action

Title
[ Docker Up ]

Icon
[ play ]

Command
[ docker compose up -d ]

Working Directory
Project Root

Run In
Background | New terminal

[ ] Ask for confirmation

[Save]
```

Dangerous actions may require confirmation.

Saved actions appear in the action bar immediately and survive application restarts. The `bottom-terminal` run mode is no longer reserved: with the bottom auxiliary terminal panel shipped it is offered in this form, and its execution contract lives in `docs/features/bottom-auxiliary-terminal/spec.md`.

---

# 50. Project File Navigation

Entering Project Files may transform the left panel into the Project file tree.

Clicking a file opens it in a file tab of the tab strip and shows it in the main surface: the tab label is the file name and the tab tooltip is the path relative to the project root (e.g. `app / Services / Billing.php`). The breadcrumb and the `Files` view label are superseded by the tab model (user decision 2026-09-26) and are not rendered.

Remember per Project:

- expanded tree nodes,
- open file tabs, their order and the active tab,
- last selected file,
- left-navigation sub-view,
- scroll position where practical.

---

# 51. Project and Chat Switch Animations

Project switch:

- update selection immediately,
- center content crossfade,
- status bar project context fade/change,
- 140–180 ms.

Chat switch:

- minimal active-row animation,
- terminal surface switch,
- no animation of terminal text,
- 80–140 ms.

Same chat, local surface change:

- short crossfade.

Project → Chat:

- subtle horizontal transition.

Chat → Chat:

- almost immediate crossfade.

---

# 52. Focus Management

Rules:

- opening a chat should focus the terminal when appropriate,
- opening bottom terminal should focus it,
- hiding bottom terminal should restore previous focus,
- dialogs trap focus,
- closing dialogs restores focus to the invoking control.

---

# 53. Keyboard Shortcuts

Required (implemented):

```text
Ctrl + `          Toggle bottom terminal
Ctrl + Tab        Next chat (across all projects)
Ctrl + Shift+Tab  Previous chat (across all projects)
Ctrl + N          New chat in the active project (full create path: created,
                  selected, terminal shown; no-op with a notice without an
                  active project)
```

Ctrl+Tab can be turned off in App Settings → General ("Switch chats with
Ctrl+Tab"). Ctrl+N has no off switch: it duplicates the always-visible
"+ New chat" affordance. All app chords work while a terminal is focused and
are never written to a PTY; they no-op while a modal dialog is open and ignore
key auto-repeat. App Settings → Shortcuts documents this table in the UI.

Terminal-surface chords (ChatTerminal, both chat and bottom-auxiliary
terminals): Ctrl+C copy-or-abort, Ctrl+Shift+C copy, Ctrl+V / Ctrl+Shift+V
paste, Ctrl+D close-chat-at-empty-prompt / delete-char, Ctrl+U clear input
line (see the terminal sections for the exact gates).

App Settings -> General has "Use Ctrl+V to paste text in terminals", enabled
by default and saved locally. It applies immediately to chat and bottom-panel
terminals, including full-screen programs such as Codex. Disabling it lets
full-screen programs handle Ctrl+V themselves (for example, Vim block
selection); Ctrl+V still pastes at a shell prompt. Ctrl+Shift+V always pastes
text. Both paste chords use the terminal's text-paste path and insert once.

Recommended future:

```text
Ctrl + P         Quick Open
Ctrl + K         Command Palette
Ctrl + Shift + K Open Kanban
Ctrl + Shift + H Create Handoff
```

---

# 54. Visual Hierarchy

Priority:

1. current Chat or Project,
2. current work surface,
3. relevant context,
4. project Actions,
5. secondary tools.

Do not visually prioritize:

- app logo,
- Settings,
- runtime badges,
- Git counters,
- decorative status.

---

# 55. Typography and Density

Recommended UI sizing:

```text
Main UI:        13–14 px
Secondary text: 12–13 px
Terminal:       15 px default (configurable: 8-32 px)
Project title:  14–15 px
```

Use compact spacing based on:

```text
4
8
12
16
24
```

Avoid oversized dashboard spacing.

---

# 56. Borders, Corners and Color

Use:

- subtle separators,
- slightly differentiated dark surfaces,
- small focus outlines,
- restrained 4–8 px corner radius.

Avoid:

- boxes around every element,
- thick borders,
- large shadows,
- highly saturated selection backgrounds.

Dark-first color strategy.

Use semantic color only where it provides real information.

---

# 57. Hover and Active States

Hover:

- subtle background change,
- text contrast increase,
- secondary icon reveal.

Active selection:

- subtle filled background,
- narrow accent indicator.

Avoid large scaling or floating effects.

---

# 58. Loading and Errors

Prefer localized loading states:

```text
Detecting runtime…
Loading files…
Refreshing Git status…
Starting terminal…
Resuming chat…
```

Avoid full-screen spinners.

Errors should be actionable.

Example:

```text
Could not start Codex

Command:
codex

The command was not found.

[Configure Agent]
[Open Terminal]
```

Missing Project:

```text
Project directory is unavailable

D:\Projects\gerde.pl

[Locate Directory]
[Remove Project]
```

---

# 59. Empty States

No Projects:

```text
No projects yet

Add a local project to start working.

[Add Project]
```

Chat without session:

```text
Fix Meta Pixel

No active session

Agent
Codex ▾

[Start]
```

Chat with Handoff:

```text
Fix Meta Pixel

Handoff available

[Resume]
```

Kanban empty column:

```text
No tasks in Todo

Create a task or move one here.
```

---

# 60. Worktree UX Direction

Future Tasks may use independent Git worktrees.

Example:

```text
Fix Meta Pixel
[git icon] feature/meta-pixel
.worktrees/meta-pixel
```

Task mental model:

```text
Task
├── Workspace
│   ├── cwd
│   ├── branch
│   └── worktree
├── Agent
├── Terminal
├── Handoff
└── Kanban state
```

The UI should hide most of this complexity unless relevant.

---

# 61. Repository Project Configuration — Future

Possible project configuration directory:

```text
.agentcode/
```

Potential files:

```text
actions.yaml
project.yaml
agents.yaml
```

Repository commands must never auto-run.

First execution may show:

```text
This action comes from the project repository:

Deploy
bash scripts/deploy.sh

[Cancel]
[Run Once]
[Trust Project Actions]
```

---

# 62. Future External Integrations

The UX should leave room for:

- GitHub
- GitLab
- Linear
- Jira
- issue trackers
- CI/CD
- ACP agents
- MCP tools
- remote repositories

External work items should map into local Tasks rather than create a parallel model.

Example:

```text
GitHub Issue #123
        ↓
Local Task
        ↓
Workspace
        ↓
Agent
        ↓
Handoff
```

---

# 63. Accessibility

Minimum requirements:

- keyboard navigation,
- visible focus rings,
- sufficient contrast,
- reduced-motion support,
- no status communicated only by color,
- accessible names for icon-only controls,
- preserve terminal accessibility where supported.

---

# 64. Window Resizing

Priority when width shrinks:

1. preserve center work surface,
2. reduce optional metadata,
3. collapse right panel,
4. narrow left panel,
5. hide low-priority context badges.

Recommended dimensions:

```text
Left default:   260–300 px
Left minimum:   ~220 px
Right default:  360–480 px
Bottom default: 220–300 px
```

Remember user sizing preferences.

---

# 65. Responsive Status Bar Context

The status bar project context adapts to window width.

Wide:

```text
D:\Projects\gerde.pl   PHP 8.5   Node 24   Docker   [git icon] feature/meta-pixel   ● 4
```

Narrow:

```text
gerde.pl   PHP 8.5   [git icon] feature/meta-pixel   ● 4
```

Very narrow:

```text
gerde.pl   [git icon] feature/meta-pixel
```

Use progressive disclosure.

---

# 66. MVP UX Scope

The MVP should support:

## Projects

- Add Project
- Remove Project
- Switch Project
- Project tree

## Chats

- Create Chat (immediate, no naming form; the name comes from the shell)
- Delete Chat (closing the terminal removes the chat)
- Switch Chat
- Keep Chat terminal alive during app lifetime

## Terminal

- primary chat terminal
- bottom auxiliary terminal
- `Ctrl + `` toggle
- concurrent sessions

## Files

- file tree
- read-only preview

## Context

- path
- runtime
- branch
- worktree/Git status

## Actions

- configurable Action Bar
- command execution

## Agents

- Default Console Agent
- select another configured agent
- launch agent in chat terminal

## Kanban

- Project Kanban visual preview
- target columns
- realistic static demonstration cards that look like future Task cards
- visible future controls such as `Implement`, `Resume` and `Open`
- representative future metadata/states where useful
- navigation to/from Kanban
- **no real Task binding**
- **no functional Kanban card actions or state transitions**

## Handoffs

At minimum, UX should support:

- one latest Handoff per Chat,
- manual Handoff content,
- Resume action,
- agent resolution,
- reopening/starting the chat terminal.

---

# 67. MVP Kanban Example

The following cards are **static demonstration data**, not real Tasks. Buttons are shown to validate placement and hierarchy; they do not execute the future workflow in MVP.

```text
BACKLOG             TODO                IN PROGRESS             DONE

┌──────────────┐    ┌──────────────┐    ┌────────────────┐    ┌──────────────┐
│ SEO Audit    │    │ Fix Pixel    │    │ Auth Cleanup   │    │ Docker Setup │
│              │    │              │    │ Codex          │    │              │
│ [Implement]  │    │ [Implement]  │    │ Handoff ready  │    │              │
└──────────────┘    └──────────────┘    │ [Resume]       │    └──────────────┘
                                         └────────────────┘
```

---

# 68. Complete Layout Example

The tab strip and the action bar occupy the top of the center column; the status bar spans the window at the very bottom (user decision 2026-09-26 — no top action band, no context header).

```text
┌──────────────────┬───────────────────────────────────────────┬───────────────┐
│ Projects         │ [Fix Pixel] [web.php] [+ New chat]        │ RIGHT PANEL   │
├──────────────────┼───────────────────────────────────────────┼───────────────┤
│ ▼ gerde.pl       │ [Handoff|Resume] [Stop|Continue] ▶ …      │ hidden        │
│   Fix Pixel      │                                           │ by default    │
│   SEO Cleanup    │ MAIN SURFACE                              │               │
│   Hero Redesign  │                                           │ Browser       │
│                  │ Chat: Fix Pixel                           │ Terminal      │
│ ▼ knajpy         │ Agent: Codex ▾                            │ future        │
│   Authentication │                                           │               │
│   Reviews        │ PS D:\dev\gerde> codex                    │               │
│                  │ ...                                       │               │
├──────────────────┴───────────────────────────────────────────┴───────────────┤
│ AUXILIARY TERMINAL                                             Ctrl + `      │
├──────────────────────────────────────────────────────────────────────────────┤
│ STATUS BAR  gerde.pl  D:\dev\gerde  PHP 8.5  [git icon] main  ● 3                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

# 69. Project Files Layout Example

```text
┌──────────────────┬───────────────────────────────────────────────────────────┐
│ [icon] NeKode  ← │ [Fix Pixel] [Billing.php] [web.php] [+ New chat]       │
├──────────────────┼───────────────────────────────────────────────────────────┤
│                  │ [Handoff|Resume] [Stop|Continue] ▶ Docker Up              │
├──────────────────┼───────────────────────────────────────────────────────────┤
│ ▼ app            │                                                           │
│   ▼ Services     │  1 <?php                                                  │
│     Billing.php  │  2                                                        │
│                  │  3 namespace App\Services;                                │
│ ▼ routes         │  ...                                                      │
│   web.php        │                                                           │
│ composer.json    │                                                           │
├──────────────────┴───────────────────────────────────────────────────────────┤
│ gerde.pl · D:\dev\gerde · PHP 8.5 · [git icon] main · ✓ clean                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

The file tab tooltip shows the path relative to the project root (here: `app / Services / Billing.php`); the breadcrumb and the `Files` view label are not rendered (tab model per `docs/features/center-layout-tabs-actions/spec.md`).

---

# 70. Kanban Layout Example

This is the intended MVP visual preview. The cards, Handoff indicator and buttons below are illustrative only; the functional Task-backed behavior is post-MVP.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Fix Pixel] [Billing.php] [+ New chat]                                       │
├──────────────────────────────────────────────────────────────────────────────┤
│ [Handoff|Resume] [Stop|Continue] ▶ Docker Up  Tests                          │
├──────────────────────────────────────────────────────────────────────────────┤
│ BACKLOG           TODO             IN PROGRESS           DONE                │
│                                                                              │
│ ┌─────────────┐   ┌─────────────┐  ┌─────────────────┐  ┌──────────────┐     │
│ │ SEO Audit   │   │ Fix Pixel   │  │ Auth Cleanup    │  │ Docker Setup │     │
│ │             │   │             │  │ Codex           │  │              │     │
│ │ [Implement] │   │ [Implement] │  │ Handoff ready   │  │              │     │
│ └─────────────┘   └─────────────┘  │ [Resume]        │  └──────────────┘     │
│                                    └─────────────────┘                       │
├──────────────────────────────────────────────────────────────────────────────┤
│ gerde.pl · D:\dev\gerde · PHP 8.5 · [git icon] main · ● 3                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

The Kanban visual preview fills the main surface; how it is reached and how it integrates with the tab model is decided with the future Kanban work (see `§18`).

---

# 71. Post-MVP Handoff Resume Flow from Kanban Example

This flow is **not implemented from Kanban in MVP**. The MVP only shows where the `Resume` control and Handoff state will appear on a demonstration card.

```text
Kanban
  ↓
Task: Auth Cleanup
  ↓
[Resume]
  ↓
Resolve Project
  ↓
Resolve Workspace
  ↓
Resolve Agent
  ↓
Open Task
  ↓
Open/restore terminal
  ↓
Start Codex if needed
  ↓
Inject Handoff context
  ↓
Continue work
```

The user should experience this as one action.

---

# 72. Design Principle: Satisfying, Not Distracting

Good:

- subtle hierarchy slides,
- smooth panel opening,
- gentle tab motion,
- compact active-state transitions,
- immediate Resume feedback.

Bad:

- springy cards,
- bouncing buttons,
- large zooms,
- animated gradients,
- long page transitions,
- flashing status.

---

# 73. Design Principle: Preserve Spatial Memory

When possible:

- Projects remain in stable positions,
- Chats remain under Projects,
- Files retain expansion state,
- panel widths remain stable,
- tabs do not reorder,
- terminal position remains predictable.

This supports muscle memory.

---

# 74. Design Principle: One Click to Continue

Ideal return-to-work flow:

```text
Open app
↓
click Chat
```

or:

```text
click Resume on Handoff
```

The application should restore the rest automatically.

---

# 75. Design Principle: Agent Choice Without Friction

Support:

```text
Global default
Project default
Chat override
One-time override
```

The user remains in control without repetitive prompts.

---

# 76. Design Principle: Protocol-Agnostic MVP

Essential workflows must remain fully functional using only:

```text
shell + terminal
```

No ACP, structured tool events or direct LLM integration is required for the MVP.

---

# 77. Navigation Summary

```text
LEFT
Projects
└── Chats

PROJECT CLICK
→ Files / Kanban

CHAT CLICK
→ Chat Terminal

KANBAN CARD — MVP
→ visual demonstration only
→ Open / Implement / Resume controls are visible but non-functional

KANBAN CARD — POST-MVP
→ Open Task
→ Implement
→ Resume

HANDOFF outside Kanban
→ Resume Chat automatically where supported by MVP scope

ACTION BAR (below the tab strip)
→ Handoff | Resume, Stop | Continue + Project Actions

BOTTOM
→ Auxiliary Terminal

STATUS BAR
→ Project context (name, path, runtimes, Git)

RIGHT
→ Hidden / future tools
```

---

# 78. Key UX Decisions

1. The application UI is English only.
2. The left panel defaults to Projects → Chats.
3. Project navigation can transition into a File Tree view.
4. These transitions use subtle, satisfying animations.
5. Chat selection opens/restores the Chat work surface.
6. The MVP Chat work surface is primarily a terminal.
7. A configurable Default Console Agent exists.
8. The user may choose another configured agent.
9. Project context exposes path, runtime, branch and worktree/Git status.
10. The configurable Project Action Bar is the action row below the tab strip in the center column (placement revised by user decision 2026-09-26).
11. `Ctrl + `` toggles the auxiliary bottom terminal.
12. The right panel is hidden by default.
13. Files and Kanban are primary Project views.
14. The MVP Kanban is a visual-only preview using static demonstration cards, not real Tasks.
15. MVP demonstration cards show the intended future `Implement`, `Resume` and `Open` controls, but those controls do not execute Kanban workflows.
16. In the functional post-MVP Kanban, cards represent the Task entities pinned to chats and the previewed controls become functional.
17. Handoffs belong to Chats.
18. `Resume` from Handoff automatically reopens the correct Project, Chat, Workspace and agent workflow.
19. Handoff Resume works with console agents and does not require ACP.
20. Motion improves orientation and satisfaction without becoming distracting.

---

# 79. Post-MVP Direction

Future UX may expand with:

- Functional Task-backed Project Kanban
- Kanban `Implement` / `Resume` / `Open` workflows
- Kanban state persistence and transitions
- Kanban integration with Workspace, Console Agent, Handoff and checkpoint state
- Global Kanban
- Browser panel
- Second terminal
- Git Changes
- Task-specific worktrees
- Agent activity timeline
- Structured ACP agents
- MCP tools
- Issue tracker integration
- GitHub/GitLab integration
- Automated Handoff generation
- Review workflows
- Parallel agent execution
- Remote runtime host

All future features should extend the same:

```text
Project → Chat → Task (→ Workspace)
```

model.

---

# 80. Product Summary

The application is an **agent-first coding workspace**.

Its defining UX is:

- project-centered,
- chat-centered,
- terminal-native,
- Kanban-aware,
- Handoff-aware,
- agent-flexible,
- visually calm,
- and optimized for quickly continuing real development work.

The long-term functional core loop is:

```text
Choose Project
↓
Choose or create Chat
↓
Implement with default console agent
↓
Work in terminal
↓
Inspect files / Git state
↓
Run project actions
↓
Create Handoff when pausing
↓
See Task on Kanban
↓
Resume later with one click
```

The MVP should already feel coherent enough for daily use before direct agent protocols, advanced automation or multi-agent orchestration are introduced. However, the Kanban portion of that experience is intentionally a visual preview only: its cards and card actions do not participate in the real Task workflow until post-MVP.

---

# 81. Task Progress / Checkpoint Timeline

Each Task may expose a compact visual representation of its current implementation progress.

The component should represent work as a sequence of **checkpoints** rather than as a generic percentage-only progress bar.

Conceptual example:

```text
●────────●────────●────────○────────○
Plan     Inspect  Implement Test     Review
                  ↑
               current
```

Alternative compact form:

```text
Plan        Inspect        Implement        Test        Review
 ●────────────●──────────────●──────────────○────────────○
```

Completed checkpoints use a completed state. The current checkpoint is visually emphasized. Future checkpoints remain inactive.

# 82. Checkpoint Semantics

A checkpoint represents a meaningful stage in the Task lifecycle. Default examples:

```text
Plan
Inspect
Implement
Test
Review
Done
```

The list must not be hard-coded. Different Tasks may use different stages.

Examples:

Frontend Task:

```text
Inspect
Implement
Run
Visual Check
Review
```

Backend Task:

```text
Analyze
Implement
Test
Static Analysis
Review
```

Deployment Task:

```text
Prepare
Build
Deploy
Verify
Complete
```

# 83. Checkpoint States

Recommended states:

```text
pending
active
completed
failed
blocked
skipped
```

Visual meaning:

```text
○ Pending
● Active
✓ Completed
✕ Failed
! Blocked
– Skipped
```

Do not communicate state using color alone.

# 84. Progress Calculation

The UI may derive an approximate percentage from checkpoint completion, but the primary representation should remain checkpoint-based.

Example:

```text
3 of 5 checkpoints completed
60%
```

Percentage is secondary. Avoid false precision such as `63.4%` unless the underlying process genuinely provides that precision.

# 85. Unknown Progress

Agentic coding frequently has uncertain progress. The component must support cases where:

- the number of remaining steps is unknown,
- the agent discovers new work,
- a checkpoint needs to be reopened,
- additional checkpoints are inserted.

Example:

```text
●──────●──────●──────◉
Plan   Inspect Implement Investigating…
```

In this state, do not fabricate a completion percentage. Prefer:

```text
3 checkpoints completed
Current: Investigating
```

# 86. Dynamic Checkpoints

Future structured agent integrations may allow the checkpoint list to evolve during execution.

Initial:

```text
Plan
Implement
Test
```

After inspection:

```text
Plan
Database Migration
API Change
Tests
Review
```

New checkpoints should appear with a subtle fade/slide and must not visually reset previous progress.

# 87. MVP Checkpoint Source

Because the MVP is terminal-first and protocol-agnostic, it must not depend on agents automatically reporting structured progress.

MVP-compatible sources:

1. manually defined Task checkpoints,
2. default checkpoint templates,
3. lightweight user updates,
4. placeholder/demo checkpoint state for UX validation.

Example default:

```text
Plan
Implement
Test
Review
```

The feature must remain useful without ACP or structured agent events.

# 88. Future Automatic Checkpoint Updates

Post-MVP agent integrations may update checkpoints automatically from:

- structured agent events,
- plans,
- tool execution,
- test results,
- Git state,
- Handoffs,
- explicit agent status updates.

Example:

```text
Plan completed
↓
Implement active
```

or:

```text
Tests failed
↓
Test checkpoint becomes failed
↓
Implement checkpoint becomes active again
```

Checkpoint transitions should reflect real work state, not elapsed time.

# 89. Checkpoint Interaction

Hovering or clicking a checkpoint may reveal lightweight details:

```text
Implement

Status:
Completed

Completed:
10:42

Summary:
Updated Meta Pixel currency normalization.

Files:
CheckoutTracker.php
MetaPixelService.php
```

Detailed history is post-MVP. The default view must remain compact.

# 90. Potential Placement

The final placement is intentionally not fixed yet. The component should work in several locations.

## Option A — Task Header

```text
Fix Meta Pixel
gerde.pl · [git icon] feature/meta-pixel · PHP 8.5

●────●────●────○────○
Plan Inspect Implement Test Review
```

Advantages:

- always visible while working,
- strongly associated with the active Task,
- does not consume sidebar space.

## Option B — Directly Above the Main Task Surface

```text
Task context
────────────────────────────────────────

●────●────●────○────○
Plan Inspect Implement Test Review

────────────────────────────────────────
Terminal
```

Advantages:

- highly visible,
- natural representation of ongoing execution,
- works well with terminal-first UX.

## Option C — Task Details / Secondary Panel

Advantages:

- keeps the main terminal maximally clean,
- better for richer checkpoint metadata.

Disadvantage:

- less visible during normal work.

## Option D — Compact Header + Expanded Details

Recommended long-term pattern:

```text
Header:
● 3/5 · Implementing

Click:
expand full checkpoint timeline
```

This provides visibility without permanently consuming vertical space.

# 91. Recommended Placement Direction

For the current design, prefer a **compact checkpoint progress strip in the Task header area**, with optional expansion.

Example:

```text
Fix Meta Pixel
gerde.pl · [git icon] feature/meta-pixel · PHP 8.5 · ● 3 changes

●────●────●────○────○
Plan Inspect Implement Test Review

Agent: Codex ▾        Handoff ▾
```

If vertical space becomes too expensive, collapse it into:

```text
Progress: ● 3/5 · Implementing
```

Clicking it expands the full timeline. The component architecture must not assume one permanent location.

# 92. Kanban Progress Indicator

Kanban cards may show a compact version of Task progress.

In the MVP Kanban, any progress/checkpoint value shown on a card is static demonstration data only. Live synchronization with real Task checkpoints is post-MVP.

Example:

```text
Auth Cleanup

Codex
●●●○○  3/5

[Resume]
```

or:

```text
Auth Cleanup

Implementing · 3/5

[Resume]
```

Do not render the full labeled timeline on normal Kanban cards.

# 93. Handoff and Checkpoints

A Handoff should preserve checkpoint state.

Example:

```text
Current checkpoint:
Test

Completed:
Plan
Inspect
Implement

Remaining:
Test
Review
```

When resumed from a Handoff:

1. restore checkpoint state,
2. highlight the previously active checkpoint,
3. continue from that state,
4. do not reset progress to the first checkpoint.

# 94. Checkpoint Failure and Recovery

Failed checkpoint:

```text
✓ Plan ─ ✓ Inspect ─ ✓ Implement ─ ✕ Test ─ ○ Review
```

If implementation resumes after test failure:

```text
✓ Plan ─ ✓ Inspect ─ ● Implement ─ ! Test ─ ○ Review
```

The timeline must support non-linear correction. Do not imply that software work always moves monotonically forward.

# 95. Checkpoint Motion Design

Checkpoint transitions should be subtle.

Recommended:

- connector fill animates over 120–180 ms,
- checkpoint state crossfades,
- current-state emphasis changes gently,
- new checkpoints fade/slide by 4–8 px.

Avoid:

- continuous pulsing,
- glow animations,
- bouncing checkpoint circles,
- animated gradients.

# 96. Checkpoint Accessibility

Requirements:

- readable labels without requiring hover,
- state represented through icon/shape plus color,
- keyboard focus for interactive checkpoints,
- accessible state labels such as `Plan, completed`, `Implement, current`, `Test, pending`,
- reduced-motion preference respected.

# 97. Checkpoint Empty State

If a Task has no defined checkpoints, do not show an empty progress bar.

Possible action:

```text
Add Progress Steps
```

or simply hide the component.

The Task remains fully usable without checkpoints.

# 98. Checkpoint UX Principle

The progress timeline should answer:

```text
Where are we?
What has already been completed?
What is currently being worked on?
What remains?
```

It should not pretend to answer:

```text
Exactly how much time remains?
```

unless reliable timing data exists.

The feature is an **orientation and continuation tool**, not a productivity metric.
