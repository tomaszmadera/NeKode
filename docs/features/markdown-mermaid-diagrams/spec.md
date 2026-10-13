# Markdown preview: Mermaid diagrams

Status: Delivered (the rendering, its strict security configuration, and the source-plus-error failure state are in the application; the user's acceptance pass over the criteria below passed on 2026-10-13). The zoom and pan gestures of Behaviour 13 and the control bar of Behaviour 14 (user decisions 2026-10-13) extend that delivered feature; their own acceptance pass passed on the same day.
Path: `docs/features/markdown-mermaid-diagrams/spec.md`.

This file is the behavioral contract for the feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

Let a Markdown file open in a file tab show its Mermaid diagrams as diagrams instead of raw text. The user is a developer on Windows who reads project documentation (feature specs, task records, README files) inside NeKode and whose documents already carry `mermaid` fenced blocks; today the preview prints that block as source and the user has to leave the app to see the picture.

## Related requirements

- Backlog item NEKODE-76 (user request 2026-10-13): render Mermaid diagrams in the Markdown file preview.
- Zoom and pan extension (user request 2026-10-13, after the acceptance pass): a large diagram scaled down to the preview width became unreadable and had no way to be magnified or moved.
- `docs/features/project-files-view/spec.md` Behaviour 7 and acceptance criterion 10 own the Markdown preview itself (the `Code` / `Preview` switch, the read-only preview, the too-large and binary fallbacks). This contract owns only what happens inside `Preview` for a `mermaid` block.
- `docs/UX-UI.md` §19 (file tree and file preview), §73 (preserve spatial memory).
- `docs/architecture/sdd.md` §6 (renderer owns no OS capabilities), §13 (file preview).

## Scope

- A fenced code block whose info string is `mermaid` renders as a diagram in the Markdown preview of a file tab.
- Diagram rendering config: strict security, dark token-mapped theme, responsive width, explicit failure state.
- Zoom and pan of a rendered diagram by pointer gestures, with a double-click restore of the fit view, and the diagram frame's own control bar (zoom out, the magnification, zoom in, fit to width, and the pan/select mode toggle).
- On-demand loading of the diagram library so a Markdown file without a `mermaid` block never pays for it.
- Unit-test coverage for block detection, the render path, the failure path, and the security configuration.
- One sentence in `docs/UX-UI.md` §19 and one pointer in `docs/features/project-files-view/spec.md` so the three documents describe the same preview.

## Non-goals

- Mermaid anywhere other than the Markdown file preview: no chat message, task record, Kanban description, or handoff panel renders diagrams.
- Other diagram languages (PlantUML, Graphviz, D2), math rendering, and Mermaid icon packs (`fa:fa-*`) that need a remote stylesheet.
- Interactive diagram content: no click or link handlers, no "copy diagram" action, no export, no full-screen view, and no keyboard shortcuts. The diagram frame's control bar (Behaviour 14) is the one exception to the controls exclusion: zoom out, the magnification readout, zoom in, fit to width, and the pan/select mode toggle, beside the pointer gestures of Behaviour 13.
- A settings control for diagrams, per-file diagram state, and light themes.
- The Mermaid `tiny` build, a vendored copy of Mermaid, and any diagram rendering in the main process.
- Editing help for Mermaid in `Code` mode (no completion, no error squiggles, no live preview while typing).
- Any change to the existing preview security model for non-diagram content: raw HTML stays escaped, remote and relative images still show alt text, links still pass the `http`/`https` allowlist.

## Behaviour

1. In a file tab whose `Preview` mode is selected (markdown path, text result), a fenced code block whose info string is `mermaid` renders as a diagram. Every other code block keeps today's rendering. `Code` mode is unchanged: it shows the whole file in read-only Monaco, including the `mermaid` block as source.
2. Detection uses the fence's info string only. It is case-insensitive, accepts `~` fences as well as backticks, accepts surrounding whitespace, and ignores anything after the first token (`mermaid title="x"` is still a diagram). A block whose info string is any other language, or empty, is never treated as a diagram.
3. The diagram occupies the full preview width and scales down to it; the preview column keeps its vertical scroll and the file's other blocks keep their layout. Resizing the window does not require a re-render.
4. The diagram uses the application's dark shell instead of Mermaid's own default surface: `theme: 'base'`, `darkMode: true`, and `themeVariables` mapped from the semantic theme tokens (`--color-panel` surface, `--color-edge` borders, `--color-ink` and `--color-ink-secondary` text, `--color-accent` accent, `--color-highlight` fill). `fontFamily` is the same UI font stack the preview text uses.
5. That configuration is applied immediately before each diagram render, with the token values read at that moment, so a theme switch, a token change, or a re-render applies to the next diagram and no stale palette is kept. The configuration always includes `startOnLoad: false`, `securityLevel: 'strict'`, and `suppressErrorRendering: true`.
6. Each diagram block has its own DOM id, so several diagrams in one file render independently of each other and in any completion order. The id is not derived from the file content.
7. A block whose diagram source cannot be parsed, or whose render throws, keeps the plain code block it would have had without this feature and adds one visible error line beneath it naming the failure. The preview never shows an empty area for such a block, never removes the source, and never inserts Mermaid's own error diagram.
8. A `mermaid` block with empty or whitespace-only source renders as an ordinary code block and shows no error.
9. Diagram output is inert. No script, event handler, `javascript:` URL, or `click` directive from the file executes or binds a handler: the diagram is inserted as markup only, and Mermaid's `bindFunctions` result is not called.
10. The library is loaded on demand: a preview that renders no `mermaid` block never loads it, and it is not part of the initial renderer bundle.
11. Switching a tab between `Preview` and `Code` leaves the file text untouched, and each return to `Preview` renders the diagrams again. Closing the tab or switching to another file ends the diagram work for that tab: a render that resolves after the switch neither inserts markup nor updates state of the closed tab.
12. A file above the preview threshold, and a binary file, keep the existing fallback in both modes: no diagram code runs for them.
13. A rendered diagram supports zoom and pan over its own area (user decision 2026-10-13). The fit-to-width view of Behaviour 3 is the starting point and the smallest scale; magnification goes up to ten times that view. Ctrl+wheel zooms around the pointer and consumes the wheel event; a wheel event without Ctrl keeps scrolling the preview and never zooms. Dragging inside the diagram pans it at any zoom level, and a double click restores the fit view. The gestures are bound on the diagram's frame and its own SVG element: no handler binds inside the diagram markup and no diagram directive gains behaviour (Behaviour 9). Each diagram block owns its zoom and pan state, and every re-render of the block (Behaviour 11) starts again at the fit view.
14. A drawn diagram carries an always-visible control bar in its frame's top-right corner (user decision 2026-10-13), each block owning its own bar and mode. In reading order it holds zoom out, the current magnification as a percentage, zoom in, fit to width, and the pan/select mode toggle. The two zoom controls are the control twin of the wheel gesture: each changes the magnification by one helper step around the diagram's own centre, under the same fit-view floor and ten-times ceiling, and zoom out is inactive at the fit view. Fit to width is the control twin of the double click and restores the fit view, centred, from either mode. The percentage reports the helper's scale, so the wheel, the drag, and both zoom controls all show their effect there. The mode toggle switches between pan mode (what a diagram starts in: dragging moves the magnified diagram and its text is not selectable) and text-selection mode (dragging selects the diagram's text, never pans, and leaves the double click to that selection, so fit to width is the way back to the fit view there); the toggle carries its state for assistive technology and its glyph shows the active mode. The bar is the component's own DOM beside the diagram markup: no control lives inside the diagram, none scales or pans with it, a click on one never starts a drag of the diagram, and a wheel over the bar zooms exactly as one over the diagram body. The bar appears only with the helper: a diagram whose helper failed to load keeps its fit view and shows no bar (Errors).

