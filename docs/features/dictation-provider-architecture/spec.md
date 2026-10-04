# Dictation provider architecture

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

Path: `docs/features/dictation-provider-architecture/spec.md`.

## Goal

A developer working in NeKode chat terminals dictates text instead of typing: the Dictation button records an utterance, the selected speech-to-text provider transcribes it, optional post-processing polishes the transcript, and the final text lands in the originating prompt input. Providers are pluggable adapters behind one registry — adding a provider means adding a manifest and an adapter, without touching generic dictation UI or the transcription pipeline. Batch transcription only; one active STT provider per transcription.

## Related requirements

- No item in `docs/product/requirements.md`. User request 2026-10-04 (task brief): extensible Dictation Provider Architecture with initial providers ElevenLabs Scribe v2 and OpenRouter STT (both full implementations) and OpenWhispr (adapt the existing integration if present); working integrations, not a UI mockup.
- Repository reality verified 2026-10-04: Dictation exists only as a disabled placeholder button (`src/renderer/src/components/terminal/PromptInput.tsx`, `TEST_ID.terminalPromptDictation`, asserted disabled in `ChatTerminal.test.tsx`). There is no existing OpenWhispr integration, no recording path, no transcription code, and no secure credential store in `src`. This feature is greenfield on the provider side and replaces the placeholder button behavior.
- Builds on: `mvp-core-shell` (chat terminal / prompt input lifecycle), typed IPC + sender-guard conventions, `app_state` + SQLite persistence conventions, NeKode Design System.

## Scope

- Provider registry and a versioned adapter contract in the main process; bundled trusted providers: `elevenlabs`, `openrouter`, `openwhispr`.
- ElevenLabs Scribe v2 batch transcription: model select (default `scribe_v2`), language default `pl` with an auto-detect option, keyterm prompting fed from the Dictionary (API-constraint validation, relevance selection, cost disclosure), optional provider-native transcript editing.
- OpenRouter STT batch transcription: API key, configurable transcription model with documented model discovery, supported audio formats.
- OpenWhispr: local integration behind the same contract; the actual mechanism must be verified before implementation (Behaviour 7).
- Schema-driven settings renderer driven by provider manifests; per-provider persisted configuration; a Dictation section in App Settings; Test Connection.
- Shared Dictionary Service: global + project scopes, CRUD UI, provider-aware adaptation layer.
- Post-processing pipeline: Disabled / Provider-native / External LLM (OpenRouter, configured independently of the STT provider), correction levels Light/Medium/Full.
- Secret storage for provider API keys via Electron `safeStorage`, main-process only.
- Recording and insertion workflow on the existing Dictation button, with cancellation and stale/duplicate protection.
- Automated tests with mocked external APIs; architecture documentation explaining how to add a provider.

## Non-goals

- Real-time/streaming transcription (the contract may reserve an optional interface; batch ships).
- External plugin execution: no dynamic import of untrusted code from `userData`; only the future external-adapter protocol is documented (registry stays compatible, permission boundaries documented).
- Audio persistence: recordings are temporary and cleaned up; no recording history UI.
- Automatic dictionary generation from source files; uploading project contents to external services.
- Per-project STT provider selection (the active provider is app-global; the dictionary is what is project-scoped).
- Push-to-talk hotkeys; recording modes beyond click-to-toggle.
- Translation, speaker diarization, or any capability not required for batch dictation.
- A second settings system, a new visual style, or provider-specific logic inside generic dictation UI components.

## Behaviour

