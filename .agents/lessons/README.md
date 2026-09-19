# Selective lessons store

```text
.agents/lessons/index.json
.agents/lessons/items/<lesson-id>.md
```

`index.json` holds compact metadata for every lesson (`id`, `scopes`, `tags`, `path`); `items/<lesson-id>.md`
holds the lesson text. The `lesson-select` skill reads the index, keeps the entries whose scopes and tags
intersect the current task, and opens only those items, so no task loads the whole history.

## Scopes

- `harness-development` - the lesson constrains work on this template's harness (router, workflows, skills,
  hooks, scripts, validators, adapters, harness update).
- `product` - the lesson constrains work in any project regardless of the harness.

A lesson may carry both. Product work selects `product` and never opens a lesson scoped only to harness
development.

## Tags

Tags are concrete selection keys: the tool, command, file, runtime, or failure mode the lesson is about
(`task-record`, `powershell`, `safety-hook`, `quota`, `release`). Tags narrow inside a matching scope. A lesson
migrated from a retired single-file store starts with no tag and stays selectable by scope alone until someone
tags it; add tags the next time you touch it.

## Lesson format

Each item file holds one lesson:

```markdown
### Short descriptive title

**Lesson:** What should be done or avoided.

**Reason:** Why this matters in this project.
```

## Rules

- Record only specific, actionable, verified lessons that are likely to prevent a future mistake or wasted work.
- A lesson describes a reusable rule or verified project behavior, not what happened during one task.
- Do not record obvious facts, temporary conditions, task history, or speculative assumptions.
- Keep each lesson short.
- Update an existing item instead of adding a duplicate or a conflicting entry; the item id is its filename stem.
- Remove lessons that are proven incorrect or no longer apply, together with their index entry.
- Lessons are provisional. They become permanent project rules only when the user promotes them into
  `AGENTS.md`, `.agents/engineering.md`, or `.agents/safety.md`.
- Do not create a parallel event log, proposal queue, or improvement state beside this store.

`.agents/scripts/lessons_store.py` owns the layout, the index schema, and the migration of a project's
retired single-file store.
