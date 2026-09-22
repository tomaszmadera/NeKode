---
name: kanban
description: "Use when managing project backlog, work items, or kanban boards (CRUD work items, board view, states, transitions, search). Also use whenever the user mentions the backlog or pastes a backlog/work-item URL: the backlog is reachable only through this skill, never by fetching the Plane page."
---

# Kanban & Backlog management

Use this skill to inspect, create, update, transition, and delete work items (Kanban cards) in the project backlog and Kanban boards. The current default backend is Plane CE via REST API.

## Configuration

Settings are configured strictly via environment variables or the project's `.agents/.env` file:
- `PLANE_API_KEY`: Required Personal Access Token. Loaded from `os.environ` or `.agents/.env`. There is no silent reading from external machine secrets.
- `PLANE_PROJECT_ID`: Target project UUID or identifier (e.g. `NAOMEM`). Configured in `.agents/.env` or overridden via `--project`.
- `PLANE_WORKSPACE_SLUG`: Workspace slug (default: `private`).
- `PLANE_BASE_URL`: Plane base URL (default: `http://hub.nekomimi.com.pl:8087` or LAN `http://192.168.5.90:8087`).
- Direct web URLs passed to `--project` automatically configure host, workspace, and project ID.

## CLI commands

Use the session-cached project profile. Read `.agents/project-profile.yaml` only when it has not yet been loaded in this session or repository evidence shows that it changed. Run `commands.kanban`. The following examples show arguments appended to that recorded command, not standalone shell commands.

### 1. Inspect Kanban board and columns

```text
# View Kanban board grouped by column/state (Backlog, Todo, In Progress, Done, Cancelled)
board --project NAOMEM

# List work items specifically in Backlog
backlog --project NAOMEM

# Or pass a full Plane URL directly
board --project http://hub.nekomimi.com.pl:8087/private/projects/57b640b7-c965-4f7e-bc29-ea77cf7d05af/issues/

# List project states/columns and their UUIDs
states --project NAOMEM
```

### 2. Read tasks (CRUD: Read)

```text
# List all tasks
list --project NAOMEM

# Filter by state, priority, or label
list --project NAOMEM --state "Todo" --priority high

# Get task details by reference (e.g. NAOMEM-1) or UUID
get NAOMEM-1 --project NAOMEM

# Search tasks across workspace
search "dataset"
```

### 3. Create task (CRUD: Create)

```text
# Create a new Kanban card in Backlog
create --project NAOMEM \
  --name "Implement feature XYZ" \
  --description "Detailed plain text description" \
  --state "Backlog" \
  --priority medium

# Create directly in Todo with assignee and target date
create --project NAOMEM \
  --name "Fix bug in parser" \
  --state "Todo" \
  --priority high \
  --assignee tomek.madera@gmail.com \
  --target-date 2026-09-15
```

### 4. Update / Move across columns (CRUD: Update)

```text
# Move task from Backlog/Todo to In Progress
update NAOMEM-1 \
  --state "In Progress"

# Complete task (move to Done)
update NAOMEM-1 \
  --state "Done"

# Update title or priority
update NAOMEM-1 \
  --priority urgent --name "Updated title"

# Dry run to inspect payload without applying changes
update NAOMEM-1 \
  --state "Done" --dry-run
```

### 5. Delete task (CRUD: Delete)

```text
# Soft-delete work item (bypassing confirmation prompt with --yes)
delete NAOMEM-1 \
  --project NAOMEM --yes
```

## State & column resolution

The CLI accepts either:
- Full state name (case-insensitive, e.g. `Backlog`, `Todo`, `In Progress`, `Done`, `Cancelled`).
- Group keyword / alias:
  - `backlog` -> state in backlog group.
  - `todo` or `unstarted` -> default state in unstarted group.
  - `in progress` or `started` -> default state in started group.
  - `done` or `completed` -> default state in completed group.
  - `cancelled` -> default state in cancelled group.

## Safety rules

- Never echo, print, or commit `PLANE_API_KEY`.
- Always pass `--dry-run` when testing automated payload transformations.
- Deletions are soft-deletes (retained with `deleted_at`).