## Business rules

- Renderer-only. Mermaid runs in the renderer process: no new IPC channel, no main-process change, no filesystem access, no persisted state. The renderer-owns-no-OS-capabilities boundary (`docs/architecture/sdd.md` §6) is unchanged.
- Security level is `'strict'`, Mermaid's own default. `'loose'` and `'antiscript'` are forbidden (they allow HTML tags and enabled click functionality from file content), and `'sandbox'` is forbidden because it renders in an iframe and the renderer CSP sets `frame-src 'none'`. Mermaid's `dompurifyConfig` is not overridden, so its baseline DOMPurify configuration stays in force.
- The renderer Content-Security-Policy in `src/renderer/index.html` is not loosened for this feature. Mermaid's injected `<style>` elements already fall under the existing `style-src 'unsafe-inline'`; `script-src 'self'` is what keeps any diagram content from executing. No CSP directive, and no allowlisted origin, is added.
- Nothing Mermaid needs is fetched at render time: the renderer bundles every diagram chunk it uses, so diagrams draw with the application offline and no diagram content reaches a network origin. A source the library cannot draw, or a diagram type whose renderer is absent from the build, takes the source-plus-error path of Behaviour 7.
- Token-driven appearance: the mapping reads existing semantic tokens and adds no theme token and no raw color outside the mapping module, so both shipped themes stay consistent with the design system.
- The feature adds no file-tree, tab, or preview affordance beyond the diagram frame's own control bar (Behaviour 14): no menu item, no keyboard shortcut, and no change to the tabs, the tree, or the preview's other surfaces.

