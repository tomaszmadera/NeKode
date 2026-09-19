---
name: harness-config-update
description: Use when updating or synchronizing the project harness and agent configuration in a target project to a newer or specified template version in a single command.
---

# Harness Config Update

Use this skill when updating an existing project to a newer (or specified) version of the `project-template` harness and agent configuration contract (e.g. updating from `5.0.0` to `5.4.0`).

This skill is designed to minimize agent tool calls by automating the entire harness synchronization, `AGENTS.md` merge, profile updates, and configuration validation in a single deterministic script execution.

## Rules & Safety Invariants

1. **Harness updates only** (within the target project's `sync:` policy, see below):
   - Synchronizes harness policies (`engineering`, `safety`), domain instruction files (`.agents/project-profile.md`), workflows and their references, templates, scripts, skills, environments, and agent adapters (`.codex/`, `.grok/`, `opencode.json`, `.opencode/`, `CLAUDE.md`, `.claude/settings.json`). Claude and Grok skill wrappers are generated from installed canonical skill frontmatter instead of copied as behavioral sources. Deletes retired instruction paths from a full-sync target. `.agents/harness-architecture.md` is retired: the harness architecture reference is harness-development material that lives only in the template repository at `docs/harness/harness-architecture.md`, so a target that still carries the old file loses it. A selective target keeps unmanaged or protected retired paths and reports them through the existing policy result.
   - `.agents/bootstrap-workflow.md` is retired: the bootstrap workflow now lives in the template-only `bootstrap-project` skill, so a target that still carries the old file loses it and any router line that names it.
   - Creates `.agents/lessons/index.json` only when absent (canonical empty shape: `{"schema_version": 1, "lessons": []}`); an existing index is never touched and its creation is not reported as added/updated.
   - Migrates a target that still carries the retired single-file lessons store: every lesson block becomes an item under `.agents/lessons/items/` with an index entry scoped `product`, reported as added together with the index, and `.agents/lessons/README.md` carries the layout rules. A malformed store or index fails the run before the first write.
   - The retired file is deleted only when every lesson in it reached the store and nothing but migrated lessons and retired boilerplate remained. Leftover prose, an id collision, or an item blocked by `protected_paths` keeps the file and is printed as `Needs manual completion` (a `pending_actions` entry), not as a policy skip, so no project lesson is lost.
   - Updates `harness.version` in `.agents/project-profile.yaml` to the target SemVer tag.
   - Merges root `AGENTS.md` by emitting every template section in template order; the target's `## Project rules` splices in at its template slot and the template's own body is never inherited; the retired `## Project Constitution` and `## Project-specific rules` sections migrate into it verbatim under `### Constitution` and `### Rules`, and a target that already has `## Project rules` keeps its body with the migrated subsections appended and a pending reconciliation note; a harness section the template no longer owns (`## Context discipline`) is dropped when its body is still the harness text, unless `sync.agents_md: keep-sections` lists the title in `sync.keep_sections`; and any other target-only section - 5.x `Required context`, `Completion report` or `Canonical sources` - is appended after the last emitted section. Known obsolete harness routing (removed pre-v4 router pointers and the old `Standard or larger work` row) is dropped; custom project rows and references are preserved. Re-running on a merged file is byte-identical.
   - Removes obsolete template-only files (such as `.agents/skills-available/`, `.grok/skills-available/`, and downstream copies of `.agents/tests/`) from target projects while synchronizing enabled optional skills from `tools/harness/skills-available/` directly into `.agents/skills/` with regenerated host wrappers.
2. **Strict preservation of project files:**
   - Never modifies or deletes project application code, tests, configs, `README.md`, `BACKLOG.md`, `.env`, or repository history.
   - Preserves project-specific lessons in `.agents/lessons/` items and their index entries.
   - Preserves active and completed task records in `.agents/tasks/`.
   - Preserves handoff records in `.agents/handoffs/`.
   - Preserves project-configured fields in `.agents/project-profile.yaml` (`project.*`, `runtime.*`, `database.*`, `local_environment.*`, `quality.*`, `verification.*`, custom deploy/test commands).
3. **Refusal gate for stale updater checkouts:** an updater running from a checkout whose `harness.version` is below `6.0.0` (the pre-v4 layout generation) refuses any update targeting `>= 6.0.0` - non-zero exit, an explicit "run the updater from an up-to-date template checkout" remediation, and zero filesystem writes (also under `--dry-run` and `--force`). The gate keys on the updater's own source checkout, never on the target's version.
4. **Automated validation:**
   - Automatically runs `validate-config` after synchronization to ensure 0 configuration errors.

## Update policy (`sync:` in `.agents/project-profile.yaml`)

The target project decides which harness areas the update may write. The policy is optional; a profile without a `sync:` section behaves exactly as before (full sync, `AGENTS.md` merge, full validation).

```yaml
sync:
  mode: selective            # full (default) | selective
  managed_areas:             # required by selective; the only paths the update may write
    - communication
    - engineering
    - adapter-claude
  agents_md: keep-sections   # merge (default) | keep-sections | skip
  keep_sections:             # target AGENTS.md sections carried over verbatim
    - Project Rules
    - Tools
  protected_paths:           # repository-relative globs, never written or deleted
    - .agents/workflows/**
    - .agents/skills/**
  allow_symlinked_dirs: false
  validate: managed-only     # full (default) | managed-only
```

| Area | Paths it owns |
|---|---|
| `communication`, `engineering`, `safety`, `agents-readme` | `engineering` and `safety` own their `.agents/*.md` policy files; `communication` still names the retired communication policy so a selective project can delete it; `workflow` owns `.agents/workflows/` |
| `scripts`, `hooks`, `templates`, `skills` | `.agents/scripts/`, `.agents/hooks/`, `.agents/templates/`, `.agents/skills/` |
| `records` | `.agents/tasks/README.md`, `.agents/handoffs/README.md`, `.agents/lessons/` |
| `profile` | `.agents/project-profile.yaml` |
| `adapter-claude`, `adapter-codex`, `adapter-grok`, `adapter-opencode` | `CLAUDE.md` + `.claude/`, `.codex/`, `.grok/`, `opencode.json` + `.opencode/` |
| `ci` | `.gitlab-ci.yml`, `.gitattributes` |

Groups: `policies` = the five policy areas, `adapters` = the four adapter areas. Carve one file back out with `protected_paths`.

Policy semantics:

- `protected_paths` wins over `managed_areas` and also blocks deletions, including obsolete-file cleanup. Deletions are per file, so protecting one file inside an obsolete directory keeps that file. In a pattern `**` stands for zero or more whole path segments, and a trailing `/**` also protects the directory itself.
- `.agents/project-profile.yaml` is written regardless of `managed_areas`, because it records `harness.version`. Protecting it in `protected_paths` deliberately freezes that record.
- `agents_md: keep-sections` preserves the listed target sections verbatim, in target order, after the sections the merge rebuilds. Use it for project sections the merge does not know.
- `allow_symlinked_dirs: false` (default) fails the run with an explicit error when a managed path is, or resolves through, a symlink, instead of writing outside the repository. Every candidate path is checked before the first write, so the failure leaves the target untouched.
- `validate: managed-only` limits the `validate-config` contract (required files, required profile sections, skills, commands, generated host adapters, adapter payload checks) to managed areas, so a partially adopted project can still validate green. Only `harness:` and `project:` stay required in the profile.
- A value outside its enumerated set, and `selective` without `managed_areas`, fail the run instead of falling back to a default; a typo must never silently widen the update to a full sync.
- Every run reports the effective policy and the paths skipped because of it (`skipped_by_policy` in `--json`).
- The template repository itself must keep `mode: full`; `validate-config` rejects a selective policy there.

## Execution

Use the session-cached project profile. Read `.agents/project-profile.yaml` only when it has not yet been loaded in this session or repository evidence shows that it changed. Run `commands.harness_config_update` with the selected arguments:

| Operation | Arguments appended to the recorded command |
|---|---|
| Specific version | `5.4.0` |
| Latest version | `latest` |
| Different target | `5.4.0 --target /path/to/project-x` |
| Preview | `5.4.0 --dry-run` |
| List versions | `--list-versions` |

### Options:
- `version`: Target version tag (e.g. `5.4.0`, `latest`, `patch`, `minor`, `major`).
- `--target <dir>`: Target project directory (defaults to current repository root).
- `--source <path_or_url>`: Custom source template directory or Git remote repository.
- `-c`, `--commit`: Automatically create a git commit (`chore: update harness config to <version>`) upon success when explicitly authorized (default: False).
- `--no-commit`: Apply changes without creating a git commit (default).
- `--dry-run`: Preview modified and added files without writing changes.
- `--force`: Force update even if version is unchanged.
- `--skip-validation`: Skip post-update `validate-config`.
- `--json`: Output machine-readable JSON summary.
