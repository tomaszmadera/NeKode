# Software Design Document (SDD)

## Agent-First Coding Environment

**Status:** MVP Design Specification  
**Version:** 0.1  
**Document:** `SDD.md`  
**Target platform:** Windows 11  
**Primary implementation stack:** Electron + React + TypeScript  
**Primary interaction model in MVP:** terminal-first, without ACP  
**UI reference direction:** ZCode-inspired, minimal, workspace-oriented  
**Primary domain objects:** Project, Chat, Terminal Session (Task is the post-MVP progress entity, see §14)

---

# 1. Purpose

This document defines the software design for a desktop application intended for **agentic software development**.

The application is not intended to be a traditional IDE clone. Its primary role is to provide a clean desktop workspace for:

- organizing software projects,
- organizing project chats,
- running coding agents through terminal-based interfaces,
- restoring active chat workspaces,
- browsing project files,
- executing frequently used project actions,
- observing Git/worktree state,
- and, in later versions, managing agent work through a Kanban-oriented workflow.

In the MVP, coding agents are treated as ordinary terminal applications.

Examples:

- Codex CLI,
- Claude Code,
- OpenCode,
- agy,
- Gemini CLI,
- local coding harnesses,
- shell scripts,
- PowerShell,
- Bash,
- SSH sessions.

The application does **not** need to understand their protocols in the MVP.

---

# 2. Product Philosophy

The application should be designed around the following principle:

> The central object is a Chat representing a running work session in a project. Terminal sessions, files, Git context, actions and agent CLIs are resources or representations associated with that Chat.

Terminology (model change 2026-09-25): the MVP tree entity is the **Chat** (PROJEKT → CZATY), a terminal session attached to a project whose name is derived from the shell. **Task** denotes the future post-MVP entity for tracking work progress, pinned to a chat. Sections about the functional Kanban, worktrees and progress use Task in that future sense.

The application should therefore avoid becoming:

> VS Code with another skin and a chat panel.

Instead it should become:

> an agent-first coding workspace and project control surface.

---

# 3. MVP Scope

The MVP SHALL provide:

1. Project management.
2. Chat management inside projects (PROJEKT → CZATY).
3. Persistent chat-to-terminal associations during the application session.
4. Multiple simultaneously running terminal sessions.
5. Project file tree.
6. Read-only file preview.
7. Configurable project action controls.
8. Project/workspace context information:
   - path,
   - detected runtimes,
   - Git branch,
   - Git worktree status.
