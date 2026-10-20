# Claude Code usage collector

The collector turns the subscription rate limits that Claude Code passes to its [status line](https://code.claude.com/docs/en/statusline) into a normalized usage file. NeKode reads that file with the built-in `Normalized JSON file` adapter. Nothing is sent to a server and no model is called.

Package: [adapters/usage-claude-code](../../../adapters/usage-claude-code). Requires Node.js on the `PATH` of the shell Claude Code uses (or `--node <path>`).

Tested CLI version: Claude Code 2.1.304 with protocol fixtures. A live read against a Claude account was not run (`not run: account access unavailable`); fixture results do not prove that your account reports limits.

## What it reads

Only the documented `rate_limits` fields:

| Status-line field | Metric id | Notes |
|---|---|---|
| `rate_limits.five_hour.used_percentage`, `resets_at` | `five_hour` (`5h`) | 5-hour window; start is `resets_at` minus 5 hours |
| `rate_limits.seven_day.used_percentage`, `resets_at` | `seven_day` (`7d`) | 7-day window; start is `resets_at` minus 7 days |
| `rate_limits.spend_limit.used_percentage`, `resets_at` | `spend_limit` | Only when present (Claude apps gateway); no period length is derived |

`resets_at` is Unix epoch seconds. Context-window percentages, cost, session ids, paths and every other field are ignored and never written or logged.

`rate_limits` appears only for claude.ai Pro and Max subscribers (or behind a gateway spend limit), and only after the session's first API response. Claude Code drops a window once its reset passes. The collector therefore:

- writes `five_hour` and `seven_day` as `unavailable` with reason `not_reported` when they are absent, never as 0%;
- writes `invalid_value` for a window whose values are not valid numbers;
- leaves an existing file unchanged when a payload has no `rate_limits` object at all, so a new session does not erase known values; with no file yet it writes the `not_reported` placeholder.

## Freshness

The status-line payload does not say when Claude Code learned the quota values, so every metric has `observedAt: null` and NeKode shows `Age unknown`. `collectedAt` is when the collector first received that value. An unchanged payload does not rewrite the file, so repeated status-line runs never make old data look fresh. A known reset that passes shows `Expired - refresh required` until Claude Code reports a new value. Without a running Claude Code session there are no new values.

## Setup

1. Copy `adapters/usage-claude-code` to a stable folder, for example `%APPDATA%\NeKode\usage-collectors\claude-code`.
2. Choose an output file in an existing folder outside NeKode's `usage` cache, for example `%USERPROFILE%\.nekode-usage\claude.json`. Use one file per Claude account. Several Claude Code sessions of the same account may write it; each write is an atomic replace.
3. Preview the change. Nothing is written:

   ```powershell
   node setup.cjs --settings "$env:USERPROFILE\.claude\settings.json" --output "$env:USERPROFILE\.nekode-usage\claude.json" --connection-id claude-max
   ```

   The JSON result shows the current `statusLine`, the proposed one, the backup path and any warnings. Read it before continuing.
4. Apply it by repeating the command with `--apply`. Setup writes `settings.json.nekode-usage-backup.json` beside the settings file, then replaces only `statusLine.command`. An existing status-line command is kept: the collector copies its input unchanged to stdout and the previous command runs after a pipe (`collector --pass-through | <previous command>`), so its output stays on screen. `padding`, `refreshInterval` and other settings are kept. Paths use forward slashes, as Claude Code requires for Git Bash on Windows.
5. In NeKode open `App Settings > Usage`, add a connection with connection id `claude-max` (the value you passed), provider id `claude`, an account label, the `Normalized JSON file` adapter, and the output file as the input path. The file may not exist yet; NeKode retries every five seconds.
6. Use Claude Code. After the first response the panel shows the 5h and 7d rows.

To undo, run `node setup.cjs --settings "<same path>" --remove`. It restores the backed-up status line exactly (or removes `statusLine` if there was none) and deletes the backup. If you changed the status line after setup, removal stops and you restore it manually from the backup.

## Troubleshooting

| Symptom | Cause and action |
|---|---|
| `Cannot read usage file. It does not exist yet` | No status-line run has happened since setup, or the paths differ. Start Claude Code, send a message, and compare `--output` with the connection path. |
| Rows say `Unavailable` (`not_reported`) | Your plan does not report subscription limits to the status line, or no API response has happened yet in this session. |
| Values stay `Age unknown` | Expected: Claude Code does not report observation time. |
| `Expired - refresh required` | The reset passed and no session has reported since. Use Claude Code again. |
| Previous status line disappeared | The compound-command warning applied, or the command needs its own shell syntax. Run `--remove`, move the command into a script, and set up again. |
| Status line shows nothing at all | Node is not on Claude Code's shell `PATH`. Re-run setup with `--node <absolute node.exe>`. The collector writes a one-line reason to stderr without payload content. |
| `already configured` / `backup already exists` | Run `--remove` first. |
