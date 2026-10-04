# OpenWhispr Dictation Integration — Functional Specification

This file is the behavioral contract for the OpenWhispr dictation feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

Path: `docs/features/openwhispr-dictation/spec.md`.
Status: approved for planning; not yet implemented. Implementation issue: Plane `NEKODE` project, "Implement OpenWhispr Dictation Integration" (Backlog).
Parent contract: `docs/features/dictation-provider-architecture/spec.md` (generic provider registry). This document is the concrete OpenWhispr specialization and takes precedence for OpenWhispr behavior. Plane NEKODE-21 (the generic provider architecture) is deprioritized; this integration ships first.

## 1. Executive Summary

NeKode gains working dictation: the user clicks the existing Dictation button in the chat terminal prompt, speaks, stops, and the recognized text is inserted into that prompt input. Transcription is performed by the user's already-installed OpenWhispr desktop application through its local versioned HTTP bridge on the loopback interface. NeKode records microphone audio itself (16 kHz mono PCM WAV encoded in the renderer), hands the temporary file path to the local bridge, and inserts the returned text. No new transcription runtime, no bundled Whisper models, no Python, no WSL, no cloud subscription, and no OpenWhispr Cloud fallback. AI post-processing of transcripts is an optional follow-up, not part of the MVP.

MVP platform: Windows 11 (the only platform NeKode ships today).

## 2. Existing NeKode Context (verified in repository, 2026-10-04)

- Dictation exists only as a disabled placeholder button in the chat terminal prompt input: `src/renderer/src/components/terminal/PromptInput.tsx` (`TEST_ID.terminalPromptDictation`, `title="Dictation is not wired up yet."`), asserted disabled in `src/renderer/src/components/terminal/ChatTerminal.test.tsx`. There is no recording, transcription, microphone, or STT code anywhere in `src`.
- The prompt input supports an external draft-fill mechanism (`PromptInjection { text, nonce }` with consumption reporting and focus return) used by Handoff/Resume; dictation insertion reuses this path.
- The only editable text targets in the app are the chat terminal prompt inputs (`HTMLInputElement` per chat). Monaco is used exclusively as a read-only file preview (`MonacoPreview.tsx`, `readOnly: true`, `domReadOnly: true`). There are no other text areas or agent prompt fields today.
- Settings: `src/renderer/src/components/settings/AppSettings.tsx` is a modal dialog with tabs `general` and `shortcuts`; values are plain React props persisted by the app through the `app_state` SQLite key–value table. There is no per-provider settings schema, no secrets storage, and no Dictation tab yet.
- Persistence: `src/main/db/migrations.ts` is an append-only versioned queue (current version 5); generic key–value storage via `AppStateService` (`app_state` table).
- IPC: typed shared contract `src/shared/ipc-contract.ts`; handlers in `src/main/ipc/ipc-handlers.ts` with input validation (`ipc-validation.ts`) and sender guards (`src/main/security/sender-guard.ts`); services under `src/main/services/` wired by `create-services.ts`. Electron security posture: `contextIsolation: true`, sandboxed renderer, `nodeIntegration: false`.
- Stack: Electron 44, React 19, TypeScript, better-sqlite3 (prebuilt N-API), vitest, Biome, pnpm. The Windows build host has no MSVC build tools, so new native Node dependencies are effectively blocked; the design below requires none.
- Tooling facts: no FFmpeg or audio library in the dependency tree. `@openwhispr/cli` is NOT installed on the machine (verified 2026-10-04); nothing may depend on it at runtime.

## 3. Goals and Non-Goals

### Goals

- G1. Working click-to-dictate in the chat terminal prompt input, powered by the local OpenWhispr application.
- G2. Reuse the installed OpenWhispr: its bridge, its models, its dictionary. NeKode never downloads models, never bundles a recognizer, never starts a second runtime.
- G3. Clear connection lifecycle: discover the bridge, authenticate, report honest status, distinguish "app not running" from "no model installed".
- G4. Safe insertion: text lands only in the input the user dictated into; stale, cancelled, and duplicate results never insert.
- G5. Settings that match reality: only implemented controls, with validation and actionable errors.
- G6. Preserve the Electron security architecture; the bridge token never reaches the renderer, logs, or disk outside OpenWhispr's own file.

### Non-Goals

- NG1. Any cloud transcription, including OpenWhispr Cloud. No silent fallback to cloud, ever.
- NG2. ElevenLabs STT, OpenRouter STT, or any other STT provider (deprioritized; see Plane NEKODE-21).
- NG3. The generic provider registry/manifest system in this iteration. OpenWhispr ships as a self-contained dictation slice behind a narrow internal interface so the later registry refactor (NEKODE-21) is mechanical.
- NG4. Streaming/real-time transcription; batch only.
- NG5. Model downloading or a second model manager in NeKode.
- NG6. Dynamic provider plugins, Python provider execution, provider SDK/marketplace.
- NG7. Dictation into read-only Monaco previews or arbitrary UI elements (they are read-only by design).
- NG8. AI post-processing in the MVP (optional follow-up, Section 13).
- NG9. Push-to-talk hotkeys, audio history, transcription history UI.
- NG10. Modifying OpenWhispr's application files, UI automation, clipboard scraping, simulated keystrokes, or memory hooks.

## 4. Scope and Priorities

In scope (MVP): bridge discovery/auth/health, model discovery and selection, microphone recording with WAV encoding, temporary file lifecycle, transcription requests, response validation, insertion into the originating chat prompt input, the Dictation settings tab, dictionary read-only display, error handling, security, cleanup.

Optional (explicitly gated, not MVP): dictionary add/remove UI (FR-018), AI post-processing (Section 13), clipboard-copy review surface enhancements beyond the fallback requirement.

