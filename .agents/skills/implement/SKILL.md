---
name: implement
description: Implement one approved Standard or Large stage with tests, minimal code, documentation, affected checks, and a complete stage diff self-review.
---

# Implement

Use this skill for one approved Standard or Large development stage. Do not use it for Trivial, Small, `bootstrap`, review, debug, or analysis.

Inputs: approved `docs/features/<slug>/spec.md`, approved `.agents/tasks/<task-id>/plan.md` and current stage, relevant task state, bounded project context, and passing or explicitly accepted preflight evidence. Return a missing prerequisite to the caller before product edits.

1. Read the spec, current stage, and relevant task state. Inspect only the code, tests, and configuration needed for that stage.
2. Add or update tests at the lowest useful level. Confirm that a meaningful new behavior/regression contract fails before implementation when practical.
3. Implement the smallest complete behavior matching the stage, using established project patterns. Add no abstraction, dependency, or infrastructure without a current requirement.
4. Update affected documentation; add an ADR only for a consequential decision.
5. Run affected tests and the cheapest sufficient static checks. Fix failures and preserve real command and exit evidence.
6. Inspect the complete stage diff against the spec, error paths, scope, regressions, and test quality. Correct defects and repeat affected checks when changes require them.
7. Return changed paths, evidence, failures or unavailable checks, material decisions, and the first unfinished action if any to the caller.
