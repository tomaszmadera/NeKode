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
- If the app is already running, `start.ps1` exits with code 1 ("already running")
  and the button shows **failed**. This is intended. Stop it with stop.ps1 (below).
- Dev mode started **from inside** NeKode starts **a second instance**
  (a second window next to the first). If you want to "open the app" during
  normal use, use the Unpacked mode (below) after running
  `pnpm run build:unpack` first.

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
