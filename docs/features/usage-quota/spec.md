# Usage quota

Status: Not delivered (approved contract; implementation pending).
Path: `docs/features/usage-quota/spec.md`.

## Goal

Show subscription and account allowances in one global panel, with an optional pinned meter on the title bar. Collection must be independent of project, chat, and agent profile. Missing or old data must remain distinguishable from zero usage.

This is the approved contract for NEKODE-90. On 2026-10-20 the user approved all three implementation stages: local panel and JSON import/export, Claude/Codex collection, and ElevenLabs/OpenRouter adapters. Codex remains explicitly experimental; provider access and CLI configuration changes require their separately described opt-in. No commit, push, worktree creation, or publication is authorized. Source research and its limits are in [analysis.md](analysis.md).

## Related requirements

- [Local setup and adapter protocol](usage.md), [JSON schema](schema.json), and [example observations](example.json) document the Stage 1 file integration.
- NEKODE-90: subscription quotas, optional integration, reuse of existing collection, provider adapters.
- [Product requirements](../../product/requirements.md): English UI and terminal-first agent execution.
- [UX/UI](../../UX-UI.md) and [design system](../../references/NeKode-Design-System.md).
- User-provided visual reference: local `tmp/nekode-prototype/Main.dc.html`, usage panel and toolbar. The dimensions and behaviours needed for implementation are specified below; a public clone need not contain that local export.

## Scope

Global `Usage` settings, subscription records, optional local adapters, normalized quota observations, cached rendering, pin persistence, opt-in JSON export, and the panel. Initial integrations: normalized JSON input, Claude Code status-line collector, explicitly experimental Codex app-server adapter, ElevenLabs subscription, and OpenRouter account balance.

## Non-goals

Model calls, prompt injection, scraping a terminal or billing website, billing mutations, top-ups, consuming reset credits, quota enforcement, token-based estimates of subscription percentages, arbitrary hosted no-code synchronization, plugin marketplace, and historical analytics. No changes to Agent Harness collection or upload. Direct Command Code, AGY, and Grok adapters await separate source confirmation; imported observations can represent these subscriptions.

## Behaviour

### Configuration and identity

1. `App Settings > Usage` manages subscription connections globally. A connection has an immutable local id, user-facing account label, provider id, selected adapter, enabled flag, and adapter configuration. Show source type and supported capabilities. No adapters run until explicitly configured and enabled. The toolbar entry opens an empty state with `Configure usage` when none are enabled.
2. One connection represents one subscription/account scope, regardless of how many projects, chats, or profiles use it. The user assigns the account scope; do not infer identity from an executable name, email in a prompt, or model. Each quota has a stable id within that connection, including any provider bucket id. Configure one authoritative source per connection. Switching accounts or adapters invalidates its old data and pin target. Two different accounts remain separate, with distinct labels.
3. Save/test configuration through main. Native path pickers select the adapter directory or JSON input. Show pending, success, and typed error states. A failed save preserves the form and previous working configuration. Disable/remove stops scheduling and cancels obsolete requests; late results cannot recreate the connection.

### Panel and toolbar