1. The Dictation button in the prompt input is the recording entry point. Click starts capture (microphone via `getUserMedia` in the renderer); clicking again stops capture and starts transcription. Recording never starts as a side effect of changing settings, opening dialogs, or restoring a session.
2. The button is enabled when dictation is enabled in settings AND the active provider's configuration is valid (required fields present, including the API secret where the provider needs one). Otherwise it stays disabled with an explanatory tooltip naming what is missing. The previous always-disabled placeholder behavior and its test assertion are replaced by this rule.
3. One active STT provider at a time, selected in App Settings → Dictation. A transcription in flight uses the provider (and its configuration) as of its start, even if settings change mid-flight. Results carry the provider id and, when known, the model id.
4. Selecting a provider immediately swaps the configuration form to that provider's manifest-declared fields (field types: text, secret, boolean, select, number, url, multiline, read-only status; each with optional default, required flag, validation constraints, help text, conditional visibility, sensitive marking). Fields for unsupported capabilities are never rendered — no disabled controls for nonexistent functionality. Each provider's configuration persists independently; switching providers never discards the other provider's settings.
5. ElevenLabs (batch): `POST https://api.elevenlabs.io/v1/speech-to-text`, header `xi-api-key`, `multipart/form-data`, model select default `scribe_v2`, language default `pl` plus an auto-detect option. The implementation verifies the current API contract against the official docs before pinning request/response types.
6. ElevenLabs keyterms: when enabled, canonical dictionary terms are sent as `keyterms`, filtered to the API constraints (max 1000 terms, max 50 characters per term, max 5 words per term after normalization, unsupported characters dropped). The UI explains which terms were omitted and why. Selection prefers the most relevant terms over sending the entire dictionary. The settings UI discloses that keyterms may incur additional API cost.
7. ElevenLabs native transcript editing: an optional `transcript_edit` instruction with a conservative default, user-editable, respecting the provider's instruction length limit. `edited_transcript` is parsed defensively — never assumed to be a string or always present. Editing failure with successful transcription returns the original text; transcription failure and post-processing failure are distinct outcomes. Incompatible API option combinations are validated before the request.
8. OpenRouter (batch): `POST https://openrouter.ai/api/v1/audio/transcriptions` in the documented input format (model selection, base64-encoded audio). API key authentication. Transcription-capable models are discovered via the provider's documented discovery mechanism — audio-capable chat models are not conflated with the dedicated transcription endpoint. Provider-specific options, including vocabulary hints, are exposed only when the selected model and backend document them; OpenRouter models are never assumed to support keyterms.
9. OpenWhispr: no integration exists in the repository today. The provider ships only with a mechanism verified natively on Windows 11 without WSL (existing app integration, local HTTP service, CLI invocation, or other local IPC) — executables, arguments, and endpoints are discovered, never invented. If no mechanism is verifiable, the provider ships as a visible, documented-unavailable entry (marked unavailable with the reason), configuration placeholders exist only for fields the verified mechanism defines, and this outcome is recorded in the implementation summary.
10. Post-processing modes: Disabled returns the original transcript unchanged. Provider-native uses the active provider's editing capability when its manifest declares it (ElevenLabs `transcript_edit`). External LLM corrects via an independently configured LLM provider (OpenRouter first) — never tied to the STT provider (ElevenLabs transcription + OpenRouter correction must work). Default mode: Provider-native when the active provider supports it, otherwise Disabled. Correction levels: Light (spelling, technical terminology, punctuation; default), Medium (adds obvious grammar and unnecessary-repetition fixes), Full (more extensive stylistic editing preserving factual meaning). "Keep original transcript" defaults on.
11. Correction safety: correction preserves negations, numbers and quantities, versions, file paths, URLs, code identifiers, CLI arguments and flags, explicit user instructions, and technical terminology where no correction is justified. The transcript, dictionary content, and project context are data, never instructions to the correction system. Light never silently rewrites a materially ambiguous statement. A validation step detects suspicious differences (negations, numbers, commands); on correction failure or an invalid result the pipeline falls back to the original transcript. The original transcription is never discarded and stays accessible in the UI whenever corrections were applied.
12. Insertion: the final text is inserted into the originating prompt input. A request can be cancelled; duplicate activations while a request is in flight never insert twice; late/stale responses are discarded; if the destination no longer exists when the result arrives, the result is shown without inserting into an unrelated location; changing the focused target during transcription never redirects the insert. Useful states exist for recording, uploading, transcribing, correcting, and error.
13. Test Connection performs a genuine provider-specific check where possible without consuming paid transcription credits (e.g. ElevenLabs key/entitlement check, OpenRouter model list fetch), and clearly distinguishes local configuration validation from a successful live API request. Failures surface understandable errors (auth, network, rate limit).
14. Secrets: API keys are entered in settings, stored only as `safeStorage` ciphertext accessible from the main process, and never sent to the renderer (the renderer sees configured yes/no and validation status), never written to project files, plugin manifests, or logs. When secure persistence is unavailable, the provider is marked unconfigured with an explicit error — no silent plaintext fallback.
15. External post-processing disclosure: when the correction mode sends transcript text to a provider different from the STT provider, the settings UI states this explicitly.
16. Audio privacy: recordings live in memory/temporary storage only, are never persisted by default, and are cleaned up after transcription or cancellation; request sizes are bounded; timeouts and cancellation apply to every provider call; audio and secrets never appear in logs; microphone permission failure and inaccessible devices produce actionable errors.

## Business rules