Priority order: connection foundation → transcription pipeline → UX/settings/insertion → dictionary → optional correction → validation. OpenWhispr takes precedence over all other STT providers.

## 5. User Stories

- US1. As a developer, I click Dictation, speak a command in Polish containing English technical terms ("Zresetuj branch na main i pushnij na origin"), stop, and see the text appear in the terminal prompt input — without touching the OpenWhispr window.
- US2. As a user who has not downloaded any OpenWhispr model yet, I see an honest message pointing me to OpenWhispr's own model management instead of a broken record button.
- US3. As a user, I can cancel a recording or an in-flight transcription, and nothing is inserted.
- US4. As a user, when OpenWhispr is not running, I see what to do (start OpenWhispr) — not a generic failure.
- US5. As a privacy-conscious user, I know my audio stays local: it goes to the local OpenWhispr bridge only, and the temp file is deleted afterwards.
- US6. As a user, I can see OpenWhispr's dictionary in NeKode settings and understand that NeKode does not silently rewrite it.

## 6. Functional Requirements

Identifiers are stable. "MVP" = mandatory for the first shippable slice; "Optional" = approved follow-up within this feature.

### Connection

- FR-001 (MVP) Detect the local OpenWhispr bridge: read `~/.openwhispr/cli-bridge.json` (home via `os.homedir()`, never a hardcoded profile path) in the main process. Validate: file exists; JSON parses; `version === 1`; `port` is an integer in 1–65535; `token` is a non-empty string. Any violation yields a typed "bridge config missing/invalid" status — never a thrown raw error in UI.
- FR-002 (MVP) Connection status model with exactly these states, surfaced in settings and derivable by the dictation controller: `bridge-missing`, `bridge-invalid`, `unreachable`, `auth-failed`, `connected`, `model-available`, `operational`. A health check alone never reports beyond `connected`; `model-available` requires a downloaded model in the catalog; `operational` requires a usable model selection.
- FR-003 (MVP) Health check: `GET /v1/health` with `Authorization: Bearer <token>`, timeout ≈ 1.5 s. HTTP 200 → `connected`. 401/403 → `auth-failed`. Connection error/timeout → `unreachable`. Test Connection never performs a transcription and never calls any cloud endpoint.
- FR-004 (MVP) Re-discovery: on `auth-failed` or `unreachable` at the moment a user action needs the bridge (Test Connection, model refresh, transcription start), re-read the bridge file once and retry the request once (token rotation after an OpenWhispr restart). No background polling loops; no automatic retries beyond this single re-discovery per user action.
- FR-005 (MVP) The HTTP client is hardwired to `http://127.0.0.1:<port>` from the bridge file. No configurable host, no hostname substitution, no URL setting, no cloud endpoint.

### Models

- FR-006 (MVP) Model discovery: `GET /v1/transcribe/models` (authenticated). Parse the versioned envelope `{ data: LocalTranscribeModel[] }` with `LocalTranscribeModel { provider: string; model: string; downloaded: boolean; default: boolean }`. Model ids are never hardcoded; unknown providers/models render generically.
- FR-007 (MVP) Model selection setting with values: `default` (omit the `model` field — OpenWhispr uses its configured default) or one explicitly downloaded model (`provider + model` identity). Persisted as non-secret configuration in `app_state`.
- FR-008 (MVP) Stale model handling: if the configured model is absent from the current catalog's downloaded set, transcription falls back to `default` (omit `model`), the settings UI marks the selection stale with a re-selection hint, and a one-time warning is attached to the next transcription outcome. NeKode never downloads models.
- FR-009 (MVP) No downloaded models at all (the verified state of the reference machine on 2026-10-04): status caps at `model-available = false`; the Dictation button is disabled with a tooltip directing the user to OpenWhispr's model management; settings shows the same guidance.

### Recording and audio

- FR-010 (MVP) Recording starts only by clicking the Dictation button (click-to-toggle: click starts, click stops and submits). Recording never starts from settings changes, dialog opens, or session restore. A visible recording indicator (button state + accessible label) is shown while recording; clicking again or pressing Escape stops; a dedicated cancel control discards the take.
- FR-011 (MVP) Capture via `getUserMedia` in the renderer; PCM encoded to WAV (16-bit, mono, 16 kHz) in the renderer (AudioWorklet-based encoder; no external dependency, no FFmpeg). Default input device; no device-picker UI in MVP. Microphone permission denial or missing device produces an actionable error and no recording state.
- FR-012 (MVP) The encoded audio is transferred to the main process over a typed IPC channel (binary payload) and written by main to an app-managed temp directory under `os.tmpdir()` with a generated file name. The renderer never learns or chooses filesystem paths.
- FR-013 (MVP) Cleanup lifecycle: the temp file is deleted when transcription completes, fails, is cancelled, or times out; a startup sweep deletes leftovers from previous sessions; nothing is persisted by default; audio content and temp paths never appear in logs.
- FR-014 (MVP) Edge audio cases: a take shorter than ~300 ms or containing no detected speech is treated as "no speech recognized" without calling the bridge; an interrupted take (device loss) ends in a recording-failure state; app shutdown during recording discards the take and releases the microphone.

### Transcription

