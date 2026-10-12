# Desktop activation probe

## Accepted desktop V1 scope

The user accepts current-focus delivery for desktop V1 and requires NeKode's Dictation button to focus its own prompt before dispatching the configured shortcut. The [desktop V1 contract](spec.md#desktop-v1-contract) now defines DFR-001 through DFR-010; the user has approved the amended execution plan. The A-to-B observation below remains a failure against the earlier original-target contract, and is evidence of the now-accepted desktop semantics. It does not establish NeKode session telemetry or change any take/correction budget. The remaining probe text is historical procedure/evidence, not permission to rerun it or a competing product contract.

Purpose: test the desktop route selected for NEKODE-22 without wiring NeKode's product button. Public Cloud API remains deferred in NEKODE-37. The third Stage 2 correction is approved for diagnostic visibility, a bounded Start-attempt limit and offline checks. Its independent review passed on 2026-10-11 (No significant issues found). One live stable-focus take is user-confirmed; the additional focus-change take delivered text to B after starting in A and failed original-target acceptance. This correction authorizes no new recording or Cloud transfer.

## Required configuration

The user confirmed the actual configuration: Dictation Hotkey `Ctrl + Super`, activation mode `Tap`, processing mode `Cloud`. These configuration facts alone do not authorize a live run. The user separately authorized at most two additional harmless-phrase Cloud takes on 2026-10-11. One Start, exactly one transcript in A and finished OpenWhispr processing were then user-confirmed; the user confirmed the second take was not performed. The actual internal counter in that earlier probe instance is unknown. Do not infer a fresh budget from this correction or a process restart. Do not substitute Windows defaults, read credentials or change OpenWhispr settings to make the test pass.

The artifact is `scripts/openwhispr-desktop-probe.ps1`: a standalone Windows scratch window with inputs A and B and explicit activation/release controls. It does not activate dictation on launch. The default run is a preview with disabled activation controls. `-OfflineCheck` runs headless with injected send/focus functions and creates no native sender or window. Live activation requires `-Live` plus explicit `-Shortcut`, `-ActivationMode` and `-ProcessingMode` parameters and approval of the exact test configuration. The script supports only the confirmed `Ctrl + Super` chord; it refuses any other shortcut.

`-MaxTakes 1` limits a newly started process to one Start attempt; `-MaxTakes 2` is the default and preserves the previous maximum. Only the exact values `1` and `2` are accepted, before native sender or window creation. The status shows LIVE/Preview, current probe phase, the actual Start-attempt count and limit, held keys, and the reason each control is disabled. A failed Start attempt also consumes the limit: neither a failed send nor `Stopped confirmed` resets it. The handler reserves the attempt and refreshes controls before focusing the input or sending keys, so nested Start events cannot consume an extra attempt. There are no automatic retries.

Offline check (no keys, microphone or upload):

```powershell
powershell -NoProfile -NonInteractive -File scripts/openwhispr-desktop-probe.ps1 -OfflineCheck
powershell -NoProfile -NonInteractive -File scripts/openwhispr-desktop-probe.ps1 -OfflineCheck -MaxTakes 1
```

Release failures remain visible in the window's status and retain failed keys for the Stop / release retry. Closing is refused while any key remains held. Errors use the status label rather than a modal dialog; nested focus-loss release does not send duplicate key-up events.

The earlier live probe was launched as PID 32128 with the earlier source. Editing this file did not update its loaded controls or expose its counter. The user reported Ready with all buttons inactive and no Manual observation dialog; the source-level cause of that live observation remains unresolved. The user then confirmed OpenWhispr stopped and the old scratch window closed; a read-only process check found PID 32128 absent and no PowerShell command line containing the probe. This correction did not touch that process. Diagnostic visibility and the single-attempt option do not establish that the activation problem is fixed. Any later replacement launch needs reconciled remaining authorization and separate approval for any additional audio. A new process starts its displayed counter at zero; that is not a reset of authorization across processes or sessions.

## Proposed live scope

The procedure below describes the two-case feasibility test, not permission to repeat it. Use the harmless phrase "To jest test dyktowania w NeKode." within the explicitly authorized remaining Start-attempt budget. A later approved single-attempt process uses `-MaxTakes 1` and performs only the selected case. OpenWhispr owns microphone recording and processing; if its selected mode is Cloud, audio leaves the machine through OpenWhispr. The test writes only to its scratch inputs and does not submit any terminal prompt. It does not create an API key, change account settings, modify OpenWhispr files or scrape the system clipboard.

