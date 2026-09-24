### Electron userData on Windows ignores %APPDATA% redirection

**Lesson:** To isolate an Electron app's data during smoke tests on Windows, do not rely on overriding `APPDATA` — Electron resolves `app.getPath('userData')` from the Windows Known Folder, so the app still reads/writes the real `%APPDATA%\<app>` directory. Real isolation requires `app.setPath('userData', ...)` inside the process. When a smoke test must run unmodified app code, accept that it touches the app's own data dir and keep any manipulation reversible (rename + restore).

**Reason:** Verified 2026-09-24: a dev run with `APPDATA=<scratch>` still created `C:\Users\<user>\AppData\Roaming\nekode\nekode.db`. Scratch files were left under the redirected path while the real DB kept being used.
