# Themes

Status: Delivered (theme registry, token files, the NeKode Flat and NeKode Float themes, and the semantic hook contract for theme structure overrides).
Path: `docs/features/themes/spec.md`.

## Goal

Let the user pick a visual theme for the NeKode window, and let a theme restyle shell elements without depending on test ids, Tailwind class combinations, or DOM position, so component changes cannot silently break a theme.

## Related requirements

- Theme selection and persistence: `docs/references/NeKode-Design-System.md` (section 3, implementation status) and `docs/UX-UI.md` (App Settings).
- User decision 2026-10-21: remove the NeKode Float theme and keep NeKode Float v2.
- User decisions 2026-10-21 for the NeKode Float v2 cleanup: the WSL directory list and the bottom panel tab bar get their normal opaque background back; the Kanban tab icon gets the pink glow the theme always declared.
- User decision 2026-10-22: rename NeKode Float v2 to NeKode Float (id `nekode-float-v2` becomes `nekode-float`) and make it the default theme.

## Scope

- Theme membership, labels and layout variant (registry).
- Token override files per theme.
- How a theme file may target shell elements beyond tokens (theme hooks).
- The NeKode Float structure overrides, expressed through theme hooks.

## Non-goals

- New themes or palette changes.
- Light themes, per-project themes, or user-authored themes.
- Changing NeKode Flat (`default`) visuals.
- Theming Monaco.

## Behaviour

1. The registry `src/renderer/src/lib/theme.ts` (`THEMES`) is the only source of theme membership. It lists exactly `default` ("NeKode Flat", attached layout) and `nekode-float` ("NeKode Float", floating layout). `DEFAULT_THEME_ID` is `nekode-float`.
2. Every registry id has exactly one file `src/renderer/src/themes/<id>.css` and exactly one `@import` in `src/renderer/src/theme.css`, and every theme file and import has a registry id.
3. Each override theme declares every token name that `themes/default.css` declares.
4. The active theme is `data-theme="<id>"` on the document root, stored in `localStorage` under `nekode.theme.v1`. A stored `nekode-float-v2` (the id before the 2026-10-22 rename) resolves to `nekode-float`. A missing or unknown stored id resolves to `DEFAULT_THEME_ID`; so does a storage read failure.
5. The quick theme switcher in the status bar cycles through registry ids in registry order.
6. Theme hooks: a theme file targets a shell element beyond tokens only through
   - a semantic class with the `nk-` prefix that the owning component renders for that purpose, or
   - an existing semantic class or state attribute of that component (for example `nk-tab-active`, `status-bar-section`, `data-selected`, `data-status`, `data-fixed-action`).

   A theme selector must not use `data-testid`, a combination of Tailwind utility classes, an element-type qualifier used only to narrow a utility class (such as `div.bg-app`), or position pseudo-classes (`:nth-of-type`, `:first-child`, `:first-of-type`, `:last-of-type`) to find its target. Descendant selectors into a hooked element (for example `.nk-tab-terminal svg`) are allowed.
7. Theme files are unlayered and therefore win over Tailwind utilities and `@layer components` rules without `!important`. A theme declaration uses `!important` only to override an inline `style` attribute, with a comment that names it.
8. NeKode Float keeps the computed styles it has today on every hooked element, in its default, hover and focus states, except the two changes in Behaviour 9.
9. NeKode Float changes exactly these visuals:
   - The WSL directory list in Add Project and the bottom panel tab bar are no longer forced transparent; they show their normal `bg-app` background.
   - The Kanban tab icon is colored `#ff7ad9` with a pink drop-shadow glow.
10. NeKode Flat computed styles do not change.

## Business rules

- Theme ids are stable strings; removing a theme does not migrate a stored id to another theme. Renaming a theme maps its old stored id to the new one (Behaviour 4).
- The semantic hooks are presentation contract, not test contract: tests keep using `data-testid`; theme files never do.

## Authorization

none

## Data / API

- `localStorage` key `nekode.theme.v1` (unchanged format).
- `localStorage` key `nekode.quickThemeSwitch.v1` (unchanged).
- No IPC, database or main-process change.

## Edge cases

- A stored `nekode-float-v2` id after upgrade: the window renders NeKode Float and App Settings shows "NeKode Float". The next theme change saves the new id.
- A stored `nekode-float` id from before the 2026-10-21 removal now renders NeKode Float.
- A stored `default` id keeps NeKode Flat; only users without a saved choice get the new default.
- The bottom panel prompt input and terminal use the same components as the chat surface and keep the same NeKode Float styling as today.
- The status dot color is set inline from the chat status config; NeKode Float overrides it with `!important` (Behaviour 7 exception).

## Errors

Storage read or write failures keep the existing App Settings error behavior. No new error paths.

## Acceptance criteria

1. `THEMES` has exactly `default` and `nekode-float`; `themes/nekode-float-v2.css` and its import do not exist; `theme.test.ts` registry parity passes.
2. `grep` for `data-testid`, `:nth-of-type`, `:first-child`, `:first-of-type`, `:last-of-type`, `div.bg-`, `form.bg-`, `aside.bg-` and `.rounded-lg.` in `src/renderer/src/themes/*.css` returns nothing.
3. `!important` appears in `themes/nekode-float.css` only on declarations that override an inline style, each with a comment.
4. A real-app CDP capture of computed styles (default, hover, focus, `::after`) for every element NeKode Float v2 styled before the 2026-10-21 cleanup shows no difference between before and after for `default`, and for `nekode-float-v2` (now `nekode-float`) shows differences only on the WSL directory list background, the bottom panel tab bar background, and the Kanban tab icon color and filter.
5. A stored `nekode-float-v2` id resolves to `nekode-float`; a missing or unknown id resolves to `nekode-float`; a stored `default` stays `default` (unit test).
6. Lint, typecheck and the renderer test suite pass.

## Required tests

- `theme.test.ts`: registry parity (two themes); token parity; a guard that theme files contain no forbidden selector patterns from Behaviour 6 and no unexplained `!important` (Behaviour 7).
- `App.test.tsx` and `StatusBar.test.tsx`: theme selection, persistence, restore and quick switch cycle use the two themes and start on NeKode Float; missing, unknown, renamed and `default` stored ids resolve per Behaviour 4.
- Real-app computed-style comparison (acceptance criterion 4) recorded in the task record as evidence; not a committed test.

## Relevant SDD / ADR

none
