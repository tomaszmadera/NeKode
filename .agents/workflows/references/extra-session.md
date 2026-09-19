# Extra-session execution reference

Execution invariants:

- At most one extra agent session may exist beside Main at a time. Trivial/Small work and owning review/debug/analysis sessions do not use an extra implementation/review loop.
- Main remains the task owner while an extra implementer or reviewer performs bounded work. A replacement starts only after the previous extra session ends. A successor that replaces Main resumes the same durable task.
- Give an extra implementer only the current stage contract/artifact paths and first action, not the full planning conversation. Preserve the model/reasoning configuration when exposed unless the approved plan says otherwise.
- While an extra implementer owns a stage, Main coordinates without editing that scope concurrently. The implementer returns changed paths, checks/evidence, material decisions, and the first unfinished action, then ends the session.
- An independent reviewer uses the freed slot, returns findings/evidence, and ends before corrections begin. An interrupted or unavailable review is not a pass.
- Give the reviewer a comparison base, allowed changed paths, the `code-review` skill, relevant spec and plan/stage paths, task-record path only when needed, and matching stack criteria. Bound the prompt to the named diff. Do not paste the planning conversation. Do not include project file trees or full-file dumps.
- Use capability information already exposed by the runtime for session creation, role mapping, and liveness/transport. Inspect adapter capabilities only when a required mechanic is unresolved. Transport behavior does not change the independent-review gate.

Advisory external-model delegation consumes no extra-agent slot only when its canonical skill defines synchronous/read-only advisory work; it never replaces a required independent review or handoff.
