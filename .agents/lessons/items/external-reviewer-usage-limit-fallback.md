### External reviewer CLI can be usage-limited; fall back to a same-agent subagent

**Lesson:** An external reviewer or verifier CLI (Codex) can refuse to start on account usage limits even though the tool itself works. Do not treat that as a passed review or as a hard block: fall back to a fresh same-agent subagent reviewer with isolated context (never Main, never the implementer) and record the substitution in the review evidence. Reserve `handoff` for the case where no reviewer session of any kind can start.

**Reason:** Verified 2026-09-24 in NeKode: `codex exec -s read-only` failed with "You've hit your usage limit" (retry 2026-09-26), blocking live Codex verification of project skills. The user directed that independent review default to the same agent as main with a fallback instead of depending on the external CLI; the standing rule is recorded in `.agents/workflows/references/extra-session.md`.
