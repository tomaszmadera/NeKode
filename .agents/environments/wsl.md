# WSL command execution reference

- Run recorded Python harness commands with the WSL interpreter that starts the harness; `{python}` in a recorded command expands to that interpreter.
- The Windows launcher `py` and a Windows venv are not prerequisites in WSL. A profile that still names `py` fails preflight before verification runs.
- Do not mix interpreters in one verification run; the harness and the recorded command must resolve to the same WSL interpreter.
- Detect WSL from repository evidence such as `/proc/version` containing `microsoft`; do not shell out to Windows utilities for this.
- Preflight reports branch, upstream, and ahead/behind from local Git refs only; it never contacts remotes and never checks SSH.
- Document portable behavior only: no private paths, no machine-specific drives, and no credentials in profiles or documentation.