## Authorization

None (local single-user application). The preview stays read-only, and the path-containment rule of `docs/features/project-files-view/spec.md` is unchanged.

## Data / API

No IPC channel, no database table, no persisted setting, no new main-process service.

New renderer code under `src/renderer/src/components/files/`:

- a block-detection helper that decides, from a fenced code block's info string, whether it is a diagram,
- a diagram component: it takes the diagram source as a prop, loads the library on demand, renders into its own container, and owns the loading, ready, and error states from Behaviour 7 and 8,
- a config module holding the token-to-theme-variable mapping and the frozen security keys of Behaviour 5.

New runtime dependency in `package.json` and `pnpm-lock.yaml`: `mermaid` `^12.1.0`, imported only by the diagram component through a dynamic `import()`. The published Mermaid bundles target ES2024 and require Node >= 22.12.0 to build; the project runs Node 24.18.0 and Electron 44, so no polyfill or transpile step is added. Mermaid ships its own DOMPurify, so no second sanitizer dependency is added.

Second runtime dependency for the gestures: `@panzoom/panzoom` `^4.6.2` (MIT, CSS-transform based), imported only by the diagram component through the same dynamic `import()` path, so it is absent from the initial renderer bundle and a preview without a diagram loads neither library. It adds no DOM inside the diagram markup and binds its listeners on the frame and SVG element the component owns. The component renders the control bar of Behaviour 14 as its own DOM beside the diagram markup and drives it through the helper's `zoomIn`, `zoomOut`, `reset`, `setOptions`, and the helper's own scale events; nothing about the bar needs main-process or IPC support.

New `TEST_ID` entries for the diagram frame, its error line, and the control bar (its five controls and the magnification readout), following the existing naming in `src/renderer/src/lib/test-ids.ts`.

## Edge cases

- Several `mermaid` blocks in one file, including two blocks with identical source, each render separately.
- A diagram block indented inside a list item or blockquote is still detected and rendered in place.
- CRLF line endings, leading and trailing blank lines, and a trailing newline in the block do not change whether it renders.
- A `mermaid` block inside a longer code example (an escaped fence printed as text) stays text; it is not a diagram.
- Source that is valid Mermaid but draws a very large graph renders; the preview scrolls and no timeout is imposed.
- Source above Mermaid's own `maxTextSize` default (50000 characters) fails to render and takes the Behaviour 7 path.
- A diagram type whose renderer is absent from the build, and any source the library cannot draw, take the Behaviour 7 path. The build carries the diagram chunks it uses locally, so no diagram depends on network access.
- Unicode, CJK, and bidirectional label text render as the library draws them; the preview adds no direction styling.
- A source that is only a front-matter or config block is drawn as the library decides, or fails visibly through Behaviour 7. A render the library reports as successful replaces the source even when it draws little: the diagram area keeps its border, padding, and background, so the result is a visible empty panel rather than a collapsed hole, and the source stays readable in `Code` mode.
- The window is resized or the panel is resized after a diagram rendered: the diagram scales with the container width and is not re-rendered. A magnified diagram keeps its zoom factor across the resize.
- Two diagrams in one file zoom and pan independently, each starting at its fit view.
- Ctrl+wheel at a zoom bound stays at that bound and still consumes the gesture, and zoom in at the ten-times ceiling does the same while the percentage keeps showing the ceiling. In pan mode (what a diagram starts in) text inside a rendered diagram is not selectable: pressing to drag pans. The mode toggle makes that text selectable and turns the drag into a selection instead; the source stays selectable in `Code` mode either way.
- A diagram in its source-plus-error state (Behaviour 7) and a block under Behaviour 12 render no control bar: there is no drawn diagram to control.
- Two diagrams in one file carry two independent bars and modes: switching one to text selection leaves the other panning.
- The same file is open in two tabs: each tab renders its own diagrams independently.

## Errors

- Parse failure or rejected render: one error line under the retained code block, no Mermaid error diagram (`suppressErrorRendering: true`), no crashed preview, and no effect on other blocks or tabs. The error text is derived from the library's message and truncated for display; it is never inserted as markup.
- Failure to load the library itself (missing build output, corrupted chunk): the same retained-source fallback, so the file stays readable.
- The pan-zoom helper failing to load leaves the drawn diagram in its fit view with no gestures and no control bar (Behaviour 14): the bar belongs to the helper, and the diagram itself is already on screen.
- A render that resolves after the tab closed or after the content changed is dropped: no state update, no markup insertion into a removed node, and no unhandled promise rejection.
- No error state is produced for non-diagram code blocks, and none for a `mermaid` block under Behaviour 12.
- A CSP violation report caused by diagram content is a defect, not an accepted state: the contract is that nothing diagram-related is fetched and nothing outside the app's own style injection is loaded.

