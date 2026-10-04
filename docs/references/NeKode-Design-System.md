# NeKode Design System

**Status:** Foundation / implementation-ready  
**Target:** Electron desktop application  
**Primary theme:** Dark  
**Scope:** Visual language, design tokens, typography, color system, spacing, surfaces, controls, terminal styling, iconography, states, motion and implementation guidance  
**Out of scope:** Wireframes, page layouts, feature flows, information architecture

---

## 1. Design intent

NeKode should feel like a **premium, calm, technical developer tool** built for long sessions with coding agents.

The interface should be:

- dark, dense and focused,
- visually quiet,
- precise rather than decorative,
- optimized for power users,
- readable for many hours without eye fatigue,
- clearly hierarchical without heavy cards or borders,
- modern, but not trendy or playful,
- recognizably NeKode rather than a VS Code clone.

The visual language should communicate **control, observability and execution**.

---

## 2. Core design principles

### 2.1 Low visual noise

Prefer hierarchy created by:

1. typography,
2. spacing,
3. surface contrast,
4. subtle separators,
5. restrained accent color.

Avoid large cards, strong shadows, thick borders and excessive color coding.

### 2.2 Dense, not cramped

NeKode is a professional developer workspace. Density is desirable, but controls must remain easy to scan and click.

Default control height should be compact. Large consumer-app spacing should be avoided.

### 2.3 Content over chrome

Application chrome should visually recede. Terminals, task state, repository content and agent output should remain dominant.

### 2.4 Color has meaning

Blue (`--color-info`) is reserved primarily for:

- focus,
- primary actions,
- current workflow stage,
- info state.

Green indicates success/completion. Amber indicates attention or medium/high effort. Red indicates errors, destructive actions or negative diff values.

### 2.5 Consistency over novelty

Controls performing the same type of action should share:

- height,
- padding,
- radius,
- icon size,
- hover behavior,
- focus treatment.

---

## 3. Theme architecture

NeKode should use semantic design tokens rather than hard-coded component colors.

Recommended hierarchy:

```text
primitive tokens
    ↓
semantic tokens
    ↓
component tokens
```

Example:

```text
--color-info
    ↓
--focus-ring-color
    ↓
--button-focus-ring
```

This makes later theme variants possible without rewriting components.

Implementation status (2026-10-01, updated 2026-10-04): `src/renderer/src/theme.css` imports the
`default` tokens from `themes/default.css` (Tailwind v4 `@theme`) and the
override theme from `themes/nekode-float.css`.
Every override theme covers every default token name (theme.test.ts asserts
name parity against `default.css` for each override file, not value parity),
so themes may diverge freely. Theme membership, display labels and the shell
layout variant live in the registry `src/renderer/src/lib/theme.ts`:
`default` keeps the attached shell, `nekode-float` ("NeKode Float")
clones the default palette except `--color-terminal`, which matches
`--color-app`, and raises `--radius-lg` one step to 10px (user decision
2026-10-04: the floating shell panels and the dialogs round at 10px). It
switches the shell to the floating layout: the title bar
strip without its separating hairline (the app name stays top-left beside
the Windows caption buttons), a detached rounded left panel with a gap to
the center column, and file tabs attached to the top of the rounded frame
around the center content below the tab strip; the frame's top-left corner
stays square where the first tab attaches (App.tsx, user decision
2026-10-04).
App Settings applies the selected theme
through `data-theme` on the document root and saves its identifier in
`localStorage` under `nekode.theme.v1`. Missing or unknown identifiers use
`default`; storage failures are shown in App Settings. Renderer components
continue to consume semantic utilities. The xterm terminal palette resolves
the active theme's `--color-terminal`, `--color-ink`, and `--color-scrollbar`
at mount (components/lib/theme-color.ts); the Monaco palette is not
theme-aware.

---

## 4. Color palette

### 4.1 Surfaces

| Token | Value | Usage |
|---|---:|---|
| `--color-app` | `rgb(11 13 31)` | Main application background |
| `--color-panel` | `rgb(26 29 44)` | Left and right panels, tab strip, status bar, dialogs |
| `--color-highlight` | `rgb(31 44 63)` | Highlight and selection inside panels |
| `--color-row-hover` | `rgb(28 35 52)` | Left-nav row hover (project, chat, New Chat; dimmer than selection) |
| `--color-button` | `rgb(30 42 66)` | Command buttons and the active tab |
| `--color-button-hover` | `rgb(38 52 80)` | Button hover (derived) |
| `--color-tab-inactive` | `rgb(25 29 41)` | Inactive tab background |
| `--color-terminal` | `rgb(13 15 26)` | Agent console and terminal (derived) |

