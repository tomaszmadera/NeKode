# OpenRouter account balance adapter

This optional adapter shows your OpenRouter account balance in USD. It makes one documented metadata request per poll and nothing else: no model calls, purchases, top-ups or key changes. You can use NeKode's usage panel without it; a user who does not want to create a Management key can import a collector's JSON instead.

Package: [adapters/usage-openrouter](../../../adapters/usage-openrouter). Requires Node.js 18 or later on `PATH` (the manifest runs `node index.cjs`; it uses the built-in `fetch`).

Source documentation, checked on 2026-10-21:

- [Get remaining credits](https://openrouter.ai/docs/api-reference/get-credits): `GET https://openrouter.ai/api/v1/credits`, `Authorization: Bearer <key>`, a Management key is required, response `data.total_credits` and `data.total_usage`, and 403 `Only management keys can perform this operation` for other keys.
- [Management API keys](https://openrouter.ai/docs/guides/overview/auth/management-api-keys): what a Management key can do and how to create one.
- [FAQ, credit and billing systems](https://openrouter.ai/docs/faq): "OpenRouter uses a credit system where the base currency is US dollars."

Tested against sanitized fixtures and a local fake server only. A live read against an OpenRouter account was not run (`not run: account access unavailable`); fixture results do not prove that your account or a later API version works.

## Management key privileges

Read this before enabling the adapter. NeKode shows the same explanation in `App Settings > Usage` when you select this source.

OpenRouter returns the account balance only to a Management key. According to OpenRouter's documentation, a Management key:

- cannot call models (completion endpoints refuse it);
- is account-wide and unscoped: one key covers administrative actions across all of the account's workspaces;
- can create, change and delete API keys, and is accepted by administrative routes such as analytics, BYOK credentials, credits, guardrails, organization settings and workspaces;
- can be created only by an Organization Admin for organization accounts.

Anyone who obtains the key can therefore manage your API keys and account administration. NeKode limits its own use to one `GET /api/v1/credits` per poll, stores the key encrypted, and never shows, exports or logs it. Reduce the risk by creating a dedicated key with an expiration date, and revoke it in OpenRouter when you stop using the adapter. An expired key fails with 401.

## What one read does

1. Sends `GET https://openrouter.ai/api/v1/credits` with `Authorization: Bearer <your key>` and `Accept: application/json`. Redirects are refused, so the key is never sent to another host.
2. Maps the response to one metric and exits. One 20-second deadline covers the request and the response body. It ends before NeKode's 30-second plugin limit, so a slow API reports the adapter's own `timeout`.

There is no fallback: an ordinary API key is refused with an explicit configuration error. The adapter never calls `/api/v1/key` or another endpoint and never shows a per-key spending limit as the account balance.

NeKode polls this adapter at most every 300 seconds (the manifest minimum) while `Show usage quota` is on and the app is visible.

## Mapping

| Response field | Use |
|---|---|
| `data.total_credits` | Total credits purchased; must be a nonnegative number |
| `data.total_usage` | Total credits used; must be a nonnegative number |

The metric id is `balance`, kind `balance`, label `Account balance`, with `amount = total_credits - total_usage` (rounded to six decimal places to remove floating-point noise) and currency `USD`, because OpenRouter credits use US dollars as their base currency (FAQ above). A negative result is shown as returned. A balance has no period, reset or percentage bar.

`observedAt` is the time the response arrived. The endpoint returns current account totals, so the completed GET time represents a current snapshot (spec rule 14).

## Setup

1. Read [Management key privileges](#management-key-privileges).
2. In OpenRouter, open Management API Keys, choose `Create New Key`, name it (for example `NeKode usage`), set an expiration and copy the key; it is shown only once.
3. Copy `adapters/usage-openrouter` into `<userData>/usage-adapters/usage-openrouter` (or your configured adapters directory). App Settings lists `OpenRouter account balance` with its executable and the privilege explanation; enabling it lets it run with your user permissions.
4. In `App Settings > Usage`, turn on `Show usage quota` and add a connection: provider id `openrouter` (the adapter reports this id), an account label, and this source. Enter the key in `OpenRouter Management key`.
5. Test the connection, then enable and save it.

The key is stored encrypted with Electron `safeStorage`. If encryption is unavailable, NeKode refuses to save it and never stores plaintext. The field is write-only: leave it blank to keep the stored key, or use `Clear stored OpenRouter Management key`. NeKode sends the key to the adapter over stdin only; the adapter sends it only in the `Authorization` header and never writes it to output, errors or command-line arguments.

## Troubleshooting

| Error | Cause and action |
|---|---|
| `Usage source config. Enter an OpenRouter Management key, not an ordinary API key...` | OpenRouter returned 403: the key is an ordinary API key. Create a Management key and enter it. Also shown when no key is stored. Automatic retries stop until you change the connection or refresh. |
| `Usage source auth` | OpenRouter returned 401: the key is invalid, expired or revoked. Create a new Management key and save it. Automatic retries stop until you change the connection or refresh. |
| `Usage source rate_limited` | OpenRouter returned 429. NeKode waits at least 300 seconds (the adapter minimum), longer when `Retry-After` or the failure backoff asks for more. |
| `Usage source timeout` | No complete answer within 20 seconds. Retries back off at 300 seconds (the adapter minimum). |
| `Usage source network` | The API could not be reached or returned a 5xx error. Retries back off. |
| `Usage source unsupported` | The endpoint returned 404, or Node.js has no `fetch` (update to Node.js 18 or later). |
| `Usage source protocol` | The response was not the documented shape, too large, or another HTTP error. Check for an adapter update. |

After a failure the last balance stays visible with its age and the error. The adapter writes nothing to stderr, and NeKode never shows plugin diagnostics or provider response bodies.