- FR-015 (MVP) Transcription request: `POST /v1/transcribe` with JSON `{ path, language?, model? }`, bearer auth. `path` is the absolute Windows path of the temp WAV file. `language` is sent only when the user chose an explicit language (e.g. `pl`); `model` only for an explicit downloaded model (FR-007/FR-008).
- FR-016 (MVP) Timeout: configurable in settings, default 30 s, allowed range 5–300 s (the official CLI allows 30 minutes for local transcription; dictation takes are short). On timeout the attempt fails with a timeout error and a safe-retry hint; the temp file is cleaned up.
- FR-017 (MVP) Cancellation: the user can cancel while `Transcribing`. Cancellation aborts the HTTP request client-side (AbortController). The spec explicitly does not assume the bridge stops inference server-side; NeKode only guarantees its own state settles and nothing is inserted.
- FR-018 (MVP) Response validation: expect the envelope `{ data: { text, provider, model, warning? } }`. `text` must be a string; a valid empty string is the "no speech recognized" outcome; a missing/malformed envelope or non-string `text` is a normalized `malformed-response` error. A present `warning` is surfaced to the user alongside the text, never silently dropped.
- FR-019 (MVP) Exactly one dictation session at a time. A second activation while Recording/Preparing/Transcribing is ignored (the button shows the active state). Every completed session inserts at most once; late/stale results after cancel, timeout, or a newer session are discarded.

### Insertion

- FR-020 (MVP) The insertion target is bound at recording start and is exactly one kind in MVP: the chat terminal prompt input of the chat that owned the Dictation button (target = `{ chatId, kind: 'terminal-prompt' }`). The target never changes if focus moves elsewhere during the session.
- FR-021 (MVP) Delivery uses the existing `PromptInjection` draft-fill path of that prompt input (text appended to the current value; consumption reported; focus returned to the input). Insertion happens exactly once per session (FR-019).
- FR-022 (MVP) Destination gone (chat closed, view unmounted, terminal destroyed) when the result arrives: the result is never inserted anywhere else; a non-intrusive review surface offers the text with a copy action. The user decides what to do with it.
- FR-023 (MVP) If the target input had content at recording start, the recognized text is appended to that content (draft semantics of the injection path), preserving the user's typing.

### Settings UX

- FR-024 (MVP) A "Dictation" tab in App Settings with sections:
  - General: "Enable dictation" toggle (default off); "Transcription language" select: `OpenWhispr default` (omit field, default) plus explicit languages with Polish (`pl`) first among choices.
  - Connection: status row rendering the FR-002 state in plain words (e.g. `bridge-missing` → "OpenWhispr not detected — is the app installed and running?"), "Test connection" button (FR-003), "Refresh models" button (FR-006), last-checked timestamp.
  - Model: "Use OpenWhispr default model" option (default) plus a list of downloaded models from the last refresh (name shown as `provider / model`); a stale selection renders marked (FR-008); a refresh happens when the tab opens.
  - Advanced: "Transcription timeout" number input, default 30, range 5–300, seconds, validated on change.
- FR-025 (MVP) No API key field, no Base URL field, no model download controls, and no controls for unimplemented capabilities (dictionary editing appears only if FR-018 is implemented; post-processing controls appear only with Section 13). Settings must not display options that do nothing.
- FR-026 (MVP) Dictation button enablement rule (replacing the always-disabled placeholder and its test): enabled iff dictation is enabled in settings AND the connection state is `operational` (FR-002, i.e. bridge connected with a usable model selection). Otherwise disabled with a tooltip naming the first missing piece (disabled in settings / OpenWhispr not connected / no model downloaded). The enablement state derives from a renderer-side snapshot; no token or bridge detail is exposed to render it.

### Dictionary

- FR-027 (MVP) Dictionary read: `GET /v1/dictionary/list` (authenticated) rendered read-only in the Dictation tab (a "Dictionary (OpenWhispr)" section): terms list, entry count, and the documented limitation (FR-029). Handle the observed pagination fields (`has_more`, `next_cursor`) by fetching additional pages when `has_more` is true.
- FR-028 (Optional) Dictionary modification: add/remove entries via `POST /v1/dictionary/update` (`{ add: [...] }` / `{ remove: [...] }`) only on an explicit user action with an explicit confirmation for removals. NeKode never silently synchronizes, reorders, or prunes the OpenWhispr dictionary.
- FR-029 (MVP) Disclosure: the UI states that the current OpenWhispr file-transcription API does not accept dictionary/keyterm hints, so dictionary terms are not applied to NeKode's transcriptions by the bridge; their MVP role is informational (and, post-MVP, correction hints — Section 13).

### Errors and platform

- FR-030 (MVP) Error normalization: all failure modes map to the user-facing table in Section 16 with a single status per session, actionable text, and no dialog spam. Recoverable vs. action-required classes follow that table; infinite retry loops do not exist.
- FR-031 (MVP) Windows 11 specifics: paths are absolute Windows paths for the bridge; home directory always via `os.homedir()`; temp files under `os.tmpdir()`; no WSL, no PowerShell invocations, no shell interpolation anywhere in the dictation path.
- FR-032 (MVP) Security requirements of Section 15 are functional requirements: token confined to the main process, no token in renderer IPC payloads/logs, loopback-only client, no cloud fallback, unchanged Electron flags, every new IPC channel typed, validated, and sender-guarded.

## 7. User Workflows

### W1. Happy path (Polish dictation into a chat terminal)

1. User opens Settings → Dictation, enables dictation. Status shows `operational` (bridge connected, model usable). Language: Polish (`pl`). Model: OpenWhispr default.
2. User focuses a chat's prompt input and clicks Dictation. Button switches to a recording state; the microphone activates.
3. User speaks: "Wypuszczaj wersję zero dziewięć zero na mainie". Clicks Dictation again.
4. Renderer stops capture, encodes WAV; main writes the temp file; main POSTs `/v1/transcribe` with `{ path, language: "pl" }`.
5. Bridge returns `{ data: { text: "Wypuszczaj wersję 0.9.0 na mainie", provider, model } }`; main deletes the temp file; the text is injected into the originating prompt input; the button returns to Idle.

### W2. First run, no models (verified real state of the reference machine)

