---
workflow: small-development
pipeline: task-record-if-recorded > inspect > plan-in-session > implement > affected-checks > diff-review > optional-correction > verify-targeted > completion
---
# Small development workflow

This workflow owns one bounded local implementation slice with clear acceptance and one direct validation path. Durability controls state, not implementation gates.

1. If durability is `recorded`, activate `task-record` before broad inspection; otherwise keep work ephemeral without a record.
2. Inspect the smallest relevant code, configuration, tests, documentation, and Git evidence needed to confirm scope.
3. For recorded work, request `task-record`: begin `plan`. Keep the plan in the session; create no specification or plan file.
4. For recorded work, request `task-record`: end `plan`, begin `implement`. Implement the bounded slice and run affected checks. If discovery requires a durable specification/plan or another independently demonstrable slice, reclassify before expanding scope.
5. For recorded work, request `task-record`: end `implement`, begin `review`. Review the complete diff for scope, failure paths, regressions, generated noise, and documentation impact. No independent reviewer or extra implementation session is required.
6. Correct any findings, repeat affected checks, and inspect the complete corrected diff. For recorded corrections, request `task-record`: end `review`, begin `correction`; after corrections end `correction` and begin `review` again.
7. For recorded work, request `task-record`: end `review`, begin `verify`. Activate `verify` exactly once on the final diff after all corrections, normally with `targeted`; select a broader scope only when impact requires it. Documentation/path-only work uses the narrow validator selected by that skill. A failed check invalidates that final-verification attempt: request `task-record` to end `verify` with the failing evidence and begin `correction`, correct and re-review through step 6, then request a new `verify` row.
8. For recorded work, end `verify` through `task-record` with passing evidence, then activate `task-close` with `already-complete`. For ephemeral work, report the result and evidence directly without `task-close`.
