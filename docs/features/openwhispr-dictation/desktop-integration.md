# Desktop dictation

OpenWhispr owns recording, processing and pasting. NeKode dispatches its fixed Windows shortcut. The [Desktop V1 contract](spec.md#desktop-v1-contract) defines the behavior and limits.

## Setup and use

Start OpenWhispr and configure `Ctrl + Super` (Windows key), activation `Tap`. In NeKode's App Settings, open Dictation, enable desktop dictation, then confirm that OpenWhispr is running with that configuration. Both options default off. Changing enablement resets confirmation. Opening settings or saving options sends no shortcut.

Configure microphone, language, model and Cloud or Local processing in OpenWhispr. OpenWhispr handles Cloud audio according to its selected mode. A local downloaded model or working local bridge is not a desktop launcher requirement.

Click Dictation beside the intended chat prompt. NeKode focuses that input and moves its caret to the end of the draft, then sends `Ctrl + Super` once. The draft stays intact. "Sending shortcut..." describes dispatch only. Success does not establish that OpenWhispr started recording or completed transcription. App Settings > General, `Chat prompt`, defaults to Dictation and Send, with Send on the right. The field stays the paste target. Send submits the draft, or Enter when the draft is empty. The same choice can show the text field or hide the prompt. The bottom terminal has no prompt, Send, or Dictation.

Tap may start or stop a recording depending on OpenWhispr's current state. Stop or cancel through OpenWhispr or its configured shortcut. Keep the intended field focused until OpenWhispr pastes; moving focus can redirect insertion. Sending a prompt remains your separate explicit action.

## Dictionary

Opening the Dictation settings tab reads the OpenWhispr dictionary through its local bridge. Refresh dictionary requests a new read. The section shows the complete entry count and the first 200 terms in their returned order, including duplicates. A longer list has a display-cap notice. NeKode does not edit or synchronize the dictionary.

The supported OpenWhispr v1.10.2 response contains one complete string list. A bridge that requires pagination, returns more than 10,000 entries or sends an invalid response shows an error without a partial list. Missing bridge, connection or authentication errors have an explicit refresh action. These errors do not disable desktop dictation.

OpenWhispr manages dictionary use in desktop dictation. The local file-transcription API does not accept dictionary or keyterm hints, so NeKode does not apply these terms to local bridge transcriptions.

## Errors

Release Ctrl, Super, Shift and Alt before clicking Dictation. Keep the owning NeKode window in the foreground. If dispatch reports an uncertain result or cleanup failure, inspect and stop OpenWhispr and release Ctrl and Super if needed before another attempt. NeKode never retries or changes routes automatically.

A missing helper or Windows PowerShell initialization failure asks you to repair the NeKode installation. A PowerShell policy refusal instead asks you to check with your administrator whether NeKode's bundled helper is permitted. NeKode does not change enforced Group Policy. Desktop dictation requires Windows and does not install, start or configure OpenWhispr.

When NeKode closes, it waits for its terminal processes to exit. If terminal shutdown does not complete within seven seconds, NeKode shows "NeKode could not close", keeps waiting, and quits when the terminals exit. A close during that wait does not start a second shutdown. Closing NeKode does not stop or cancel an OpenWhispr recording; use OpenWhispr's own controls.

## Helper lifecycle

The production helper is `resources/dictation/desktop-shortcut.ps1` in development and `dictation/desktop-shortcut.ps1` beside packaged app resources. `electron-builder.yml` copies it through `extraResources`. Product code never launches the standalone probe GUI.

Main derives the trusted sender's native NeKode window handle and invokes Windows PowerShell with a fixed argument array, hidden console and no shell interpolation. The helper compiles before announcing `READY`. It sends no keys before receiving `GO`. Main bounds startup to 10 seconds and may terminate only before `GO`.

The fixed invocation includes `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File` for the bundled helper. This execution policy lasts only for that PowerShell process; it writes no CurrentUser or LocalMachine policy and does not override MachinePolicy or UserPolicy enforced by Group Policy. This allows the application-owned helper to start when the ordinary policy is Restricted. See [Microsoft's execution policy scope and precedence](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1#execution-policy-scope-and-precedence). Policy diagnostics before `READY` remain bounded and produce a sanitized error with no raw paths or native messages.

After `GO`, the helper checks foreground and held modifiers, records each key before attempting key-down, and releases every attempted key in reverse order in `finally`. The chord has no sleeps, retries or external waits. Main bounds the caller's dispatch wait to 5 seconds. Expiry reports uncertainty without terminating the helper; the sender remains latched until process close so a second dispatch cannot overlap cleanup. A hung helper can therefore refuse further dispatch until it exits or NeKode is restarted. No desktop recording cancellation is inferred from timeout or UI unmount.

Automated `-OfflineCheck` compiles and runs the production dispatch algorithm against injected native behavior. It sends no real keys. Actual Windows focus/paste acceptance needs separately authorized product testing; an offline check or successful build is not live acceptance.