## Acceptance criteria

1. With a `.md` file containing a `mermaid` flowchart block open in Preview, the block shows a diagram rather than source text, and the rest of the file renders as before.
2. `Code` shows the same file in read-only Monaco with the block as source text, and switching back to `Preview` renders the diagram again.
3. A block with a syntax error keeps showing its source and adds one error line; the other blocks of the same file render normally.
4. One file with a flowchart, a sequence diagram, and a state diagram renders three diagrams, each correct and each with its own identity in the DOM; a source the library cannot draw shows source plus the error line rather than a blank area.
5. Raw HTML and unsafe links in the Markdown stay inert, and a diagram source carrying a `click` directive produces no clickable behaviour and runs no script.
6. The diagram surface matches the application: the background is the preview panel surface, not Mermaid's default grey, and the labels use the app's UI font.
7. With DevTools open while rendering diagrams, no CSP violation is reported and no request leaves the app for diagram content.
8. A Markdown file with no `mermaid` block loads no diagram chunk and no pan-zoom helper, and the renderer's initial bundle contains neither the diagram library nor the pan-zoom helper.
9. A too-large Markdown file and a binary file still show their existing fallback, in both modes.
10. Diagram rendering survives the ordinary preview flows: opening another file, closing the tab with the diagram pending, and switching the mode while a diagram is still rendering produce no error and no stray markup.
11. With a large diagram open in `Preview`, Ctrl+wheel over the diagram magnifies it around the pointer, dragging moves the magnified view, and a double click returns it to the fit view; a plain wheel over the diagram scrolls the preview as before.
12. With a diagram open in `Preview`, its frame's top-right corner shows zoom out, the magnification, zoom in, fit to width, and the pan/select toggle: zoom in magnifies the diagram and the percentage follows it, zoom out is inactive at the fit view and reduces the magnification after a zoom, fit to width returns a zoomed and dragged diagram to its fit view, and the toggle switches between dragging the diagram and selecting its text with the mouse.

## Required tests

- Renderer test on the Markdown preview with the diagram component mocked: a `language-mermaid` code block mounts the diagram component and not a `pre` element; a `ts` block still renders as `pre`; several diagram blocks in one document mount several instances, including a backtick, a tilde and a list-indented fence; the existing GFM assertions (heading, table, task list, inert raw HTML, unsafe link, image alt text) stay green with diagram blocks present in the same document.
- Diagram-component test with the library module mocked: a successful render inserts the returned SVG in the id the component asked for, and drops the source block; two instances mounted at once each reach their own id, and the id helper is unique across calls; a rejected render keeps the source and shows the error line; a rejection after unmount neither inserts markup nor logs an unhandled rejection; the configuration handed to the library is asserted key by key (`securityLevel: 'strict'`, `suppressErrorRendering: true`, `startOnLoad: false`, the base theme with the dark flag), so loosening the security configuration fails a test.
- Configuration test with the computed style stubbed: every mapped theme variable reads its semantic token, unset tokens are omitted, and the font stack falls back to the application stack.
- Diagram-component interaction tests with the pan-zoom helper mocked: the helper is created on the diagram's own SVG element with the interaction options pinned key by key (the fit view as the smallest scale, the magnification bound, the drag cursor); Ctrl+wheel calls the helper's wheel zoom and consumes the event; a wheel event without Ctrl calls nothing and stays unconsumed; a double click resets to the fit view; unmount destroys the helper instance and clears the styles it set. The control bar is asserted against the same mock: it appears only once the helper is attached and never inside the diagram markup; the zoom controls call the helper's zoom-in and zoom-out without animation, with zoom out inactive at the fit view; fit to width calls the helper's reset; the helper's reported scale is what the readout shows; the mode toggle calls the helper's option setter with panning off, a text cursor, and its own start handler and back again, writing the selectable style on both nodes the helper styles; and a double click in text-selection mode does not reset.
- Detection test for the fence info string: `mermaid` in any case, an extra token after it, a tilde fence, whitespace, an empty info string, and another language.
- Regression: the existing Markdown preview test and the ProjectFiles markdown-mode tests stay green.
- The library is not loaded for a preview without a diagram block; where the test environment cannot observe a dynamic import, the same guarantee is asserted at the user's acceptance gate (criterion 8).

## Relevant SDD / ADR

- `docs/architecture/sdd.md` §6, §13; `docs/UX-UI.md` §19, §73.
- `docs/features/project-files-view/spec.md` Behaviour 7 and acceptance criterion 10 gain a pointer to this contract; `docs/UX-UI.md` §19 gains the matching sentence.
- `none` (no ADR required: the change is renderer-local, adds no IPC surface, and follows the security model that already governs the preview).