The palette has a cool navy bias: every surface mixes blue into the gray, never pure black.

### 4.2 Text

| Token | Value | Usage |
|---|---:|---|
| `--color-ink` | `rgb(202 203 209)` | Main text |
| `--color-ink-secondary` | `rgb(140 142 152)` | Secondary labels (derived) |
| `--color-ink-muted` | `rgb(106 108 118)` | Metadata / low-emphasis labels (derived) |
| `--color-ink-disabled` | `rgb(76 78 88)` | Disabled controls (derived) |

Avoid pure white except in rare, high-priority cases.

### 4.3 Accent blue

The single blue accent is the info color. Use it for focus, primary actions and workflow indicators; never as a large surface fill.

| Token | Value | Usage |
|---|---:|---|
| `--color-info` | `rgb(83 134 188)` | Focus outline, primary accent, info text |

### 4.4 Semantic colors

| Meaning | Text | Soft background |
|---|---:|---:|
| Success | `rgb(147 189 161)` | `rgb(147 189 161 / 0.12)` |
| Warning | `rgb(217 164 65)` | `rgb(217 164 65 / 0.12)` |
| Error | `rgb(151 65 80)` | `rgb(151 65 80 / 0.12)` |
| Info | `rgb(83 134 188)` | `rgb(83 134 188 / 0.12)` |

Semantic colors are text and indicator colors: icons, labels, dots, thin indicators and banner text. `--color-error` is intentionally deep: keep it on small elements and pair status with an icon or wording so color alone never carries the message.

---

## 5. Borders and separators

Use borders mainly for structure, not decoration.

```css
--color-edge: rgb(33 37 49);    /* inactive tab border, hairline separators */
--color-divider: rgb(56 70 96); /* inset separator between connected buttons */
```

The double-button divider is the toolbar-standard single hairline
(2026-09-29, replacing an earlier two-tone groove the user found too
intense): 1px wide, vertically centered, and shorter than the buttons
(`16px` in the `42px` control height), in `--color-divider`. The segment
group carries the button surface (`--color-button`) behind the whole
divider column, so no dark gap shows above and below the hairline and the
group reads as one component.

Recommended border width:

- standard: `1px`
- inactive tabs: `1px` full outline (no underline convention)

Avoid double borders between adjacent panes. Prefer a single shared divider.

---

## 6. Typography

### 6.1 UI font

Applied stack:

```css
font-family: "Recursive Sans Casual", Inter, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
```

`Recursive Sans Casual` is the proportional counterpart of the bundled Recursive variable font (MONO axis 0, CASL axis 1). Inter and the Segoe faces stay in the stack as fallbacks.

### 6.2 Monospace font

Applied stack:

```css
font-family: "Recursive Mono Casual", "Symbols Nerd Font Mono", Consolas, "Courier New", monospace;
```

Recursive is bundled locally under the SIL Open Font License (`src/renderer/src/fonts/OFL.txt`): one variable woff2 serves both the UI sans and the terminal mono through the MONO axis. Do not bundle fonts without a libre license; otherwise prefer local/system fonts.

The terminal adds bundled Symbols Nerd Font Mono v3.4.0 for prompt glyphs, with provenance and source notices in `src/renderer/src/fonts/NERD-FONTS-PROVENANCE.md`. App Settings > Fonts edits terminal text/icon families and size, previews them, and restores defaults. Custom families require a local font installation; existing terminal sessions adopt the applied preferences without restarting.

### 6.3 Type scale

| Role | Size | Weight | Line height |
|---|---:|---:|---:|
| App title | 15px | 600 | 20px |
| Section title | 13px | 600 | 18px |
| Body | 13px | 400 | 19px |
| Compact UI | 12px | 500 | 16px |
| Metadata | 11px | 500 | 15px |
| Terminal (default) | 15px | 400 | xterm default |
| Large status heading | 14px | 600 | 19px |

