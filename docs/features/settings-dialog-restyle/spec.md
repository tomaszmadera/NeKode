# Settings dialog restyle

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

Path: `docs/features/settings-dialog-restyle/spec.md`.

## Goal

Restyle the App Settings dialog so General, Fonts, Shortcuts, Dictation, Agents, and Usage match the layout in `tmp/Main.dc.html`. People who already use these settings keep every current setting, command, and saved value.

## Related requirements

The visual reference is `tmp/Main.dc.html` (dialog from the Settings section, state in `settingsVals`). Product behaviour stays the behaviour already implemented in the settings components.

## Scope

- Dialog chrome: size, header, left navigation, page intro, section labels, grouped rows, and footers.
- Control presentation: selects, text fields, switches, the font-size stepper, shortcut key chips, segmented scope control, and primary or secondary buttons.
- Colour through existing theme tokens in every theme. New roles, when needed, are added to every theme.
- Accessible names that tests and keyboard use today stay, except where this spec renames a visible label.

## Non-goals

- New settings, removed settings, or changed defaults.
- Remembering the last settings page. The dialog opens on General, or on Usage or Agents when those entry points already do that, and those flags clear on close.
- Hard-coded prototype colours, sample agents, sample adapters, sample counts, or a fake Test connection or Save.
- Restyling project-level Agents, Actions, Kanban, or Task progress settings.
- The OpenWhispr desktop confirmation stays a checkbox.
- A release, version bump, or tag.

## Behaviour

The dialog is at most 920 by 660 pixels, centred, at least 48 pixels from the window edge, with a 12 pixel radius and a 1 pixel border. Backdrop mouse down on the backdrop itself, Escape, and the close button close it. Focus moves into the dialog and returns to the previous control on close. Tab cycles inside the dialog. Arrow keys, Home, and End move between the six pages.

The header is 52 pixels: a gear icon, the breadcrumb Settings then the page name, and the close button. The accessible dialog name stays "App Settings". The close button name stays "Close app settings".

The left navigation is 200 pixels. Each page is a plain icon and label row, 36 pixels high. The active row uses the same selected-session background as the sidebar, `aria-selected`, and `aria-current="page"`. Rows stay `role="tab"` so the existing keyboard contract holds.

Page content is at most 660 pixels wide, with 24 pixels top, 28 pixels side, and 32 pixels bottom padding. Each page has an 18 pixel semibold heading and one description, then sections. A section label is uppercase, 12 pixels, semibold, letter-spacing 0.08em. A group is a bordered box with a 10 pixel radius and 1 pixel dividers between rows.

Checkboxes in this dialog become switches for the same setting and default. A switch is `role="switch"` and `aria-checked`. The track is 38 by 22 pixels inside a hit target at least 36 pixels. Icon buttons in rows are at least 32 pixels. Form controls are 36 pixels tall. Every control has a visible label or an `aria-label`, and a visible accent focus ring.

Shortcut rows render from the existing shortcut list. A chord written with ` / ` shows as separate key chips joined by "or", and the original chord string stays available to assistive technology and tests.

The font size control uses the same allowed sizes and default as the current list (8 through 32, default 15). Apply and Restore defaults keep the current validation and reset behaviour. The applied families line sits in the group footer.

Dictation keeps provider loading, schema fields, secret masking (`••••••••` plus the last four characters), Change, Clear, Cancel, Save, and Test connection. Clear removes the saved key. Change reveals the password field. Only one connection footer message shows at a time. A failed test marks the key field invalid. Correction level is disabled while post-processing mode is Disabled. Real mode and level values stay `disabled`, `provider_native`, `external_llm`, and light, medium, full.

The dictionary keeps scopes, counts (`0 entries`, `1 entry`, `N entries`), aliases, the empty state "No dictionary entries in this scope.", add, edit, delete, and enable. Enable is a switch.

Agents: the editor replaces the list. Template is offered only when creating. Copy still duplicates by clearing the id. Delete, edit, and save call the same commands. The command field stays described by the existing command-help string.

Usage keeps the quota switch, source list, editor, adapter picker, export save, and adapter list. Status strings stay the current ones (`No limits yet`, `1 limit`, `N limits`, `Last reading …`, `No reading yet`, `Disabled`, and error text). Output file and Replace are dimmed while Write is off; Choose can still pick a path, which is the current behaviour. Adapters start expanded. Open folder still opens the adapters folder.

## Business rules

- No component hard-codes the prototype hex colours. Roles map to tokens: dialog, field, group, selected row, control (`button`), border (`edge`), primary text, body, muted, accent, error, success, ink on accent, and the switch knob.
- One primary button per group footer. Primary text uses the on-accent token.
- There is no light theme. Muted text and the off switch track are not retuned globally for a light palette that does not exist.

## Authorization

none

## Data / API

No new persistence, IPC, or stored shape. Existing settings keys and payloads stay.

## Edge cases

- Opening from the usage or agents entry point still lands on that page.
- A missing font family still fails validation and does not save.
- Font size stops at 8 and 32.
- A configured dictation key shows the mask. Change and Clear return to the password field. A failed test and a save notice do not appear together.
- An agent with no New Chat override hides that field until the switch is on.
- Usage Write off dims the output file and disables Replace. A removed or invalid adapter still shows its current error text.

## Errors

Existing error alerts stay visible. A failed dictation connection shows one error message and an error border on the key field. Save and test failures still surface the current messages. No new silent fallback.

## Acceptance criteria

- All six pages follow the reference layout in every shipped theme, with no hard-coded prototype colours in components.
- Every current setting still loads, toggles, saves, tests, adds, edits, and removes as it does now.
- Escape, backdrop mouse down, and the close button close the dialog.
- The dialog does not remember the last page.
- Switches expose `aria-checked`. Navigation exposes `aria-current="page"` and `aria-selected`.
- Lint, typecheck, and the existing settings tests pass, including updated queries for switches, shortened labels, the font stepper, and the masked key.

## Required tests

- Update component tests whose queries name a checkbox, an old label, the font-size select, or `.checked` on a control that is now a switch.
- Cover the switch row: click flips `aria-checked` and reports the next value.
- Cover dictation Change, Clear, and the error border after a failed connection test.

## Relevant SDD / ADR

none
