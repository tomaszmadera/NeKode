# Review rules for NeKode

This file holds the standing acceptance rules for the maintainer's review loop.
The loop, its roles, and its limits are described in [roles](roles.md). The
rules apply to every work item that goes through the loop, on top of the
item-specific acceptance rules written in the Plane work item.

The rules do not replace the [public project contract](../docs/development/project-contract.md)
or [CI and verification](../docs/development/ci.md). They select the parts of
those contracts that a reviewer can decide from evidence, one line per rule.

## Standing rules

Each rule has a stable id, one requirement, and one way to check it. A rule is
accepted only if a test, a CI check, a script, a log, or one screenshot can
decide it.

```text
R1 | The "verify" check (GitHub Actions, windows-latest) is green on the latest PR commit | check: PR Checks tab
R2 | Every bug fix adds a test that fails without the fix | check: PR diff + test log with a red run before the fix
R3 | The PR references its Plane work item (NEKODE-<n>) and describes the change | check: PR description
R4 | No changes outside the scope of the work item | check: list of changed files
R5 | A change under adapters/plane has a green `pnpm run test:adapters` | check: command log (CI does not run it)
```

Notes on evidence:

- R1: NeKode is Windows-first, so the `verify` job in
  [the CI workflow](../.github/workflows/ci.yml) is the evidence for test
  rules. A green run on a Linux machine does not prove Windows behavior.
- R2: this is the regression rule from
  [CI and verification](../docs/development/ci.md#dobór-weryfikacji). Keep the
  red run, or revert and restore the fix before the final check.
- R5: the Plane adapter tests use the Python standard library only, so the log
  may come from any machine with Python 3.11 or newer. Paste the command, exit
  code, and test count into the handoff.

## Item rules

Rules for a single work item live in its Plane description, in a section named
"Acceptance rules", with ids `T1`, `T2`, and so on:

```text
## Acceptance rules
T1 | <behavior> works when <condition> | check: test <confirmed test path>
T2 | Feature documentation updated | check: diff of docs/
```

## Verdict format

The reviewer posts one comment per pass on the Plane work item. Every standing
rule and every item rule gets exactly one line:

```text
Pass 2/3 · PR #<n> · commit <sha> · CI verify: <result>
R1 PASS
R2 FAIL: fix in <file> has no new test
R3 PASS
R4 PASS
R5 PASS: not applicable, no change under adapters/plane
T1 PASS
T2 FAIL: docs/ unchanged
Result: FAIL (2), back to the doer
Rule proposal: none
```

A rule that does not apply to the change is reported as `PASS: not applicable`
with the reason. Findings that no rule covers are not a FAIL. They go into the
"Rule proposal" line for the owner to decide.

## Turning defects into tests or rules

- Every defect found in review or after merge ends as a test in the repository
  (Vitest for the app, Python `unittest` for the Plane adapter) or as a new rule
  in this file. A comment alone is not enough.
- A FAIL for a defect closes only when the new test exists, fails without the
  fix, and passes with it in the `verify` check.
- If no test can be written, the defect becomes a rule checked by a command log
  or one specific screenshot.
- A defect too large for the current item gets its own Plane work item with the
  `bug→test` label. It closes only with a merged test.

## Changing the rules

- Only the owner changes this file, directly or by approving a PR that changes it.
- The doer and the reviewer may only propose changes.
- A change made during a pass applies from the next work item unless the owner
  decides otherwise.