4. Add a 32px-high `Usage quota` button to the title bar, after the brand, leaving native caption controls and a usable drag region. Interactive descendants use `no-drag`. At narrow widths the button may collapse to an accessible icon. The existing title-bar height stays unchanged.
5. Clicking toggles a panel anchored to the button, approximately 6px below the title bar. Width 400px, maximum viewport width minus 24px, maximum height to the bottom margin, vertical scrolling. Clamp the anchor inside the viewport instead of hard-coding the prototype's `left: 250px`. Header has `Usage`, a source/freshness summary, `Refresh usage`, and `Close usage panel`. Outside click and Escape close it; focus enters the panel, remains within it while open, and returns to the trigger. The panel has an accessible dialog name and no drag region.
6. Match the prototype's compact rows: about 30px high, 14px horizontal padding, 10px column gaps, a 20px provider/account avatar on the first row, quota period, graphic, percentage, and reset/pace hint. Default desktop columns are `132px minmax(0, 1fr) 36px 60px`; narrow layouts reflow without losing values or keyboard controls. Group rows under the subscription label; additional rows retain an accessible full label even when repeated visual names are hidden.
7. Use theme tokens with the reference dark palette as the visual target: panel `#151823`, border `#2f364e`, track `#232838`, fill `#8b7cf6`, current slice outline `#7dd3fc`, unused past slice `rgba(245,158,11,.45)`, pin background `#262b3f`. Panel radius 10px and shadow `0 20px 50px rgba(0,0,0,.55)`. Main labels use 12px monospace, percentage 12px bold, and secondary text 11px. Preserve contrast and focus indicators in every supported theme. Prefer existing tokens over adding equivalent hard-coded colours.
8. Known short windows show a bar, percentage, and reset countdown. A known fixed seven-day window shows seven equal elapsed-time slices anchored to that window, not the calendar week. A known monthly cycle splits its actual interval into seven-day slices with a shorter last slice. Use segmentation/pace only when cycle boundaries are known. Otherwise show a continuous percentage bar and known reset. A balance row shows currency and amount without a percentage bar. Do not fabricate 5h, 7d, monthly, or provider-specific rows.
9. Clicking a valid metric row pins it to the toolbar. Persist `{connectionId, metricId}` globally across restarts; highlight the selected row and expose `aria-pressed`. The toolbar repeats that metric's avatar, period, miniature graphic, value, and freshness. Preserve a pin through refresh failures, with its explicit unavailable/old state. If the target is removed or changes identity, clear it and show the neutral `Usage` button. Do not silently pin OpenRouter or another metric. Initially no metric is pinned.
10. Every configured source has a textual last-observation age and status available without relying on colour or hover. Known ages: up to 5 minutes fresh, over 5 through 60 minutes aging, over 60 minutes stale, matching the prototype's green dot, amber dot, and coral ring/dimmed row. Errors and expired windows override a fresh badge; a recent file read cannot erase them. Tooltips add exact timestamp, account/scope, source, and reset details. The toolbar provides the same information in its accessible name or description.
11. Refresh retains existing rows and focus, shows `Refreshing usage...`, and deduplicates in-flight requests. Each connection succeeds or fails independently. With no observations show `No usage data yet`; with no source capability show `Unavailable`. Failure retains the last successful observation with its age and error, not a zero value.

### Collection and freshness

12. Main owns one scheduler and one cache per connection. While the application is visible, poll API/command sources at most once per 60 seconds, or less frequently if the adapter declares a larger minimum. Poll configured local JSON inputs at most once per 5 seconds. The pinned meter continues updating with the panel closed. Hidden/minimized windows pause polling; showing the app performs one due refresh. Shutdown clears timers and terminates child processes. Disabled/unconfigured sources produce no file reads or network/process activity.
13. Manual refresh may request an immediate read but obeys single-flight, adapter minimum interval, and provider backoff. After network/timeout failures retry at 60, 120, 240, then at most every 300 seconds. A rate-limit retry deadline overrides a shorter delay. Authentication, unsupported-version, and invalid-configuration failures suspend automatic retries until configuration changes or an explicit retry. One source cannot block another. Local JSON file sources (decision 2026-10-20): a missing input file and protocol, validation, or I/O failures are transient, not invalid configuration; automatic collection retries at the 5-second local cadence without growing backoff, and manual refresh skips failure backoff for that source while still obeying single-flight and the 5-second minimum interval. Invalid configuration for a file source means a path the settings validation rejects (not absolute, alias, or input/output overlap). Command and API sources keep the 60, 120, 240, 300-second schedule for protocol and validation failures.
14. Separate `observedAt` (when the source actually knew the value), `receivedAt` (when main accepted it), and `collectedAt` (when the adapter ran). Only `observedAt` determines data age. A poll of unchanged cached data preserves its observation time. If the source cannot establish observation age, set `observedAt: null`, display `Age unknown`, and do not claim fresh data. No guessing freshness from file mtime, adapter execution, or a changed reset countdown. Reject observation timestamps more than 60 seconds in the future. An older observation cannot overwrite a newer one for the same connection and metric; an age-unknown replacement cannot overwrite a dated observation for the same period without an explicit cache invalidation. An API response without an observation timestamp may use its completed GET time only when the endpoint represents a current snapshot, with this mapping documented by the adapter.
15. When the reset time passes without a new valid observation, that window becomes `Expired - refresh required`; retain its historical value as old data and exclude pace calculations. Do not advance the period or reset usage locally. Claude's documented status-line payload has no observation timestamp for quota, so its basic collector uses `observedAt: null` and reports the collector receipt time separately. Repeated payloads cannot become fresh just because the status-line script ran. A missing/removed window is explicit unavailability, not zero. Independent writers use separate files; one collector owns each input.