Workspace navigation and actions (user decision 2026-10-03): the Projects
heading, project/chat names, New Chat controls, center tabs and action-row
button labels share Recursive Sans Casual at 14px, weight 400 and 20px line
height (`text-sm`). The Projects heading uses normal letter spacing.

Avoid oversized headings. NeKode should feel like a workspace, not a content site.

### 6.4 Letter spacing

- Normal UI: `0` to `0.01em`
- Uppercase project labels: `0.04em` to `0.06em`
- Metadata/status: up to `0.03em`

### 6.5 Font pairing candidates

Decision (2026-09-28): a candidate is usable only when it has a non-mono counterpart, so UI and terminal can compose as one family. Candidates without a sans version are filtered out; the applied pairing is the first retained candidate, **Recursive Mono Casual** with **Recursive Sans Casual** for the UI. Both come from one bundled variable font (the MONO axis switches mono/proportional, CASL 1 gives the casual character), which guarantees identical design across UI and terminal.

| Candidate | Sans counterpart | Result |
|---|---|---|
| Recursive Mono Casual | Recursive Sans (same variable family, MONO axis 0) | Applied |
| Comic Mono | none (fork of Comic Shanns, mono only) | Filtered |
| Fira Code | Fira Sans | Retained |
| Cascadia Code | none in the family (Windows pairs it with Segoe UI Variable, a different family) | Filtered |
| Maple Mono | none (all published variants are mono) | Filtered |
| Monospace Argon | none (Monaspace is a superfamily of five mono styles) | Filtered |
| Source Code Pro | Source Sans 3 | Retained |
| JetBrains Mono | JetBrains Sans (used in JetBrains branding, no public release) | Retained, counterpart not downloadable |
| Iosevka Charon Mono | Iosevka Charon (quasi-proportional sibling) | Retained |
| Google Sans Code | Google Sans (not distributed on Google Fonts; Google Sans Flex is the open variant) | Retained, counterpart not freely bundled |
| Geist Mono | Geist | Retained |

Retained candidates remain candidates for a later switch; the retained-but-not-downloadable entries stay on the list only until the counterpart becomes publicly available or the user re-ranks them.

---

## 7. Spacing system

Use a 4px base grid.

```text
2px   micro adjustment
4px   xxs
6px   xs
8px   sm
12px  md
16px  lg
20px  xl
24px  2xl
32px  3xl
```

Recommended component spacing:

- icon ↔ label: `6px`
- compact control horizontal padding: `8–10px`
- standard control horizontal padding: `10–12px`
- toolbar gap: `6px`
- panel internal padding: `12px`
- major section gap: `16px`

Control height: filled buttons and input frames share one height token,
`--spacing-control` (2.625rem = 42px, user decision 2026-10-03), matched to
the visible tab height (the tab strip is `50px` minus its `8px` top padding)
and project/chat tiles. This is a 31.25% increase from 32px. Ghost inline controls (row
actions, tab close, tree chevrons) keep row scale.

Implemented (2026-09-28): the action row pads its controls (`8px` above,
below and at the sides, one grid step on each axis) instead of stretching
them flush to the row borders, so filled buttons keep the shared control
height with visible breathing room.

---

## 8. Radius

Rounded corners should remain restrained.

```css
--radius-sm: 4px;
--radius-md: 6px;
--radius-lg: 8px;
--radius-pill: 999px;
```

Usage:

- buttons and rows: `6px`
- tabs: `6px`, top corners only
- dialogs / popovers: `8px`
- status pills: pill radius only when visually appropriate

Avoid large 12–20px SaaS-style rounding.

The values above are theme tokens in `src/renderer/src/theme.css`
(`--radius-sm/md/lg/pill`); overriding them re-skins every rounded surface.

---

## 9. Shadows and glow

NeKode should rely mostly on surfaces and borders.

Use shadows only for floating elements:

```css
--shadow-popover:
  0 8px 24px rgba(0, 0, 0, 0.38),
  0 0 0 1px rgba(180, 205, 235, 0.08);
```

Active glow:

```css
box-shadow: 0 0 14px rgb(83 134 188 / 0.14);
```

Never use strong neon glow around entire panels.

---

## 10. Iconography

Use one icon family consistently.

Recommended:

- Lucide
- Phosphor

Preferred visual character:

- outline icons,
- `1.5–1.75px` stroke,
- mostly monochrome,
- color only when state requires it.

