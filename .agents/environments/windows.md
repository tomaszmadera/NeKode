# Windows command execution reference

- Prefer synchronous execution for short-lived commands. Use asynchronous execution only for watchers, development servers, and genuinely long-running processes.
- Do not background Git inspection, short scripts, filesystem checks, or small-scope linters.
- In PowerShell, stdout may complete while a background runner remains active; check task/process status once instead of passively polling.
- Run related short Git inspections sequentially in one non-login PowerShell process.
- Run recorded Python harness commands from non-login PowerShell. Switch to `cmd.exe` only after evidence shows it resolves the configured Python interpreter correctly.
- Keep alternate Git index setup, scoped checks, and cleanup as separate commands with explicit validated paths so a compound command cannot hide which mutation was authorized.
- In PowerShell Git inspections, pass an annotated-tag dereference such as `'refs/tags/<tag>^{}'` as a quoted literal, or use `git rev-list -n 1 <tag>`, so PowerShell does not consume the brace expression.
- When a harness record needs a UTC timestamp, use `[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')`. Do not assume `Get-Date -AsUTC` exists.
- When a recorded `{python}` command runs and `python` is unavailable, resolve `py` with `Get-Command py` and use that launcher.
- In a WSL session, run the harness with the WSL interpreter; the Windows launcher `py` and a Windows venv are not prerequisites there. See `wsl.md`.