1. Focus A. Activate once using the confirmed shortcut. Observe whether OpenWhispr starts recording before proceeding. Speak the test phrase and stop through the configured Tap/Hold action. Observe completion and record the text delivered to A, any duplicate delivery and any available completion/cancellation signal.
2. Focus A and repeat the start/stop sequence once. Move focus to B after stopping and before delivery, if that interval is observable. Record which input receives text. If the interval cannot be exercised, report the focus-change case as unverified.

Before either activation, refuse to send keys unless the scratch window is foreground. Release every held simulated key even on an error or focus change. Do not retry a toggle automatically when recording state is uncertain. If the shortcut is ignored, misrouted or leaves recording state unclear, stop the automated test and have the user stop OpenWhispr manually before closing the scratch window. This limitation must be disclosed before live authorization.

## Acceptance and limits

Synthetic start/stop, transcript delivery and focus-change routing need observed evidence. A transcript delivered to B after starting in A fails the original-target requirement. Successful activation alone does not establish observable completion, cancellation, session ownership or exactly-once delivery for NeKode.

Do not wire the product until the observed interface and insertion behavior support an approved contract. If they do not, report the result as a desktop limitation; do not silently substitute the deferred API route or weaken FR-020.

## Evidence template

| Check | Expected evidence | Result |
|---|---|---|
| Offline syntax and parameter validation | Commands above and exit status; no native sender/window | Passed, exit 0: Ready at 0/1/2 attempts, single-attempt exhaustion, invalid limits, actual Start-handler reentrancy, preview/phase/held-key reasons and existing release/focus regressions. Native GUI rendering remains unverified. |
| Independent review | Activation, foreground gate, release and uncertain-state handling reviewed | Earlier probe review passed historically; third correction review passed on 2026-10-11 (No significant issues found). |
| Confirmed configuration | Actual shortcut, Tap/Hold and local/Cloud mode | Ctrl + Super, Tap, Cloud; separate 2026-10-11 live authorization recorded above. No new live run authorized by this correction. |
| Start/stop | OpenWhispr visibly enters and exits recording | First new take user-confirmed: one Start, OpenWhispr finished recording/processing. No second take performed. |
| Stable-focus delivery | One transcript in A | First new take user-confirmed: test text delivered exactly once in A. |
| Focus-change delivery | Target observed after A to B focus change | Separate MaxTakes 1 Cloud take authorized on 2026-10-11: B focused before delivery, text inserted into B, processing finished. Original A target was not preserved (FR-020 / AC9 failed). |
| Completion/cancellation interface | Specific usable signal or explicit absence | Current installed 1.10.2 bridge route table, second-instance handler and tray callbacks expose no usable external desktop session-completion/cancellation interface. Manual finished-state observation is not NeKode telemetry. |
| Ready with disabled actions | Actual count, mode, phase, held keys and control reasons | Earlier probe did not expose these diagnostics. Live cause unresolved; no modal reported. Corrected artifact passed independent review; live validation still needs separate approval. |

Requirements: [specification](spec.md). Scope and approval gate: the approved desktop V1 scope and its amended execution plan (Stage 2); this file's own authorization limits remain as recorded above.

## Focus-change result (2026-10-11)

The user separately authorized one additional Cloud take with Ctrl + Super / Tap / MaxTakes 1. The corrected visible probe started at LIVE / Ready / 0/1 with Start active. The user confirmed B was focused before text arrived, text went to B, and OpenWhispr finished recording and processing. The window was then user-closed and OpenWhispr stopped; PID 33516 was absent. No more activation was instructed. This result fails original-target delivery and does not authorize product wiring or weakening FR-020 / FR-019.

The current installed app.asar remains version 1.10.2. Read-only inspection covered cliBridge.js:383-575, main.js:1824-1863 and tray.js:260-267. These paths contain no external desktop start/stop/session-completion or cancellation interface. The bridge's transcription-history routes do not bind a result to a NeKode-owned desktop session. No user history or credentials were inspected. [Official auto-paste documentation](https://docs.openwhispr.com/help/dictation/auto-paste-and-clipboard) describes delivery into the active app when dictation finishes.
