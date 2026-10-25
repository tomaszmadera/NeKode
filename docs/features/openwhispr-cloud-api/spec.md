# OpenWhispr Cloud API dictation

Status: Approved by the user on 2026-10-25 for NEKODE-37.

This file owns the direct OpenWhispr Cloud API contract. The desktop shortcut and local bridge remain governed by [OpenWhispr dictation](../openwhispr-dictation/spec.md). Provider registration, dictionary storage, secret storage and post-processing remain governed by [Dictation provider architecture](../dictation-provider-architecture/spec.md).

## Goal

Allow a developer to dictate into a NeKode chat prompt using an OpenWhispr Pro or Business subscription through the official public API, without running the OpenWhispr desktop app or downloading a local model.

## Related requirements

- NEKODE-37: explicit Cloud API mode, encrypted personal credentials, upload disclosure, vocabulary hints, error handling, cancellation and original-chat delivery.
- NEKODE-21: the existing in-process adapter registry, manifest-driven Settings and shared recording workflow.
- User report on 2026-10-25: selecting and configuring ElevenLabs still produces the error `disabled` on Dictation. The provider workflow must not depend on the retained OpenWhispr local enable flag.
- Official API requirements checked on 2026-10-25: [transcription](https://docs.openwhispr.com/api/transcription), [API schema](https://docs.openwhispr.com/openapi.json), [usage](https://docs.openwhispr.com/api-reference/usage/get-usage).

## Scope

- One bundled adapter, id `openwhispr-cloud`, name `OpenWhispr Cloud (beta)`.
- Selection beside the existing local bridge, desktop shortcut and other STT providers.
- Personal API key, Polish or automatic language selection, optional vocabulary hints, and explicit upload permission in Settings.
- Reuse of safeStorage, the effective global/project dictionary, batch WAV capture, cancellation, safe post-processing and result recovery.
- Correct provider-specific start eligibility, including the reported ElevenLabs `disabled` regression.

## Non-goals

- Installing, launching, changing or authenticating the OpenWhispr desktop app or CLI.
- Local inference, automatic fallback between local and Cloud, streaming or external plugins.
- Cloud history/dictionary synchronization, model selection, subtitle timestamps or quota dashboards.
- Audio compression, automatic splitting, background retries or reading existing user credentials.
- Live authenticated API calls, real keys, microphone recording, commits or publication during this implementation task.

## Behaviour

### Selection and setup

1. Settings lists the Cloud adapter as a distinct method. The existing single-method selection rule continues to apply; selecting an adapter disables the desktop shortcut route.
2. The Cloud description explains before recording that audio and supplied vocabulary hints are sent to OpenWhispr Cloud. It identifies the beta, required paid plan and current limits.
3. Configuration has `apiKey` (secret), `language` (default `pl`, `auto` omits the API field), and `cloudUploadEnabled` (boolean, default false). The checkbox label explicitly permits sending recordings and vocabulary hints to OpenWhispr Cloud. Saving a key alone never grants upload permission.
4. Readiness requires a saved personal key and upload permission. Both are checked in main, before recording and again before upload. Missing permission or credentials gives actionable guidance to Settings. A valid configuration does not claim that a remote account or quota has already been verified.
5. The provider exposes no Base URL, model discovery, model picker, native editing or timestamp controls. Its endpoint is fixed HTTPS and authenticated requests reject redirects.

### Recording and delivery

1. Selecting a configured non-local adapter, including ElevenLabs and OpenWhispr Cloud, is sufficient to start the in-app workflow. It must not read or depend on the retained local bridge's `dictation.enabled`, local model, connection status or configuration validity.
2. The local `openwhispr` adapter retains its local enablement and operational/model checks. Desktop shortcut enablement and confirmation retain their separate meaning.
3. Bind the selected adapter to the take when recording starts. Changing Settings while recording must never redirect already captured audio to another provider. Recheck Cloud permission at upload time, so revocation prevents that upload. A retry retains its original provider.
4. Stop submits at most one WAV upload. Esc/cancel aborts the request and prevents any late response from being inserted or post-processed. NeKode does not claim cancellation stops remote processing or refunds quota.
5. The result stays addressed to the originating chat and is inserted at most once. Existing chat-switch, target-loss recovery and raw transcript handling remain in force. No automatic terminal submission occurs.
6. The existing independent post-processing settings apply after transcription. A Cloud adapter does not advertise native editing; unsupported native editing keeps the original transcript under the existing pipeline contract.

## Business rules

- The documented beta accepts a file up to 4 MB. NeKode uses a conservative maximum of 4,000,000 WAV bytes, including the header; anything larger fails locally before network upload. Settings explains that this is about two minutes at the current mono 16 kHz PCM format. The existing recorder's larger global limit remains unchanged.
- The API currently allows 600 audio minutes per calendar month and one in-flight transcription per key. Display these as published beta limits, not a locally measured remaining balance.
- Keep NeKode's existing single-take serialization. Another application may still use the same key, so a remote concurrency failure remains possible.
- Use the existing project-over-global dictionary resolution. Send enabled effective terms and their aliases only as comma-separated recognition hints, with blank/duplicate hints removed. Do not replace transcript strings or silently truncate using an undocumented provider limit.
- No automatic retry on quota, rate, concurrency, timeout or service errors. The user decides whether to record or retry again.

## Authorization

- The user explicitly selects Cloud, saves its key and grants upload permission before recording. Local failure never authorizes switching to Cloud.
- This task authorizes implementation and mock verification only. A real authenticated request or audio upload requires separate explicit authorization.
- Keep the existing trusted-sender checks and typed preload bridge. Add no arbitrary HTTP or credential-read IPC.

## Data / API

### Transport

- Base: `https://api.openwhispr.com/api/v1`.
- Upload: `POST /transcribe`, `Authorization: Bearer <personal-key>`, `multipart/form-data` with `file` (`audio/wav`), optional `language`, optional `prompt` (vocabulary hints). Let FormData supply its multipart boundary.
- No `model` request field. The remote service chooses the engine.
- Validate the response envelope and string `data.text`. Preserve raw text and valid optional language, duration and informational model metadata. Missing/invalid transcript data is a malformed response, never a successful empty transcript. A valid empty transcript uses the existing no-speech path.
- No timestamps are advertised. Response word count is not word alignment.
- Bound metadata tests to 10 seconds and transcription to 30 seconds, combining timeouts with the caller's AbortSignal and clearing timers after completion.

### Non-consuming connection test

- Accept only a personal `owk_live_` key; reject missing, workspace and malformed header values locally. Do not echo key contents.
- `GET /me` verifies the documented `data.scopes` includes `transcriptions:write`. `GET /usage` checks documented `data.plan` is Pro or Business. The schema is defined in the official OpenAPI document; do not infer metadata endpoints from local bridge routes.
- These calls upload no audio and consume no transcription minutes, but still count as API requests. They do not prove remaining transcription minutes or guarantee a later upload succeeds.
- Return only a sanitized success/error summary. Do not return account identities, raw response bodies or credentials to the renderer.

### Persistence and secrets

- Reuse per-provider AppState configuration and existing main-process safeStorage encryption (`enc:v1:`). No database migration is needed.
- Saving/replacing the key follows the existing Settings secret-entry flow. The write request goes to main, input state is cleared after saving, and subsequent reads expose masked metadata only. Do not return decrypted keys in IPC results, status, errors or logs, or write keys to project files.
- If encryption is unavailable, reject saving. Reject invalid Cloud configuration before any persistent mutation.
- Add only the typed result/error data needed by the existing workflow. Normalize Cloud errors in main without forwarding remote text, which could contain sensitive content.
- Reuse existing temporary audio cleanup and in-memory transcript lifetime; introduce no new audio/history storage.

## Edge cases

- An app with no local bridge, `dictation.enabled` unset/false, or invalid retained local settings can still use a properly configured Cloud or other non-local adapter.
- Switching from local to Cloud mid-take never changes the destination of that take; revoked Cloud permission blocks a Cloud take before upload.
- Over-limit audio makes zero upload calls. A server-side 413 still has an explicit too-large result.
- Cancelling a request may leave the remote server temporarily busy. A subsequent 409 is reported without starting overlapping retries.
- Network failure, malformed JSON and cancelled body parsing cannot produce a success result or a second delivery.

## Errors

Extend the existing dictation error union and result validator only as needed, with readable UI messages and actions:

| Condition | Result/action |
|---|---|
| Missing key or 401 | Authentication failure; configure a personal key in Settings. |
| Upload permission absent/revoked | Cloud consent required; review and save upload permission in Settings. |
| `plan_required` | Pro or Business required; check the subscription. |
| `forbidden` | Check key scope, personal key type and organization Cloud policy. |
| 400 `validation_error` | Audio/request rejected; check language or use a new recording. |
| Local oversize or 413 | Recording too large; record a shorter take. |
| 409 `concurrency_limit` | Another transcription uses this key; wait until it finishes. |
| 429 `quota_exceeded` | Monthly transcription allowance exhausted; wait for renewal. |
| 429 `rate_limited` | Request rate limit reached; wait before retrying. |
| 503 `service_unavailable` | Cloud beta unavailable; try later. |
| Timeout, cancellation, transport failure | Preserve their distinct existing workflow semantics. |
| Malformed response or unknown server error | Sanitized provider failure; no fabricated transcript or fallback. |

Parse only allowlisted error codes. Never display raw response messages, headers, request bodies or thrown fetch errors. Do not label Cloud quota/plan errors as `recording-failure` or local-model failures.

## Acceptance criteria

1. Settings shows a separate Cloud method with the disclosure, key, language and initially unchecked upload permission. No local model or running desktop app is required.
2. Cloud cannot start/upload without its required configuration and permission, including via direct service/IPC calls. Revocation before upload prevents egress.
3. A mocked upload has the documented endpoint, authorization, WAV multipart fields, language omission for auto and effective vocabulary hints. Responses preserve raw text and do not rewrite aliases.
4. Over-limit input makes zero uploads; boundary-size input is allowed. Metadata tests make only the documented GET requests and validate scope/plan without audio.
5. Stored keys are encrypted; all read/status/error payloads and logs exclude plaintext. Encryption failure or invalid input does not partially save configuration.
6. The reported ElevenLabs `disabled` scenario is reproduced with a real injected OpenWhisprClient whose local settings are disabled, then passes after the fix. Cloud and OpenRouter also work with those local settings; local and desktop gates remain unchanged.
7. Provider selection changes do not redirect a take, and cancellation, duplicate stop/result events and chat switches preserve at-most-once/original-chat guarantees with Cloud responses.
8. Every listed Cloud failure produces a distinct actionable UI result, makes no silent retry/fallback and settles the busy state. No error leaks raw remote text.
9. Existing provider selection, dictionary, secret storage and post-processing regressions pass using mock API transport. No live credentials/audio are used.

## Required tests

- Adapter tests with injected fetch: manifest, request construction, automatic/Polish language, vocabulary, response validation, limits, metadata scope/plan, error-code normalization, abort/timeout and no raw error leakage.
- Service regressions: realistic local client plus registered cloud/ElevenLabs/OpenRouter adapters; disabled and invalid local settings; local operational gate; key/permission checks, safeStorage writes/reads, frozen provider identity and original-provider retries.
- Settings and workflow tests: Cloud disclosure/permission, no model controls, masked keys, readable Cloud errors, cancel/late result, duplicate delivery and target loss. Reuse existing tests where they already prove unchanged guarantees.
- IPC/preload negative/routing tests only for actual changed payloads or validation paths; keep sender guard regressions passing.
- Affected tests, complete stage diff self-review, one independent review, and one final full verification through recorded commands. Full scope is justified by credential handling and cross-provider session changes.

## Relevant SDD / ADR

- [Dictation provider architecture](../dictation-provider-architecture/spec.md), especially provider contracts, secret handling and AC-012 through AC-014.
- [OpenWhispr dictation](../openwhispr-dictation/spec.md): desktop and retained local behaviour are preserved.
