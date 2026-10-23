# Usage accounts

The local panel reads subscription allowances independently of projects and chats. Open `App Settings > Usage` and turn on `Show usage quota`; it is off at fresh install. While it is on, `Usage quota` appears beside the NeKode brand and opens the panel, with `Configure usage` when no account is enabled.

Turning `Show usage quota` off hides the title-bar button and stops all usage activity: no adapter processes, network requests or export writes. Accounts, the pin and cached values are kept, and turning it on resumes collection. `App Settings > Usage` stays available while it is off.

## Add an account

1. Turn on `Show usage quota`, choose `Add account`, then the service that reports the account's limits. Each service runs an adapter that reads the provider through its API or CLI; NeKode assigns the provider id, so you never type an id.
2. Enter a name and the service's fields, then `Test` and `Save`. Saving stores only this account. A failed save keeps the editor and your previous configuration. Changing the name or configuration clears the old observation and pin.
3. Open Usage and choose a metric row to pin it. The initial toolbar has no pin. Removing or disabling the account clears its pin. A failed read retains the last known value with its age and error.

CLI collection: the explicitly experimental [Codex app-server adapter](codex.md). Claude Code plan limits: the experimental [Claude Code usage adapter](claude-code.md).

Provider APIs: the optional [ElevenLabs subscription adapter](elevenlabs.md) shows character usage against the subscription limit, and the optional [OpenRouter account balance adapter](openrouter.md) shows the account's USD balance and needs an OpenRouter Management key (read its privilege explanation first). Both make one documented metadata GET per read; their API keys are stored encrypted.

NeKode ships the Claude Code, Codex, ElevenLabs and OpenRouter adapters with the app (spec rules 17-19): a packaged app keeps them in its `resources\usage-adapters` folder next to `nekode.exe`, and a run from source uses `adapters/` in the repository. You install nothing for them, they update with NeKode, and shipped adapters run on NeKode's own Node runtime, so they need no Node.js installation.