9. Auxiliary bottom terminal.
10. Keyboard shortcut `Ctrl + `` for toggling the bottom terminal.
11. Visual-only Project Kanban preview using static demonstration data. The preview SHALL show the intended future columns, representative Task cards, metadata and controls such as `Implement` and `Resume`, but those cards SHALL NOT be backed by real Task records and those Kanban controls SHALL NOT execute the future workflow.
12. Application state persistence.
13. Resizable primary layout regions.

The MVP SHALL NOT implement:

- ACP,
- MCP integration,
- direct LLM APIs,
- custom agent protocol,
- LSP,
- IntelliSense,
- source code editing,
- semantic repository indexing,
- embeddings,
- multi-agent orchestration,
- browser panel functionality,
- Git operations UI,
- functional Kanban-to-Task binding,
- Kanban card workflow execution (`Implement`, `Resume`, `Open`),
- Kanban state persistence or state mutation,
- Kanban-driven Workspace/Agent/Handoff execution,
- automatic task-to-worktree creation,
- remote agent host,
- cloud sync.

These may be introduced later without invalidating the MVP architecture.

---

# 4. Proposed Technology Stack

## 4.1 Desktop Runtime

Use:

- Electron

Reasons:

- first-class Node.js integration,
- process spawning,
- PTY support,
- filesystem access,
- Git integration,
- mature desktop tooling,
- compatibility with terminal-based developer workflows,
- straightforward future integration with ACP, MCP, LSP and local agent processes.

---

## 4.2 Frontend

Use:

- React
- TypeScript
- Vite
- Tailwind CSS
- xterm.js
- Monaco Editor in read-only mode

Recommended additional libraries:

- Zustand or TanStack Store for UI state,
- TanStack Router if routing becomes useful,
- Lucide for icons,
- Radix UI or Base UI for accessible primitives.

The initial UI should remain deliberately lightweight.

---

## 4.3 Desktop/Core Layer

Use:

- Node.js
- TypeScript
- Electron IPC
- `node-pty`
- `chokidar`
- Git CLI or a small Git wrapper
- SQLite

Recommended SQLite library:

- `better-sqlite3`

The MVP should prefer simple synchronous persistence over unnecessary infrastructure.

---

# 5. High-Level Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│                       Electron Desktop                           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Renderer                                                   │  │
│  │                                                            │  │
│  │ React UI                                                   │  │
│  │ ├── Project/Chat navigation                                │  │
│  │ ├── Main workspace surface                                 │  │
│  │ ├── File tree / file preview                               │  │
│  │ ├── Terminal views                                         │  │
│  │ ├── Action Bar                                             │  │
│  │ └── Kanban visual preview                                │  │
│  └──────────────────────┬─────────────────────────────────────┘  │
│                         │ IPC                                    │
│  ┌──────────────────────▼─────────────────────────────────────┐  │
│  │ Electron Main / Application Core                           │  │
│  │                                                            │  │
│  │ ProjectService                                             │  │
│  │ ChatService                                                │  │
│  │ WorkspaceService (post-MVP)                                │  │
│  │ TerminalService                                            │  │
│  │ FileService                                                │  │
│  │ GitService                                                 │  │
│  │ RuntimeDetectionService                                    │  │
│  │ ActionService                                              │  │
│  │ PersistenceService                                         │  │
│  └──────────────────────┬─────────────────────────────────────┘  │
│                         │                                        │
│       ┌─────────────────┼───────────────────────┐                │
│       ▼                 ▼                       ▼                │
│     PTY/processes     filesystem               SQLite            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

# 6. Architectural Rule: Renderer Must Not Own OS Capabilities

The Electron renderer must not directly execute shell commands or access unrestricted filesystem APIs.

All privileged functionality must go through narrowly defined IPC APIs exposed through the Electron preload bridge.

Example:

```ts
window.app.projects.list()
window.app.projects.add(...)
window.app.chats.create(...)
window.app.terminals.create(...)
window.app.terminals.write(...)
window.app.git.getStatus(...)
window.app.files.read(...)
window.app.actions.execute(...)
```

Do not expose raw Node.js APIs to the renderer.

Recommended Electron configuration:

```ts
contextIsolation: true
nodeIntegration: false
sandbox: true // where practical
```

---

# 7. Primary UI Layout

The application uses a five-region conceptual layout (user decision 2026-09-26: no window-top action band and no context header above the main surface):

```text
┌────────────────┬──────────────────────────────────────────┬──────────────┐
│ LEFT           │ CENTER                                   │ RIGHT        │
│ Projects       │ Tab Strip                                │ hidden       │
│ and Chats      │ [chat][files…][+ New chat]               │ by default   │
├────────────────┼──────────────────────────────────────────┼──────────────┤
│                │ Action Bar                               │              │
│                │ [Handoff|Resume] [Stop|Continue] ▶ …     │              │
├────────────────┼──────────────────────────────────────────┼──────────────┤
│                │ Main Surface                             │              │
│                │                                          │              │
├────────────────┴──────────────────────────────────────────┴──────────────┤
│ BOTTOM: Auxiliary Terminal                                               │
├──────────────────────────────────────────────────────────────────────────┤
│ STATUS BAR: gerde.pl · D:\Projects\gerde.pl · PHP 8.5 ·  main · ● 4     │
└──────────────────────────────────────────────────────────────────────────┘
```

Semantics:

- **LEFT** — work navigation.
- **CENTER** — one column, top-down: **tab strip** (the terminal-chat tab is always first, never closable, its label is the active chat's name; then open-file tabs, `+ New chat`), **action bar** (action row), **main surface**.
- **RIGHT** — secondary tools, hidden by default.
- **BOTTOM** — auxiliary terminal/tools.
- **STATUS BAR** — project context (name, path, runtimes, Git branch and worktree status — §9), full window width at the very bottom of the window.

---

# 8. Left Panel

## 8.1 Purpose

The left panel is the primary navigation surface.

Default hierarchy:

```text
Projects
│
├── Project A
│   ├── Chat A
│   ├── Chat B
│   └── Chat C
│
├── Project B
│   ├── Chat A
│   └── Chat B
│
└── Project C
```

The left panel should remain intentionally minimal.

Do not turn it into a generic IDE navigation rail.

---

## 8.2 Project Click Behavior

Clicking a project opens its project view in the center.

MVP project view contains:

- project file tree,
- file preview,
- access to the Kanban visual preview.

---

## 8.3 Chat Click Behavior

Clicking a Chat opens or restores the Chat's current work surface.

For the MVP:

> Chat work surface = primary terminal session associated with that Chat.

The terminal process must remain running when the user switches to another chat.

---

# 9. Project Context: Status Bar

The project context is presented in the status bar: the full-width bar at the very bottom of the window, below all other regions. The former center context header is removed (relocation per user decision 2026-09-26). With no active project the project section of the status bar is empty; the bar itself stays.

Example:

```text
gerde.pl
D:\Projects\gerde.pl   PHP 8.5   Node 24   Docker   feature/meta-pixel   ● 4
```

Minimum information:

- project name,
- filesystem path,
- detected runtime(s),
- active Git branch,
- worktree status.

---

## 9.1 Git Status Presentation

Examples:

Clean:

```text
 main    ✓ clean
```

Modified:

```text
 feature/auth    ● 7 changes
```

Conflict:

```text
 merge/payment    ! 2 conflicts
```

Optional hover details:

```text
Modified:   4
Added:      2
Deleted:    0
Untracked:  1
Conflicts:  0
Ahead:      3
Behind:     0
```

---

## 9.2 Runtime Detection

Runtime detection should initially be heuristic and inexpensive.

Potential sources:

### PHP

Detect:

```text
composer.json
```

Possible runtime sources:

- local `php --version`,
- Composer platform configuration,
- Docker configuration.

### Node.js

Detect:

```text
package.json
.nvmrc
.node-version
```

### Python

Detect:

```text
pyproject.toml
requirements.txt
.python-version
```

### Docker

Detect:

```text
Dockerfile
docker-compose.yml
docker-compose.yaml
compose.yml
compose.yaml
```

### Unity

Detect:

```text
ProjectSettings/ProjectVersion.txt
```

Return a structure rather than a single string:

```ts
interface RuntimeInfo {
    id: string
    name: string
    version?: string
    source: string
}
```

Example:

```ts
[
    {
        id: "php",
        name: "PHP",
        version: "8.5",
        source: "local"
    },
    {
        id: "node",
        name: "Node",
        version: "24",
        source: ".nvmrc"
    },
    {
        id: "docker",
        name: "Docker",
        source: "compose.yaml"
    }
]
```

---

# 10. Main Surface Model

Do not call the center area `Editor`.

Use a generic abstraction such as:

```ts
type MainSurface =
    | ProjectSurface
    | FileSurface
    | TerminalSurface
    | KanbanSurface
```

Possible post-MVP surfaces:

```ts
type FutureMainSurface =
    | DiffSurface
    | BrowserSurface
    | AgentSurface
    | PlanSurface
    | ReviewSurface
