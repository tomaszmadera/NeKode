# Settings dialog restyle

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

Path: `docs/features/settings-dialog-restyle/spec.md`.

## Goal

Restyle the App Settings dialog and the Project Settings dialog so they share one shell and match the layout in `tmp/Main.dc.html`. People who already use these settings keep every current setting, command, and saved value.

App Settings pages: General, Fonts, Shortcuts, Dictation, Agents, and Usage. Project Settings pages: Shell, Actions, Tasks, Task progress, and Agents.

## Related requirements

The visual reference is `tmp/Main.dc.html` (dialog from the Settings section, state in `settingsVals` and `pset`). Product behaviour stays the behaviour already implemented in the settings components. Copy spacing, radii, and type from the reference. Do not copy its sample data.

## Scope

- One dialog shell for both dialogs: size, header, left navigation, page intro, section labels, grouped rows, and footers.
- Control presentation: selects, text fields, switches, the font-size stepper, shortcut key chips, segmented scope control, and primary or secondary buttons.
- Project Settings header identity: the open project's name and its resolved colour on the avatar.
- Colour through existing theme tokens in every theme. New roles, when needed, are added to every theme.
- Accessible names that tests and keyboard use today stay, except where this spec renames a visible label.

## Non-goals

- New settings, removed settings, or changed defaults.
- Remembering the last settings page. App Settings opens on General, or on Usage or Agents when those entry points already do that, and those flags clear on close. Project Settings uses the caller's `initialTab` for that mount only (default Shell).
- Hard-coded prototype colours, sample agents, sample adapters, sample sources, sample paths, sample counts, or a fake Test connection or Save.
- A new gear on the tab bar. Project Settings already opens from its existing entry points.
- Turning these controls into switches: the OpenWhispr desktop confirmation, project Agent enable rows, and boolean fields that come from a tracker or task-progress schema.
- A Clear action for a Kanban secret. An empty secret is omitted and the stored secret stays.
- A release, version bump, or tag.

## Behaviour

Both dialogs use the same shell. The dialog is at most 920 by 660 pixels, centred, at least 48 pixels from the window edge, with a 12 pixel radius and a 1 pixel border. Backdrop mouse down on the backdrop itself and the close button close it. The left navigation is 200 pixels. Each page is a plain icon and label row, 36 pixels high. The active row uses the same selected-session background as the sidebar, `aria-selected`, and `aria-current="page"`. Rows stay `role="tab"`. Arrow keys, Home, and End move between that dialog's pages.

Page content is at most 660 pixels wide, with 24 pixels top, 28 pixels side, and 32 pixels bottom padding. Each page has an 18 pixel semibold heading and one description, then sections. A section label is uppercase, 12 pixels, semibold, letter-spacing 0.08em. A group is a bordered box with a 10 pixel radius and 1 pixel dividers between rows.

A switch is `role="switch"` and `aria-checked`. The track is 38 by 22 pixels inside a hit target at least 36 pixels. Icon buttons in rows are at least 32 pixels. Form controls are 36 pixels tall. Every control has a visible label or an `aria-label`, and a visible accent focus ring. One primary button per group footer. Primary text uses the on-accent token.

The two dialogs keep different keyboard models:

- App Settings listens on the dialog. Escape stops propagation and closes it. Tab cycles inside the dialog. Focus moves in on open and returns to the previous control on close.
- Project Settings listens for Escape on the window, because focus can stay on the opener. That listener does nothing while the dialog is suspended (App Settings is open on top). A confirm dialog that portals to the document body and stops Escape does not close Project Settings.

### App Settings

The header is 52 pixels: a gear icon, the breadcrumb Settings then the page name, and the close button. The accessible dialog name stays "App Settings". The close button name stays "Close app settings".

Checkboxes on these pages become switches for the same setting and default, except the OpenWhispr desktop confirmation.

Shortcut rows render from the existing shortcut list. A chord written with ` / ` shows as separate key chips joined by "or", and the original chord string stays available to assistive technology and tests.

The font size control uses the same allowed sizes and default as the current list (8 through 32, default 15). Apply and Restore defaults keep the current validation and reset behaviour. The applied families line sits in the group footer.

Dictation keeps provider loading, schema fields, secret masking (`••••••••` plus the last four characters), Change, Clear, Cancel, Save, and Test connection. Clear removes the saved key. Change reveals the password field. Only one connection footer message shows at a time. A failed test marks the key field invalid. Correction level is disabled while post-processing mode is Disabled. Real mode and level values stay `disabled`, `provider_native`, `external_llm`, and light, medium, full.

The dictionary keeps scopes, counts (`0 entries`, `1 entry`, `N entries`), aliases, the empty state "No dictionary entries in this scope.", add, edit, delete, and enable. Enable is a switch.

Agents: the editor replaces the list. Template is offered only when creating. Copy still duplicates by clearing the id. Delete, edit, and save call the same commands. The command field stays described by the existing command-help string.

Usage keeps the quota switch, source list, editor, adapter picker, export save, and adapter list. Status strings stay the current ones (`No limits yet`, `1 limit`, `N limits`, `Last reading …`, `No reading yet`, `Disabled`, and error text). Output file and Replace are dimmed while Write is off; Choose can still pick a path, which is the current behaviour. Adapters start expanded. Open folder still opens the adapters folder.

### Project Settings

The header is 52 pixels: the project avatar, the project name, the note "project settings", the breadcrumb page name, and the close button. The avatar is shown even when sidebar project icons are hidden. Its colour is the project's resolved colour (the saved colour, otherwise the deterministic palette colour). With no project, the title is "Project" and the avatar uses the ordinary button colours. The accessible dialog name stays "Project Settings", including a text node with that string. The close button name stays "Close settings".

