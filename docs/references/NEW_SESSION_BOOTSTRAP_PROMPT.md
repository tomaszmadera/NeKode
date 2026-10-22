# New session bootstrap prompt

Status: a historical prompt from the concept stage. It is not an instruction for resuming the current work and not an overriding product contract. The claims below about sources of truth and the project state describe that context; the current rules are set by the [public contract](../development/project-contract.md), and the architecture by the [sdd.md](../architecture/sdd.md) file.

Paste the prompt below at the start of a new session, and then, if you want, paste `SDD.md`, `UX-UI.md` or other prepared documents right away.

---

## Prompt

We are working on a desktop app for **agentic coding** on Windows 11.

I want to continue the project from the existing concept, not design it from scratch.

### Short product description

We are building an **agent-first coding workspace** inspired by the UX direction of ZCode, but as our own independent product.

The app is meant for:

- managing software projects,
- managing tasks,
- running coding agents through the terminal,
- switching between active tasks,
- resuming work from Handoffs,
- browsing project files,
- watching Git branch / worktree status / runtime,
- running configurable project actions,
- and eventually managing work mainly through Kanban.

The MVP is **terminal-first** and does not need ACP.

In the MVP, an agent is a regular console app, for example:

- Codex,
- Claude Code,
- OpenCode,
- agy,
- Gemini CLI,
- any other configured CLI agent.

The user has:

- a global Default Console Agent,
- an optional default agent for the project,
- an optional agent assigned to the Task,
- the option to choose a different agent once.

---

## Main domain concept

The central object is:

```text
Task
```

A Task can have:

```text
Project
Workspace
Terminal Session
Agent
Git branch
Git worktree
Handoff
Kanban state
Progress checkpoints
```

A Kanban card and a Task in the project tree represent **the same object**.

Target model:

```text
Project
└── Task
    ├── Workspace
    │   ├── cwd
    │   ├── branch
    │   └── worktree
    ├── Terminal
    ├── Agent
    ├── Handoffs
    ├── Progress Checkpoints
    └── Kanban state
```

---

## Main UI structure

The app has five main areas:

```text
TOP
Project Action Bar

LEFT
Projects → Tasks
or, in context, Project File Tree

CENTER HEADER
Project / Workspace context:
path
runtime
Git branch
worktree / Git status

CENTER
Main Surface:
Task Terminal
Files
Kanban
future surfaces

BOTTOM
Auxiliary Terminal
Ctrl + `

RIGHT
Secondary tools
hidden by default
for example Browser / second Terminal
```

---

## Key UX decisions

The UI of the whole app is in English.

Style:

- dark-first,
- minimalist,
- calm,
- a premium developer tool,
- compact,
- inspired by ZCode,
- but not a copy of VS Code.

Animations should be:

- subtle,
- short,
- satisfying,
- helpful for spatial orientation,
- never distracting.

Animated transitions are especially important:

- Projects/Tasks → File Tree,
- Project → Task,
- Files ↔ Kanban,
- opening the bottom terminal,
- opening the right panel,
- Resume from a Handoff.

---

## Kanban

Kanban should be one of the main parts of the product.

At the project level:

```text
Files | Kanban
```

Basic columns:

```text
Backlog
Todo
In Progress
Done
```

Probably also, eventually:

```text
Review
```

A Task card can have the action:

```text
Implement
```

for a new task,

and:

```text
Resume
```

for a task that is active or has a Handoff.

Clicking `Implement` should start the Task with the default agent, unless the user chooses another one.

---

## Handoffs

A Handoff is a resource of a Task.

It should let you resume work with one click.

Clicking:

```text
Resume
```

should automatically:

1. select the right Project,
2. select the right Task,
3. open / restore the Workspace,
4. open or create a Terminal,
5. pick the right Console Agent,
6. start it, if needed,
7. pass it the Handoff context,
8. continue the work.

The MVP must not assume ACP.

A Handoff can be passed to the agent, for example, as:

- a prepared prompt,
- a temporary file,
- a CLI argument,
- text pasted into the terminal.

---

## Task Progress / Checkpoints

A Task can have a visual progress with checkpoints, for example:

```text
Plan → Inspect → Implement → Test → Review
```

This is not a regular percentage progress bar.

It should answer:

- what has been done,
- where we are,
- what is left.

Checkpoints can have the status:

```text
pending
active
completed
failed
blocked
skipped
```

Progress should also work for non-linear work.

A Handoff keeps the checkpoint state.

---

# Prepared documents

We already have the following documents.

## 1. `SDD.md`

Software Design Document.

It contains, among other things:

- the Electron + React + TypeScript architecture,
- the Project / Task / Workspace / TerminalSession model,
- SQLite persistence,
- `node-pty`,
- GitService,
- RuntimeDetectionService,
- ActionService,
- IPC,
- file browsing,
- read-only Monaco,
- the MVP scope,
- acceptance criteria,
- the MVP vs post-MVP split,
- the direction of future worktrees and agent integrations.

If I paste `SDD.md` in this session:

**treat it as the current source of truth for the technical architecture**, unless we explicitly agree on a change later.

---

## 2. `UX-UI.md`

The full UX/UI specification.

It contains, among other things:

- the app layout,
- all main surfaces,
- Project/Task navigation,
- File Tree,
- Kanban,
- Console Agents,
- Default Agent,
- Handoffs,
- Resume flow,
- Project Action Bar,
- bottom terminal,
- right panel,
- Git/runtime context,
- checkpoint progress,
- motion design,
- error states,
- accessibility,
- English-only UI.

If I paste `UX-UI.md`:

**treat it as the current source of truth for UX/UI**, unless we explicitly agree on a change later.

---

## 3. Mockup prompt pack

There is a set of prompts for generating mockups of all important views of the app.

It contains:

- a view inventory,
- a master visual system,
- prompts for full screens,
- prompts for dialogs and states,
- components,
- animation storyboards.

The files include, among others:

```text
00_MASTER_VISUAL_SYSTEM.md
VIEW_INVENTORY.md
ALL_PROMPTS.md
README.md
```

and separate view prompts.

You do not need to know them if I do not paste them.

---

## 4. `MAIN_HOME_VIEW_PROMPT.md`

A separate prompt for generating one main mockup of the app.

It is meant to check the overall:

- feel,
- density,
- hierarchy,
- visual direction,
- mood,

before we start generating all the other mockups.

---

# How to work in this session

If I paste one or more documents after this prompt:

1. read them carefully,
2. do not ask me again for information that is already in them,
3. detect contradictions between the documents,
4. if something differs, apply:
   - a newer explicit agreement from the conversation > a document,
   - UX-UI.md for UX/UI,
   - SDD.md for the technical architecture,
5. do not expand the MVP without need,
6. do not turn the project into a classic IDE,
7. keep the terminal-first character of the MVP,
8. remember that Kanban, Handoff and Task are parts of one consistent model,
9. assess new proposals for consistency with the whole product architecture.

If you propose an architecture or UX change, state:

- what you change,
- why,
- what the consequences are,
- whether it needs an update of `SDD.md`, `UX-UI.md` or both.

---

# Current goal

After pasting this prompt and the documents, I want to be able to continue working on the project right away, without reconstructing earlier agreements again.

Confirm briefly that you understand the project, and read the provided documents before designing further.