1. User enables dictation; status shows "connected, but no transcription model is downloaded".
2. The Dictation button stays disabled; tooltip: "No OpenWhispr model downloaded — open OpenWhispr to download one."
3. After the user downloads a model in OpenWhispr and clicks Refresh models, status becomes `operational` and the button enables.

### W3. OpenWhispr restarted mid-session (token rotation)

1. A transcription gets 401 (`auth-failed`). Per FR-004 the bridge file is re-read once and the request retried once.
2. Success: the session completes normally (the user notices nothing). Continued failure: the session fails with "OpenWhispr connection lost — check that the app is running", status updates, nothing inserts.

### W4. Destination disappears

1. User dictates into chat A, closes chat A while `Transcribing`.
2. Result arrives; target lookup fails; no insertion anywhere; a review surface shows the transcript with Copy. State returns to Idle.

### W5. Cancel paths

- Cancel during Recording: capture stops, take discarded, Idle; bridge never called.
- Cancel during Transcribing: HTTP request aborted (FR-017); nothing inserts; Idle.
- Timeout: same as failed transcription with a timeout message and a retry hint; retry re-uses the still-held take only if the user explicitly retries before recording again; otherwise a new session starts from Recording.

## 8. UI and Settings Specification

Settings live in the existing App Settings modal as a third tab, `Dictation`, following the current tab pattern (button tabs, focus management, Escape closes). Controls (all per FR-024):

| Setting | Type | Default | Validation / visibility | Behavior |
|---|---|---|---|---|
| Enable dictation | toggle | off | always visible | gates button enablement; turning off mid-recording cancels the session |
| Transcription language | select | OpenWhispr default | always visible when dictation section enabled | `default` omits the field; `pl` and other options send `language` |
| Connection status | read-only row | — | always visible | renders FR-002 state in plain words + last-checked time; spinner while checking |
| Test connection | button | — | enabled when not checking | runs FR-003 (+FR-004 re-discovery); updates status; never transcribes |
| Refresh models | button | — | enabled when not loading | runs FR-006; repopulates model list; preserves a still-valid selection |
| Model | select | Use OpenWhispr default | list from last refresh | lists only `downloaded: true` entries as selectable; stale selection marked; `default` always present |
| Timeout (s) | number | 30 | integer 5–300, invalid input shows inline error and reverts on blur | applied to subsequent sessions |

Recording UX on the prompt input: the Dictation button is the single control — Idle (mic icon + "Dictation") → Recording (red-dot state, aria-label "Stop dictation", Escape stops) → Preparing/Transcribing (spinner state, aria-label "Cancel dictation", click cancels) → back to Idle. Tooltips carry the disabled reason (FR-026). The existing disabled placeholder and its test assertion are replaced by this behavior.

Insertion fallback surface: a small transient panel anchored to the bottom panel area listing the transcript with a Copy button and a Close action; appears only for FR-022 (destination gone) cases; auto-dismisses on the next dictation session.

## 9. Recording and Transcription Lifecycle

State machine (one session; the button always reflects the current state):

```
Idle
 → Recording            (user click; mic granted)
 → PreparingAudio       (stop click: encode WAV → IPC → temp file written)
 → Transcribing         (POST /v1/transcribe in flight)
 → [Optional Correcting — post-MVP only, Section 13]
 → Inserted             (injection delivered) → Idle
 → Reviewed             (fallback surface shown) → Idle
 → Failed               (error surfaced) → Idle
 → Cancelled            → Idle
```

Transition rules:

- Recording → Cancelled: stop-and-discard control or Escape; mic released; no bridge call.
- Recording → Failed: permission revoked mid-take, device loss, encoder failure; mic released; no bridge call.
- PreparingAudio → Failed: empty/silence-only take (→ "no speech recognized" outcome), IPC/write failure. Temp file cleaned.
- Transcribing → Inserted/Reviewed/Failed/Cancelled per FR-015..FR-023; any exit deletes the temp file and releases resources.
- Retry semantics: Failed states allow retry with a NEW session (new recording). Only the timeout case may offer "retry same take" (single explicit retry, no loop). `auth-failed`/`unreachable` allow retry after the automatic single re-discovery (FR-004) — further attempts require a user action (Test connection or a new dictation click).
- No state is terminal-busy: every path ends in Idle; the button is never stuck disabled or spinning (FR-019 guarantees single-session ownership, so a lost session cannot wedge the UI — the controller owns the state and settles it on every exit path).

## 10. OpenWhispr Integration Contract

Verified externally (upstream contracts supplied with this assignment) and confirmed live against the installed application (see Section 22 "Verified locally"). Do not re-research; implement exactly this.

- Mechanism A (used): the OpenWhispr desktop app exposes a versioned local HTTP bridge on loopback. Configuration file: `~/.openwhispr/cli-bridge.json`, `{ "version": 1, "port": <int>, "token": <string> }`; port is dynamic — never assume 8200.
- Mechanism B (diagnostics only): `@openwhispr/cli` (npm, Node ≥ 20) speaks to the same bridge. NOT installed on the reference machine; NeKode has no runtime dependency on it. If it is installed, `openwhispr doctor --format json` and `openwhispr --local dictionary list --format json` are diagnostic aids; `--local` is mandatory for local-only checks (the CLI can otherwise pick a remote backend; `doctor` exit codes do not prove local reachability). Any future child-process use must resolve the npm `.cmd` shim on Windows without shell interpolation — but NeKode uses direct HTTP and does not spawn the CLI.

Endpoints (all bearer-authenticated unless noted; responses use the versioned envelope `{ "data": ... }`):