```

---

# 11. Project Surface

When a project is selected, show project-level navigation.

MVP recommendation:

```text
[ Files ]   [ Kanban ]
```

Default tab:

```text
Files
```

The Project Surface should own project-level views rather than chat-specific terminal workspaces.

---

# 12. File Tree

The project file tree must support:

- folder expansion/collapse,
- file selection,
- lazy loading where practical,
- ignored directory filtering,
- configurable exclusion patterns.

Default exclusions may include:

```text
.git
node_modules
vendor
.idea
.vscode
dist
build
coverage
```

However, this exclusion list should be configurable later.

---

# 13. File Preview

When a user clicks a file:

- open it in the center,
- display it read-only,
- use Monaco Editor,
- apply syntax highlighting where supported,
- for a markdown file, offer `Code` and `Preview` in the action row (`Preview` is the default rendered Markdown, `Code` is Monaco; user decision 2026-10-06, contract in `docs/features/project-files-view/spec.md`),
- do not implement editing in the MVP.

Requirements:

```text
read-only
line numbers
syntax highlighting
scrolling
large-file protection
```

Large files should not freeze the renderer.

The application may refuse or truncate previews above a safe configured threshold.

---

# 14. Task Model (post-MVP)

The central MVP domain object is the **Chat**: a terminal session attached to a project, named after the shell, creatable and removable through `ChatService` (§38). The Chat has no workflow state of its own.

The **Task** is the future post-MVP entity for tracking work progress, pinned to a chat (requirements.md). Its design so far:

```ts
interface Task {
    id: string
    projectId: string
    chatId: string

    title: string
    description?: string

    status:
        | "backlog"
        | "todo"
        | "in-progress"
        | "done"

    workspaceId?: string

    branch?: string
    worktreePath?: string

    createdAt: string
    updatedAt: string
}
```

Although `branch` and `worktreePath` do not need active management when the Task entity lands, fields or architectural support should be anticipated.

---

# 15. Task and Kanban Relationship

For the **functional post-MVP Kanban**, a Kanban card and a Task must refer to the same domain object.

Do not create separate production domain types such as:

```text
TerminalTask
KanbanTask
```

Instead, the target model is:

```text
Task
├── terminal workspace
├── Kanban representation
├── future branch
├── future worktree
└── future agent
```

This is a major architectural constraint for the functional Kanban.

### MVP exception: demonstration cards

The MVP Kanban is intentionally **visual-only**. Its cards are static demonstration data used to validate layout, hierarchy, density and future controls. They are **not real Task records**, do not need database persistence, and do not need to reference entities from the project tree (the MVP tree shows chats).

This exception exists only for the MVP preview. Once Kanban becomes functional post-MVP, every real Kanban card MUST represent the same underlying `Task` entity used elsewhere in the application.

---

# 16. Workspace Model

A Workspace represents the execution context associated with a Task.

Suggested model:

```ts
interface Workspace {
    id: string
    taskId: string
    projectId: string

    cwd: string

    branch?: string
    worktreePath?: string

    createdAt: string
    updatedAt: string
}
```

The Workspace abstraction intentionally separates a Task from a specific terminal process.

Future Workspace resources may include:

```text
primary agent
terminal #1
terminal #2
browser
preview
files
Git diff
context data
```

---

# 17. Terminal Architecture

## 17.1 Technology

Use:

- xterm.js in renderer,
- `node-pty` in Electron main/core.

---

## 17.2 Terminal Session Model

```ts
interface TerminalSession {
    id: string
    workspaceId?: string
    projectId: string
    chatId?: string

    kind:
        | "chat-primary"
        | "auxiliary"
        | "secondary"

    shell: string
    cwd: string

    status:
        | "starting"
        | "running"
        | "exited"
        | "failed"

    pid?: number
    exitCode?: number

    createdAt: string
}
```

---

## 17.3 Primary Chat Terminal

For the MVP:

```text
Chat
  ↓
Primary Terminal Session
```

Example:

```text
Chat: Implement OAuth
       ↓
Codex CLI running inside PowerShell
```

The Workspace layer (§16) is a post-MVP refinement between the chat and its terminal.

The application does not need to know that Codex is running.

It only owns the terminal session.

---

## 17.4 Switching Chats

Assume:

```text
Chat A → PTY A
Chat B → PTY B
Chat C → PTY C
```

When switching from Chat A to Chat B:

1. Do not terminate PTY A.
2. Stop rendering PTY A.
3. Render/attach PTY B.
4. Preserve scrollback.
5. Preserve PTY dimensions as needed.
6. Keep background processes alive.

Returning to Chat A should show the same terminal process and state.

---

# 18. Application Restart and Terminal Persistence

Two levels of persistence must be distinguished.

## 18.1 Required in MVP

Within one application lifetime:

- Chat switching does not kill terminal sessions.

After application restart:

- project list is restored,
- chats are restored,
- active project/chat is restored,
- terminal metadata may be restored,
- terminal history may optionally be restored,
- live processes do not need to survive.

This is acceptable for the MVP.

---

## 18.2 Post-MVP Target

Future architecture should allow:

```text
Electron UI
     │
     │ RPC
     ▼
Terminal Host / Daemon
     │
     ├── PTY Chat A
     ├── PTY Chat B
     └── PTY Chat C
```

Benefits:

- Electron restart does not kill coding agents,
- auto-update can restart the UI,
- detached long-running coding tasks remain active,
- future remote UI becomes possible.

The MVP must avoid coupling the data model so tightly to Electron main that extraction becomes unnecessarily difficult.

---

# 19. Bottom Auxiliary Terminal

The center area may contain a bottom panel.

Default shortcut:

```text
Ctrl + `
```

Behavior:

- toggle auxiliary terminal panel,
- preserve terminal session when hidden,
- maintain size between opens,
- allow drag-resize vertically.

Example:

```text
┌──────────────────────────────────────┐
│ Primary Chat Terminal                │
│                                      │
│ Codex working...                     │
│                                      │
├──────────────────────────────────────┤
│ Auxiliary Terminal                   │
│ $ php artisan test                   │
└──────────────────────────────────────┘
```

Purpose:

- run tests,
- inspect Git,
- view logs,
- manually execute scripts,
- debug issues without interrupting the primary coding-agent terminal.

---

# 20. Right Panel