Sizes:

- compact controls: `14px`
- standard controls: `16px`
- navigation: `17–18px`
- status icons: `13–14px`

NeKode branding should use a **minimal cat icon**, not a cartoon mascot.

Decision (2026-09-28): **Lucide** via `lucide-react` is the icon family. All
components import icons by role name from `src/renderer/src/lib/icons.tsx`
(`Icon.handoff`, `Icon.resume`, `Icon.stop`, `Icon.continue`, `Icon.preview`,
`Icon.container`, `Icon.chat`, `Icon.directory`, `Icon.files`, `Icon.git`,
`Icon.kanban`, `Icon.projects`, `Icon.check`, `Icon.dictation`,
`Icon.panelLeft`, `Icon.panelRight`, `Icon.terminal`, `Icon.agent`,
`Icon.search`, `Icon.send`, ...), never from lucide-react directly, so a package swap or
glyph change stays a one-file edit. Icons inherit `currentColor` and carry
`aria-hidden` whenever a visible label names the control.

---

## 11. Buttons

### 11.1 Base button

Recommended height:

- compact: `28px`
- default: `42px` (user decision 2026-10-03)

Implemented (2026-09-28): filled `--color-button` actions use the shared
`--spacing-control` height (42px), the same visual height as tabs and project/chat tiles; toolbar
buttons stretch to their bar (`self-stretch`), standalone buttons use the
token directly. Ghost row controls stay compact.

Base visual treatment (borderless, filled):

```css
background: var(--color-button);
border: none;
color: var(--color-ink);
border-radius: var(--radius-md);
```

Hover:

```css
background: var(--color-button-hover);
```

### 11.2 Primary action

Use accent blue sparingly.

Examples:

- active Resume,
- Start,
- selected high-priority action.

### 11.3 Destructive action

`Stop` should not be permanently bright red.

Default:

- neutral/dark background,
- muted red icon or hover treatment.

Strong red should appear on hover, active or confirmation state.

### 11.4 Segmented controls

`Hand Off | Resume` should behave visually as one component.

Requirements:

- borderless: each segment uses the button treatment (`--color-button`, no border),
- shared outer radius, segments clipped as one component,
- internal divider per section 5: a single 1px `--color-divider` hairline, vertically centered and shorter than the segments,
- same height,
- active segment may use the info blue as text or a thin indicator, never a large fill.

Implemented (2026-09-28) for the fixed `Handoff | Resume` and `Stop |
Continue` segments; configured actions stay separate filled buttons. The
action row's right end is an icon-only Actions control (2026-09-28): the
`Icon.settings` gear with the accessible name and tooltip `Actions`
(`aria-label`/`title`, the visible label is gone), no default fill and a
`--color-button-hover` fill on hover so the icon stays discoverable.

---

## 12. Tabs

Tabs should be compact and document/tool oriented, with rounded top corners.

Inactive:

- background: `var(--color-tab-inactive)`,
- border: `1px solid var(--color-edge)`,
- text: `var(--color-ink-secondary)`.

Active:

- background: `var(--color-button)` (the same surface as buttons),
- no border,
- text: `var(--color-ink)`.

Close icons should only appear on hover or active tabs if used.

`+ New Chat` may use a compact button-like treatment at the far right of the tab row. It carries no hover background, only a text-color shift (user decision 2026-10-04).

---

## 13. Navigation rail

The left navigation rail should use:

- dark application background,
- subtle active background,
- icon + short label,
- no separate framed box around the rail.

Active item:

```css
background: var(--color-highlight);
color: var(--color-ink);
```

Primary sections:

- Projects
- Git
- Kanban

---

## 14. Project and chat styling

Project names are sentence case, compact, almost white
(`--color-project-title`, rgb(226 230 238), 2026-10-01; previously
rgb(111 157 200), 2026-09-29, before that the muted ink; uppercase dropped
2026-10-02, NEKODE-3 soft header). The Projects
section header is light blue (`--color-projects-header`,
rgb(134 174 216)) and chat names are pastel blue (`--color-chat-title`,
rgb(141 168 205)), both added 2026-10-01.

Example:

```text
Acme-Platform
```

Suggested style:

```css
font-size: 11px;
font-weight: 600;
letter-spacing: 0.05em;
color: var(--color-project-title);
```

