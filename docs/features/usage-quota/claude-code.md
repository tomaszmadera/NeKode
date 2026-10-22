# Claude Code session snapshots

NeKode reads Claude Code subscription rate limits from a snapshot directory. Each Claude Code session writes its own `<session_id>.json` file there from its [status line](https://code.claude.com/docs/en/statusline), and the built-in `Claude Code` reader merges the files. Nothing is sent to a server and no model is called. NeKode never writes to the directory.

Two writers produce compatible files:

- Another tool's status-line script may already write Claude Code's raw status-line JSON to a directory. If so, select that directory in NeKode; no setup is needed.
- Otherwise NeKode's snapshot writer ([adapters/usage-claude-code](../../../adapters/usage-claude-code)) writes a reduced file that holds only `session_id` and `rate_limits`. It is installed by a previewed setup script.

Use one directory per Claude account. The reader cannot tell accounts apart, so sessions of two accounts in one directory would mix their values.

Record each Claude account once per computer. If another tool already records Claude usage (for example to send it to a service that NeKode reads through a [user adapter](usage.md)), do not install NeKode's writer as well: read that tool's directory or its adapter instead. Setup refuses a second NeKode writer, but it cannot recognise other tools' status-line scripts, so its preview repeats this rule next to the command it would keep.

Tested CLI version: Claude Code 2.1.304 with protocol fixtures. A live read against a Claude account was not run (`not run: account access unavailable`); fixture results do not prove that your account reports limits.

## What the reader uses

Only the documented `rate_limits` fields:

| Status-line field | Metric id | Notes |
|---|---|---|
| `rate_limits.five_hour.used_percentage`, `resets_at` | `five_hour` (`5h`) | 5-hour window; start is `resets_at` minus 5 hours |
| `rate_limits.seven_day.used_percentage`, `resets_at` | `seven_day` (`7d`) | 7-day window; start is `resets_at` minus 7 days |
| `rate_limits.spend_limit.used_percentage`, `resets_at` | `spend_limit` | Only when a file reports it (Claude apps gateway); no period length is derived |

`resets_at` is Unix epoch seconds. Context-window percentages, cost, paths, model and every other field are ignored and never copied into NeKode's cache or export.

Per poll the reader takes at most the 256 most recently modified regular `*.json` files of at most 256 KiB each. Modification time only selects files; it never makes data fresh. For each window:

- a later `resets_at` wins, so an idle session that re-renders old cached values cannot replace a newer window;
- for the same `resets_at` the higher `used_percentage` wins, because usage within one window does not decrease;
- a window that is absent or invalid in one file does not erase a valid value from another.

A reset time that has already passed loses to an unknown (`null`) reset, because the window it described is over; a future numeric reset beats an unknown one.

Across polls NeKode keeps a previously shown value only while its numeric reset is still in the future: if the file that held the newest value is deleted, NeKode keeps that value rather than showing an older one from another session. A kept value whose reset has passed, or whose reset is unknown, is replaced by the current read, so two reads with unknown resets show the latest value rather than pinning an old higher one. Changing the account (name, source or directory) clears it.

Unparseable, oversized and foreign files (JSON without a `rate_limits` object) are skipped. If no file has a valid window, `five_hour` and `seven_day` show `Unavailable` with reason `not_reported`, never 0%. `rate_limits` appears only for claude.ai Pro and Max subscribers (or behind a gateway spend limit), and only after a session's first API response.

## Freshness and polling

The status-line payload does not say when Claude Code learned the quota values, so every metric has `observedAt: null` and NeKode shows `Age unknown`. A known reset that passes shows `Expired - refresh required` until a session reports a new value. Without a running Claude Code session there are no new values.

The reader polls at most every five seconds while `Show usage quota` is on and the app is visible. A missing directory whose parent folder exists is a transient error: NeKode keeps the last values and retries every five seconds, so the directory can appear after the first status-line run. A missing parent folder, a symbolic link or junction in the path, or an export file inside the directory is rejected when you save.

## Read a directory written by another tool

1. In NeKode open `App Settings > Usage`, turn on `Show usage quota`, choose `Add account`, then `Claude Code`.
2. Enter a name, replace the proposed directory with the other tool's directory (`Choose directory`), then `Test` and `Save`.

## Use NeKode's writer

1. In NeKode open `App Settings > Usage`, choose `Add account`, then `Claude Code`. NeKode proposes its own directory, `<userData>\claude-code-usage\<account id>`, and creates it when you save. Enter a name and save.
2. Choose `Copy setup command` and run the copied command in PowerShell. It names the shipped setup script, your `.claude\settings.json` and the account's directory, and only previews the change. To run setup by hand instead, open the writer's folder in PowerShell. NeKode ships it: in an installed app it is `resources\usage-collectors\claude-code` next to `nekode.exe`; when you run NeKode from source it is `adapters\usage-claude-code` in the repository. Setup records that folder in Claude Code's status line, so moving or uninstalling NeKode breaks the status line until you run setup again from the new folder. Claude Code, not NeKode, starts the writer, so it needs Node.js on the `PATH` of the shell Claude Code uses (or `--node <path>`).
2. Preview the change. Nothing is written:

   ```powershell
   node setup.cjs --settings "$env:USERPROFILE\.claude\settings.json" --dir "<absolute directory>"
   ```

   `--dir` is required: there is no default directory. Use the directory shown in the account editor. The directory must not contain the settings file. The JSON result shows the current `statusLine`, the proposed one, the directory, the backup path, any warnings and the one-recorder note. Read it before continuing.
3. Apply it by repeating the command with `--apply`. Setup writes `settings.json.nekode-usage-backup.json` beside the settings file, then replaces only `statusLine.command`. An existing status-line command is kept: the writer copies its input unchanged to stdout and the previous command runs after a pipe (`collector --pass-through | <previous command>`), so its output stays on screen. `padding`, `refreshInterval` and other settings are kept. Paths use forward slashes, as Claude Code requires for Git Bash on Windows. If writing the settings fails, setup removes its backup again, so you can retry.
5. Use Claude Code. After the first response of a session the writer creates `<session_id>.json` (atomic rename); unchanged payloads and payloads without `rate_limits` write nothing.

To undo, run `node setup.cjs --settings "<same path>" --remove`. It restores the backed-up status line exactly (or removes `statusLine` if there was none) and deletes the backup. If you changed the status line after setup, removal stops and you restore it manually from the backup. Session files stay in the directory; delete them yourself if you no longer need them.

## Pruning old session files

Claude Code creates a new session id for each session, so the directory gains one small file per session, and nothing deletes them: the reader never writes, and the NeKode writer only replaces the file of its own session. Every poll lists the directory and checks the modification time of each `*.json` file, then reads at most the 256 newest. Thousands of files make each poll slower.

Delete old session files from time to time, for example files not modified in the last 14 days:

```powershell
Get-ChildItem "<snapshot directory>" -Filter *.json -File |
  Where-Object LastWriteTime -lt (Get-Date).AddDays(-14) | Remove-Item
```

Replace the path with your directory. A deleted file whose window has not reset yet does not lower the value NeKode shows (see above), and an active session writes its file again on its next status-line update.

## Troubleshooting

| Symptom | Cause and action |
|---|---|
| `Cannot read Claude snapshot directory. It does not exist yet` | No status-line run has written a file since setup, or the paths differ. Start Claude Code, send a message, and compare the directory with the account. |
| Rows say `Unavailable` (`not_reported`) | Your plan does not report subscription limits to the status line, no session has had an API response yet, or every file was skipped. |
| Polls get slow or the directory is large | Old session files accumulate. Prune them as described above. |
| Values stay `Age unknown` | Expected: Claude Code does not report observation time. |
| `Expired - refresh required` | The reset passed and no session has reported since. Use Claude Code again. |
| Values from another account appear | Two accounts share a directory. Give each account its own `--dir` and NeKode account. |
| Previous status line disappeared | The compound-command warning applied, or the command needs its own shell syntax. Run `--remove`, move the command into a script, and set up again. |
| Status line shows nothing at all | Node is not on Claude Code's shell `PATH`. Re-run setup with `--node <absolute node.exe>`. The writer prints a one-line reason to stderr without payload content. |
| `already configured` / `backup already exists` | Run `--remove` first. |
