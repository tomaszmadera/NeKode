# Terminal font settings

## Goal

Let a NeKode user inspect and edit the terminal text font, icon font, and text size in a dedicated Fonts settings tab. Render Nerd Font prompt icons using a bundled symbols font.

## Related requirements

User decisions on 2026-10-04: accept the bundled Symbols Nerd Font Mono proposal; make fonts configurable; give font settings their own tab; enlarge App Settings and move navigation to the left. The user selected terminal and icons only, excluding UI font editing.

## Scope

- A larger, viewport-bounded App Settings dialog with left-side General, Fonts, and Shortcuts tabs.
- Editable terminal text and icon font families, the existing terminal font size setting, a preview, and restoration of font defaults.
- Locally bundled Nerd Font symbols, font loading, persisted preferences, and live application to chat and bottom-panel terminals.

## Non-goals

UI font family or size editing, shell prompt/theme editing, operating-system font installation, installed-font enumeration, IPC or database changes, and application publication.

## Behaviour

1. General retains non-font preferences. All editable font preferences appear in Fonts; Shortcuts retains its documentation.
2. The settings dialog is wider than the former 28rem dialog, has a stable useful content area, and fits the viewport. Tab navigation stays on the left and content scrolls when necessary.
3. Terminal text defaults to Recursive Mono Casual. Icons default to a locally bundled Symbols Nerd Font Mono. Existing terminal font size and its saved value remain compatible.
4. Fonts exposes the active text and icon family names. The user can edit each family, preview representative text and Nerd Font icons, apply valid edits, and restore the default font settings.
5. Applying font families persists them across app restarts. Custom families refer to fonts installed on the user's computer; explain this requirement beside the inputs. The explicit existing system/generic fallbacks remain available for missing custom fonts.
6. Applying family or size changes updates existing terminal views and refits the grid without spawning, terminating, reconnecting, or replacing their PTY sessions. Both chat terminals and bottom-panel tabs use the same configuration.
7. Load bundled symbols before rendering the first meaningful terminal content. Obsolete asynchronous font loads must not apply after a newer selection or after disposal.
8. Keyboard navigation, Shift+Tab, Escape, focus containment, return of focus on close, and accessible tab/tabpanel relationships work with the new layout.

## Business rules

Preserve the default Recursive UI/terminal pairing. Use the Mono symbols variant and include the font's provenance and required license/attribution files. Keep text-font and icon-font choices separate so icons can be added without changing letter shapes.

## Authorization

None; preferences belong to the current local application user.

## Data / API

Use renderer-local preference persistence, following the existing terminal-size and theme conventions. Preserve `nekode.terminal-font-size.v1` compatibility. Validate and safely quote custom family names before building the CSS/xterm font stack. No IPC contract changes.

## Edge cases

Empty, malformed, or excessively long input does not replace an applied preference. Invalid stored preferences restore declared defaults. Missing custom system fonts use the explicitly documented fallback stack. Rapid changes and hidden terminal views retain the latest selection and existing sessions.

## Errors

Show field validation for rejected edits. Surface a bundled font loading failure through the existing visible error/notice mechanism and retain a usable terminal; do not silently claim the icon font loaded.

## Acceptance criteria

- General, Fonts, and Shortcuts are arranged vertically to the left of content in an enlarged dialog.
- Terminal family, icon family, and size can be inspected and changed in Fonts, with preview and defaults restoration.
- Applied settings survive remount/restart and the previous saved size survives the change.
- Open chat and bottom-panel terminals adopt changes without PTY recreation or loss of scrollback/input.
- The default prompt renders its OS, folder, branch, and clock icons from bundled resources without depending on a system Nerd Font installation.
- Controls remain usable by keyboard and the dialog fits small viewports.

## Required tests

Meaningful preference validation/persistence and apply/reset tests; settings tab and keyboard/focus regressions; live terminal font changes retaining the terminal/session identity. Adapt existing tests affected by the relocation of font size, preserving unrelated pending edits. Verify representative glyphs and layout in a real renderer when available; report any unavailable visual verification honestly.

## Relevant SDD / ADR

[Design system typography](../../references/NeKode-Design-System.md#6-typography). Update its recorded default font stack to include the bundled icon fallback while preserving its primary pairing.