Each project should expose a visible `Chats` subheading.

Chat items must use a **chat bubble icon**, not document/file icons.

Selected chat:

- highlight background (`--color-highlight`),
- primary text.

Implemented (2026-09-28, revised 2026-10-02): project rows render in sentence
case (14px), and every chat row carries the chat bubble icon (`Icon.chat`, 12px)
before the shell display name. The project row's right content edge — the
`Files` icon — sits 8px from the panel edge (`pr-2` after the 4px list
inset, user decision 2026-10-04), on one vertical axis with the header's
Add Project button and the chat rows' right padding. Left-navigation metrics
(2026-10-02 polish): the
project row and chat rows use the shared `h-control` height (42px since
2026-10-03), including the New Chat control, level with the
project tile; all vertical gaps are the same 4px step (`ul gap-1` between chat
tiles, `mt-1` between the project tile and the chat list), so adjacent
highlights never merge. Chat tiles and the New Chat control are indented by
`pl-6` (24px) with a 12px inner padding (`pl-3`), and their highlight and
hover fills stay inside that indent — they never reach under the project
tile's alignment axis. Hover on any row shows the selection fill's footprint
and does not change the text color (user decision 2026-10-02;
previously the project name had no hover background and chat hovers lightened
the text). The project row carries its hover fill on the whole row container —
the same footprint as selection — and chat tiles and the New Chat row hover
one step dimmer as well (`--color-row-hover`, revised 2026-10-02): hovering
never changes a tile's size, and the brighter `--color-highlight` remains the
selected row's fill only. The chat list has no vertical guide line and
its rows span the full list width; the selected chat keeps the highlight
background (`--color-highlight`) across that full width. The `+ New Chat`
affordance is a row matching the chat rows: same height, the plus icon in
the chat-icon column (user decision 2026-09-29). Each chat row further
carries a close control (user request 2026-10-04): an X on the row's right
edge (`Icon.close`, 12px, the same corner metrics as the project row's
`Files` action), revealed while the row is hovered or keyboard-focused and
absent otherwise — the tile never resizes; the hover boundary is the whole
tile, so moving the pointer onto the X keeps it shown instead of flickering
(fix 2026-10-04). On direct hover the control highlights like the `Files`
action (`hover:bg-highlight`, text brightens to `--color-ink`). While the X
is shown, the
attention badge yields the same corner and returns when it hides. Clicking
the X stages a modal confirmation dialog ("Close chat"); confirming runs the
terminal-exit close flow (mvp-core-shell spec Behaviour 11), so the chat and
its terminal are removed together; Cancel, Escape and the backdrop dismiss
the dialog without touching the chat. The dialog follows the App Settings
idiom (dimmed backdrop, centered panel, focus restored to the opener) and
blocks the app-level shortcuts while open (`[aria-modal]` guard). The
project row's `Files` action is always visible (user decision 2026-09-29,
previously hover-revealed) and sits one pixel left of its neighbors' axis
(`-translate-x-px`, user request 2026-10-04). Entering Project Files slides
the left panel in from
the right: 220ms `cubic-bezier(0.2, 0, 0, 1)` (`slide-in-from-right` in
`index.css`, section 24 panel-expansion band; disabled under
`prefers-reduced-motion`). The slide passes under the center column, never
over it (2026-09-29): the column is raised above the transformed panel
(`relative z-10` with an opaque `bg-app`; a `transform` alone would paint
the panel above all normal-flow siblings). Returning to Projects replays
the mirrored slide (`slide-in-from-left`, left-to-right from the window's
left edge, same 220ms; user decision 2026-09-29) for the Projects list
(`slideIn` on `LeftNavigation`, set only right after leaving Project
Files, so the app start stays static).

---

## 15. Agent console

The agent console is a first-class visual surface.

Background:

```css
background: var(--color-terminal);
```

Typography:

- monospace,
- 15px by default (App Settings allows 8-32px; saved choices are preserved),
- 1.5-ish line height.

Color mapping:

- command/prompt: info blue,
- normal output: text primary,
- metadata: text muted,
- success: green,
- warnings: amber,
- errors: muted red,
- diff additions: green,
- diff removals: red.

Avoid syntax-editor conventions such as line numbers unless the console content genuinely includes them.

The console must look like a **running terminal agent**, not an AI chat.