The right panel exists structurally in the MVP but is hidden by default.

No functional right-panel tools are required in the MVP.

Potential future tools:

```text
Browser
Second terminal
Git
Changes
Context
Agent activity
Documentation
Preview
```

The layout implementation should make this panel easy to activate later.

---

# 21. Action Bar

The **Project Action Bar** is the action row directly below the tab strip in the center column, full width of the center column. Placement per user decision 2026-09-26: it is not a window-top band.

Order: the fixed groups `Handoff | Resume` and `Stop | Continue`, then configurable project actions.

Example:

```text
[Handoff | Resume]   [Stop | Continue]   ▶ Docker Up   🧪 Tests   🚀 Deploy
```

Purpose:

- send fixed agent-communication input to the active chat terminal,
- execute frequent project commands with one click,
- act as a project-specific control surface,
- expose common operations without requiring terminal typing.

---

# 22. Action Definition

Suggested model:

```ts
interface ActionControl {
    id: string

    scope:
        | "global"
        | "project"

    projectId?: string

    title: string
    icon?: string

    command: string
    cwd?: string

    runMode:
        | "background"
        // shipped with the bottom auxiliary terminal panel:
        // contract: docs/features/bottom-auxiliary-terminal/spec.md
        | "bottom-terminal"
        | "new-terminal"

    confirm?: boolean

    sortOrder: number
}
```

---

# 23. Action Execution Modes

## 23.1 Background

Example:

```text
docker compose up -d
```

The command runs without attaching the output to a visible terminal.

UI should report:

```text
running
success
failure
exit code
```

---

## 23.2 Bottom Terminal

The action:

1. opens the bottom terminal if hidden,
2. runs the configured command,
3. streams output to the terminal.

Recommended default for commands where output matters.
Shipped with the bottom auxiliary terminal panel: the execution contract (opens the panel, adds a new bottom tab in the active project, writes the command plus CR once the terminal is ready, reports delivery success with a null exit code) lives in `docs/features/bottom-auxiliary-terminal/spec.md`.

Examples:

```text
docker compose up
php artisan test
npm run build
```

---

## 23.3 New Terminal

Create a new independent terminal session and execute the action there.

Useful for:

```text
npm run dev
docker compose logs -f
php artisan queue:work
```

This mode may remain minimal in the MVP.

---

# 24. Action Status

Controls should support visual execution state.

Example:

```text
▶ Docker Up
```

Running:

```text
◌ Docker Up
```

Successful:

```text
✓ Docker Up
```

Failed:

```text
✕ Docker Up
```

Optional hover details:

```text
docker compose up -d

Exit code: 0
Completed: 12 seconds ago
```

Long-running processes may use:

```text
● Docker
● Vite
```

---

# 25. Action Configuration UI

The MVP should preferably provide a basic GUI rather than requiring manual JSON editing.

Example:

```text
Add Action

Title:
[ Docker Up ]

Icon:
[ play ]

Command:
[ docker compose up -d ]

Working directory:
[ Project root ]

Run in:
(*) Background
( ) New terminal

[ ] Ask for confirmation

[ Save ]
```

Persistence may still use JSON or SQLite internally.
The action form offers Background, New terminal, and Bottom terminal. Saved actions keep the mode they already have.

---

# 26. Repository-Based Action Configuration

Post-MVP, allow project action configuration to live inside the repository.

Possible convention:

```text
.agentcode/
    actions.yaml
```

Example:

```yaml
actions:
  - title: Docker Up
    icon: play
    command: docker compose up -d
    run: bottom-terminal

  - title: Tests
    icon: flask
    command: docker compose exec app php artisan test
    run: bottom-terminal

  - title: Deploy
    icon: rocket
    command: bash scripts/deploy.sh
    run: bottom-terminal
    confirm: true
```

This enables project controls to travel with the repository.

Repository configuration must not silently execute commands without user action.

---

# 27. Kanban

Kanban is intended to become one of the application's main features.

In the MVP it is a **visual product preview**, not a functional workflow. It exists to establish and validate:

- layout,
- navigation,
- column structure,
- card hierarchy and density,
- representative metadata,
- placement and visual treatment of future controls such as `Implement`, `Resume` and `Open`,
- future product direction.

The MVP Kanban SHALL use static demonstration data. It SHALL NOT read from or mutate the real Task collection, and its cards SHALL NOT trigger agent, Workspace, Terminal, Handoff or status-transition workflows.

The purpose is that a user can open the Kanban page and accurately see how the future feature is intended to look before the functional process is implemented.

---

# 28. MVP Kanban Location

Implement a **Project Kanban** first.

When a project is selected:

```text
[ Files ]   [ Kanban ]
```

Example:

```text
┌────────────────────────────────────────────────────────────────────┐
│ gerde.pl                                                           │
│ D:\Projects\gerde   PHP 8.5    main   ● 3 changes                │
├────────────────────────────────────────────────────────────────────┤
│ Files     Kanban                                                   │
│           ──────                                                   │
│                                                                    │
│ BACKLOG       TODO           IN PROGRESS       DONE                │
│                                                                    │
│ ┌─────────┐  ┌───────────┐  ┌──────────────┐  ┌──────────────┐   │
│ │ SEO     │  │ Fix Pixel │  │ Auth cleanup │  │ Docker setup │   │
│ │         │  │           │  │ Codex        │  │              │   │
│ │Implement│  │Implement  │  │Resume        │  │ Open         │   │
│ └─────────┘  └───────────┘  └──────────────┘  └──────────────┘   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

# 29. MVP Kanban Visual Scope

Required:

- route to/from the Kanban view,
- display the intended project Kanban columns,
- display realistic placeholder cards using static demonstration data,
- visually match the intended future Task cards,
- show representative future metadata where useful,
- show the intended placement and styling of future primary controls such as `Implement`, `Resume` and `Open`,
- provide hover/focus/disabled or preview states needed to evaluate the UX.

The MVP Kanban is **not functionally connected to the Task system**. Placeholder cards may use realistic names and states, but they are not real Tasks.

Explicitly not required in MVP:

- binding Kanban cards to persisted Task records,
- opening a real Task from a placeholder card,
- executing `Implement`, `Resume` or `Open` from Kanban,
- creating or restoring a Workspace from Kanban,
- starting a Console Agent from Kanban,
- Handoff resolution from Kanban,
- drag and drop,
- Kanban persistence,
- card editing,
- card creation,
- automatic or manual Kanban state transitions,
- agent integration,
- live progress/checkpoint integration.

If the UI renders `Implement`, `Resume`, `Open`, agent names, Handoff indicators or progress values in MVP, they are **demonstration UI only** and MUST NOT imply that the underlying process is implemented.

Suggested initial columns:

```text
Backlog
Todo
In Progress
Done
```

A future `Review` column is likely valuable.

---

# 30. Global Kanban — Future

Future versions should support a global cross-project board.

Example:

```text
BACKLOG            TODO              IN PROGRESS          DONE

