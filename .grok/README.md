# Grok Build adapter

Grok Build reads the root `AGENTS.md`; that file and `.agents/` remain the canonical repository instructions. This directory contains only Grok-specific discovery and execution adapters.

## Skills

Thin wrappers under `.grok/skills/` expose the canonical `.agents/skills/*/SKILL.md` workflows as Grok Build slash commands. A wrapper must only identify and link its canonical skill; update workflow behavior in `.agents/skills/`, never in both locations.

Run `grok inspect` from the repository root to confirm that `AGENTS.md` and the required project skills are discovered. Invoke a skill with `/<skill-name>`.

## Session capabilities

Grok Build exposes child creation as `spawn_subagent`. The console can create a distinct agent with workspace access; `/new` and `/fork` reset or branch conversation and do not establish that capability by themselves. Runtime-reported session status and tool results provide liveness evidence.

Coordination behavior is defined in [the canonical extra-session reference](../.agents/workflows/references/extra-session.md). This adapter records capability mappings only.

## Hooks

Project hooks live in `.grok/hooks/` and require folder trust (`/hooks-trust` or `--trust`) before they run. They only dispatch canonical events to `.agents/hooks/dispatch.py`. Quota registration uses `SessionStart`, `PreToolUse`, and `SessionEnd`; task-file reporting uses `PostToolUse` and a separate `SessionEnd` safety net. Reporting configuration stays in `.agents/.env`; Grok credentials stay in `~/.grok/auth.json` (or `$GROK_HOME`). This adapter does not own Hub URL or token rules.