## Business rules

- Usage percentages describe provider-reported allowance, never context-window usage or a sum of session costs. Finite percentages are nonnegative; raw values above 100 remain visible if the provider supports overage. Clamp only graphic fill to `[0, 100]`. A nonpositive credit limit cannot produce a percentage.
- For known `[start, end)` intervals, elapsed proportion is `(now - start) / (end - start)` clamped to `[0, 1]`. Current slice and equal-use targets use that interval. Use absolute timestamps and actual interval lengths, not machine weekdays or a hard-coded month length. Re-render countdown and freshness locally without relabelling observations as new.
- Within a slice's lower/upper share, show no pace warning. Below the lower share, tint the unused past portion amber and show `up-arrow Npp`; above the upper share, stripe future-slice consumption and expose `Ahead of pace` accessibly. Differences are percentage points rounded to a whole point. Tooltips explain this is a planning comparison, not a provider restriction or a prediction that quota will certainly expire unused. Stale, expired, or age-unknown data has no pace advice.
- Derive duration from an explicit provider contract or response. Codex `primary` and `secondary` do not intrinsically mean 5h/7d; preserve multiple `limitId` buckets. A reported reset plus an explicitly fixed duration can determine the start; a monthly reset alone cannot.
- OpenRouter balance is account-wide `total_credits - total_usage`, displayed in USD as documented, including a negative value if returned. Never substitute a per-key spending cap for account balance. ElevenLabs percentage uses the subscription count/limit and labels the unit from the API mapping.

## Authorization

Only the trusted renderer can invoke typed usage channels. Main validates all input, configured ids, paths, versions, and payload bounds before mutation or adapter invocation. Do not weaken Electron isolation.

Adapters are trusted local executables, not a sandbox. Settings must show the executable and explain that enabling a plugin allows it to run with the user's permissions. Spawn only a manifest from the selected adapters directory using an argument array with no shell. Secret values travel over stdin, never argv, diagnostics, exports, or response DTOs. Store configured API secrets encrypted with Electron `safeStorage`; if unavailable or decryption fails, show a configuration error and do not save plaintext or invoke the provider. Secret fields are write-only, with an explicit clear action.

Claude integration provides an opt-in collector and setup instructions. Installing software does not modify `~/.claude/settings.json`, existing status-line commands, agent hooks, or harness files. A separate reviewed setup action must preserve an existing status line and account mapping. Codex reuses the user's configured CLI auth context without extracting tokens into NeKode. Do not call login/logout, start a model thread/turn, or change the account to obtain quota. API adapters make only documented metadata GET requests. Explain OpenRouter Management key privileges before enabling that adapter; it stays optional.

## Data / API

### Local adapter contract

A separate quota adapter manifest has `id`, `name`, `protocolVersion: 1`, `invocation: {command, args}`, supported source/metric capabilities, `minimumRefreshSeconds`, and a bounded config schema (text, secret, boolean, choice, file path). Discover one level under `<userData>/usage-adapters`, with an explicit settings override. List invalid manifests as disabled with an actionable error; reject duplicate ids rather than selecting one unpredictably. No automatic downloads or global plugin framework.

One process per `read` request: `{protocolVersion: 1, action: "read", config, params: {connectionId}}`. Exactly one bounded JSON response: `{protocolVersion: 1, ok: true, data}` or `{protocolVersion: 1, ok: false, error: {code, message, retryAfterSeconds?}}`. Exit 0 for success, 1 for declared failure. Cap stdout at 1 MiB, stderr at 8 KiB, and execution at 30 seconds; terminate the process tree on timeout/cancellation. Main exposes sanitized error codes and messages, never arbitrary stderr or provider bodies. The Codex adapter handles its own bounded JSONL handshake and read internally, then closes app-server; it does not make app-server part of terminal ownership. Unsupported CLI versions fail explicitly. Never silently switch to an unofficial endpoint.

### Normalized observation document