[gerde] SEO        [knajpy] Auth     [neko] Settings      [gerde] Docker
[game] Terrain     [bot] Animations  [site] Refactor
```

Project Kanban:

```text
all tasks from one project
```

Global Kanban:

```text
tasks from all projects
```

They must use the same Task data model.

---

# 31. Post-MVP Functional Kanban + Agent Integration

The complete Kanban workflow begins **post-MVP**. At that point, placeholder cards are replaced by real Task-backed cards and the controls shown in the MVP preview become functional.

Future task cards may expose:

```text
Fix Meta Pixel

● Codex
feature/meta-pixel

Working · 12m
+4 -2
```

Or:

```text
Refactor authentication

✓ Agent finished
38 tests passed

Ready for review
```

Potential lifecycle:

```text
TODO
  ↓ start task
IN PROGRESS
  ↓ agent finished
REVIEW
  ↓ user accepts
DONE
```

This complete Task/Kanban/agent workflow is a post-MVP product direction and must not be implemented in the MVP. The MVP may visually preview these states and controls using static demonstration data only.

---

# 32. Project Model

```ts
interface Project {
    id: string

    name: string
    path: string

    createdAt: string
    updatedAt: string

    lastOpenedAt?: string
}
```

Potential future fields:

```ts
interface FutureProjectFields {
    defaultShell?: string
    preferredRuntime?: string
    configPath?: string

    gitRemote?: string

    tags?: string[]
}
```

---

# 33. Application Layout State

Persist layout state.

Suggested model:

```ts
interface AppLayoutState {
    leftPanel: {
        width: number
    }

    rightPanel: {
        open: boolean
        width: number
        view?: "browser" | "terminal"
    }

    bottomPanel: {
        open: boolean
        height: number
        view: "terminal"
    }

    activeProjectId?: string
    activeChatId?: string

    projectSurface?: "files" | "kanban"
}
```

---

# 34. Persistence

Use SQLite for application state.

Persist at minimum:

- projects,
- chats,
- workspaces (post-MVP),
- action controls,
- terminal metadata,
- UI layout state,
- last selected project,
- last selected chat,
- selected project surface,
- panel sizes.

Potential tables:

```text
projects
chats
workspaces (post-MVP)
terminal_sessions
actions
settings
layout_state
```

---

# 35. Suggested SQLite Schema

Conceptual only.

```sql
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_opened_at TEXT
);

CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    cwd TEXT NOT NULL,
    branch TEXT,
    worktree_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE terminal_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    chat_id TEXT,
    workspace_id TEXT,
    kind TEXT NOT NULL,
    shell TEXT NOT NULL,
    cwd TEXT NOT NULL,
    status TEXT NOT NULL,
    pid INTEGER,
    exit_code INTEGER,
    created_at TEXT NOT NULL
);

CREATE TABLE actions (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    scope TEXT NOT NULL,
    title TEXT NOT NULL,
    icon TEXT,
    command TEXT NOT NULL,
    cwd TEXT,
    run_mode TEXT NOT NULL,
    confirm INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
);
```

Migration tooling should be used from the beginning.

---

# 36. Service Layer

Recommended core services:

```text
ProjectService
ChatService
WorkspaceService (post-MVP)
TerminalService
FileService
GitService
RuntimeDetectionService
ActionService
PersistenceService
SettingsService
```

---

# 37. ProjectService

Responsibilities:

- add project,
- remove project,
- list projects,
- validate project path,
- open project,
- load project metadata.

Example API:

```ts
interface ProjectService {
    list(): Promise<Project[]>

    add(path: string): Promise<Project>

    remove(projectId: string): Promise<void>

    get(projectId: string): Promise<Project>
}
```

---

# 38. ChatService

Responsibilities:

- create chat (no naming form: the name comes from the shell, duplicates allowed),
- delete chat,
- list project chats.

Example:

```ts
interface ChatService {
    list(projectId: string): Promise<Chat[]>

    create(projectId: string): Promise<Chat>

    remove(chatId: string): Promise<void>
}
```

Chat rename and workflow status (`backlog`/`todo`/`in-progress`/`done`) are not chat concerns: rename is a deferred usability item, and status belongs to the post-MVP Task entity (§14).

---

# 39. TerminalService

Responsibilities:

- create PTY,
- write to PTY,
- resize PTY,
- terminate PTY,
- stream output,
- track process lifecycle,
- associate terminal with its chat,
- create auxiliary terminals.

Example:

```ts
interface TerminalService {
    create(input: CreateTerminalInput): Promise<TerminalSession>

    write(
        terminalId: string,
        data: string
    ): Promise<void>

    resize(
        terminalId: string,
        cols: number,
        rows: number
    ): Promise<void>