To add your own adapter, for example one that reads a service collecting usage from several computers, put its folder under `<userData>/usage-adapters` (on Windows `%APPDATA%\nekode\usage-adapters`). `Advanced > Open adapters folder` creates and opens it. Keep such an adapter outside the NeKode repository. NeKode reads each immediate subfolder; there is no setting for another location. A valid adapter there with the same id as a shipped one replaces the shipped one; an invalid copy does not hide it. If you copied `usage-codex`, `usage-elevenlabs` or `usage-openrouter` there for an earlier NeKode version, delete those copies: otherwise they keep replacing the shipped adapters and keep needing Node.js. Your adapters run their manifest command unchanged, so a `node` adapter needs Node.js on `PATH`. `Advanced` shows whether each adapter is shipped with NeKode or added by you, with its executable and any manifest error; invalid adapters are not offered in `Add account`. Reopen settings after adding one. Invalid manifests remain disabled; duplicate ids among your adapters disable every duplicate. An adapter that declares protocol version 1 is listed as invalid until it is updated to protocol version 2 (see [Local plugin contract](#local-plugin-contract)).

### Removed JSON file and Claude snapshot services

NeKode no longer reads usage from a JSON file or from Claude Code session snapshots (spec L6). An account saved with the `Custom JSON file` (`usage-file`) or the snapshot `Claude Code` (`claude-code-snapshots`) service stays in the list, is never read, and shows "This service is no longer available. Remove the account and add it again with a supported service." Its cached values stay visible as old data and its pin is kept until you remove the account. NeKode does not convert it to another service. The ids `usage-file` and `claude-code-snapshots` cannot be used by an adapter.

## Observation time and intervals

`observedAt` is when the producer actually knew the allowance. Use `null` if that time cannot be established. `collectedAt` records collector receipt separately; main adds `receivedAt`. Repeated reads of an unchanged report and changed reset countdowns never make an observation fresh. Older observations cannot replace newer ones. Age-unknown values cannot replace dated values for the same period. An unavailable metric has a reason code and no numeric value; missing information is never represented as zero.

The panel shows fresh through five minutes, aging through sixty minutes, then stale. Expired reset windows need a new observation; NeKode never resets a provider's value locally. Seven-day windows have daily slices. Known monthly boundaries have four equal slices. Short or unknown intervals use a continuous bar. Pace is an elapsed-time planning comparison, not a provider restriction or prediction. Any open window gets pace advice, including stale and age-unknown observations, because usage within a window never decreases; expired windows get none. Unused allowance of past slices shows in red with the `up-arrow Npp` hint. Graphic fill stops at 100%; a provider's reported overage remains visible numerically. Nonpositive credit limits have no derived percentage.

Automatic polling reads each account no more often than every sixty seconds or the adapter's declared longer minimum (`minimumRefreshSeconds`), with the adapter action `read`. The closed panel's pinned metric continues updating. Hidden or minimized app windows pause automatic polling. Automatic polls back off after network, timeout, protocol or validation failures at 60, 120, 240, then 300 seconds, and a declared retry deadline overrides a shorter delay. Auth, configuration and unsupported-version failures stop automatic polling until a configuration change or a manual refresh.

`Refresh usage` asks every enabled account for a live read with the adapter action `refresh`: the adapter must fetch each value it returns from the provider during that request (spec L2-L3). A manual refresh reads an account when at least 60 seconds have passed since the start of its last read, whether automatic or manual, and no provider retry deadline (a `rate_limited` failure's `retryAfterSeconds`) is pending. It ignores the adapter minimum, the growing backoff and the auth/configuration stop. An account inside that limit is reported as waiting, with the remaining time and the reason: the 60-second limit or provider backoff. After any completed read, the next automatic poll is due the adapter minimum after that read started.

Cached observations carry an opaque connection revision matched against durable settings at startup. An account or configuration change rejects the previous account's cache even if replacing that cache failed. Caches without matching identity metadata are ignored until a successful read rebuilds them.

## Optional local export

Export is off by default. Choose a distinct absolute output path and enable it. Replacing any existing newly selected output requires the explicit `Replace an existing file` setting. Main writes the complete version 1 document using a temporary sibling and atomic rename. Inputs, cache paths, junctions, symbolic links and Windows case aliases cannot be outputs. A write failure retains the previous file and appears independently from collection errors.

The `Write usage to a JSON file` section has its own `Save`. Export includes only enabled accounts, source states, timestamps and normalized values. It excludes secrets, executable configuration, account email and raw provider/session data. Turning export off retains the last file and stops writes. A hosted web/no-code consumer needs separately configured filesystem synchronization; NeKode uploads nothing and opens no server.

## Local plugin contract

Each immediate child of the adapters directory has `usage-adapter.json`, protocol version 2, invocation command/argument array, source kind (`api` or `cli`), capabilities (`window`, `credits`, `balance`), minimum refresh seconds, and a bounded config schema. A manifest with another protocol version is listed as invalid: "This adapter uses an unsupported protocol version. Update it to protocol version 2, which requires live refresh." Fields support `text`, `secret`, `boolean`, `choice` and `file` types, and an optional field `description` (at most 512 characters) shown as help. An optional manifest `description` (at most 1024 characters) is shown in settings whenever the source is selected, before it can be enabled; use it for required privileges. An optional `errorActions` object maps a supported error code to a fixed next action (at most 256 characters) that replaces the generic one in the displayed error. Optional service metadata: `providerId` (same format as `id`; NeKode assigns it to every account of this adapter and checks it on each read), `summary` (at most 160 characters, shown in `Add account`) and `experimental` (boolean, shown as `Experimental`). Without `providerId`, accounts use the adapter id and accept any reported provider id. The settings panel shows the executable: enabling it permits execution with your user permissions. Plugins are trusted, not sandboxed.

Main starts one process without a shell and writes one stdin request. `action` is `read` for automatic polling and `refresh` only for a manual `Refresh usage`; every adapter must implement both:

```json
{"protocolVersion":2,"action":"refresh","config":{"region":"default"},"params":{"connectionId":"example-account"}}
```

Return one JSON object, then exit 0 for success:

```json
{"protocolVersion":2,"ok":true,"data":{"schemaVersion":1,"subscriptions":[]}}
```

For `refresh`, the adapter obtains every value it returns from the provider during this request, never from its own cache, a previous process or a file another program wrote; for `read` it may use the same path. An adapter that cannot reach the provider fails with its typed error and never substitutes older values. Set `observedAt` to the time the provider response arrived, unless the provider reports an earlier observation time. Main rejects a `refresh` response with any `available` metric whose `observedAt` is missing or earlier than the request start (compared in whole seconds) as `protocol` ("Usage adapter did not return a live refresh.") and keeps the previous observation; `unavailable` metrics are exempt.

For an actual read, `subscriptions` must contain exactly one subscription with the account's id (`params.connectionId`), and its provider id when the manifest declares `providerId`. A declared error exits 1 and returns `ok:false` with an `error` containing a typed `code`, safe `message` and optional numeric `retryAfterSeconds`. Supported codes are `validation_error`, `not_found`, `protocol`, `timeout`, `auth`, `network`, `rate_limited`, `unsupported`, `config`, `io`. Main replaces plugin error messages with `Usage source <code>.` plus the manifest's `errorActions` entry or a generic next action, and never transports stderr. Limits: 30 seconds, 1 MiB stdout, 8 KiB stderr, 100 subscriptions and 50 metrics per subscription. Timeout, cancellation and application shutdown terminate process trees. The normalized document is described by [schema.json](schema.json), with a sample in [example.json](example.json).

Secret fields are write-only, stored encrypted through Electron safeStorage and delivered over stdin only. Missing encryption or failed decryption blocks use with a configuration error. Leave the field blank to keep a saved secret or use its explicit clear action.

Fixture seam: the Claude Code, ElevenLabs, and OpenRouter adapters accept `NEKODE_USAGE_TEST_BASE_URL` from the environment only when it is a loopback origin of the form `http://127.0.0.1:<port>`, so tests and the smoke can use a local fake server. Any other value is ignored and the documented provider URL is used. A packaged NeKode build removes the variable from the adapter process environment (on Windows also every variant of its name in another letter case), so the seam works only when NeKode runs unpackaged (development, tests, and the smoke).