Version 1 JSON uses `schemaVersion: 1` and `subscriptions`, with no credentials. Each subscription includes `id`, `providerId`, `label`, `sourceKind` (`api`, `cli`, or `file`), `metrics`, and a source status. Connection ids bind inputs to configured account scopes; duplicate ids/metric ids are rejected. The file adapter accepts one subscription matching its configured connection id; the export contains every enabled connection. Labels and free text are bounded to 256 characters; documents have at most 100 subscriptions and 50 metrics per subscription. Document size is at most 1 MiB.

Each metric has `id`, `label`, `kind` (`window`, `credits`, or `balance`), `observedAt` (UTC ISO timestamp or null), `state` (`available`, `unavailable`, or `expired`), and the applicable values:

| Kind | Values |
|---|---|
| `window` | `usedPercent`, optional `periodStart`, `resetsAt`, `windowDurationSeconds`, and provider `bucketId` |
| `credits` | `used`, `limit`, `unit`, optional `periodStart`, `resetsAt`; percentage derived only for a positive limit |
| `balance` | `amount`, ISO currency code; no invented period |

All optional values use null when unknown. Available metrics require finite numeric values for their kind. Period timestamps are UTC ISO strings; end must follow start. Unavailable metrics have no numeric value and carry a bounded reason code. A failed read may retain an older successful metric in the service snapshot alongside the connection's current error. Reject malformed documents atomically without destroying the prior cache. Schema/version mismatch is an error. Producer observations may include `collectedAt` as a separate collection/receipt timestamp without implying freshness; main adds `receivedAt` and preserves collection time in its snapshot/export. Reimport never converts these into `observedAt`.

Use a dedicated shared contract imported by `ipc-contract.ts`. Proposed minimal methods are `usage:listAdapters`, `usage:getSettings`, `usage:saveSettings`, `usage:read`, and `usage:refresh`; settings DTOs contain secret-presence flags only. Reuse native dialog channels when sufficient. IPC updates remain request/response; while the app is visible a single renderer hook reads the in-memory snapshot at most once per 5 seconds and after refresh/configuration changes. Snapshot reads never trigger provider calls; main owns scheduling. Pause the hook when hidden and dispose it on unmount. Avoid adding a push channel without a demonstrated renderer need.

### Persistence and external consumers

Store connection configuration and the pin under namespaced global `app_state` keys, with secrets encrypted and configuration saves transactional. New keys need no SQL schema migration. Persist last successful normalized observations in a bounded credential-free cache under `<userData>/usage`; on restart retain their original ages. Filesystem cache failure is reported and never prevents rendering an accepted in-memory observation.

The file adapter reads only its configured absolute input, validates size before parsing, and preserves producer observation times. Provide an example JSON and a public schema during implementation. Export is off by default; enabling selects an absolute output file. Main is its sole writer and atomically replaces a complete validated document using a temporary sibling and rename. Resolve real paths/parent directories, reject symlink/reparse aliases and case-insensitive Windows aliases of any input or cache path, and reject input/output overlap before saving or writing. Do not overwrite an existing non-export file without an explicit replace decision. A failed export preserves the previous file and shows the export error independently from collection.

Export contains enabled subscriptions, source states, last known values, and timestamps. It contains no raw provider responses, account email, credential paths, terminal content, or secrets. The user-facing label is the only account description. Removing/disabling a connection removes it from the next export. Turning export off stops writes; retaining the last file is explicit in settings. A web/no-code service without local filesystem access needs separately configured synchronization; no upload or local HTTP server is part of this feature.

## Edge cases

No adapters, no account auth, missing/partial windows, multiple accounts, overlapping limit buckets, expired reset, restart with old cache, future clocks, out-of-order observations, producer writing partial JSON, malformed/oversized files, stale API caches, request races after config changes, minimized app, narrow window, and missing pin target all preserve the rules above. Source errors do not close terminals or block normal application startup.

## Errors

Use typed `validation_error`, `not_found`, `protocol`, `timeout`, `auth`, `network`, `rate_limited`, `unsupported`, `config`, and `io` failures consistent with the shared error transport. A source error names the connection and a safe next action. Examples: `Sign in with the configured Codex CLI`, `Usage data unavailable for this account`, `Unsupported usage adapter version`, `Cannot read usage file`, `Usage export failed`. Retry deadlines are numeric and validated. Do not log provider bodies, token values, or status-line input (it includes session metadata).

