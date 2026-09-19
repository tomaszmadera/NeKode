# Project profile reference

`.agents/project-profile.yaml` stores current project facts and recorded commands. Instructional semantics for its maintenance live here rather than in the YAML state/config file.

## Project instantiation

- During bootstrap, select the application stack from approved project requirements.
- Record `publication.strategy` as `linear` or `git-flow`, and `publication.versioning` as `none` or `semver`. Use `not-configured` until a fact is known. `git-flow` requires `semver`.
- When publication uses `semver`, record or add a version source that `ci bump` can update, such as a supported manifest or `VERSION`. In `project-template` (`project.status: template`), `harness.version` is also the product version and is the writable source. Downstream projects never use `harness.version` as their product version.
- Bootstrap and adoption update the publication fields while preserving profile comments and unrelated values.
- In an instantiated project, replace every applicable `not-configured` value and verification command with recorded project facts/commands.
- Do not infer language, framework, database, infrastructure, or commands per task.

## Harness update semantics

`sync.mode` is `full` or `selective`. The template repository itself keeps `full`. `selective` limits writes to `managed_areas`.

Supported managed areas are communication, engineering, safety, workflow, agents-readme, scripts, hooks, templates, skills, records, profile, adapter-claude, adapter-codex, adapter-grok, adapter-opencode, adapter-agy, ci, plus policy and adapter groups understood by the updater.

`protected_paths` are repository-relative globs the updater never writes or deletes. A trailing `/**` also protects the directory itself. Protected paths win over managed areas.

`agents_md` may be `merge`, `keep-sections`, or `skip`. `keep_sections` applies only to `keep-sections`.

`allow_symlinked_dirs: false` makes the update fail before writing through or onto a symlinked harness path.

`validate: managed-only` limits validation to managed areas. Invalid enumerated values fail instead of falling back silently.

`harness.version` is the project-template semver tag the workspace was created from or last updated to. Copy it from the released template tag. In a downstream project, do not invent or bump it because product code changed. In `project-template`, `ci bump` updates it as the template product version after an approved release change, not merely because local guidance was edited.