Prompt input (2026-09-28): every terminal view ends in a styled input row
(`PromptInput`) instead of typing at the shell prompt line: a `>` glyph, a
mono input in an `--radius-md` frame on `--color-panel` with a
`--color-edge` border (info on focus), and the Send and Dictation controls
at the right end of the frame. Send (2026-09-28: Lucide paper plane
`Icon.send` plus the visible `Send` label) submits the line by click through
the same PTY write path as Enter and is disabled while the input is empty; a
centered hairline divider (design doc 5) separates Send from the Dictation
control (design doc 21), the frame's last segment. The frame is the only
boundary between
terminal output and the input row: no separator line above the row (the old
full-width hairline doubled the frame's border and rendered unevenly under
fractional Windows scaling; removed 2026-09-28). Enter submits the line plus
CR through the
same PTY write path as typed input, so shell echo, history and the Ctrl+D
emptiness gate keep working. Scrollbars render only when content overflows
(xterm.css forces a permanent `overflow-y: scroll`; `index.css` overrides it
to `auto`) and use `--color-scrollbar` / `--color-scrollbar-active`.

---

## 16. Bottom terminal

The terminal should visually match the main agent console but remain slightly more subdued.

Allowed tabs:

- Terminal 1
- Terminal 2
- Terminal 3

Do not use editor-oriented tabs such as:

- Problems
- Output
- Debug Console

The terminal pane should remain constrained to the center workspace region and must not visually extend into the right repository column.

---

## 17. Workflow / checkpoint strip

The workflow strip spans the **full application width**.

Stages:

```text
Intake → Planning → Implementation → Verification → Hand-off
```

States:

- completed: green check / muted green,
- active: blue filled node / blue glow,
- upcoming: subdued outlined node.

Use thin connector lines.

Subtitles should be smaller and muted.

Right-side controls:

- Details with dropdown chevron,
- All Tasks.

No `All Active Tasks` control.

---

## 18. Telemetry strip

The telemetry strip should feel like runtime instrumentation, not analytics.

Example:

```text
Model: Claude 3.5 Sonnet
Effort: Medium
Tokens: 142k used
5h limit: 68%
Weekly: 41%
```

Use:

- compact type,
- thin separators,
- small icons,
- subtle semantic color.

Avoid cards, progress donuts or large charts.

---

## 19. Repository tree

The repository panel should be visually simple.

It contains only:

- header,
- file/folder tree.

No preview pane, inspector, file card or secondary content.

Tree characteristics:

- compact row height,
- 16px icons,
- subtle indentation,
- low-contrast guides only when necessary,
- selected file using the highlight background (`--color-highlight`).

Implemented (2026-09-28): tree rows use the 14px UI size (`text-sm`), raised
from 12px for readability; chevrons stay 12px.

---

## 20. Bottom status bar

The bottom status bar should remain minimal.

Required examples:

```text
acme-platform
main
feature/streaming-chat-ui
Agents working: 2
```

Also include small icon-only controls for:

- toggle left panel,
- toggle right panel.

Do not show editor-specific metadata such as:

- line/column,
- encoding,
- line endings,
- syntax mode,
- file language.

---

## 21. Dictation control

Dictation should use a microphone icon.

Implemented (2026-09-28): the Idle state ships as a disabled, labeled button
(`Icon.dictation` mic plus the visible `Dictation` label, `--color-button`
surface, `--color-ink-disabled`) built into the terminal prompt input frame
as its right segment (2026-09-28: its last segment, after the Send control,
design doc 15): flush to the frame end at full inner height, square
left edge, right corners following the frame radius (clipped by the frame).
The visible label names the control, so the icon is decorative
(`aria-hidden`). No recognizer is wired yet, so Hover and Listening are
pending until the dictation feature lands.

States:

### Idle
- muted icon,
- neutral surface.

### Hover
- stronger text/icon contrast.

### Listening
- accent blue or subtle red recording indicator,
- optional soft pulse around microphone.

Animation must remain restrained.

---

## 22. Docker controls

`Docker Up` and `Docker Down` should visually read as environment/runtime actions.

Recommended:

- container/cube icon,
- run/up state using blue or green accent,
- stop/down state remaining neutral until hover/active.

Avoid relying solely on green/red to distinguish them; icon shape and labels must remain sufficient.

---

## 23. Interaction states