    terminate(
        terminalId: string
    ): Promise<void>
}
```

Output should use event-based IPC.

---

# 40. FileService

Responsibilities:

- list project directory,
- read file,
- enforce project path boundary,
- apply ignored paths,
- protect renderer from giant files.

Security requirement:

A renderer request associated with Project A must not be allowed to read arbitrary files outside Project A without an explicitly supported operation.

---

# 41. GitService

MVP requirements:

- detect whether repository is Git-controlled,
- get active branch,
- get status summary,
- calculate:
  - modified,
  - added,
  - deleted,
  - untracked,
  - conflicted,
  - ahead,
  - behind where practical.

Suggested API:

```ts
interface GitStatus {
    isRepository: boolean

    branch?: string

    clean: boolean

    modified: number
    added: number
    deleted: number
    untracked: number
    conflicted: number

    ahead?: number
    behind?: number
}
```

The MVP does not need to stage, commit, checkout or merge.

---

# 42. RuntimeDetectionService

Responsibilities:

- inspect known project files,
- optionally call safe local version commands,
- return runtime metadata.

Detection should be asynchronous and cached.

Do not run expensive detection continuously.

Suggested refresh triggers:

- project opened,
- explicit refresh,
- relevant configuration file changed.

---

# 43. ActionService

Responsibilities:

- validate action,
- resolve working directory,
- execute action,
- route command to correct execution mode,
- expose execution state,
- terminate long-running action where supported.

Do not concatenate user-controlled shell fragments internally unless the action is explicitly defined as a shell command.

Action execution is inherently privileged and should remain explicit.

---

# 44. IPC Design

Avoid one generic IPC endpoint such as:

```text
execute(method, args)
```

Prefer explicit IPC domains.

Example:

```text
projects:list
projects:add
projects:remove

chats:list
chats:create
chats:remove

terminals:create
terminals:write
terminals:resize
terminals:terminate
terminals:data
terminals:exit

files:list
files:read

git:status

runtime:detect

actions:list
actions:create
actions:update
actions:delete
actions:execute
```

All payloads should have shared TypeScript types.

---

# 45. Package Structure

Recommended monorepo layout:

```text
apps/
    desktop/

packages/
    ui/
    core/
    protocol/
    persistence/

    project/
    chat/
    workspace/
    terminal/
    git/
    runtime/
    actions/
```

Simpler MVP variant:

```text
src/
    main/
        services/
        ipc/
        persistence/

    preload/

    renderer/
        components/
        features/
        stores/

    shared/
        types/
        ipc/
```

Prefer the simpler layout unless the codebase grows enough to justify package extraction.

---

# 46. Renderer Feature Structure

Suggested:

```text
renderer/
    app/

    features/
        projects/
        chats/
        files/
        terminal/
        actions/
        kanban/
        workspace-context/

    components/
        layout/
        common/

    stores/

    hooks/
```

Feature boundaries should follow product concepts rather than technical categories where possible.

---

# 47. UI State vs Persistent State

UI state:

- active tabs,
- open dialogs,
- hover states,
- terminal dimensions,
- transient action status.

Persistent state:

- projects,
- chats,
- actions,
- selected project,
- selected chat,
- panel dimensions,
- panel visibility.

PTY process state is runtime state, not durable application data.

---

# 48. Keyboard Shortcuts

MVP:

```text
Ctrl + `      Toggle bottom terminal
```

Recommended future shortcuts:

```text
Ctrl + P      Project/file quick open
Ctrl + K      Command palette
Ctrl + Shift+K Kanban
Ctrl + Shift+T New chat
```

Do not add large shortcut systems before core workflows stabilize.

---

# 49. Visual Design Direction

The UI should be:

- dark-first,
- minimal,
- low visual noise,
- dense enough for developers,
- not overloaded with borders,
- clear about hierarchy,
- inspired by ZCode rather than VS Code.

Guidelines:

- use subtle separators,
- avoid deeply nested toolbars,
- avoid excessive icon-only controls,
- keep secondary panels hidden until needed,
- prioritize the active chat/workspace.

---

# 50. Error Handling

UI errors must be actionable.

Examples:

Instead of:

```text
Command failed.
```

show:

```text
Docker Up failed

Command:
docker compose up -d

Exit code:
1

Open output
```

Instead of:

```text
Failed to open project.
```

show:

```text
Project directory is no longer available:

D:\Projects\foo

[Locate directory]
[Remove project]
```

---

# 51. Logging

Implement structured application logging.

Minimum categories:

```text
application
ipc
projects
chats
terminal
filesystem
git
runtime
actions
persistence
```

Do not log terminal input by default because it may contain credentials or secrets.

Do not persist environment variables or secret-bearing process arguments unnecessarily.

---

# 52. Security Considerations

The application executes arbitrary local shell commands by design.

Therefore:

1. Explicit user-configured actions are trusted local automation.
2. Repository action files must never auto-run on repository open.
3. Imported project configuration should be treated as untrusted until the user triggers a command.
4. Renderer must not have unrestricted Node access.
5. File operations should enforce allowed roots.
6. Browser integration, when added later, must be isolated from privileged Electron APIs.
7. Command output should be handled as text, never interpreted as HTML.
8. URLs opened from terminal output must not execute local commands.

---

# 53. Performance Requirements

The UI should remain responsive while:

- multiple terminals run,
- large command output is streamed,
- Git status is refreshed,
- directories are scanned.

Key rules:

- throttle terminal rendering where appropriate,
- debounce filesystem watchers,
- cache runtime detection,
- avoid recursive full-project scans on every render,
- lazy-load file trees,
- run Git operations outside the renderer.

---

# 54. File Watching

Use `chokidar` only where needed.

MVP watchers may monitor:

- visible project directories,
- runtime configuration files,
- Git metadata indirectly through periodic/debounced Git refresh.

Avoid watching every dependency directory.

Default ignore candidates:

```text
.git/objects
node_modules
vendor
dist
build
cache
```

---

# 55. Git Refresh Strategy

Suggested:

1. refresh on project open,
2. refresh after configured actions complete,
3. debounce refresh after filesystem changes,
4. optional low-frequency refresh while project is active.