| Endpoint | Purpose | Notes |
|---|---|---|
| `GET /v1/health` | reachability | 200 = reachable; 401/403 = auth failure; no model readiness implied |
| `GET /v1/transcribe/models` | model catalog | `LocalTranscribeModel[]`; filter `downloaded` for selectable models |
| `POST /v1/transcribe` | transcribe a local file | JSON body `{ path, language?, model? }`; accepts a filesystem PATH, not an upload |
| `GET /v1/dictionary/list` | dictionary read | observed pagination fields `has_more` / `next_cursor` |
| `POST /v1/dictionary/update` | dictionary add/remove | body `{ add: [...] }` and/or `{ remove: [...] }` |

Request/response examples:

```json
POST /v1/transcribe
{ "path": "C:\\Users\\tomek\\AppData\\Local\\Temp\\nekode-dictation\\abc123.wav", "language": "pl" }

200 OK
{ "data": { "text": "Przykładowa rozpoznana wypowiedź.", "provider": "whisper", "model": "base" } }
```

```json
GET /v1/transcribe/models →
{ "data": [ { "provider": "whisper", "model": "tiny", "downloaded": false, "default": false } ] }
```

Hard limitations (must be encoded in behavior, not just comments):

- `/v1/transcribe` has NO `keyterms`/`prompt` parameter: the OpenWhispr dictionary is not applied to file transcriptions by the bridge. Never claim native dictionary prompting.
- The endpoint takes a path: the file must exist and stay readable until the response arrives; NeKode controls creation and deletion (FR-012, FR-013).
- Cancelling the HTTP request does not necessarily stop inference inside OpenWhispr (FR-017).
- The token is rotated by OpenWhispr on restart; stale tokens manifest as 401 (FR-004).
- A stale bridge file does not prove liveness; only `/v1/health` does (FR-002/FR-003).

## 11. Model Discovery and Selection

- Catalog refresh happens when the settings tab opens and on Refresh models; the transcription path uses the last known selection without a blocking refresh.
- Selection identity: `default` or `provider + model` of a downloaded entry. Only downloaded entries are selectable; non-downloaded entries may render in a disabled "available in OpenWhispr catalog" group only if FR-025's "no dead controls" rule is honored (they must not look actionable).
- OpenWhispr's own `default: true` flag is informational in the UI ("OpenWhispr default: X") — NeKode's `default` option means "omit the field", which delegates the choice to OpenWhispr.
- Model-specific language support is not queryable via the bridge; the UI therefore shows language as a request hint and surfaces provider warnings (FR-018) when a model rejects a combination.

## 12. Dictionary Integration

Decision (MVP): Option A — OpenWhispr-managed dictionary, read-only in NeKode (FR-027), explicit optional add/remove (FR-028, Optional). Rationale: one source of truth, zero duplicated storage, no sync bugs; the dictionary's practical value for file transcription is currently nil (FR-029 limitation), so building NeKode-side scope/alias persistence (Option B) now would be speculative. Option B (global+project NeKode-managed vocabulary as correction hints) is deferred to the post-processing milestone (Section 13) where it has a real consumer; it then lives behind the generic dictionary service designed in the parent contract (`dictation-provider-architecture`, Business rules).

Preferred spelling vs. recognition variants: in MVP the list is displayed as-is (raw OpenWhispr entries). No alias machinery, no unconditional substitutions — the parent contract's rule (aliases are correction hints, never automatic replacements) applies when Option B lands.

## 13. Optional AI Post-processing (follow-up, NOT MVP)

