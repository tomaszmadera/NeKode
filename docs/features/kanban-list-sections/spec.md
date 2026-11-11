# Kanban list sections

**Status:** Implemented contract for the project Kanban task list (NEKODE-178).

This spec changes only the presentation of the loaded board list. Loading,
filtering, sorting, review, Start, Resume, and host callbacks keep the
`kanban-adapter-interface` contract. No drag and drop.

## Placement

The Kanban view fills the main card under the tabs: the existing toolbar at
the top, then the scrollable task list. The toolbar layout does not change. In
the Float theme its background is transparent so the card gradient shows, and
its 1px bottom border stays. Flat keeps its solid bar.

## Toolbar

The toolbar keeps the current controls and order: Refresh, New task, sort,
search, and the project actions. Control sizes, spacing, and radii are
unchanged by this spec.

## Task list

The board is a vertical flex column of status groups separated by 14px of
space. No line separates groups.

### Section header

Each group starts with a real `<button aria-expanded>` that is only as wide as
its content. The header has no border and no full-width background.

- height 28px, padding 0 8px 0 4px, gap 8px, radius 6px, transparent.
- Hover: control-hover background and text colour.
- Contents: a 12px chevron that rotates 90 degrees when open (150ms), a 14px
  status icon, the group name in 12px uppercase with 0.06em tracking, and a
  count pill in mono 11px.
- The pill uses text ink at 7% as its background, muted ink, radius 999px, and
  padding 1px 7px. It counts the group's tasks while the group is open or
  closed.
- Clicking the header toggles the group. While a search filters the list the
  header is disabled, matching the current behaviour.

Status icons share `viewBox="0 0 24 24"`, `stroke="currentColor"`,
`stroke-width="2"`, size 14, and a ring `circle cx=12 cy=12 r=9`:

| Group | Colour | Ring | Inner mark |
|---|---|---|---|
| Backlog | muted | `stroke-dasharray: 3 3` | none |
| Todo | text secondary | solid | none |
| In Progress | info | solid | filled right half-disc `M12 6.5a5.5 5.5 0 0 1 0 11z` |
| Done | success | solid | check `M8 12.5l2.8 2.8L16.5 9.5` |
| Cancelled | faint | solid | cross `M9 9l6 6M15 9l-6 6` |

### Task container

A group renders its container only when it is open and has tasks. An empty
group shows the header alone: no empty box and no empty text.

The container has a 1px border, radius 10px, `overflow: hidden`, and a
background of text ink at 2%.

### Task row

Rows use `grid-template-columns: 96px minmax(0, 1fr) auto minmax(72px, auto)`,
gap 14px, minimum height 40px, padding 0 10px 0 14px, and 13px text. The last
column keeps the 72px action width for a single Start and may grow only when
Start and Resume are both shown.

- A hairline separates adjacent rows only: border-top at 70% of the border
  colour between `.row + .row`.
- Hover paints the row with text ink at 4% over 120ms.
- ID: mono 12px, muted. Clicking it opens the review.
- Title: one line with ellipsis, text colour, 13px. Clicking it opens the
  review. In a completed or cancelled group the title is muted and struck
  through.
- Priority: a 6px round dot and the label, 12px, text tertiary, no wrapping.
  None renders nothing: no dot and no label.
- Start: row action at the end, height 26px, padding 0 10px, radius 6px, 1px
  border, control background, text colour, 12px medium, `aria-label` of
  `Start <ref>`. It is transparent at rest and appears on row hover or its own
  `:focus-visible`; at `@media (hover: none)` it is always visible. Start stays
  disabled while Resume is shown.

### Colour roles

| Role | Token |
|---|---|
| border | `--color-edge` |
| text | `--color-ink` |
| text secondary | `--color-ink-secondary` |
| text tertiary | `--color-ink-muted` |
| muted | `--color-ink-muted` |
| faint | `--color-ink-disabled` |
| control | `--color-button` |
| control hover | `--color-button-hover` |
| info | `--color-info` |
| ok / status running | `--color-success` |
| git yellow (Medium) | `--color-warning` |
| context critical (Urgent) | `--color-error` |
| danger soft coral (High) | `--color-usage-stale` |

No palette colour is added. Percentages are applied to the listed token.

### Empty project

A project with no tasks shows a centred empty state instead of the list: the
project name and `· Kanban` in mono 15px text secondary, and one 13px muted
line explaining that tasks will appear there. A board with states but no
tasks is empty for this purpose.

## Accessibility

- Section headers and Start are native buttons; headers expose
  `aria-expanded`.
- Each group is a `<section>` labelled with its name.
- Rows stay a list: each row is a list item.
- Reveal-on-hover never hides a control from the keyboard: focus shows Start,
  and touch devices always show it.
- ID and title keep their review and context-menu behaviour.