Every interactive element should define:

- default,
- hover,
- pressed,
- focus-visible,
- disabled,
- selected when applicable.

Focus state:

```css
outline: 1px solid var(--color-info);
outline-offset: 1px;
```

Do not remove keyboard focus indicators.

Cursor (user decision 2026-09-29): every enabled button shows the hand
cursor (`cursor: pointer` on `button:not(:disabled)`, `index.css`); disabled
controls keep `not-allowed`. Hover backgrounds stay per component (section
14): left-nav rows hover one step dimmer than selection
(`--color-row-hover`).

---

## 24. Motion

Motion should be functional and fast.

Recommended durations:

```text
hover / color:       100–140ms
panel expansion:     160–220ms
tooltip/popover:     120–160ms
workflow transition: 180–240ms
```

Preferred easing:

```css
cubic-bezier(0.2, 0, 0, 1)
```

Avoid springy or playful animations.

Respect:

```css
@media (prefers-reduced-motion: reduce)
```

---

## 25. Accessibility

Minimum targets:

- normal text contrast: WCAG AA where practical,
- keyboard navigation across all controls,
- visible focus state,
- tooltips for icon-only controls,
- text labels or accessible names for all icons,
- minimum clickable target around `28x28px` in dense areas,
- never communicate status by color alone.

Terminal colors should remain distinguishable against `--color-terminal`.

---

## 26. Electron implementation guidance

### 26.1 Theme ownership

Expose tokens at the document root:

```css
:root,
[data-theme="dark"] {
  /* surfaces */
  --color-app: rgb(11 13 31);
  --color-panel: rgb(26 29 44);
  --color-highlight: rgb(31 44 63);
  --color-button: rgb(30 42 66);
  --color-button-hover: rgb(38 52 80);
  --color-tab-inactive: rgb(25 29 41);
  --color-terminal: rgb(13 15 26);

  /* text */
  --color-ink: rgb(202 203 209);
  --color-ink-secondary: rgb(140 142 152);
  --color-ink-muted: rgb(106 108 118);
  --color-ink-disabled: rgb(76 78 88);

  /* semantic */
  --color-success: rgb(147 189 161);
  --color-warning: rgb(217 164 65);
  --color-error: rgb(151 65 80);
  --color-info: rgb(83 134 188);
  --color-project-title: rgb(226 230 238);
  --color-projects-header: rgb(134 174 216);
  --color-chat-title: rgb(141 168 205);

  /* structure */
  --color-edge: rgb(33 37 49);
  --color-divider: rgb(56 70 96);

  /* radius */
  --radius-sm: 4px;
  --radius-md: 6px;
}
```

### 26.2 Native desktop behavior

Implemented (2026-09-28): the app uses the Window Controls Overlay title bar.
`src/main/index.ts` sets `titleBarStyle: 'hidden'` plus `titleBarOverlay`
(`#0b0d1f` strip, `#cacbd1` symbols, 36px; the app strips are 40px since
2026-09-29) and a matching `backgroundColor` against the first-paint flash.
Since the user decision of 2026-10-01 the renderer's title bar is one
continuous full-width strip: the brand (AppBrand) at the left end, the
Windows caption buttons overlaying the right end. It is the primary drag
surface (`.drag-region` / `.no-drag` in `index.css`) and paints the base app
background; the tab strip, the Files header and the left panel content start
one level below, so nothing interactive sits under the caption buttons and
the tab strip needs no `env(titlebar-area-width)` inset anymore. The tab
strip shares the action row's metrics (2026-09-29):
`px-2 pt-2` insets, so the first tab's left edge aligns with the first
action-row button. Since 2026-10-03 tabs use the shared 42px control height
inside a 50px strip (`--spacing-control` plus 8px top padding).
The Projects header height is 47px (`--spacing-control` plus 5px), with an 8px
top margin and 4px first-project inset. The first project tile therefore
starts 59px below the content row, matching the action buttons after the
50px tab strip, 1px border and 8px padding (without an error notice).
The title bar
and Files header keep their 40px height: the Files header is a fixed `h-10` strip that centers its
controls (the back row). The
hairline under the tab strip is owned by the action row
(`border-t`), not by the tab strip: the 36px overlay strip paints over a
`border-b` at the strip's bottom edge, so the line visibly vanished under
the caption buttons (fixed 2026-09-29). The hairline under the title bar
follows the same convention: the content row below owns it (`border-t`,
2026-10-01), which stays visible because the caption buttons overlay the
strip's top band, not its bottom edge.