Post-MVP capability, gated on an existing LLM integration in NeKode (none exists today — the parent contract's OpenRouter correction provider is itself unimplemented). When built:

- Levels: Disabled (default state of the feature: original text used), Light (conservative spelling/punctuation/technical-name fixes; the default when correction is enabled), Medium (+ obvious grammar, repetitions), Full (stylistic editing preserving meaning).
- Protected categories that correction must never alter silently: negations, numbers/quantities, version numbers, file paths, URLs, CLI flags, code identifiers, branch names, explicit instructions to coding agents. Fixture: "Do not delete the old implementation." must survive Light/Medium/Full unchanged in meaning.
- The transcript is data, never instructions; a validation step flags suspicious diffs (negation flips, changed digits, changed paths) and falls back to the original.
- Failure at any correction step returns the ORIGINAL transcript with a "correction failed" notice; the original and corrected variants remain distinguishable in the UI; "keep original" defaults on.
- Dictionary terms (Option B vocabulary) feed correction as hints only.
- Any cloud LLM use requires explicit disclosure that transcript content leaves the machine; local OpenWhispr transcription itself never does.
- Transcription works fully with correction disabled; correction failure never blocks insertion of the original.

MVP scope of this section: preserve the transcript verbatim and keep a stable internal seam (`Correcting` state, original-vs-final result fields) so this milestone can land without reworking the pipeline.

## 14. Data Handling and Persistence

- Persisted (non-secret, `app_state` KV, keys namespaced e.g. `dictation.*`): dictation enabled flag, language choice, model selection (`default` or provider+model), timeout, last connection status snapshot (state + timestamp only — no token, no endpoints beyond the loopback port).
- Never persisted: bridge token (read from OpenWhispr's own file at need; never copied into `app_state`, settings files, or logs), audio (temp file deleted per FR-013), transcripts (in-memory only; the review surface holds at most the latest undelivered result until dismissed/session end).
- No new SQLite tables and no migration in MVP (KV suffices for four small values). If the later registry refactor needs structured per-provider config, that is NEKODE-21's concern with its own migration.
- Temp audio location: `<os.tmpdir()>/nekode-dictation/`, files named by generated ids, permissions default to the user's temp dir; the directory is swept at startup and removed when empty.

## 15. Security and Privacy

- Electron posture unchanged: `contextIsolation: true`, sandbox on, `nodeIntegration: false`. All dictation IPC goes through the typed contract with input validation and sender guards; privileged operations (bridge HTTP, temp-file IO, token handling) run only in the main process behind a narrow preload surface.
- The bridge token: read in main from `~/.openwhispr/cli-bridge.json`; held in memory only; never sent to the renderer (the renderer receives status enums and results, never credentials); never logged; never written to any file by NeKode.
- The bridge client connects exclusively to `http://127.0.0.1:<port>` from the bridge file; the token is the authenticator — a localhost origin alone proves nothing and grants nothing.
- No arbitrary authenticated HTTP proxying for the renderer; no renderer-supplied filesystem paths reach the bridge (main generates temp paths); no renderer-supplied URLs.
- Audio privacy: recording is always user-initiated; audio goes only to the local bridge; no persistence (FR-013); no telemetry.
- No cloud fallback, ever (NG1). A future cloud correction feature must be separately configured and explicitly disclosed (Section 13).

## 16. Error Handling and Recovery

| Scenario | Detected by | User-facing behavior | Recoverable? |
|---|---|---|---|
| OpenWhispr not installed / bridge file missing | FR-001 | Status "OpenWhispr not detected — install/start the OpenWhispr app"; button disabled with tooltip | Yes: after user starts OpenWhispr → Test connection |
| Bridge file invalid (bad JSON/version/port/token) | FR-001 | Status "OpenWhispr configuration invalid"; hint to restart OpenWhispr | Yes: restart OpenWhispr (rewrites file) → Test connection |
| App running, bridge unreachable | FR-003 | Status "OpenWhispr is not responding — is the app running?" | Yes: user action retried after single re-discovery |
| Token invalid (401/403) | FR-003/FR-004 | One silent re-discovery retry; if still failing: "Authentication with OpenWhispr failed — restart OpenWhispr and test the connection again" | Yes: restart OpenWhispr |
| Bridge version incompatible | FR-001 (`version !== 1`) | Status "OpenWhispr bridge version not supported (expected v1)"; explicit compatibility error, no guessing | Needs OpenWhispr/NeKode update |
| No downloaded model | FR-006/FR-009 | "No transcription model downloaded — open OpenWhispr → models and download one"; button disabled | Yes: user downloads model → Refresh models |
| Selected model disappeared | FR-008 | Transcription proceeds on OpenWhispr's default; settings marks selection stale; one-time warning attached to the result | Yes: re-select in settings |
| Microphone unavailable / permission denied | FR-011/FR-014 | "Microphone unavailable — check Windows microphone permission for NeKode"; no recording starts; settings untouched | Yes: grant permission → click again |
| Recording format/encode failure | FR-014 | "Recording failed — try again"; recording-failure state | Yes: re-record |
| Transcription timeout | FR-016 | "Transcription timed out — OpenWhispr did not answer in Ns"; single explicit retry of the same take offered | Yes: retry once, else re-record |
| Empty recognized text | FR-018 | "No speech recognized"; nothing inserts | Yes: re-record |
| Malformed bridge response | FR-018 | "OpenWhispr returned an unexpected response"; provider `warning` shown when present with otherwise-valid text | Yes: retry / re-record |
| OpenWhispr closes mid-request | FR-004/FR-017 | Connection error with data preserved where available; "OpenWhispr connection lost" | Yes: restart OpenWhispr |
| Destination chat closed | FR-022 | Transcript shown in review surface with Copy; never inserted elsewhere | Manual |
| User cancels | FR-010/FR-017 | Session ends; nothing inserted; no error | — |
| Dictation disabled in settings | FR-024/FR-026 | Button disabled, tooltip "Dictation is disabled in Settings" | Yes: enable in settings |

Error classes: recoverable-with-user-action (connection family, model family, microphone) vs. session-fatal (timeout after retry, malformed response, cancelled). No automatic retry storms anywhere (FR-004, FR-030).

## 17. Non-Functional Requirements

- Performance: Test connection ≈ 1.5 s budget; transcription timeout default 30 s (user-tunable 5–300 s); recording start latency imperceptible (< 300 ms to visible recording state); insertion within ~100 ms of result receipt.
- Reliability: every session terminates in a defined state; no wedged busy states (Section 9); temp files never leak across restarts (startup sweep).
- Resource: microphone released on every session exit; no polling timers in steady state.
- Compatibility: Windows 11; single-user local app; works with OpenWhispr bridge `version: 1` contracts only (explicit compatibility error otherwise).
- Testability: bridge client fully mockable behind an interface; all external calls mocked in the automated suite; no real OpenWhispr process required for unit/integration tests; the manual acceptance pass uses the real installed app.
- i18n: UI text English (project convention); Polish dictation is a first-class use case via the language setting.

## 18. Technical Architecture Recommendations

- Main process: `OpenWhisprClient` service (`src/main/services/dictation/`) owning bridge-file parsing, the loopback HTTP client (bearer token internal), health/models/dictionary/transcribe calls, and typed error normalization. Constructor-inject a `fetch`-like transport for tests (project convention: constructor deps, no singletons).
- `DictationService` orchestrating sessions: state machine (Section 9), temp-file lifecycle, timeout, single-session ownership, result routing. Exposes typed IPC: `dictation.status`, `dictation.record/start|stop|cancel` (renderer-side capture control), `dictation.audio` (renderer → main binary payload), `dictation.transcribe` result event, `dictation.testConnection`, `dictation.models/refresh`, `dictation.settings` get/set, `dictation.dictionary/list`. All in `src/shared/ipc-contract.ts`, validated, sender-guarded.
- Renderer: a `useDictation` controller (zustand-compatible with existing App state flow) owning session state and button state; recording via `getUserMedia` + AudioWorklet PCM tap → WAV encoder (self-written, ~100 lines, no dependency); insertion via the existing `PromptInjection` path with a `{ text, nonce }` fill appended to current value; target binding = the chat id owning the button.
- Deliberate seam for NEKODE-21: `DictationService` talks to OpenWhispr only through the `OpenWhisprClient` interface shaped like a provider adapter (`discover/status/models/transcribe`), so the future registry adopts it without user-visible changes. No manifest system, no registry, no plugin loading now (NG3).
- Settings persistence via `AppStateService` keys (Section 14); no migration.
- No new native dependencies, no FFmpeg, no Python, no WSL, no CLI spawn.

## 19. Dependencies and Compatibility

- Runtime deps added: none.
- OpenWhispr desktop app (user-installed, already present on the reference machine) with a v1 local bridge. NeKode must degrade to clear unavailability states when it is absent (FR-030) — NeKode never installs, updates, or auto-starts OpenWhispr (auto-start guidance in error text is fine).
- Node APIs: `os.homedir()`, `os.tmpdir()`, `fetch` (Electron 44 main process), `AbortController`.
- Renderer APIs: `getUserMedia`, `AudioWorklet`, `MediaRecorder` NOT required (PCM path avoids WebM/Opus entirely — see Appendix).
- `@openwhispr/cli`: not a dependency; diagnostics only (not installed on the reference machine).

## 20. Acceptance Criteria

- AC1 (Discovery). Given OpenWhispr installed and running with a valid `cli-bridge.json`, When the Dictation settings tab opens and Test connection runs, Then status becomes `connected`/`operational` within the timeout, using the port from the file (not assumed 8200), and no token value appears in any log, IPC payload to the renderer, or persisted setting.
- AC2 (Auth honesty). Given a bridge file with a wrong token, When Test connection runs, Then the single re-discovery (FR-004) happens and the final status is `auth-failed` with the Section 16 message; nothing transcribes.
- AC3 (No models). Given a catalog where every entry has `downloaded: false` (the verified reference-machine state), When settings refresh models, Then no model is selectable, status caps below `operational`, and the Dictation button is disabled with the model-management tooltip.
- AC4 (Happy path). Given `operational` status and language `pl`, When the user records a spoken Polish sentence into chat A's prompt and stops, Then exactly one `POST /v1/transcribe` carries `{ path: <temp .wav>, language: "pl" }` (no `model` field under the default selection), the temp file exists during the request and is deleted after, and the recognized text is appended into chat A's prompt input exactly once.
- AC5 (Recording gate). Given dictation disabled in settings OR status below `operational`, Then the Dictation button is disabled and its tooltip names the reason; clicking does not start capture; changing settings never starts recording.
- AC6 (Cancel). Given an active Recording or Transcribing session, When the user cancels, Then no insert occurs, the microphone/HTTP request are released, the temp file is deleted, and the button returns to Idle.
- AC7 (Stale results). Given a cancelled or superseded session, When its late response arrives, Then it is discarded and the UI stays consistent (FR-019); a duplicate activation during an active session inserts nothing extra.
- AC8 (Destination gone). Given the target chat closed during Transcribing, When the result arrives, Then no input anywhere receives the text and the review surface offers Copy.
- AC9 (Focus safety). Given the user switches focus, tabs, or chats during Transcribing, Then insertion still lands in the bound chat's prompt (W1) — or the review fallback if that chat is gone; focus changes alone never redirect insertion.
- AC10 (Model fallback). Given a configured model that is no longer downloaded, When a transcription runs, Then the request omits `model`, the result carries a stale-selection warning, and settings marks the selection stale.
- AC11 (Timeout). Given the bridge never answers, When the configured timeout elapses, Then the session fails with the timeout message, the temp file is deleted, and at most one same-take retry is offered.
- AC12 (Empty/no speech). Given a silence-only take, Then no bridge call happens (client-side gate) and the outcome is "No speech recognized".
- AC13 (Cleanup). Given any session exit (success, failure, cancel, timeout, app quit during recording), Then the temp file is gone after the run and the startup sweep removed leftovers from a previous crash.
- AC14 (Security). Given the feature active, Then: Electron flags unchanged; every new IPC channel is typed, validated, sender-guarded; the token never appears in renderer-visible payloads, logs, or `app_state`; the HTTP client only ever dials `127.0.0.1` ports from the bridge file; no cloud endpoint is ever called.
- AC15 (Settings truthfulness). Given the MVP build, Then the Dictation tab shows exactly the FR-024 controls (no API key field, no base URL, no dictionary editor unless FR-018 ships, no post-processing controls) and each control performs its documented behavior.
- AC16 (Dictionary read). Given a populated OpenWhispr dictionary (verified populated on the reference machine), When the Dictionary section renders, Then it lists the terms with count, follows `has_more` pagination, and displays the FR-029 limitation text; no write occurs without an explicit user action (which in MVP does not exist).
- AC17 (Windows paths). Given a temp recording, Then the `path` sent to the bridge is an absolute Windows path resolvable by OpenWhispr on the same machine, and home/tmp resolution never hardcodes a user profile name.

## 21. Verification and Test Scenarios

Automated (vitest; bridge mocked via the injected transport; no real OpenWhispr, no network, no microphone):

- Bridge file parser: valid v1; missing file; invalid JSON; `version: 2`; port 0/70000/missing; token empty/absent/non-string → each maps to the FR-001 status.
- `OpenWhisprClient` against a mocked transport: health 200/401/timeout/connection-refused; models envelope (downloaded filter, unknown provider shapes, `has_more` pagination for dictionary); transcribe success, empty text, malformed envelope, `warning` passthrough, 401 triggering exactly one re-read+retry, timeout, abort.
- Session controller state machine: full happy path; cancel in Recording; cancel in Transcribing; timeout + single same-take retry; duplicate activation ignored; stale-response discard; destination-gone → review fallback; disabled-settings gating.
- WAV encoder: known PCM fixture → expected 16 kHz mono 16-bit WAV bytes (header + payload); short/silence take flagged client-side.
- Temp lifecycle: create/write/delete on every exit path; startup sweep deletes a planted leftover.
- Settings mapping: app_state keys round-trip; timeout validation bounds; stale-model marking.
- Security: renderer-visible payloads assert absence of the token; new channels validated/sender-guarded; Electron flags asserted unchanged (existing pattern).
- PromptInput/ChatTerminal tests: replace the always-disabled assertion with the enablement rule (AC5) and the state-driven button labels.
- Insertion: existing `PromptInjection` consumption semantics preserved; append-not-replace against a non-empty input (FR-023).

Manual Windows 11 acceptance (real installed OpenWhispr): W1 happy path in Polish; W2 no-model state; W3 restart/token rotation; W4 destination gone; Test connection with OpenWhispr quit; microphone-permission denial; observed temp-dir cleanliness after each run; confirm no token in logs (`%APPDATA%`/`userData` logs).

## 22. Open Questions and Assumptions

Verified externally (upstream contracts supplied with the assignment; not re-derived):

- Bridge file location/schema (`~/.openwhispr/cli-bridge.json`, v1, dynamic port, bearer token); `/v1/health`, `/v1/transcribe/models`, `POST /v1/transcribe` (path-based, no keyterms), `/v1/dictionary/list`, `/v1/dictionary/update`; envelope `{ data }`; `LocalTranscribeResponse { text, provider, model, warning? }`; CLI 30-minute local timeout precedent; CLI `--local`/`doctor` caveats; no cloud fallback.

Verified locally (this repository / this machine, 2026-10-04):

- Bridge file present and valid (`version: 1`, dynamic port service running on 8200 at check time, token present); `/v1/health` → 200 with bearer token, 401 without; `/v1/transcribe/models` → 200 with 12 catalog entries (providers: whisper, nvidia, cohere), ALL `downloaded: false`; `/v1/dictionary/list` → 200, populated (~200 entries), `has_more: false`; `@openwhispr/cli` not installed.
- NeKode repo facts in Section 2 (placeholder button, PromptInjection path, read-only Monaco, settings/persistence/IPC conventions, no audio code, no MSVC toolchain on host).

Requires validation (must be confirmed during implementation M2, on the real machine — do not assume):

- V1. Accepted audio inputs of the installed bridge build: this spec mandates 16 kHz mono 16-bit WAV (safe Whisper-family default). If the bridge rejects it, negotiate sample rate/channels first; WebM/Opus from `MediaRecorder` is a fallback only if the bridge demonstrably accepts it. Renaming a file extension is never a conversion.
- V2. Whether `/v1/transcribe` accepts additional optional fields (e.g. `language` values beyond ISO-639-1, `model` identity format `provider+model` vs bare name) — pin to observed behavior; the OpenWhispr backend is free to evolve.
- V3. Bridge behavior under concurrent requests (dictation while OpenWhispr itself transcribes) — single-session MVP sidesteps it; document any queueing observed.
- V4. Installed OpenWhispr app version / upgrade policy of the bridge contract (v2 handling = explicit incompatibility error per FR-030; no guessing).
- V5. Dictionary list upper bounds (page size, very large dictionaries) — pagination is implemented per FR-027; rendering caps at a reasonable window with a count if needed.

Open questions (product): none blocking MVP. Post-MVP correction provider choice (Section 13) is deliberately open until an LLM integration exists in NeKode.

## 23. Deferred Functionality

Explicitly LOW PRIORITY / deferred (keep backlog entries; do not implement here; Plane NEKODE-21 remains the umbrella):

- ElevenLabs Speech-to-Text; OpenRouter Speech-to-Text; any additional cloud or local STT providers.
- Generic provider registry/manifests and schema-driven settings (NEKODE-21) — the OpenWhispr slice ships standalone behind the adapter-shaped seam (Section 18).
- Dynamic third-party provider plugin loading; Python-based provider execution; provider SDK / plugin marketplace.
- NeKode-managed dictionary (Option B: global+project scopes, aliases) — returns with the correction milestone as hint data.
- AI post-processing (Section 13) — optional follow-up, separately specified when an LLM integration exists.
- Streaming transcription; push-to-talk; audio/transcript history; device picker; additional UI insertion targets beyond the chat prompt input (revisit only if new editable targets appear in the app).

## 24. Implementation Milestones (proposal only — NOT part of this specification task)

- M1 Foundation: bridge-file parser, loopback client (bearer, 1.5 s health timeout), status model (FR-001..FR-005), error normalization, IPC surface skeleton. Verify: parser + client unit suites against mocked transport.
- M2 Transcription: renderer capture + WAV encoder, temp-file lifecycle, `POST /v1/transcribe`, model discovery + selection + stale-model fallback, timeout/cancellation. Verify: mocked end-to-end session tests; on-machine validation of V1/V2 with the real bridge.
- M3 Application UX: Dictation settings tab, button enablement + state labels (replace placeholder test), insertion via PromptInjection, review fallback, status/error surfaces. Verify: PromptInput/ChatTerminal/AppSettings suites + manual W1–W5.
- M4 Dictionary: read-only list with pagination, limitation disclosure; optional explicit add/remove behind a flag (FR-028). Verify: mocked pagination suites; manual against the populated local dictionary.
- M5 Optional correction (only if/when an LLM integration exists): conservative levels, protected-category fixtures, original preservation, disclosure. Separate plan before implementation.
- M6 Validation: full automated suite, security checklist (AC14), Windows acceptance pass on the real installation, cleanup/leak checks (AC13), documentation touch-ups.

Sequencing rule: M1 → M2 → M3 are the MVP core; M4 can parallel M3; M5 and parts of M4 are optional enhancements; M6 closes.
