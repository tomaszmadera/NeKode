---
name: verify
description: Run exactly one final verification scope (targeted, changed, or full) using recorded project commands and preserve real command and exit evidence.
---
# Verify

Select exactly one final scope for the complete final diff:

- `targeted`: Small or otherwise narrow changed behavior.
- `changed`: Standard changed-scope verification.
- `full`: Large, high-impact, migration, security/public-contract, integration-risk, or explicitly exhaustive verification.

Use the session-cached project profile. Read `.agents/project-profile.yaml` only when it has not yet been loaded in this session or repository evidence shows that it changed. Use `commands.verify_targeted`, `commands.verify_changed`, or `commands.verify_full` for the selected scope. Do not infer an unrecorded stack command. Documentation/path-only changes may use their relevant validator plus `git diff --check` when applicable.

Do not run a lower final scope immediately before a higher one unless the higher command depends on it. Preserve the actual command, process termination/exit status, material output, and skipped/unavailable checks. Missing tooling or a failed command is not a pass.

If the selected command uses Python `unittest -k`, read `references/python-unittest.md` before constructing filters.
