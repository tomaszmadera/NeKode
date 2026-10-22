# Codex app-server usage adapter (experimental)

This adapter reads ChatGPT rate limits for the Codex CLI's signed-in account through [`codex app-server`](https://learn.chatgpt.com/docs/app-server). The app-server is experimental upstream and not supported for production workloads, so this adapter is experimental too: its protocol can change with any Codex release. It is off until you install and enable it.

Package: [adapters/usage-codex](../../../adapters/usage-codex). Requires Node.js on `PATH` (the manifest runs `node index.cjs`).

Tested CLI version: `codex-cli 0.163.0` (protocol mapping checked against `codex app-server generate-json-schema` from that version, plus sanitized fixtures). Older versions are refused. A live read against a ChatGPT account was not run (`not run: account access unavailable`); fixture results do not prove that your account or a later Codex release works.

## What one read does

1. Runs `codex --version` and refuses a version older than 0.163.0 or one it cannot parse (`unsupported`).
2. Starts `codex app-server` (stdio JSONL, no shell, no extra arguments).
3. Sends exactly `initialize`, `initialized`, `account/read` with `refreshToken: false`, and `account/rateLimits/read`. Server notifications and server requests are ignored.
4. Terminates the app-server process tree and returns one normalized document. One 25-second deadline covers the whole read: the version check, the app-server session and cleanup. It ends before NeKode's 30-second plugin limit, so a slow Codex reports the adapter's own `timeout`.

It never starts a thread or turn, never calls login, logout, credit, reset-credit or configuration methods, and never reads or copies Codex tokens: Codex uses its own stored auth. The account email, plan, account id and Codex home path are discarded. NeKode polls this adapter at most every 120 seconds while visible.

## Mapping

Each bucket in `rateLimitsByLimitId` (or the single `rateLimits` view when no map is returned) produces two metrics, `<limitId>.primary` and `<limitId>.secondary`, with `bucketId` set to the limit id.

- `usedPercent` maps to the percentage.
- `windowDurationMins` gives `windowDurationSeconds` and the label (`5h`, `7d`, `15m`). Primary and secondary are not assumed to be 5h or 7d.
- `resetsAt` (Unix seconds) maps to `resetsAt`; the start is `resetsAt` minus the reported duration when both exist.
- A `null` window is `unavailable` with reason `window_not_reported`, never 0%.
- `limitName` prefixes the label of non-default buckets.
- `observedAt` is the time the `account/rateLimits/read` response arrived. This method performs a backend usage read (its response carries backend-owned fields such as `ordinaryUsageAllowed` from "the same usage read"), so the response time represents a current snapshot.

Credits, plan type, reset credits and upsell data are not mapped.

## Setup

1. Check compatibility: `codex --version` must print `codex-cli 0.163.0` or later.
2. Sign in with the Codex CLI itself using ChatGPT. NeKode does not sign you in.
3. NeKode ships this adapter ([shipped adapters](usage.md)); nothing to copy. `Add account` lists `Codex CLI` marked `Experimental`, and `Advanced` shows its executable; enabling it lets it run with your user permissions.
4. Choose `Add account`, then `Codex CLI` (marked `Experimental`), and enter a name. Leave `Codex executable` empty to use `codex` from `PATH`, or set the absolute path of `codex.exe`. Script shims such as `codex.cmd` cannot run without a shell and are refused.

   An npm global install (`npm install -g @openai/codex`) puts only script shims (`codex`, `codex.cmd`, `codex.ps1`) in the npm prefix folder on `PATH`, so set the executable path. The binary is in the platform package under the npm global root: run `npm root -g`, then use `<root>\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe` (layout observed in `@openai/codex` 0.155.1 on Windows x64; on Windows ARM the package is `codex-win32-arm64`). If your version differs, search that package folder for `codex.exe`. For other installs, `(Get-Command codex).Source` in PowerShell shows the executable when it is a real `.exe`.
5. `Test`, then `Save`.

## Troubleshooting

| Error | Cause and action |
|---|---|
| `Usage source config` | Codex was not found, or the executable path is relative or a script shim. Set the absolute `codex.exe` path. |
| `Usage source unsupported` | Codex is older than 0.163.0, its version cannot be read, or the app-server lacks a method. Update Codex. Automatic retries stop until you retry or change the account. |
| `Usage source auth` | Codex is not signed in, uses an API key or another provider, or the backend denied the read. Sign in with the configured Codex CLI using ChatGPT, then retry. |
| `Usage source timeout` | The version check and app-server read did not finish within the 25-second deadline. Retries back off at 60, 120, 240 and 300 seconds. |
| `Usage source rate_limited` | app-server reported overload; NeKode waits at least 60 seconds. |
| `Usage source protocol` | app-server exited early or sent an unexpected message, likely a protocol change. Update Codex, or disable the adapter. |
| `Usage source network` | The rate-limit read failed for another reason. It retries with backoff. |

The adapter writes nothing to stderr and NeKode never shows plugin diagnostics or provider messages.
