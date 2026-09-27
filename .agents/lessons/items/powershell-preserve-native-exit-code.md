# Preserve native exit codes in PowerShell verification

In a sequential PowerShell verification command, check `$LASTEXITCODE` immediately after every native process and exit before running the next command. `$ErrorActionPreference = 'Stop'` does not turn a native process's nonzero exit into a terminating PowerShell error, so a later successful command can mask the failure.

Evidence: a failing `py -3 -c` assertion was followed by a successful `codex features list`, and the combined shell command returned exit code 0. The corrected check captured `$LASTEXITCODE` after each native command.
