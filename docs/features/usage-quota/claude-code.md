# Claude Code usage adapter

The bundled `Claude Code` service shows your Claude plan limits: the 5-hour window and the 7-day window, with daily slices for the 7-day window. It reads the Claude Code sign-in on this computer and asks Anthropic for the current values on every read. Contract: usage-quota spec L10-L14.

Package: [adapters/usage-claude](../../../adapters/usage-claude), shipped with NeKode as `usage-adapters/usage-claude` and run on the NeKode executable in Node mode. Manifest id `claude-code-usage`, provider `claude`, source kind `api`, marked experimental. NeKode reads it at most every 300 seconds on schedule; a manual `Refresh usage` reads it live at most once per 60 seconds (spec L5).

Tested against sanitized fixture credentials in a temporary config directory and a local fixture HTTP server only. A live read against `api.anthropic.com` with a real sign-in was not run (`not run: needs the user's Claude Code sign-in`); fixture results do not prove that your account or a later version of the endpoint works.

## Privileges

Read this before enabling the service. NeKode shows the same explanation in `App Settings > Usage` when you select it.

- It uses the Claude Code sign-in on this computer: it reads the OAuth access token from the Claude Code credentials file.
- It sends that token only to `api.anthropic.com`, in the `Authorization` header of one request per read. Redirects are refused, so the token never goes to another host.
- It never reads or sends the refresh token, never refreshes the access token, never writes the credentials file, and never changes the Claude Code sign-in. When the access token expires, Claude Code renews it the next time you use Claude Code.
- It never writes the token to its output, errors, diagnostics (stderr) or command-line arguments. The token is not stored in NeKode settings, the usage cache or the JSON export.

The endpoint `GET /api/oauth/usage` is not publicly documented by Anthropic. It can change or stop working without notice; the service then fails with a `protocol` error and shows no older values in place of a live read. There is no fallback endpoint.

## What one read does

Scheduled reads and a manual refresh run the same steps (spec L2, L12):

1. Resolve the config directory: the `Claude Code config directory` field if set (it must be an absolute path); otherwise `CLAUDE_CONFIG_DIR` from NeKode's environment (it must also be an absolute path; a relative value fails as `config`); otherwise `~/.claude`.
2. Read `<config directory>/.credentials.json` (at most 64 KiB) and take `claudeAiOauth.accessToken` and `claudeAiOauth.expiresAt` (epoch milliseconds). An expired token fails as `auth` without a request.
3. Send exactly one `GET https://api.anthropic.com/api/oauth/usage` with `Authorization: Bearer <access token>` and `anthropic-beta: oauth-2025-04-20`. One 10-second deadline covers the request and the response body.
4. Map the response and exit.

## Mapping

| Response field | Metric |
|---|---|
| `five_hour.utilization`, `five_hour.resets_at` | `five_hour`, "5-hour window", window of 18000 seconds |
| `seven_day.utilization`, `seven_day.resets_at` | `seven_day`, "7-day window", window of 604800 seconds |

`usedPercent` is `utilization`. `resetsAt` is `resets_at` converted to UTC with at most millisecond precision (the endpoint sends microseconds and a `+00:00` offset). `periodStart` is `resetsAt` minus the window duration. `observedAt` is the time the response arrived. A missing or null window, or a null `utilization`, shows that window as unavailable (`not_reported`); a null `resets_at` keeps the percentage without a reset time. Other response fields, such as per-model windows, are ignored.

## Setup

1. Sign in to Claude Code on this computer (`claude`, then `/login`).
2. In `App Settings > Usage`, turn on `Show usage quota`, choose `Add account` and the `Claude Code` service, and enter a name.
3. Leave `Claude Code config directory` empty to use `CLAUDE_CONFIG_DIR` or `~/.claude`.
4. `Test`, then `Save`.

### Several Claude accounts

Use one NeKode account per Claude Code config directory. Claude Code keeps one sign-in per config directory, so sign in to each Claude account with its own `CLAUDE_CONFIG_DIR` (for example `C:\Users\you\.claude-work`), then add one NeKode account per directory and enter that absolute path in `Claude Code config directory`.

## Errors

| Error | Cause and action |
|---|---|
| `auth` | No credentials file, no access token, no expiry, an expired token, or HTTP 401 or 403. Open Claude Code and sign in again, then retry. Scheduled reads stay suspended until you save the account or refresh manually. |
| `config` | The config directory field is not an absolute path, or the field is empty and `CLAUDE_CONFIG_DIR` is set to a relative path. Enter an absolute path in the field, or set `CLAUDE_CONFIG_DIR` to an absolute path (or unset it) and leave the field empty. |
| `io` | The credentials file exists but cannot be read (for example, access denied). |
| `rate_limited` | HTTP 429. NeKode waits for `Retry-After` seconds (at most 86400), otherwise 300 seconds; a manual refresh reports this as `backoff`. |
| `protocol` | Another HTTP status, an invalid body, or an unexpected response shape. The endpoint may have changed. Messages never include the response body. |
| `network` | Anthropic cannot be reached. |
| `timeout` | No complete answer within 10 seconds. |

## Removed snapshot service

The Claude Code session snapshot source was removed on 2026-10-23 (spec L6-L8): NeKode no longer reads a snapshot directory written by a Claude Code status line and no longer ships the snapshot writer. An account saved with the snapshot service (`claude-code-snapshots`) stays listed with the message "This service is no longer available. Remove the account and add it again with a supported service." Its cached values and pin are kept until you remove it. Add a new account with the `Claude Code` service instead.
