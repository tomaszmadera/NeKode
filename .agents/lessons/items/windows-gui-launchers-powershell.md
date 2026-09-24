### Launch NSIS installers and GUI exes via PowerShell, not bash

**Lesson:** On this Windows host, launching NSIS installers (and some GUI exes) from the Hermes bash/MSYS terminal hangs or crashes (exit 139) without installing. Use `powershell -NoProfile -Command 'Start-Process -FilePath "<exe>" -ArgumentList "/S","/D=<dir>" -Wait'` for silent install and the bundled `Uninstall <name>.exe /S` for silent removal. `cmd /c start /wait` from bash also misbehaves.

**Reason:** Verified 2026-09-24 with `nekode Setup 0.1.0.exe`: bash-launched runs never wrote files (one hung 7 min, one exited 139); the same binary installed cleanly and immediately via PowerShell `Start-Process -Wait`.
