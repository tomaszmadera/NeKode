# Driving the real Electron app over CDP on Windows

For a real-app terminal/UI probe without an e2e framework (electron-e2e skill, renderer probes):

- Isolate data without code changes: Electron honors `--user-data-dir=<dir>` for `app.getPath('userData')`
  (verified 2026-10-01: a seeded `projects` row in the temp DB + page reload worked). This complements the
  `app.setPath` route in `electron-userdata-not-appdata` and keeps the developer's real DB untouched.
- CDP port: pass `--remote-debugging-port=<port>` directly to the electron binary. `electron-vite dev`
  instead reads the `REMOTE_DEBUGGING_PORT` env var (electron-vite spawns electron itself).
- Trusted Enter needs `text`: `Input.dispatchKeyEvent` keyDown for Enter submits an HTML form only when the
  event carries `text: '\r'` (and `unmodifiedText`), like Playwright's key layout. Without `text` the keydown
  dispatches (listeners see it, nothing preventDefaults) but implicit form submission never fires, which
  fakes a real "Enter does not submit" bug.
- A shell-level task stop of a background `electron` launch does not kill the Windows process tree. The
  survivor keeps the CDP port, so the next launch silently loses it and probes hit the STALE app. Kill by
  command-line filter (the instance's unique `--user-data-dir` flag) before relaunching, and count surviving
  processes afterwards.
- `Page.captureScreenshot` can return a STALE compositor frame for a backgrounded window on Windows: the
  probe reads the new theme but the PNG still shows the old one. Launch smoke instances with
  `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding`, `Page.bringToFront` plus a
  ~1s settle before each capture, and pixel-sample the PNG (PIL) asserting the expected RGB instead of
  trusting the image; capture a second frame after any runtime switch (verified 2026-10-01: stale frame
  showed the default palette after switching to default-beta-1; fresh frames matched `#10121c` exactly).
- CDP from the Hermes Python venv: the `websockets` pip package speaks the DevTools protocol
  (`Runtime.evaluate`, `Page.captureScreenshot`); node `ws` is not installed in the repo.

Also in this repo: plain `cmd /c ...` under Git Bash gets `/c` path-converted; use `MSYS_NO_PATHCONV=1`.
