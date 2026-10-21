# Usage connections

The local panel reads subscription allowances independently of projects and chats. Open `App Settings > Usage` and turn on `Show usage quota`; it is off at fresh install. While it is on, `Usage quota` appears beside the NeKode brand and opens the panel, with `Configure usage` when no connection is enabled.

Turning `Show usage quota` off hides the title-bar button and stops all usage activity: no file reads, adapter processes, network requests or export writes. Connections, the pin and cached values are kept, and turning it on resumes collection. `App Settings > Usage` stays available while it is off.

## Connect a local file

1. Copy [example.json](example.json) to a local file. The values are fixtures, not provider readings. Replace them with a collector's actual observations following [schema.json](schema.json).
2. Add a connection. Set its immutable connection id to the subscription's `id` (`example-account` in the example), its provider id to `example`, and an account label you recognize. Each account needs its own connection and input file. Select `Normalized JSON file` and choose the absolute input path.
3. Test the connection (`Test connection` is available only while `Show usage quota` is on). Enable it and save. Saving invalid settings retains your previous working configuration and your form. Changing account label, provider, adapter or configuration clears the old observation and pin.
4. Open Usage and choose a metric row to pin it. The initial toolbar has no pin. Removing or disabling the connection clears its pin. A failed read retains the last known value with its age and error.

CLI collection: the built-in `Claude Code session snapshots` reader reads one account's [Claude Code snapshot directory](claude-code.md) (Agent Harness or NeKode's writer), and the explicitly experimental [Codex app-server adapter](codex.md) is a plugin.

Provider APIs: the optional [ElevenLabs subscription adapter](elevenlabs.md) shows character usage against the subscription limit, and the optional [OpenRouter account balance adapter](openrouter.md) shows the account's USD balance and needs an OpenRouter Management key (read its privilege explanation first). Both are plugins that make one documented metadata GET per poll; their API keys are stored encrypted. Without either key, the local and CLI sources work unchanged.

The built-in readers require no external executable. NeKode ships the Codex, ElevenLabs and OpenRouter adapters and the Claude Code snapshot writer with the app (spec rules 17-19): a packaged app keeps them in its `resources\usage-adapters` and `resources\usage-collectors` folders next to `nekode.exe`, and a run from source uses `adapters/` in the repository. You install nothing for them, they update with NeKode, and shipped adapters run on NeKode's own Node runtime, so they need no Node.js installation.

To add your own adapter, put its folder under `<userData>/usage-adapters` (on Windows `%APPDATA%\nekode\usage-adapters`; create the folder if it does not exist). NeKode reads each immediate subfolder; there is no setting for another location. A valid adapter there with the same id as a shipped one replaces the shipped one; an invalid copy does not hide it. If you copied `usage-codex`, `usage-elevenlabs` or `usage-openrouter` there for an earlier NeKode version, delete those copies: otherwise they keep replacing the shipped adapters and keep needing Node.js. Settings then show the source as `Shipped with NeKode`. Your adapters run their manifest command unchanged, so a `node` adapter needs Node.js on `PATH`. An optional process example lives in [adapters/usage-file](../../../adapters/usage-file); it is not shipped. Copy it into `<userData>/usage-adapters` to exercise the plugin protocol. Settings show whether each source is a built-in reader, shipped with NeKode, or added in your folder. Invalid manifests remain disabled; duplicate ids among your adapters disable every duplicate. The built-in reader ids `usage-file` and `claude-code-snapshots` are reserved.

## Observation time and intervals

`observedAt` is when the producer actually knew the allowance. Use `null` if that time cannot be established. `collectedAt` records collector receipt separately; main adds `receivedAt`. Repeated file reads, file modification time and changed reset countdowns never make an observation fresh. Older observations cannot replace newer ones. Age-unknown values cannot replace dated values for the same period. An unavailable metric has a reason code and no numeric value; missing information is never represented as zero.

The panel shows fresh through five minutes, aging through sixty minutes, then stale. Expired reset windows need a new observation; NeKode never resets a provider's value locally. Seven-day windows have daily slices. Known monthly boundaries have seven-day slices plus a shorter final slice. Short or unknown intervals use a continuous bar. Pace is an elapsed-time planning comparison, not a provider restriction or prediction. Stale, expired and age-unknown data has no pace advice. Graphic fill stops at 100%; a provider's reported overage remains visible numerically. Nonpositive credit limits have no derived percentage.

