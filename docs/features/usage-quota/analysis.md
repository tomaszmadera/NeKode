# Usage quota: data source analysis

State of the analysis: 2026-10-20. Scope: NEKODE-90, a recommendation and an implementation design for approval. No connections to private accounts, no token reads and no changes to agent configuration were made.

## Recommendation

The panel should belong to NeKode, and the integrations should be optional subscription adapters. Main collects normalized readings, the renderer shows the panel, and a local JSON export lets the data be used outside the app. An adapter can read a provider API, a documented CLI interface or a chosen file. A missing source means explicit unavailability, without estimating a percentage from token counts.

The data contract is universal. A reliable, always current reading of every subscription cannot be promised. A closed session, missing permissions or an API change must be visible as the source state. A write in a hook alone does not confirm that the percentage was fetched from the provider again.

I do not recommend an extra no-code system as a mandatory layer. If the current Agent Harness collector can export the agreed format, the file adapter will use its data without a second collection. The collector format was not named or verified; compatibility needs an example without secrets. The plan does not change Agent Harness.

## Available sources

| Subscription / service | Confirmed source | Limitation and proposed decision |
|---|---|---|
| Claude, used by Claude Code | The official statusLine: rate_limits.five_hour and seven_day, percentage and reset | Data after an API response; the windows may be absent. Pro/Max or a separate gateway spend limit. An optional file collector. |
| ChatGPT / Codex | The officially described codex app-server, account/rateLimits/read and account/rateLimits/updated | The app-server is experimental and not supported for production. An explicitly experimental adapter after checking the CLI version, without model turns. |
| ElevenLabs | GET /v1/user/subscription: character_count, character_limit, next_character_count_reset_unix | Needs permissions. The percentage comes from the counter and the limit; the reset does not fix the start of the period. |
| OpenRouter | GET /api/v1/credits: total_credits, total_usage | Needs a Management key. This is the account balance, not a subscription percentage or a key limit. Such a broad key should not be required by default. |
| Command Code | The official /usage shows the 5h and weekly windows; the documentation also describes monthly pools | No machine API for reading the subscription was confirmed. First implementation: JSON import. |
| AGY from the prototype | The name does not clearly identify the provider or the account | Do not automatically equate it with Antigravity. The Antigravity documentation confirms an interactive /usage, without establishing a machine interface for this purpose. |
| Grok from the prototype | The subscription documentation describes pools and usage views | No API for reading this subscription was confirmed. Do not replace it with the xAI API limits. First implementation: JSON import. |

Primary sources read on 2026-10-20:

- [Claude Code: status line](https://code.claude.com/docs/en/statusline): fields, conditional presence, triggering and refreshInterval. A timer runs the script; the documentation does not guarantee a new read of the limits from the server on every run. Without a running session, the status line collector does not work.
- [OpenAI: Codex App Server](https://learn.chatgpt.com/docs/app-server): the initialize / initialized handshake, stdio JSONL, account methods, rateLimitsByLimitId, usedPercent, windowDurationMins, resetsAt and the experimental status of the app-server. Window lengths should be read from the response, without a fixed 5h/7d assumption.
- [ElevenLabs: get user subscription](https://elevenlabs.io/docs/api-reference/user/subscription/get): counter, limit, period and reset time.
- [OpenRouter: get remaining credits](https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits): account data and the Management key requirement. Balance = total_credits - total_usage.
- [Command Code: pricing limits](https://commandcode.ai/docs/resources/pricing-limits): kinds of pools and the interactive /usage.
- [Antigravity CLI: model quotas](https://www.antigravity.google/docs/cli/commands/usage): /usage / /quota opens an interactive panel and fetches backend data.
- [Grok: usage limits](https://docs.x.ai/x-subscription/usage-limits): the scope of the shared pool and the views in the account. It does not prove a mapping to a specific user subscription.

The unofficial Claude endpoint is not needed for the basic reading while Claude Code works. The analysis does not confirm its contract, permissions or stability. It is not part of the implementation. Scraping a web page or the terminal /usage is not a basis for a reliable integration either.

## Fit with the repository

- [Architecture, IPC boundary](../../architecture/sdd.md#ipc-boundary): main owns the filesystem, processes and persistence; the renderer uses the typed bridge. New reads do not need Node permissions in the renderer.
- [Kanban adapters](../kanban-adapter-interface/spec.md#behaviour), points 1-6, and src/main/services/kanban/adapter-host.ts:1: there is a pattern of processes, a manifest, JSON over stdin/stdout, a response limit and a timeout. A similar mechanism can be used without joining the Kanban and quota domains. Kanban should not be refactored up front.
- src/main/services/kanban/kanban-service.ts:55: there is a safeStorage interface. Quota can use this encryption mechanism, with an explicit error when it is unavailable instead of a plain-text write.
- src/main/services/app-state-service.ts:8: there is a global app_state store. The subscription configuration and the pin need no new table and no link to a project.
- src/renderer/src/App.tsx:2510: there is a title bar with the app brand. This is the place for a global quota button; the clickable area must be no-drag and avoid the system buttons.
- src/renderer/src/components/settings/AppSettings.tsx:44: the global settings have an explicit list of tabs. Quota should have a separate Usage tab, independent of the agent profiles.
- [Product requirements](../../product/requirements.md): the UI is in English, and agents stay CLI processes. Reading subscription metadata does not run models and does not replace terminals.

The initial search for quota|subscription|usage in src/shared, src/main, src/renderer found no subscription limit service; "subscription" mostly referred to terminal event subscriptions.

## Prototype and real data

The local tmp/nekode-prototype/README.md describes the export as a visual reference. Main.dc.html:74 contains the panel, :558 fixed sample readings, and :660 the rows, segments, freshness and pinning. The sample readings do not prove that an integration is possible.

The contract keeps the 400px panel, compact rows, avatars, bars and segments, the freshness indicator and pinning to the bar. Real data needs a few rules:

- The subscription/account is the grouping unit. Two sessions of the same account do not add percentages and do not create two subscriptions.
- Not every provider has 5h and 7d. A missing window does not mean 0%.
- Freshness has a data age and an origin. Reading a file again or running the status line does not make old data current. The basic Claude payload does not give the time the limit was observed, so the collector passes Age unknown and, separately, the receive time.
- Pace makes sense for a known start and end of the period. resetsAt without a duration is not enough. A difference of percentages is percentage points, marked pp.
- A reset that has passed invalidates the window value until a new reading. The app does not write 0% then.
- The OpenRouter dollar balance is not a monthly usage bar. The key's permissions must be explained before configuration.

## One collection, many consumers

Proposed flow:

```text
API / official CLI / existing collector
                  |
         optional quota adapter
                  |
        validation + cache in main
             /             \
        typed IPC       JSON export (opt-in)
             |               |
      NeKode panel      local consumer / user's sync
```

A collector can write the same normalized format outside NeKode. Then the file adapter only reads the data; collection and the existing upload stay with the collector. The NeKode export is a separate file for consumers to read, with one write owner and an atomic replace. The export must not be named as the collector's input, because that would create a refresh loop.

A desktop consumer with filesystem access can read the local JSON without a server. A regular web page and hosted no-code do not have such access. They need a chosen synchronizer or an authenticated service. Automatic upload, a local HTTP server and another cloud integration are outside the plan; the file alone does not replace them. When NeKode is closed, its export stops refreshing. An independent collector can still refresh its own file.

## Proposed order

1. The panel, subscription settings, pin, normalization, the file adapter and the export. A working result on a fixture and an external file, without provider accounts.
2. The Claude Code collector and an experimental Codex adapter over stdio. A separate compatibility test of versions and permissions. Missing data stays an explicit state.
3. Optional ElevenLabs and OpenRouter adapters, with handling of secrets, refresh limits and account errors.

Direct Command Code, AGY and Grok adapters stay outside the plan until the product, the contract and the authorization are confirmed. Their data can be delivered through the file adapter. The details are in the [specification draft](spec.md), and the execution in the local NEKODE-90 plan. Approving the plan does not guarantee the stability of the experimental Codex interface or access to the accounts.
