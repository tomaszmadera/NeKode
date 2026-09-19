# Context succession reference

Before a large step and at meaningful checkpoints, assess remaining headroom plus the next bounded action. Prefer runtime-reported remaining context and compare it with the action's expected needs, evidence, and a safety margin for a safe checkpoint. Do not start an action that cannot reasonably finish within that headroom.

When exact headroom is unavailable, use percentage of a known context window, then a runtime warning or compaction signal. Use an absolute token threshold only as a fallback explicitly supplied by the runtime/model profile, never as a universal threshold. Do not build a separate token estimator. Quota/account counters are not session-context evidence.

At the signal, reach only the nearest safe checkpoint:

- Main coordinating or implementing development: preserve durable task state, end any extra session, snapshot the current step/stage through handoff, then transfer the same unfinished work to a distinct successor session.
- Extra implementer: return compact status, changed paths, verification evidence, material decisions, and the first unfinished action to Main, then end the session. A fresh extra implementer may resume the same stage.
- Reviewer: return the comparison base, partial findings or explicit no-findings-so-far status, and the first unfinished review action, then end the session. An interrupted review is not passed.
- Current owner of review/debug/analysis: preserve durable state/snapshot and transfer the same unfinished work to a successor session.

Do not create a new task, stage, or plan merely because context is filling. Ephemeral work becomes recorded without raising complexity before transfer. A replacement extra session starts only after its predecessor ends. Extra sessions update handoff artifacts only when Main assigns that work.