Do not run `git status` continuously at high frequency.

---

# 56. Worktree Direction

MVP does not need automatic worktree handling.

However, future architecture should support:

```text
Project
│
├── Task: OAuth
│   └── worktree: .worktrees/oauth
│       └── branch: feature/oauth
│
├── Task: Payments
│   └── worktree: .worktrees/payments
│       └── branch: feature/payments
│
└── Task: Tests
    └── worktree: .worktrees/tests
        └── branch: test/refactor
```

This is especially valuable for parallel agentic coding.

Do not hard-code Tasks to the project root.

Use:

```ts
Workspace.cwd
```

as the actual execution path.

---

# 57. MVP User Flow: Add Project

```text
Open app
  ↓
Add Project
  ↓
Select directory
  ↓
Project saved
  ↓
Project appears in left panel
  ↓
Project selected
  ↓
Files view opens
  ↓
Runtime + Git context detected
```

---

# 58. MVP User Flow: Create Chat

```text
Project context
  ↓
Create Chat (no naming form)
  ↓
Chat created (name from the shell)
  ↓
Primary terminal created
  ↓
Chat opens in center
```

The chat terminal initially uses the project path as `cwd`.

---

# 59. MVP User Flow: Agent via CLI

Example:

```text
Chat: Fix authentication

Primary terminal:

PS D:\Projects\app> codex
```

From this moment, Codex is simply a child process inside the chat terminal.

The application does not parse the agent protocol.

---

# 60. MVP User Flow: Switch Chats

```text
Chat A active
  ↓
Click Chat B
  ↓
Chat A PTY remains alive
  ↓
Chat B PTY appears
  ↓
Click Chat A
  ↓
same Chat A PTY restored
```

This behavior is required.

---

# 61. MVP User Flow: Auxiliary Terminal

```text
Agent running in primary chat terminal
  ↓
Ctrl + `
  ↓
bottom terminal opens
  ↓
user runs:
php artisan test
  ↓
Ctrl + `
  ↓
terminal hides without being terminated
```

---

# 62. MVP User Flow: Project Action

```text
Click "Tests"
  ↓
ActionService resolves command
  ↓
bottom terminal opens
  ↓
command executes
  ↓
output visible
  ↓
Git status stays as-is (no command-end detection; it refreshes
on a project selection change)
```

---

# 63. MVP User Flow: Kanban Visual Preview

```text
Select Project
  ↓
Click Kanban tab
  ↓
Project Kanban appears
  ↓
static demo columns/cards rendered
  ↓
future controls such as Implement / Resume are visible for UX validation
  ↓
return to Files tab
```

Only navigation into/out of the Kanban view is functional. The cards are not real Tasks, and Kanban card controls do not execute any workflow in the MVP.

---

# 64. Acceptance Criteria

The MVP is considered technically complete when all criteria below are met.

## Projects

- [ ] User can add a local project directory.
- [ ] User can remove a project.
- [ ] Projects persist after restart.
- [ ] Projects appear in the left panel.

## Chats

- [ ] User can create a Chat inside a Project (name from the shell, duplicates allowed).
- [ ] User can delete a Chat by closing its terminal.
- [ ] Chats persist after restart.
- [ ] Chats appear under their Project.

## Terminal

- [ ] Opening a Chat creates or restores its primary terminal.
- [ ] Multiple chat terminals can run simultaneously.
- [ ] Switching Chats does not terminate their PTYs.
- [ ] Terminal input works correctly.
- [ ] ANSI colors work correctly.
- [ ] Terminal resize works.
- [ ] Terminal exit is detected.
- [ ] Terminal process can be manually terminated.

## Auxiliary Terminal

- [ ] `Ctrl + `` toggles the bottom terminal.
- [ ] Hiding it does not terminate its process.
- [ ] User can resize the bottom panel.

## Files

- [ ] Selecting a Project shows a directory tree.
- [ ] Folders can be expanded.
- [ ] Files can be selected.
- [ ] Selected text files open read-only.
- [ ] Large/binary files are handled safely.

## Status Bar

- [ ] Current project name is displayed.
- [ ] Current path is displayed.
- [ ] Git branch is displayed when available.
- [ ] Git status is displayed when available.
- [ ] Detected runtimes are displayed.

## Action Bar

- [ ] User can define a project action.
- [ ] Action has title.
- [ ] Action may have icon.
- [ ] Action has command.
- [ ] Action can execute in background, in a new terminal, or in a bottom terminal.
- [ ] Action status is visible.

## Kanban

- [ ] Project view contains Files/Kanban navigation.
- [ ] Kanban view renders the intended project columns.
- [ ] Kanban view renders realistic static demonstration cards.
- [ ] Demonstration cards visibly preview the intended placement of future controls such as `Implement`, `Resume` and `Open`.
- [ ] Demonstration cards are not backed by persisted Task records.
- [ ] Kanban card controls do not start agents, create/restore Workspaces, resume Handoffs or mutate Task/Kanban state in the MVP.

## Persistence

- [ ] Projects persist.
- [ ] Chats persist.
- [ ] Actions persist.
- [ ] Panel layout persists.
- [ ] Last active Project persists.
- [ ] Last active Chat persists.

---

# 65. Explicit Non-Goals for MVP

The implementation agent must not expand scope by adding:

- ACP,
- MCP,
- direct OpenAI/Anthropic/Gemini APIs,
- LLM selection,
- prompt management,
- LLM-style agent conversation UI (a "chat" in this application is a terminal session),
- source code editing,
- IntelliSense,
- LSP,
- vector databases,
- embeddings,
- autonomous orchestration,
- task auto-generation,
- full Git client,
- worktree manager,
- browser panel,
- cloud backend,
- authentication,
- collaboration,
- telemetry service.

If such functionality appears necessary, prefer leaving an extension point rather than implementing it.

---

# 66. Recommended Implementation Order

## Phase 1 — Application Skeleton

1. Electron
2. React
3. TypeScript
4. Vite
5. preload bridge
6. base layout
7. SQLite bootstrap

## Phase 2 — Projects

1. add project
2. persist project
3. left navigation
4. select project

## Phase 3 — Project Context

1. path
2. Git branch
3. Git status
4. runtime detection

## Phase 4 — File Browser

1. directory tree
2. lazy loading
3. file selection
4. read-only Monaco preview

## Phase 5 — Chats

1. create Chat (name from the shell)
2. delete Chat (terminal exit)
3. Chat navigation
4. cwd per chat (project path by default)

## Phase 6 — Terminals

1. node-pty
2. xterm.js
3. Chat terminal
4. chat switching
5. resize
6. lifecycle handling

## Phase 7 — Bottom Terminal

1. panel
2. `Ctrl + ``
3. independent PTY
4. persistence of UI visibility/height

