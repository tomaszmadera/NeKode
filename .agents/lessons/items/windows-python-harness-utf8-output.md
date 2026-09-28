# Use UTF-8 output for Python harness status on Windows

Set `PYTHONIOENCODING=utf-8` in the PowerShell process before running `.agents/scripts/task-status --json`. The script emits Unicode text with `ensure_ascii=False`, and the default cp1250 console encoding can raise `UnicodeEncodeError` before the report is printed.

Evidence: `python .agents/scripts/task-status --json` failed in `encodings/cp1250.py` while encoding U+2190 on 2026-09-28. The same command succeeded after setting `PYTHONIOENCODING=utf-8`.