## Acceptance criteria

1. With no enabled adapters, no collection occurs; `Usage` opens a usable configure state. Adding a valid JSON connection displays actual file values without an agent session or network request.
2. Multiple sessions/projects using one configured subscription show one set of meters; two explicitly configured account scopes remain distinct. Malformed/duplicate input ids cannot merge them.
3. The panel matches the compact prototype dimensions, graphics, pin highlight, and freshness markers at normal width, remains usable at narrow width and in every theme, and preserves native window drag/caption controls.
4. Keyboard users can open, navigate, pin, refresh, close with Escape, and return focus. All values, age, source errors, and pace meanings are available without colour or hover.
5. A pin survives restart and temporary failure; deletion/identity change clears it without selecting an unrelated source. Missing windows are never zero.
6. Fake-clock cases prove freshness boundaries at 5 and 60 minutes, age-unknown handling, preservation on repeated file reads, reset expiration, and rejection of older/future observations.
7. Seven-day and actual monthly intervals produce correct slices and percentage-point comparisons. Unknown intervals and stale data show no pace advice; durations/buckets are provider-driven.
8. Refresh is single-flight per connection, follows visibility/cadence/backoff rules, retains cached rows, isolates source failures, and ignores responses from obsolete configurations. Shutdown leaves no collector/app-server child running.
9. File import/export validates versions, bounds, paths, alias overlap, and atomic writes. Export is opt-in and excludes secrets and raw session/account metadata; failure preserves the previous export and accepted observations.
10. The Claude collector only maps documented subscription rate-limit fields, handles absent windows, does not relabel repeated observations as fresh, and preserves existing status-line behaviour under its separately reviewed setup. It does not read context percentage as quota.
11. The Codex adapter identifies itself as experimental, performs only initialization and read-only account/rate-limit operations, supports reported duration/multiple buckets, and fails clearly on incompatible CLI/auth. No thread/turn or account mutation is sent. Compatibility is verified against the installed CLI before enabling it on an account.
12. ElevenLabs handles missing/zero limits and unknown cycle starts. OpenRouter uses the documented Management key metadata endpoint and shows account USD balance; ordinary-key denial is an explicit auth/config result, not a per-key substitute.
13. Persisted secrets are encrypted; missing encryption blocks secret save/use. No test logs, argv, export, or read DTO contains a configured secret. Existing projects, terminal lifecycle, Kanban, and agent profiles retain behaviour.

## Required tests

- Pure normalization and fake-clock tests for identity, bounds, age, intervals, overage, missing windows, and multiple buckets.
- Fixture-process host tests for manifest validation, success/error exits, protocol mismatch, timeout/tree cleanup, secret-safe argv/error transport, cancellation, and per-source isolation. No real credentials in fixtures.
- Service tests with temporary directories and injected clocks/host/state for scheduling, caches, config/pin transactions, encrypted-secret failure, atomic export, path aliases, input/output separation, and stale-response rejection.
- Adapter mapping tests with sanitized provider fixtures, including Claude repeats/absent windows, Codex JSONL handshake and multiple buckets, ElevenLabs zero limit, and OpenRouter Management-key denial. Document supported CLI versions and run a bounded opt-in compatibility read before any real-account enablement; fixtures alone do not prove live compatibility.
- Renderer/component integration tests for user-observable panel, empty/error/loading states, pin/restart behaviour, focus, and keyboard controls. Avoid tests asserting CSS source text. Visual verification in the real Windows Electron app with isolated user data, fixture adapters, no credentials, all themes, and caption/drag controls.
- Final verification uses the recorded full command for this multi-stage integration, plus the Windows Electron smoke. Live provider reads are optional and require configured account access; record unavailable evidence explicitly rather than claiming those checks passed.

## Relevant SDD / ADR

[Architecture](../../architecture/sdd.md#current-implementation-obligations), [public project contract](../../development/project-contract.md), and the [Kanban adapter pattern](../kanban-adapter-interface/spec.md). No accepted ADR changes yet. The 2026-10-20 approval accepts the full three-stage scope and the documented integration limits; it does not establish live provider compatibility.