## Phase 8 — Action Bar

1. actions model
2. configuration dialog
3. action buttons
4. bottom-terminal execution
5. state display

## Phase 9 — Kanban Visual Preview

1. Files/Kanban project tabs
2. static target columns
3. realistic static demonstration cards
4. visual placement of future `Implement`, `Resume` and `Open` controls
5. representative future metadata/states where useful
6. no real Task binding and no Kanban workflow execution

## Phase 10 — Hardening

1. error handling
2. security review
3. persistence recovery
4. large-file handling
5. process cleanup
6. Windows path edge cases

---

# 67. Future Architecture Direction

Potential later evolution:

```text
Task
│
├── Workspace
│   ├── worktree
│   ├── branch
│   ├── primary agent
│   ├── terminal #1
│   ├── terminal #2
│   ├── browser
│   └── preview
│
├── Kanban state
├── Agent execution state
├── Git change summary
└── Review state
```

Possible agent integration layer:

```text
AgentAdapter
├── ACPAdapter
├── CodexAdapter
├── ClaudeCodeAdapter
├── OpenCodeAdapter
├── AgyAdapter
└── OpenAICompatibleAdapter
```

This layer is deliberately excluded from the MVP.

---

# 68. Future Separate Runtime Host

Potential architecture:

```text
Desktop UI
    │
    │ RPC
    ▼
Local Runtime Host
    │
    ├── PTY
    ├── agents
    ├── Git
    ├── filesystem
    ├── MCP
    └── ACP
```

This could later allow:

```text
Windows UI
   ↓
runtime host via SSH/RPC
   ↓
Ubuntu / Docker / remote workstation
```

The MVP should not implement this but should avoid choices that make it impossible.

---

# 69. Core Design Decisions

The following decisions should be treated as stable unless implementation evidence strongly suggests otherwise.

## Decision 1

Use Electron.

## Decision 2

Use React + TypeScript for the UI.

## Decision 3

The MVP is terminal-first and protocol-agnostic.

## Decision 4

Chat is the central MVP domain object (model change 2026-09-25); Task is the post-MVP progress entity pinned to a chat (§14).

## Decision 5

In the functional post-MVP Kanban, Task and Kanban card represent the same underlying entity. MVP Kanban cards are a deliberate static-demo exception and are not real Tasks.

## Decision 6

A chat is not the same thing as a terminal.

The relationship is:

```text
Chat
  ↓
TerminalSession
```

The Workspace layer between them is a post-MVP refinement (§16).

## Decision 7

The center area is a generic Workspace/Main Surface, not an editor.

## Decision 8

The configurable Project Action Bar is the action row below the tab strip in the center column (placement revised by user decision 2026-09-26).

## Decision 9

The right panel is structurally available but hidden by default.

## Decision 10

The bottom terminal is an auxiliary tool toggled by:

```text
Ctrl + `
```

## Decision 11

The MVP Project Kanban is a visual-only preview. It uses static demonstration cards to show the intended columns, card content, metadata and future controls, but it has no real Task binding and no functional `Implement`/`Resume` workflow. The complete Kanban process is post-MVP.

## Decision 12

The architecture must anticipate task-specific Git worktrees.

---

# 70. Final MVP Shape

```text
┌────────────────┬──────────────────────────────────────────┬──────────────┐
│ PROJECTS       │ TABS                                     │ RIGHT        │
│                │ [Fix Pixel] [Billing.php] [+ New chat]   │ hidden       │
├────────────────┼──────────────────────────────────────────┼──────────────┤
│ ▼ gerde.pl     │ ACTIONS                                  │ future:      │
│   Fix Pixel    │ [Handoff|Resume] [Stop|Continue]         │ Browser      │
│   SEO          │ ▶ Docker Up  🧪 Tests                     │ Terminal     │
│   Hero         │                                          │              │
├────────────────┼──────────────────────────────────────────┼──────────────┤
│                │ MAIN SURFACE                             │              │
│ ▼ knajpy       │                                          │              │
│   Auth         │ Chat: Fix Pixel                          │              │
│   Reviews      │     Terminal (active tab)                │              │
│                │                                          │              │
│                │ File tabs:                               │              │
│                │     read-only preview                    │              │
├────────────────┴──────────────────────────────────────────┴──────────────┤
│ AUXILIARY TERMINAL                                        Ctrl + `       │
├──────────────────────────────────────────────────────────────────────────┤
│ STATUS BAR  gerde.pl  D:\dev\gerde  PHP 8.5   main  ● 3                 │
└──────────────────────────────────────────────────────────────────────────┘
```

---

# 71. Product Direction Summary

The MVP should be intentionally simple:

> Project → Chat → persistent terminal workspace.

The application adds value by providing:

- chat-based navigation,
- clean workspace switching,
- visible project context,
- reusable command controls,
- file awareness,
- and a future Kanban-first operating model.

The long-term direction is:

> a desktop control surface for parallel human + coding-agent development, where Tasks unify terminal workspaces, Git worktrees, agents and Kanban workflow.

The implementation should optimize for reaching a usable MVP quickly without sacrificing the domain model required for that future direction.
