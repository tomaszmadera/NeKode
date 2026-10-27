# Action buttons: starting the app (start.ps1 / stop.ps1)

The **Actions** system is built into NeKode. You add a button from the UI,
without code changes.

In the Working Dir field, enter the absolute path of your own NeKode clone. The commands below use paths relative to that directory; replace the directory placeholder before saving.

## How to add a button

1. Open the panel: **the settings icon on the action bar** (above the main surface)
   or **Project Settings** in the left navigation → the **Actions** section.
2. Click **Add Action** and fill in the fields:

| Field       | Value                                                  |
| ----------- | ------------------------------------------------------ |
| Scope       | Global (or Project, if it should be per project)       |
| Title       | `Start NeKode`                                         |
| Icon        | `None` (Lucide palette) or `Custom (emoji)`, for example 🚀 |
| Command     | `powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\start.ps1"` |
| Working Dir | `<NeKode-clone-directory>`                             |
| Run In      | `Background`                                           |
| Confirm     | optional                                               |

3. **Save**: the button appears on the action bar.

## Button icon

The **Icon** field has two modes:

- **Lucide palette** (predefined, consistent with the rest of the UI): run, stop, preview,
  continue, retry, build, test, bug, deploy, web, terminal, database, package,
  timer. The selected name renders as a Lucide glyph before the button title.
- **Custom (emoji)**: any emoji (for example 🚀) pasted into the text field.
  It renders as is.

`None` means no icon; the button then shows only the status marker (idle /
running / failed) and the title. The choice does not affect how the command runs.

## Run with PowerShell NoProfile

The checkbox right under the Command field. Its label shows the full prefix
`powershell -NoProfile -ExecutionPolicy Bypass -File`, which is prepended
to the saved command.
In the Command field, enter the script path and its arguments, for example `./scripts/start.ps1`.
Put a path with spaces in quotes.
The option works for every Run In. When you edit a saved action, the form shows
the original command with the checkbox selected; clearing it removes the PowerShell wrapper.
When you edit a command with this prefix, the checkbox is selected automatically.

## Important

- With the **Run with powershell -NoProfile -ExecutionPolicy
  Bypass -File** checkbox cleared, the Command field is run by
  `cmd.exe` (`spawn` with `shell: true`), and cmd does not run .ps1 directly.
  That is why the command wraps the script in `powershell -NoProfile -ExecutionPolicy Bypass -File ...`.
- Run In = **Background**: `start.ps1` starts `pnpm run dev` in the background
  (logs in `tmp\logs\`) and exits after about 3 s, so the button shows
  running → success while the app keeps running.
- If the run recorded by `start.ps1` is already active, the script exits with code 1
  ("already running") and the button shows **failed**. Stop that run with `stop.ps1`.
- Dev mode uses `tmp/dev-user-data` by default. Its projects and settings persist
  between starts, separately from the installed app, so both can run at once.
  An explicit `NEKODE_USER_DATA` overrides this default. Choosing the installed
  app's profile requires closing that app first because one profile has one instance.
  Running `pnpm run dev` directly does not apply the script's default profile.
- Unpacked mode uses the app's normal profile unless `NEKODE_USER_DATA` overrides it.
  Build it first with `pnpm run build:unpack`.

## Ready-to-paste commands

Start (dev):

```
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\start.ps1"
```

Stop:

```
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\stop.ps1"
```

Start (built app, requires `pnpm run build:unpack` first):

```
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\start.ps1" -Mode Unpacked
```

For Stop/Unpacked the other fields are the same (only the Title differs).

## Demo data for UI development

The dev profile keeps projects, sessions, and settings between starts. To populate
it once, start and stop Dev so the app initializes the database, then run:

```powershell
pnpm run demo:seed
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\start.ps1"
```

The command targets only `tmp/dev-user-data/nekode.db` and requires the recorded
dev run to be stopped. It adds Atlas Web (three sessions), Orbit API (two sessions),
and Empty Playground (no sessions), with local folders under `tmp/demo-projects`.
It sets initial selection, project colors, icons, and sidebar width when those
settings have no stored value. Sessions use ordinary shells; no agent CLI is launched.
The selected project's sessions appear on startup; expand the other projects to
inspect their lists. The app restores the selected session, not every terminal process.

Repeating `pnpm run demo:seed` preserves edits and removals and creates no duplicates.
It does not populate an explicit `NEKODE_USER_DATA` override or the installed profile.
To check the seed behavior, run `node --test scripts/seed-demo.test.mjs`.