Local file sources (the JSON file and Claude snapshot readers) poll no more often than five seconds, and other plugins no more often than sixty seconds or their declared longer minimum. The closed panel's pinned metric continues updating. Hidden or minimized app windows pause automatic polling. A local file source treats a missing input file and unreadable, partial or invalid JSON as transient: it keeps the last accepted values with the error and retries every five seconds without growing backoff, so a repaired or newly created file recovers automatically, and Refresh reads it again after five seconds. You can save a file connection before its producer has written the file, as long as the folder exists. Command and API plugins back off after network, timeout, protocol or validation failures at 60, 120, 240, then 300 seconds, and a declared retry deadline overrides a shorter delay. Auth/configuration/unsupported-version failures wait for a configuration change or an explicit retry; for a file source, configuration errors are paths that settings validation rejects.

Cached observations carry an opaque connection revision matched against durable settings at startup. An account or configuration change rejects the previous account's cache even if replacing that cache failed. Caches without matching identity metadata are ignored until a successful read rebuilds them.

## Optional local export

Export is off by default. Choose a distinct absolute output path and enable it. Replacing any existing newly selected output requires the explicit `Replace an existing file` setting. Main writes the complete version 1 document using a temporary sibling and atomic rename. Inputs, cache paths, junctions, symbolic links and Windows case aliases cannot be outputs. A write failure retains the previous file and appears independently from collection errors.

Export includes only enabled connections, source states, timestamps and normalized values. It excludes secrets, executable configuration, account email and raw provider/session data. Turning export off retains the last file and stops writes. A hosted web/no-code consumer needs separately configured filesystem synchronization; NeKode uploads nothing and opens no server.

## Local plugin contract

Each immediate child of the adapters directory has `usage-adapter.json`, protocol version 1, invocation command/argument array, source kind, capabilities (`window`, `credits`, `balance`), minimum refresh seconds, and a bounded config schema. Fields support `text`, `secret`, `boolean`, `choice` and `file` types, and an optional field `description` (at most 512 characters) shown as help. An optional manifest `description` (at most 1024 characters) is shown in settings whenever the source is selected, before it can be enabled; use it for required privileges. An optional `errorActions` object maps a supported error code to a fixed next action (at most 256 characters) that replaces the generic one in the displayed error. The settings panel shows the executable: enabling it permits execution with your user permissions. Plugins are trusted, not sandboxed.

Main starts one process without a shell and writes one stdin request:

```json
{"protocolVersion":1,"action":"read","config":{"path":"/absolute/input.json"},"params":{"connectionId":"example-account"}}
```

Return one JSON object, then exit 0 for success:

```json
{"protocolVersion":1,"ok":true,"data":{"schemaVersion":1,"subscriptions":[]}}
```

For an actual read, `subscriptions` must contain exactly the configured connection id and provider id. A declared error exits 1 and returns `ok:false` with an `error` containing a typed `code`, safe `message` and optional numeric `retryAfterSeconds`. Supported codes are `validation_error`, `not_found`, `protocol`, `timeout`, `auth`, `network`, `rate_limited`, `unsupported`, `config`, `io`. Main replaces plugin error messages with `Usage source <code>.` plus the manifest's `errorActions` entry or a generic next action, and never transports stderr. Limits: 30 seconds, 1 MiB stdout, 8 KiB stderr, 100 subscriptions and 50 metrics per subscription. Timeout, cancellation and application shutdown terminate process trees.

Secret fields are write-only, stored encrypted through Electron safeStorage and delivered over stdin only. Missing encryption or failed decryption blocks use with a configuration error. Leave the field blank to keep a saved secret or use its explicit clear action. No provider modules, account reads or CLI configuration changes are part of the local-file setup.

Fixture seam: the ElevenLabs and OpenRouter adapters accept `NEKODE_USAGE_TEST_BASE_URL` from the environment only when it is a loopback origin of the form `http://127.0.0.1:<port>`, so tests and the smoke can use a local fake server. Any other value is ignored and the documented provider URL is used. A packaged NeKode build removes the variable from the adapter process environment, so the seam works only when NeKode runs unpackaged (development, tests, and the smoke).
