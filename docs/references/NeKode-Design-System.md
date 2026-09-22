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

Blue is reserved primarily for:

- selected states,
- active controls,
- current workflow stage,
- focus,
- primary actions.

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
--blue-500
    ↓
--color-accent
    ↓
--button-primary-background
```

This makes later theme variants possible without rewriting components.

---

## 4. Color palette

### 4.1 Neutral / background scale

| Token | Hex | Usage |
|---|---:|---|
| `--bg-app` | `#090D14` | Main application background |
| `--bg-surface-1` | `#0D121B` | Primary panels |
| `--bg-surface-2` | `#111824` | Elevated panel / toolbar |
| `--bg-surface-3` | `#162030` | Hovered / selected low-emphasis surface |
| `--bg-surface-4` | `#1B2738` | Strong selected surface |
| `--bg-terminal` | `#080C12` | Agent console and terminal |

The palette should have a **slight cool-blue bias**, not pure gray or pure black.

### 4.2 Text

| Token | Hex | Usage |
|---|---:|---|
| `--text-primary` | `#E8EEF7` | Main text |
| `--text-secondary` | `#A9B4C3` | Secondary labels |
| `--text-muted` | `#748195` | Metadata / low-emphasis labels |
| `--text-disabled` | `#4E5968` | Disabled controls |
| `--text-inverse` | `#07101B` | Text on bright accent surfaces |

Avoid pure white except in rare, high-priority cases.

### 4.3 Accent blue

| Token | Hex | Usage |
|---|---:|---|
| `--accent-300` | `#78B9FF` | Bright text/accent |
| `--accent-400` | `#4EA2FF` | Active state |
| `--accent-500` | `#2F8DF4` | Primary accent |
| `--accent-600` | `#2175D6` | Pressed state |
| `--accent-soft` | `rgba(47, 141, 244, 0.14)` | Soft selection background |
| `--accent-glow` | `rgba(47, 141, 244, 0.24)` | Very restrained glow |

### 4.4 Semantic colors

| Meaning | Base | Soft background |
|---|---:|---:|
| Success | `#55C58A` | `rgba(85,197,138,0.12)` |
| Warning | `#D9A441` | `rgba(217,164,65,0.12)` |
| Error | `#E06C75` | `rgba(224,108,117,0.12)` |
| Info | `#62A8E8` | `rgba(98,168,232,0.12)` |

Semantic colors should normally be used in small areas: icons, labels, dots, text or thin indicators.

---

## 5. Borders and separators

Use borders mainly for structure, not decoration.

```css
--border-subtle: rgba(162, 184, 214, 0.08);
--border-default: rgba(162, 184, 214, 0.12);
--border-strong: rgba(162, 184, 214, 0.18);
--border-focus: rgba(78, 162, 255, 0.72);
```

Recommended border width:

- standard: `1px`
- active tab underline: `2px`

Avoid double borders between adjacent panes. Prefer a single shared divider.

---

## 6. Typography

### 6.1 UI font

Preferred stack:

```css
font-family: Inter, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
```

On Windows, `Segoe UI Variable` can be preferred when available.

### 6.2 Monospace font

Preferred stack:

```css
font-family: "JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace;
```

Do not bundle proprietary font files unnecessarily. Use local/system fonts where possible.

### 6.3 Type scale

| Role | Size | Weight | Line height |
|---|---:|---:|---:|
| App title | 15px | 600 | 20px |
| Section title | 13px | 600 | 18px |
| Body | 13px | 400 | 19px |
| Compact UI | 12px | 500 | 16px |
| Metadata | 11px | 500 | 15px |
| Terminal | 12.5–13px | 400 | 19–20px |
| Large status heading | 14px | 600 | 19px |

Avoid oversized headings. NeKode should feel like a workspace, not a content site.

### 6.4 Letter spacing

- Normal UI: `0` to `0.01em`
- Uppercase project labels: `0.04em` to `0.06em`
- Metadata/status: up to `0.03em`

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

---

## 8. Radius

Rounded corners should remain restrained.

```css
--radius-xs: 3px;
--radius-sm: 5px;
--radius-md: 7px;
--radius-lg: 9px;
--radius-pill: 999px;
```

Usage:

- tabs / compact buttons: `5px`
- normal buttons: `5–7px`
- search field: `7px`
- tooltips / popovers: `7px`
- status pills: pill radius only when visually appropriate

Avoid large 12–20px SaaS-style rounding.

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
box-shadow: 0 0 14px rgba(47, 141, 244, 0.12);
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

---

## 11. Buttons

### 11.1 Base button

Recommended height:

- compact: `28px`
- default: `30–32px`

Base visual treatment:

```css
background: var(--bg-surface-2);
border: 1px solid var(--border-default);
color: var(--text-secondary);
```

Hover:

```css
background: var(--bg-surface-3);
color: var(--text-primary);
border-color: var(--border-strong);
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

- shared outer border,
- no gap between segments,
- internal divider only,
- same height,
- active segment may use blue fill.

---

## 12. Tabs

Tabs should be compact and document/tool oriented.

Default:

- muted text,
- transparent or near-transparent background.

Active:

- primary text,
- subtle surface highlight,
- `2px` blue underline or low-intensity blue edge.

Close icons should only appear on hover or active tabs if used.

`+ New Chat` may use a compact button-like treatment at the far right of the tab row.

---

## 13. Navigation rail

The left navigation rail should use:

- dark application background,
- subtle active background,
- icon + short label,
- no separate framed box around the rail.

Active item:

```css
background: var(--accent-soft);
color: var(--text-primary);
```

Optional thin blue edge can reinforce selection.

Primary sections:

- Projects
- Git
- Kanban

---

## 14. Project and chat styling

Project names are uppercase, compact and muted.

Example:

```text
ACME-PLATFORM
```

Suggested style:

```css
font-size: 11px;
font-weight: 600;
letter-spacing: 0.05em;
color: var(--text-muted);
```

Each project should expose a visible `Chats` subheading.

Chat items must use a **chat bubble icon**, not document/file icons.

Selected chat:

- accent-soft background,
- primary text,
- optional blue left edge.

---

## 15. Agent console

The agent console is a first-class visual surface.

Background:

```css
background: var(--bg-terminal);
```

Typography:

- monospace,
- 12.5–13px,
- 1.5-ish line height.

Color mapping:

- command/prompt: accent blue / cyan,
- normal output: text primary,
- metadata: text muted,
- success: green,
- warnings: amber,
- errors: muted red,
- diff additions: green,
- diff removals: red.

Avoid syntax-editor conventions such as line numbers unless the console content genuinely includes them.

The console must look like a **running terminal agent**, not an AI chat.

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
- selected file using accent-soft background.

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
outline: 1px solid var(--border-focus);
outline-offset: 1px;
```

Do not remove keyboard focus indicators.

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

Terminal colors should remain distinguishable against `--bg-terminal`.

---

## 26. Electron implementation guidance

### 26.1 Theme ownership

Expose tokens at the document root:

```css
:root,
[data-theme="dark"] {
  --bg-app: #090d14;
  --bg-surface-1: #0d121b;
  --bg-surface-2: #111824;
  --bg-surface-3: #162030;
  --bg-terminal: #080c12;

  --text-primary: #e8eef7;
  --text-secondary: #a9b4c3;
  --text-muted: #748195;

  --accent-400: #4ea2ff;
  --accent-500: #2f8df4;
  --accent-soft: rgba(47, 141, 244, 0.14);

  --success: #55c58a;
  --warning: #d9a441;
  --error: #e06c75;

  --border-subtle: rgba(162, 184, 214, 0.08);
  --border-default: rgba(162, 184, 214, 0.12);
  --border-strong: rgba(162, 184, 214, 0.18);

  --radius-sm: 5px;
  --radius-md: 7px;
}
```

### 26.2 Native desktop behavior

When using a custom title bar in Electron:

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
  --button-bg: var(--bg-surface-2);
  --button-bg-hover: var(--bg-surface-3);
  --button-border: var(--border-default);
  --button-text: var(--text-secondary);

  --tab-text: var(--text-muted);
  --tab-text-active: var(--text-primary);
  --tab-accent: var(--accent-500);

  --panel-bg: var(--bg-surface-1);
  --panel-border: var(--border-subtle);

  --terminal-bg: var(--bg-terminal);
  --terminal-text: var(--text-primary);
  --terminal-muted: var(--text-muted);
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
  /* backgrounds */
  --bg-app: #090d14;
  --bg-surface-1: #0d121b;
  --bg-surface-2: #111824;
  --bg-surface-3: #162030;
  --bg-surface-4: #1b2738;
  --bg-terminal: #080c12;

  /* text */
  --text-primary: #e8eef7;
  --text-secondary: #a9b4c3;
  --text-muted: #748195;
  --text-disabled: #4e5968;

  /* accent */
  --accent-300: #78b9ff;
  --accent-400: #4ea2ff;
  --accent-500: #2f8df4;
  --accent-600: #2175d6;
  --accent-soft: rgba(47, 141, 244, 0.14);

  /* semantic */
  --success: #55c58a;
  --warning: #d9a441;
  --error: #e06c75;
  --info: #62a8e8;

  /* borders */
  --border-subtle: rgba(162, 184, 214, 0.08);
  --border-default: rgba(162, 184, 214, 0.12);
  --border-strong: rgba(162, 184, 214, 0.18);
  --border-focus: rgba(78, 162, 255, 0.72);

  /* radius */
  --radius-xs: 3px;
  --radius-sm: 5px;
  --radius-md: 7px;
  --radius-lg: 9px;

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
