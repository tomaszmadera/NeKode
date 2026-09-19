---
name: lesson-select
description: Select or update repository lessons after an operational error, user correction, required-tool substitution, deterministic mapped event, or known lesson id/hint. Never search for speculative candidates.
---
# Lesson selection

Before reading the index, require an unexpected operational error, user correction, required-tool unavailability needing another method, a deterministic repository event mapped to a lesson domain, or an already-known lesson id/hint from state, handoff, or evidence. Without a candidate, do not load the index or history.

Read `.agents/lessons/index.json`. Keep the entries whose `scopes` intersect the current work, then narrow with
`tags` matching the task, stack, environment, command, or failure mode, and open only the `path` of what
remains. An entry that carries no tag yet stays selectable by scope alone. Never read every item.

Scopes are `harness-development` (work on this template's harness) and `product` (work in any project). Product
work selects `product` and skips a lesson scoped only to harness development. A project with no index has no
recorded lesson; `.agents/lessons/README.md` states the layout, and `.agents/scripts/lessons_store.py` migrates
a retired single-file store.

Add or update a lesson when an unexpected operational error occurs, an expected tool is unavailable and another
method is required, or the agent acts incorrectly and the user must correct it. Write the item under
`.agents/lessons/items/<id>.md` and add or update its index entry with `id`, `scopes`, `tags`, and `path`. Keep
lessons specific, actionable, verified, repository-grounded, and deduplicated.