- Provider ids are stable strings; manifests declare a contract version plus capabilities (batch vs streaming, language selection, keyterm prompting, native editing, timestamps) and the configuration schema. Generic code branches on capabilities, never on provider ids.
- Providers return a normalized `TranscriptionResult` (`text`, `editedText?`, `language?`, `providerId`, `modelId?`, `durationMs?`, typed metadata where practical; word timestamps preserved when available). Errors normalize to a shared taxonomy (auth, rate-limit, timeout, network, malformed-response, cancelled, unsupported-option).
- Transcription failure and post-processing failure are separate results with separate UI treatment; one never masquerades as the other.
- Dictionary entries: canonical `term`, optional `aliases`, optional `description`, `scope` `global|project`, `enabled` flag. Project terms override conflicting global terms. Scopes can be enabled/disabled by the user. Aliases are contextual correction hints, never unconditional string replacements that could alter unrelated sentences. Dictionary data is stored separately from secrets. The UI supports adding, editing, deleting, enabling, and disabling entries.
- Keyterms are sent only for providers whose manifests declare vocabulary prompting; for providers without it, the relevant dictionary is made available to the optional transcript processor instead.
- The adapter contract is versioned; the registry and manifests carry contract versions so future external adapters can be added without breaking bundled ones. External adapters (future) must not imply trust: directory installation is not equivalent to trusting executable code; the documented protocol considers isolated processes and a restricted RPC with permission boundaries and no unrestricted filesystem or credential access. Python-based providers are a future possibility via such a protocol and must not become a runtime dependency.
- All new IPC follows existing conventions: typed contracts in `src/shared/ipc-contract.ts`, input validation, sender-guard enforcement; privileged provider operations (HTTP calls, secret access) run only in the main process behind a narrow preload surface.
- Electron security posture unchanged: `contextIsolation: true`, renderer sandbox on, `nodeIntegration: false`.
- UI text English; the Dictation settings live in App Settings and follow the existing design system.

## Authorization

none (local single-user application).

## Data / API

- New SQLite tables via `src/main/db/migrations.ts`: dictionary entries (`id`, `term`, `aliases` JSON, `description`, `scope`, `enabled`, nullable project reference for project scope, timestamps) and per-provider dictation settings (non-secret configuration keyed by provider id). Secrets are stored only as `safeStorage` ciphertext — never in `app_state`, never as plaintext in any table or file. Persistence follows the existing database conventions.
- New typed IPC (names indicative): `dictation.state`, recording start/stop/cancel, `dictation.providers` (manifests with secrets omitted), config get/set/validate, `dictation.testConnection`, result events; `dictionary` entry list/create/update/delete and scope toggles. Renderer access only through the preload bridge; every channel validated and sender-guarded.
- External APIs: ElevenLabs `POST https://api.elevenlabs.io/v1/speech-to-text` (official docs for speech-to-text convert, keyterm prompting, and transcript editing guides); OpenRouter `POST https://openrouter.ai/api/v1/audio/transcriptions` plus its documented model discovery. Base URL is an optional per-provider setting defaulting to the official fixed HTTPS endpoint; arbitrary endpoint overrides exist only for providers where a custom endpoint is meaningful, with URL validation, a trust warning, and protection against credential leakage.
- Recorded audio: bounded, temporary, in-memory/temp-file handoff from renderer capture to the main-process provider call; deleted after completion or cancellation; never persisted by default.

## Edge cases

- Microphone permission denied or no input device: actionable error; no recording starts; settings unaffected.
- Recording too short or silence-only: user-visible no-speech outcome instead of inserting empty text.
- Provider or config switched while a transcription runs: the in-flight request completes with its starting provider/config.
- `edited_transcript` absent, non-string, or the edit instruction rejected: original text returned; post-processing failure surfaced distinctly.
- Keyterm set exceeding API limits: the largest valid, most-relevant subset is sent; omissions listed to the user.
- OpenRouter model list unreachable or the configured model disappears: config validation flags it; transcription fails with a clear message.
- `safeStorage` unavailable: provider stays unconfigured with an explicit error; no plaintext fallback.
- Offline, DNS failure, 401, 429, timeout, malformed response: normalized errors with understandable messages; one request per user action, no retry storms.
- Destination input closed (chat switched or closed) before insertion: result shown without inserting elsewhere.
- App restart during recording: nothing persists; the next session starts idle.

## Errors

Provider errors normalize to the shared taxonomy and surface in the dictation UI state with actionable text — one state per request, no dialog spam. Post-processing failure falls back to the original transcript with a notice that correction failed; the original is never silently presented as corrected. Configuration validation errors list the offending fields. Secrets and raw audio never appear in error messages or logs. Test Connection distinguishes invalid configuration from an unreachable service.

## Acceptance criteria