Rules:

- preserve standard Windows minimize/maximize/close behavior,
- define draggable and non-draggable regions correctly,
- keep interactive controls outside draggable hit areas,
- support Windows scaling / HiDPI,
- test at 100%, 125%, 150% and 200% scaling.

Typical title bar regions:

```css
.titlebar {
  -webkit-app-region: drag;
}

.titlebar button,
.titlebar input,
.titlebar [role="button"] {
  -webkit-app-region: no-drag;
}
```

### 26.3 Density

Prefer CSS variables for density so a future compact/comfortable mode remains possible.

Example:

```css
:root {
  --control-height: 30px;
  --row-height: 26px;
  --panel-padding: 12px;
}
```

### 26.4 Platform polish

On Windows:

- use Windows-native cursor behavior,
- avoid macOS visual conventions,
- use Ctrl-based shortcut notation,
- support system scale factor,
- ensure title-bar controls remain visually familiar.

---

## 27. Recommended component token layer

Example:

```css
:root {
  --button-bg: var(--color-button);
  --button-bg-hover: var(--color-button-hover);
  --button-text: var(--color-ink);

  --tab-bg: var(--color-tab-inactive);
  --tab-bg-active: var(--color-button);
  --tab-border: var(--color-edge);
  --tab-text: var(--color-ink-secondary);
  --tab-text-active: var(--color-ink);

  --panel-bg: var(--color-panel);
  --panel-divider: var(--color-edge);

  --terminal-bg: var(--color-terminal);
  --terminal-text: var(--color-ink);
  --terminal-muted: var(--color-ink-muted);
}
```

Components should consume semantic/component tokens rather than primitive hex values.

---

## 28. Visual anti-patterns

Avoid:

- pure black everywhere,
- excessive gradients,
- heavy glassmorphism,
- large SaaS-style cards,
- huge corner radii,
- neon cyberpunk styling,
- excessive blue glow,
- random icon colors,
- oversized typography,
- unnecessary panel headers,
- decorative separators,
- mixing multiple icon libraries,
- macOS controls on Windows,
- VS Code-specific status metadata,
- chat bubbles in the agent console,
- unnecessary preview panes.

---

## 29. Definition of visual success

A NeKode screen should feel correct when:

- the main content is more visually dominant than the application chrome,
- a user can distinguish active, completed and pending states instantly,
- the UI remains readable after hours of use,
- controls appear compact but not fragile,
- the interface feels purpose-built for autonomous coding agents,
- every accent color communicates state or action,
- terminal surfaces feel native to the product rather than embedded widgets,
- the design remains coherent even when individual panels are hidden.

---

## 30. Foundation token summary

```css
:root {
  /* surfaces */
  --color-app: rgb(11 13 31);
  --color-panel: rgb(26 29 44);
  --color-highlight: rgb(31 44 63);
  --color-button: rgb(30 42 66);
  --color-button-hover: rgb(38 52 80);
  --color-tab-inactive: rgb(25 29 41);
  --color-terminal: rgb(13 15 26);

  /* text */
  --color-ink: rgb(202 203 209);
  --color-ink-secondary: rgb(140 142 152);
  --color-ink-muted: rgb(106 108 118);
  --color-ink-disabled: rgb(76 78 88);

  /* semantic */
  --color-success: rgb(147 189 161);
  --color-warning: rgb(217 164 65);
  --color-error: rgb(151 65 80);
  --color-info: rgb(83 134 188);
  --color-project-title: rgb(226 230 238);
  --color-projects-header: rgb(134 174 216);
  --color-chat-title: rgb(141 168 205);

  /* structure */
  --color-edge: rgb(33 37 49);
  --color-divider: rgb(56 70 96);

  /* radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;

  /* density */
  --control-height-compact: 28px;
  --control-height: 30px;
  --row-height: 26px;
  --panel-padding: 12px;
}
```

---

# Final direction

NeKode should look like a **professional Windows-native workspace for supervising autonomous coding agents**: dark, dense, restrained, highly legible and operationally focused.

The design system should favor **semantic tokens, compact controls, precise state communication and terminal-first surfaces** over decoration.
