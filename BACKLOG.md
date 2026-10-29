# Backlog

This file holds only deferred ideas for the project. It is not an active delivery plan.

Add new entries as single bullet points in the matching category. When an idea goes into delivery, remove it from here and create the proper specification or task record.

## Ease of use

- Manual chat renaming: a double click on the name in the chat tab in the center column turns on name editing (the `name` field in the database is prepared; by default the name is the terminal or shell name). Source: user decision 2026-09-25; double-click interaction: user decision 2026-09-28.

## Other deferred ideas

- Post-MVP: a panel for recording work progress inside the app, independent of the harness. The rest of the original idea has shipped: a chat stores the task ref it was launched from (`docs/features/session-labels/spec.md`), tasks live in the built-in `local-file` source or an adapter (`docs/features/project-home/spec.md`), and step progress is read from task progress adapters (`docs/features/task-progress-adapters/spec.md`), which replaced the `.agents/tasks/*/task.md` parser. Source: user decision 2026-09-25 (requirements.md §3).

- Kanban drag-and-drop and the visual design from UX-UI §26-30. The adapter-backed Kanban board itself has shipped (`docs/features/kanban-adapter-interface/spec.md`, status Delivered). Source: that spec's status line.