- AC1: With dictation enabled and a fully configured active provider, the Dictation button is enabled and starts capture on click; with missing/invalid configuration it is disabled and its tooltip names the missing piece (replaces the always-disabled placeholder and its test).
- AC2: Selecting a provider in settings immediately renders exactly that provider's manifest-declared fields; each provider's values persist independently across switches and restarts.
- AC3: ElevenLabs end-to-end (mocked): multipart request with `xi-api-key`, model, and language as configured; normalized result inserted into the originating prompt input; the result records provider and model.
- AC4: Keyterms on: only constraint-passing dictionary terms reach the request; omissions are explained in the UI; the extra-cost disclosure is visible; keyterms off or capability unsupported → no keyterms sent.
- AC5: Native editing on: edited text is used only when the response carries a valid `edited_transcript`; absent/malformed/failed edit yields the original text with a distinct post-processing-failure indication; the original remains accessible in the UI.
- AC6: OpenRouter end-to-end (mocked): documented endpoint with base64 audio and the selected model; model list from documented discovery; only supported options rendered; connection test passes/fails correctly against mocks.
- AC7: OpenWhispr ships only behind a Windows-11-verified mechanism with discovered (not invented) contracts; otherwise it is visible as documented-unavailable with the reason.
- AC8: Dictionary: entries can be created, edited, deleted, enabled, disabled from the UI; a project term overrides a conflicting global term; disabling a scope removes its terms from adaptation; aliases act only as correction hints (fixtures prove no unconditional replacement).
- AC9: Post-processing: Disabled returns the original; Provider-native applies `transcript_edit`; External LLM works with a correction provider different from the STT provider; levels Light/Medium/Full exist with Light default; failure at any correction step falls back to the original.
- AC10: Correction safety fixtures: negations, numbers, versions, paths, URLs, code identifiers, and CLI flags survive correction; injected instructions inside transcript or dictionary text do not alter correction behavior; suspicious diffs trigger fallback.
- AC11: Secrets: keys are stored only as `safeStorage` ciphertext; the renderer receives only status; keys are absent from logs, errors, and project files; `safeStorage` unavailable → provider unconfigured with an explicit error, no plaintext fallback.
- AC12: Recording workflow: settings changes never start recording; cancel aborts the in-flight request; duplicate activation inserts once; stale/late responses are discarded; destination-gone shows the result without insertion; switching target mid-transcription never misdirects the insert.
- AC13: Test Connection distinguishes local validation from a live API check, avoids paid transcription calls where the provider allows, and surfaces understandable errors.
- AC14: Security posture: `contextIsolation`/sandbox/`nodeIntegration` unchanged; every new IPC channel validated and sender-guarded; audio not persisted by default and temporary data cleaned after the run.
- AC15: A document explains adding a provider (manifest + adapter) without generic-UI or pipeline changes; the registry enforces the versioned contract.

## Required tests

- Registry: registration, discovery, duplicate-id rejection, manifest capability exposure, contract version checks.
- Configuration: schema-driven validation (required/conditional fields), per-provider persistence isolation, renderer-side and main-side validation agreement.
- ElevenLabs: request formatting (endpoint, header, multipart fields, model, language, keyterm filtering against limits), response parsing including word-timestamp passthrough; `edited_transcript` success/absent/non-string/error paths; transcription-success + editing-failure returns the original; keyterm omission data.
- OpenRouter: request formatting (base64 audio, model), response parsing, model discovery against a mock, unsupported-option hiding.
- Dictionary: scope override (project over global), enable/disable, alias hinting without unconditional replacement, CRUD service behavior.
- Security: secret isolation (renderer payloads redacted; keys never logged), `safeStorage`-unavailable fallback, sender-guard and validation on every new channel.
- Pipeline: Disabled passthrough; Provider-native; External LLM with a mock corrector including the cross-provider combination; fallback on correction failure; suspicious-diff validation on negation/number/command fixtures; original always retained.
- Workflow: cancellation mid-request; duplicate-activation protection; stale-response discard; destination-gone no-insert; recording never starts from settings changes; button enable/disable rules (updated `PromptInput`/`ChatTerminal` tests replacing the always-disabled assertion).
- All external APIs mocked; the suite never requires real API keys; existing Electron security settings verified intact.

## Relevant SDD / ADR

- `docs/architecture/sdd.md`
- `docs/features/mvp-core-shell/spec.md` — chat terminal / prompt input lifecycle.
- `src/shared/ipc-contract.ts`, `src/main/security/sender-guard.ts` — typed IPC and sender validation conventions.
- `docs/references/NeKode-Design-System.md` — App Settings styling.
- ADR: none yet; if the OpenWhispr mechanism or the secret-store design settles on a non-obvious choice, record an ADR.
