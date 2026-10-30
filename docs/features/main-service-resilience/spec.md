# Main service resilience

## Goal

Bound external operations so a stalled dependency cannot keep a NeKode function occupied until restart.

## Related requirements

NEKODE-136, a subtask of NEKODE-128; [architecture review, section 7.3](../../architecture/architecture-agent-review.md). Existing feature contracts remain authoritative except where the current task explicitly changes behavior.

## Scope

Dictation providers and post-processing, persisted provider configuration, update requests, task-progress adapter termination, WSL probes on IPC paths, Git sync concurrency, and OpenWhispr temporary audio cleanup.

## Non-goals

Changes to IPC contracts or renderer UI, and unrelated service behavior.

## Behaviour

- ElevenLabs, OpenRouter and local OpenAI provider requests, including connection tests and model discovery, and post-processing requests have finite deadlines combined with caller cancellation. Timeout or cancellation releases the dictation session so another session can start. Preserve existing error and post-processing fallback conventions.
- All four provider-configuration reads use one guarded parser. Missing, malformed or non-object JSON yields an empty configuration, without affecting other providers.
- Each update request, including redirects and response body consumption, has a finite deadline. Failure releases the download busy state and permits a subsequent attempt; failed downloads never launch an installer.
- After a task-progress adapter times out or is cancelled, attempt process-tree termination and settle the invocation after a bounded grace period even if close never arrives. Preserve the appropriate timeout or cancellation result and clean timers/listeners.
- WSL probes on IPC paths use asynchronous execution with the existing deadline; startup-only synchronous use may remain. Preserve existing WSL results and error behavior.
- A second concurrent Git sync for the same project fails with a conflict; different projects may proceed independently. Release the lock on every outcome. Pull uses `git pull --no-edit`, followed by the existing push sequence.
- OpenWhispr audio files reside in the existing owned session directory and are removed on normal completion or by the existing safe stale-owner cleanup after a crash. Preserve the existing ownership and symlink safeguards.

## Business rules

Deadlines must be finite and appropriate to each operation, including large update downloads. Cancellation must retain its existing semantics. A timeout is a failure, not success or an implicit retry.

## Authorization

None beyond existing local application permissions.

## Data / API

No IPC or UI contract changes. Provider configuration fallback must not expose credentials. Temporary audio retains the existing cleanup ownership rules.

## Edge cases

Cover stalled response bodies and redirects, a child that never emits close after kill, malformed configuration, concurrent syncs and cleanup after failure. Preserve another live process owner's files.

## Errors

Report errors through existing service conventions; do not leave busy or in-flight state held after timeout, cancellation or failure.

## Acceptance criteria

Each of the seven task points has regression coverage, including timeout tests with virtual timers. `pnpm run verify` passes. Manually confirm a stalled provider connection test fails after its timeout and dictation works after a failed request.

## Required tests

Unit tests cover all listed boundaries, failure recovery and timeouts, with red-before-fix evidence. Final verification uses the full project command. Manual checks use a controlled local endpoint without real credentials.

## Relevant SDD / ADR

[Dictation provider architecture](../dictation-provider-architecture/spec.md), [OpenWhispr dictation](../openwhispr-dictation/spec.md), [in-app update](../in-app-update/spec.md), [task progress adapters](../task-progress-adapters/spec.md), [project environments](../project-environments/spec.md), [Git sync](../git-sync-button/spec.md).
