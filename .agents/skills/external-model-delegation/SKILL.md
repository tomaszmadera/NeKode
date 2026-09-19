---
name: external-model-delegation
description: Delegate a bounded advisory coding task through AGY when external model compression would help and the user can approve the exact content-free transfer preview. Do not use it for authoritative review, final acceptance, repository edits, sensitive data, or autonomous external calls.
---

# External model delegation

Use the dispatcher in this directory for optional, synchronous advisory work. Main retains task ownership, local verification, edits, decisions, canonical review, handoff, and acceptance. `review-prescreen` is not code review; `handoff-summary` is not a handoff. External calls do not consume the one-extra-session slot and cannot replace its required reviewer.

`policy.json` is the only executable source for roles, routing defaults, limits, path denies, timeout, and audit defaults. Do not restate or override its values in another adapter.

## Consent boundary

1. Choose one role and only the minimum eligible inputs. Never send credentials, private keys, personal or regulated data, ignored or untracked files, repository metadata, or arbitrary trees.
2. Run the dispatcher with `--preview`. Preview performs local validation and capability discovery only; it does not invoke model inference.
3. Show the complete content-free JSON preview to the user. Explain that approval applies only to its `consent_id`, adapter, model, effort, role, paths, hashes, and bounds.
4. Invoke the same command with `--consent-id <id>` only after explicit approval of that exact ID. Any changed task, option, file, path list, or diff requires a new preview and approval.
5. Treat the result as evidence to inspect. Verify material claims locally; do not apply proposed commands or edits automatically.

The consent manifest binds the exact framed prompt, canonical policy, role contract, and result schema by hash. A missing or stale consent ID is rejected before the selected adapter is executed. Preview may perform only the documented local capability probe.

## Dispatcher

```text
python .agents/skills/external-model-delegation/scripts/delegate.py <role> --task "..." [bounded inputs] --preview
python .agents/skills/external-model-delegation/scripts/delegate.py <role> --task "..." [same bounded inputs] --consent-id <sha256>
```

- `scout` sends only the Git-tracked repository-relative path list.
- `review-prescreen` sends a validated Git diff and accepts repeatable `--file` filters.
- `test-proposal` and `change-proposal` require repeatable explicit tracked `--file` paths.
- `triage`, `summarize`, and `handoff-summary` require one exact `--input-file`; the dispatcher rejects special files, symlinks, and sensitive paths.

Use `--task-file` only for an exact eligible task-text file. Use `--model` or `--effort` only when the user should consent to that visible override. `--no-audit` is also consent-bearing and must be visible in the approved preview. Never bypass a refusal or silently select another provider, model, executable, path, or Git base.

On Windows, an explicitly selected adapter must be a native `.exe`; command scripts are rejected. File citations in facts and findings must use structured evidence references to the validated `files` array. An unconsented path can appear there only as an explicitly unverified file entry.
