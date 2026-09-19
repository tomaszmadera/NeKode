---
name: use-task-board
description: Use when finding, starting, or registering a repository with the global read-only task progress board, or when inspecting task progress.
---

# Use the global task board

The board is a separate local app. It does not live in this repository. `.agents/tasks/*/task.md` remains the source of truth.

## Locate the installation

1. Read `board_root` from `%USERPROFILE%/.task-board/config.yaml` (or `~/.task-board/config.yaml`).
2. If that key is missing, use the sibling directory `../task-board` when it contains `app/server.py`.
3. If still missing, stop and tell the user the board is not installed.

## Register and open

```text
python <board_root>/app/server.py register .
python <board_root>/app/server.py --open
```

- Register only a directory that has `.agents/project-profile.yaml` or `.agents/tasks`.
- Do not copy the board into this repository.
- Do not write `task.md` through the board; it is read-only.

## Report tasks to Personal Data Hub (Agent Tasks API)

External agent runs and repository scripts can report progress snapshots to the centralized Personal Data Hub API:

```text
python .agents/skills/use-task-board/scripts/report_tasks.py [--url URL] [--token TOKEN] [--task TASK_ID] [--strict]
```

### Configuration

- **Source:** Settings are configured strictly in `.agents/.env` (or overridden via CLI flags `--url` / `--token`).
- **API URL:** `HUB_URL` (base hub URL, e.g. `https://hub.nekomimi.com.pl:8443`), `AGENT_TASKS_API_URL` (dedicated tasks endpoint or base URL), or `--url <url>` (default: `http://localhost:8081`).
- **Token:** `HUB_TOKEN` (shared Sanctum token), `AGENT_TASKS_API_TOKEN` (dedicated tasks token), or `--token <token>` (requires Sanctum ability `agent:push` or `admin`).
- **Authorization:** The canonical safety policy's `Automatic task reporting authorization` section owns the standing authorization for automatic task reporting. Automatic reporting must stay within that section's exact trigger, endpoint, and data scope; any operation outside it requires a current user request.
- **Non-blocking by default:** Network and server errors are logged as warnings and exit `0` by default so they never block or fail local agent execution loops. Use `--strict` when failure must halt execution.
- **Automatic reporting:** a successful write of `.agents/tasks/<id>/task.md` (and a session-end safety net) dispatches the canonical `task-report` event. The event is a no-op unless the policy-owned standing authorization, an explicit `HUB_URL` or `AGENT_TASKS_API_URL`, and a token are all present in `.agents/.env`; it does not use the CLI localhost default. Unchanged snapshots are skipped. Reporting failures are warnings and never deny a tool.
- **Single task filter:** Pass `--task <task-id>` to report only a single task.
- **Inspecting records:** Reported tasks appear in the Filament admin dashboard under navigation section **Zadania i Agenci** (`/admin/agent-tasks`), or via `GET /api/v1/agent-tasks` and aggregated snapshot `GET /api/v1/agent-tasks/snapshot`.