The navigation label is "Actions", not "Actions & Configuration".

Shell keeps detection, the shell select, the custom absolute-path add, and Save. Save stays disabled when the selected shell is the saved shell. The existing WSL fallback sentence stays. Project colour is its own radiogroup: Auto, then the palette swatches named Violet, Blue, Salmon, Green, Yellow, Pink, and Teal. Choosing a colour saves immediately. The selected swatch uses the dialog and ink tokens for its ring.

Actions keeps handoff auto-send, the handoff directory, and the toolbar action list. Auto-send, "Run as a PowerShell script", and "Ask for confirmation" are switches for the same settings. The add control reads "Add action". The run-mode label reads "Run in". Add and Edit replace the list and the handoff section, so only one Save is available while editing. That button reads "Save action". The handoff save name stays "Save handoff directory".

Tasks renders the selected adapter's schema. It does not hard-code tracker fields. A required field ends with muted " · required". A schema boolean stays a checkbox. A secret that is already stored shows "Stored" and Change, and hides the password field until Change. There is no Clear. While the secret is not stored, or after Change, the password field stays in the form so a value can be typed before the first save. Save still omits an empty secret and still sends an empty non-secret. Test stays disabled until the displayed adapter is the persisted binding. "Use a local task list" stays available only while no source is bound. Teach agents stays its own section. Its confirm dialog stays portaled to the document body.

Task progress keeps the adapter select, including None, the copy-from-project list, Test, and Save. Test stays disabled until an adapter is chosen, and also while the adapter is missing or a test is running. The empty-adapter explanation keeps the paths `task-progress-adapters` and `adapters/task-progress-example/README.md`. A schema boolean stays a checkbox. A required field ends with muted " · required". Copy from project sits on the left of the footer. Test and Save sit on the right. Last read stays its own section and keeps the current explanation and read-state text.

Project Agents keeps the enable row as a native checkbox that is visually hidden and still focusable. Its accessible name stays `Enable ${name}: ${command}`, and its checked state stays the input's `checked`. The row shows the name, the command on one line, and a Default tag when that agent is the default. The default select lists only selected agents, by name only, plus "None (choose at launch)". The header count reads "Available · N of M". Manage agents opens App Settings on Agents. Empty states stay "No global agents. Use Manage agents to add one." and "No agents selected for this project. Select an agent to use it in New Chat or Tasks." Cancel restores the saved selection. Save writes the same selection payload.

## Business rules

- No component hard-codes the prototype hex colours. Roles map to tokens: dialog, field, group, selected row, control (`button`), border (`edge`), primary text, body, muted, accent, error, success, ink on accent, and the switch knob.
- One primary button per group footer. Primary text uses the on-accent token.
- There is no light theme. Muted text and the off switch track are not retuned globally for a light palette that does not exist.
- A lower document must not put Project Settings back out of scope.

## Authorization

none

## Data / API

No new persistence, IPC, or stored shape. Existing settings keys and payloads stay. Kanban save still omits an empty secret and still sends an empty non-secret as `''`.

## Edge cases

- Opening App Settings from the usage or agents entry point still lands on that page.
- Opening Project Settings with `initialTab` lands on that page for that mount only.
- A missing font family still fails validation and does not save.
- Font size stops at 8 and 32.
- A configured dictation key shows the mask. Change and Clear return to the password field. A failed test and a save notice do not appear together.
- An agent with no New Chat override hides that field until the switch is on.
- Usage Write off dims the output file and disables Replace. A removed or invalid adapter still shows its current error text.
- Escape in the Teach agents dialog closes only that dialog, and does not close it while the write is running.
- A stored Kanban secret is not echoed into the DOM. After a successful reload it shows Stored again and the typed value is gone.
- Project colour saves on selection, separately from the shell Save button.

## Errors

Existing error alerts stay visible. A failed dictation connection shows one error message and an error border on the key field. Save and test failures still surface the current messages. No new silent fallback.

## Acceptance criteria

- All six App Settings pages and all five Project Settings pages follow the reference layout in every shipped theme, with no hard-coded prototype colours in components.
- Both dialogs use the one shell. App Settings keeps the dialog Tab trap and focus restore. Project Settings keeps the window Escape listener and skips it while suspended.
- Every current setting still loads, toggles, saves, tests, adds, edits, and removes as it does now.
- Escape, backdrop mouse down, and the close button close the dialog that owns them. A portaled confirm dialog can consume Escape without closing Project Settings.
- Neither dialog remembers a page on its own.
- Switches expose `aria-checked`. Navigation exposes `aria-current="page"` and `aria-selected`.
- The Actions navigation label is "Actions". Project Settings still exposes the text "Project Settings" and the close name "Close settings".
- Lint, typecheck, and the existing settings tests pass, including queries updated for switches, shortened labels, the font stepper, and the masked key.

## Required tests

- Update component tests whose queries name a checkbox, an old label, the font-size select, or `.checked` on a control that is now a switch.
- Cover the switch row: click flips `aria-checked` and reports the next value.
- Cover dictation Change, Clear, and the error border after a failed connection test.
- Cover a stored Kanban secret: the password field is absent, the stored text is "Stored", and Change reveals the field. An untouched save still omits the secret.
- Keep project Agent enable rows as checkboxes whose accessible name matches `Enable ${name}:` and whose `checked` state is readable.
- Keep schema booleans on Tasks and Task progress as checkboxes. A required marker contains "required".
- Escape inside the Teach agents dialog does not close Project Settings.

## Relevant SDD / ADR

none
