# ElevenLabs subscription usage adapter

This optional adapter shows your ElevenLabs character usage against the subscription limit. It makes one documented metadata request per poll and nothing else: no generation, voice, billing or account changes.

Package: [adapters/usage-elevenlabs](../../../adapters/usage-elevenlabs). Requires Node.js 18 or later on `PATH` (the manifest runs `node index.cjs`; it uses the built-in `fetch`).

Source documentation, checked on 2026-10-21:

- [Get user subscription](https://elevenlabs.io/docs/api-reference/user/subscription/get): `GET /v1/user/subscription`, base URL `https://api.elevenlabs.io`, and the data-residency base URLs.
- [Authentication](https://elevenlabs.io/docs/api-reference/authentication): the API key goes in the `xi-api-key` header.

Tested against sanitized fixtures and a local fake server only. A live read against an ElevenLabs account was not run (`not run: account access unavailable`); fixture results do not prove that your account or a later API version works.

## What one read does

1. Sends `GET <base URL>/v1/user/subscription` with `xi-api-key: <your key>` and `Accept: application/json`. Redirects are refused, so the key is never sent to another host.
2. Maps the response to one metric and exits. One 20-second deadline covers the request and the response body. It ends before NeKode's 30-second plugin limit, so a slow API reports the adapter's own `timeout`.

NeKode polls this adapter at most every 300 seconds (the manifest minimum) while `Show usage quota` is on and the app is visible.

## Mapping

| Response field | Metric value | Notes |
|---|---|---|
| `character_count` | `used` | Characters used in the current period; must be a nonnegative integer |
| `character_limit` | `limit` | Characters allowed in the current billing period |
| `next_character_count_reset_unix` | `resetsAt` | Unix seconds; `null` or absent means the reset is unknown |
| (fixed) | `unit: "characters"` | The API reference states the unit of both counts is characters |

The metric id is `characters`, kind `credits`, label `Characters`. The panel shows the percentage `used / limit`.

- A zero limit is shown as `0 / 0 characters` without a percentage; a nonpositive limit never produces a percentage.
- An absent or `null` limit is `Unavailable` with reason `limit_not_reported`, never 0%.
- The cycle start is unknown: `billing_period` and `character_refresh_period` name a period length, not a start time, and a monthly reset alone cannot determine the start. `periodStart` stays `null`, so the panel shows a continuous bar and no pace advice.
- `observedAt` is the time the response arrived. The endpoint returns the current subscription state, so the completed GET time represents a current snapshot (spec rule 14).

Tier, status, currency, invoices, voice limits and every other field are discarded and never reach NeKode's cache or export.

## Setup

1. Create an API key in ElevenLabs. If you restrict the key's endpoint access, allow it to read user data (the subscription endpoint is under `/v1/user`); the exact permission name is in your ElevenLabs API key settings.
2. Copy `adapters/usage-elevenlabs` into `<userData>/usage-adapters/usage-elevenlabs` (or your configured adapters directory). App Settings lists `ElevenLabs subscription` with its executable; enabling it lets it run with your user permissions.
3. In `App Settings > Usage`, turn on `Show usage quota` and add a connection: provider id `elevenlabs` (the adapter reports this id), an account label, and this source. Enter the key in `ElevenLabs API key`. Leave `API region` on `default` unless your workspace uses ElevenLabs data residency (`us`, `eu`, `in`, `sg`).
4. Test the connection, then enable and save it.

The key is stored encrypted with Electron `safeStorage`. If encryption is unavailable, NeKode refuses to save it and never stores plaintext. The field is write-only: leave it blank to keep the stored key, or use `Clear stored ElevenLabs API key`. NeKode sends the key to the adapter over stdin only; the adapter sends it only in the `xi-api-key` header and never writes it to output, errors or command-line arguments.

## Troubleshooting

| Error | Cause and action |
|---|---|
| `Usage source auth` | ElevenLabs returned 401 or 403: the key is invalid, revoked, or may not read user data. Enter a valid key and save. Automatic retries stop until you change the connection or refresh. |
| `Usage source config` | No key is stored, or the region is not one of the documented values. Set the key and region, then save. |
| `Usage source rate_limited` | ElevenLabs returned 429. NeKode waits at least 300 seconds (the adapter minimum), longer when `Retry-After` or the failure backoff asks for more. |
| `Usage source timeout` | No complete answer within 20 seconds. Retries back off at 300 seconds (the adapter minimum). |
| `Usage source network` | The API could not be reached or returned a 5xx error. Retries back off. |
| `Usage source unsupported` | The endpoint returned 404, or Node.js has no `fetch` (update to Node.js 18 or later). |
| `Usage source protocol` | The response was not the documented shape (for example a non-integer count), too large, or another HTTP error. Check for an adapter update. |
| `Unavailable` with `limit_not_reported` | The response had no character limit. Usage is not shown as zero. |

The adapter writes nothing to stderr, and NeKode never shows plugin diagnostics or provider response bodies.
