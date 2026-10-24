# Kanban adapter interface: plugin discovery, project binding, normalized board data

Status: Delivered (adapter-backed board with Start, Resume, New task, and item review); drag-and-drop and the UX-UI 26-30 visual design remain later work.
Path: `docs/features/kanban-adapter-interface/spec.md`.

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Rodzaj manifestu i stały katalog adapterów (NEKODE-132, decyzja użytkownika 2026-10-24)

Adapter zadań ma `adapter.json` bez pola `kind`. Manifest z polem `kind` (na przykład `"kind": "task-progress"`) należy do innej rodziny adapterów: wykrywanie adapterów zadań pomija go z ostrzeżeniem w logu main i nie pokazuje go na liście `Adapter`. Pozostałe poprawne adaptery zadań są nadal wykrywane.

Adaptery zadań są wykrywane tylko w stałym katalogu `<userData>/kanban-adapters`. Nie ma ustawienia ani nadpisania katalogu: klucz app_state `kanban.adaptersDir` nie jest czytany ani zapisywany, a sekcja `Tasks` w Project Settings nie pokazuje katalogu ani przycisku `Browse...`. Pusty stan listy podaje folder instalacji (`kanban-adapters` w katalogu danych aplikacji NeKode). Ta poprawka zastępuje wcześniejsze zachowanie nadpisania z Behaviour 1, 12 i AC13.

## Filtrowanie tytułów (NEKODE-117, decyzja użytkownika 2026-10-23)

Pole `Search titles` filtruje lokalnie wszystkie pozycje już pobrane dla aktywnego projektu, także poza obszarem przewijania i w zwiniętych grupach. Wyniki zmieniają się od pierwszego znaku, bez Entera, debounce ani dodatkowych wywołań IPC/API. Dopasowanie sprawdza dosłowny fragment tytułu bez rozróżniania wielkości liter, po usunięciu skrajnych spacji zapytania. Ref i opis nie uczestniczą w dopasowaniu.

Filtr zawsze korzysta z pełnego aktualnego zbioru. Zachowuje sortowanie i kolejność grup statusów. Niepuste zapytanie ukrywa grupy bez dopasowań; grupy z wynikami są rozwinięte i mają licznik pasujących pozycji. Podczas filtrowania ich zwijanie jest nieaktywne. Wyczyszczenie przywraca poprzednie zwinięcia i wszystkie pozycje, bez zmiany zapisanych preferencji. Zapytanie złożone wyłącznie ze spacji działa jak puste.

Brak dopasowań pokazuje `No matching tasks.`, niezależnie od stanu pustej tablicy. Przycisk `Clear search` czyści tekst i przenosi fokus do pola; Escape w polu także czyści zapytanie. Podczas podglądu zadania pole w pasku aplikacji jest nieaktywne.

Zapytanie pozostaje w pamięci sesji Kanban projektu podczas odświeżenia, podglądu zadania i zmiany aktywnego widoku. Projekty mają niezależne zapytania; aplikacja nie zapisuje ich trwale. Odświeżenie, utworzenie i aktualizacja zadania stosują filtr do nowych danych.

Weryfikacja obejmuje pierwszy znak, fragment tytułu i wielkość liter, pominięcie refu i opisu, czyszczenie, brak wyników, sortowanie, przywracanie zwinięć, podgląd i zmiany danych, izolację sesji projektów oraz zbiór kilkuset pozycji bez dodatkowych żądań.

## Goal

Let NeKode read and change work items from an external Kanban backend (Plane today, others later) through user-provided adapter plugins, without building any backend knowledge into the application. The user drops adapters into one directory, binds one adapter per project in Project Settings, fills the adapter's declared config fields, and the application talks to that backend only through a versioned process protocol. This feature also ships the first real Kanban surface, reached from a `Kanban` tile under the project's name in the left navigation and a `Kanban` tab in the top tab strip. The tab is unstyled beyond the basics: a grouped list, separate slug and title columns, a hover underline on the slug, the title, enabled Start, and shown Resume as the only click targets, the priority, Start and Resume, a New task form, an item review with Status and Priority plus the full title and description, and a refresh icon on the header's right side. In the review, Status and Priority save, and the ref, title, and description stay read-only and can be selected and copied. The editing rules are in "Kanban item editing amendment (user decision 2026-10-11)" and "Kanban row and review amendment (user decision 2026-10-12)". Drag-and-drop and the visual design in UX-UI §26-30 remain later work.

## Related requirements

- UX-UI §26–30 (Kanban as a primary product surface, post-MVP) — this spec is its data layer.
- requirements.md §3 keeps functional Kanban out of MVP; this feature is the post-MVP integration groundwork (user decision 2026-10-04).
- First adapter target: Plane CE REST API. State groups and aliases are defined explicitly in Behaviour and Business rules below.

## Scope

- Shared: typed IPC contract additions (`kanban` namespace), normalized domain types (`KanbanState`, `WorkItem`, config-field types), `APP_STATE_KEY` entries and per-project key helpers.
- Main: adapter discovery (manifest scan), adapter host (spawn + stdio JSON protocol + timeout + kill), `KanbanService` facade behind IPC, per-project config persistence and cleanup on `projects:remove`.
- Renderer: Project Settings "Kanban" section — adapter select, dynamic config form driven by the adapter manifest (secret masking), Test connection. The adapters directory is fixed and not shown (NEKODE-132).
- Board surface: a `Kanban` tile in the left navigation directly under the name of a project that has a stored Kanban binding, plus a `Kanban` tab in the top tab strip beside the chat and file tabs, both opening the board in that project's center surface. `kanban:listBoard` renders as a grouped list under the state names. The refresh control is an icon on the header's right side, with an accessible name. Each item shows its slug and title in separate columns, plus its priority. Hover underlines the slug, the title, enabled Start, and shown Resume, and only those handle a click. Opening the slug or the title shows a review: Status and Priority save, and the ref, title, and description stay read-only and can be selected and copied. `New task` is in the header when the review is closed. The editing rules are in "Kanban item editing amendment (user decision 2026-10-11)" and "Kanban row and review amendment (user decision 2026-10-12)". No styling beyond minimal layout. No separate center-surface `Files | Kanban` view-switch strip is added.
- Reference adapter (Python, outside the app contract): a Plane adapter implementing protocol v1 against the Plane REST API, with the state groups, alias resolution, and `PLANE_*` configuration fields documented in the public adapter guide.

## Non-goals

- Drag-and-drop and the visual design in UX-UI §26-30. Editing the title or description is out of scope. The review changes status and priority, and `New task` creates an item, as specified in the 2026-10-11 and 2026-10-12 editing amendments.
- A separate center-surface `Files | Kanban` view-switch strip: the board is a `Kanban` tab in the existing top tab strip (beside the chat and file tabs) and a tile in the left navigation; no second, project-view tab pair is added.
- The full tabbed Project Settings rebuild: in this feature the Kanban settings render as their own tab/section inside the existing Project Settings dialog without reworking the dialog's other sections.
- Two-way automatic synchronization with a NeKode Task entity.
- Long-lived adapter daemons: every invocation is one process.
- Plugin signing, marketplace, or sandboxing beyond directory discovery and manifest validation.
- Bundling adapters with the app; adapters are always user-installed files.
- More than one bound adapter per project.
- Reading or writing the harness `.agents/.env` or project profile: NeKode stores its own per-project config (entering the API token twice is accepted for v1).

## Behaviour

1. Discovery: main scans the fixed adapters directory `<userData>/kanban-adapters` (no override, NEKODE-132) one level deep. A subdirectory containing a valid `adapter.json` without a `kind` field is an adapter; a manifest with `kind` belongs to another adapter family and is skipped with a logged warning; discovery happens on every `kanban:adaptersList` call, so adapters added while the app runs appear at the next settings open without restart. Invalid or missing manifests are skipped with a logged warning naming the path; remaining valid adapters are still listed. Duplicate adapter ids: the first in lexicographic directory-name order wins, later duplicates are skipped with a warning naming the skipped directory.
2. Manifest (`adapter.json`): `{ id, name, protocolVersion, invocation: { command, args? }, configSchema: [ { key, label, type, required?, options?, default? } ] }` where `type` is `string | secret | select | boolean`; `options` applies to `select`; `id` is kebab-case and unique. A manifest with `protocolVersion` other than `1` is rejected with a warning (no best-effort compatibility).
3. Invocation protocol v1: one process per request. Main spawns `invocation.command` + `invocation.args` (argv array, no shell) with cwd = the adapter directory, writes exactly one JSON request object to stdin, closes stdin, reads stdout to EOF, and expects exactly one JSON response object. Request: `{ protocolVersion, action, config, params }`. Response: `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. Exit code 0 must accompany `ok: true` and 1 `ok: false`; any other exit code, invalid UTF-8/JSON, more than one JSON value, or stdout above 10 MB is a typed protocol error. stderr is captured for diagnostics only (never parsed).
4. Actions and params:
   - `test` `{}` — connection/credentials check.
   - `listStates` `{}` — the backend's concrete states.
   - `listItems` `{ stateId?, stateGroup? }` — items across all states when both omitted.
   - `getItem` `{ ref }`.
   - `createItem` `{ title, description?, stateRef?, priority? }`.
   - `updateItem` `{ ref, title?, description?, stateRef?, priority? }` — patch semantics: only provided fields change. `priority: null` clears the priority. An omitted `priority` leaves it unchanged.
   - `stateRef` accepts a concrete state name (case-insensitive) or a group alias (`backlog`, `todo`/`unstarted`, `in progress`/`started`, `done`/`completed`, `cancelled`) and is resolved by the adapter against its own states.
5. Timeout: main enforces a per-invocation timeout (30 s default) and kills the adapter's process tree; expiry produces a typed `timeout` error naming the adapter and action.
6. Config delivery: the request `config` object carries all stored field values, secrets included. No config values are placed on the command line (argv is world-readable on Windows) and no secrets go into environment variables or the manifest.
7. Project binding: the Project Settings Kanban section lists discovered adapters (name, id). Selecting one renders its `configSchema` as a form: `secret` inputs are masked and never rendered back after save, `select` renders a dropdown from `options`, `boolean` a checkbox, required fields are marked. Save stores the adapter id and field values; an empty non-secret field clears the stored value; a left-empty secret field keeps the stored secret. Deselecting (none) clears the binding but keeps stored field values. No selection = not configured.
8. Test connection: a button invokes the adapter's `test` action with the currently entered values (unsaved edits included, without persisting them). Success renders an inline confirmation; failure renders the typed error message inline in the section (not a toast).
9. Read path: `kanban:listBoard(projectId)` returns normalized `{ states, items }` via the adapter (`listStates` + `listItems`). Unconfigured project or missing adapter → typed validation error naming the project.
10. Write path: `kanban:createItem(projectId, input)` and `kanban:updateItem(projectId, ref, patch)` forward normalized inputs; the adapter's returned WorkItem is returned to the renderer unchanged.
11. `projects:remove` deletes the project's adapter and config keys (same rule as `project.handoffDir` cleanup).
12. The settings section offers no adapters directory choice; its empty state names the install folder (`kanban-adapters` in the NeKode application data directory). Replaced by NEKODE-132.
13. The Kanban settings render as their own tab (labeled `Tasks` since the [project home spec](../project-home/spec.md) Behaviour 6) inside the existing Project Settings dialog, separate from Configuration and Actions, without reworking those sections.
14. Board entry points (the tab and tile presence rule in this item is replaced by the [project home spec](../project-home/spec.md) Behaviour 1-5: every selected project has a non-closable home tab first in the strip, the project name opens it, and an unbound project shows a setup welcome there; the list, review, and editing rules below stay): a project with a stored Kanban binding shows a `Kanban` tile in the left navigation directly under the project's name and a `Kanban` tab in the top tab strip beside the chat and file tabs; a project without a binding shows neither, and no separate center-surface `Files | Kanban` view-switch strip exists. The `Kanban` tab is present for as long as the project is bound and is not closable (it is a project view beside the chat tab, not a document), placed immediately after the chat tab. Selecting either entry point activates the `Kanban` tab, which renders `kanban:listBoard` in the center surface. The tab's header carries a refresh icon on its right side, an icon button with the accessible name `Refresh`. The items are shown in the adapter's state `order`, grouped under the state names. Each item shows its `ref` (the Plane slug) and its title in separate columns, plus its priority (`Urgent`, `High`, `Medium`, `Low`, or `None` when priority is null). Hover underlines the slug, the title, enabled Start, and shown Resume. Only those handle a click. The row highlights on hover. The slug column is fixed and the title truncates. Choosing the slug or the title opens a two-column review in place of the list. The left column has the same ref, the title wrapped in full, and the description (or `No description.` when the description is null or blank). The right column is one quarter of the width and has Priority and Status. Status lists the board states and saves the selected name through `kanban:updateItem` with only `stateRef`. Priority saves through the same action with only `priority`, and None sends null. The ref, title, and description stay read-only and can be selected and copied. The card and the row have no status or priority control. When the board is ready and the review is closed, the header shows `New task`. The editing rules are in "Kanban item editing amendment (user decision 2026-10-11)" and "Kanban row and review amendment (user decision 2026-10-12)". Back returns to the current view. Choosing Board or List leaves the review for that view. The review uses the loaded board payload and does not call another action. Activating the tab triggers one lazy load; the refresh icon re-runs it. A refresh that drops the open item closes the review. Loading, typed-error, empty-board, and not-configured states are inline text (the not-configured state offers a button opening Project Settings on the Tasks section, mirroring the Resume picker's Configure affordance). Selecting the chat tab or a file tab shows that surface instead; a content-selection gesture always activates the tab that shows it.

## Business rules

- Protocol version is exact-match: main speaks only `protocolVersion: 1`; a manifest or response declaring another version is a typed protocol error.
- `stateGroup` enum: `backlog | unstarted | started | completed | cancelled` (Plane's normalized groups). An adapter response containing a state or item outside the enum is a protocol violation.
- WorkItem shape: `{ ref, id, title, description|null, stateId, stateName, stateGroup, priority|null, assignee|null, url|null, updatedAt|null }`. `ref` is the adapter's stable human-readable reference (e.g. `NEKODE-16`); `id` is the backend-native id, opaque to the UI. `priority` normalizes to `urgent | high | medium | low | null`; `updatedAt` is ISO 8601 UTC or null.
- KanbanState shape: `{ id, name, group, order }` with `group` from the enum and `order` an integer sort key from the adapter.
- Storage: `project.kanbanAdapter:<projectId>` holds the adapter id; `project.kanbanConfig:<projectId>` holds the JSON object of field values. Missing or empty adapter key = unconfigured.
- Secret fields are write-only through the UI: `kanban:getConfig` returns `null` for every secret value plus the list of keys that have a stored value, so the UI can show "stored" without echoing the secret.
- Secret values are stored in the local SQLite `app_state` store as plain JSON, without encryption at rest. Main passes them only to the bound adapter process via stdin; the adapter uses them to authenticate its backend requests. Secret values are never placed in argv or returned through the settings UI.
- All adapter invocations spawn the argv array directly (no shell), cwd = the adapter directory.

## Authorization

Renderer invokes stay behind the existing trusted-sender guard. `kanban:*` channels reject unknown project ids (`not_found`). Adapter processes run with the user's own privileges and receive only the bound project's stored config values. Main executes only the `invocation.command` declared by a manifest found in the configured adapters directory; nothing outside that directory is ever executed.

## Data / API

- IPC additions (names follow `IPC_CHANNEL`):
  - `kanban:adaptersList` → `KanbanAdapterInfo[]`
  - `kanban:getConfig(projectId)` → `{ adapterId: string | null, values: Record<string, string | null>, secretKeys: string[] }`
  - `kanban:setConfig(projectId, { adapterId: string | null, values: Record<string, string> })` → `void`
  - `kanban:test(projectId, values?)` → `void` (values optional: persist-first form uses stored config)
  - `kanban:listBoard(projectId)` → `{ states: KanbanState[], items: WorkItem[] }`
  - `kanban:createItem(projectId, input: KanbanCreateInput)` → `WorkItem`
  - `kanban:updateItem(projectId, ref: string, patch: KanbanUpdatePatch)` → `WorkItem`
  - The built-in `local-file` source adds a board `revision`, an optional trailing write `revision` argument, and `kanban:bindLocalFile(projectId)`; the [project home spec](../project-home/spec.md) Data / API owns them. Process-adapter calls are unchanged.
- `KanbanAdapterInfo { id, name, configSchema: KanbanConfigField[] }`; `KanbanConfigField { key, label, type: 'string'|'secret'|'select'|'boolean', required: boolean, options?: string[], default?: string | boolean }`.
- `KanbanCreateInput { title, description?, stateRef?, priority? }`; `KanbanUpdatePatch { title?, description?, stateRef?, priority? }`. On the patch, `priority` may be null to clear it. Create does not accept null.
- `APP_STATE_KEY` has no adapters directory key (`kanban.adaptersDir` removed by NEKODE-132); helpers `projectKanbanAdapterKey(projectId)`, `projectKanbanConfigKey(projectId)`.
- No SQLite schema migration: all persistence uses the existing flat `app_state` key-value store.

## Edge cases

- Adapters directory missing or empty: the list is empty and the settings section shows an explanatory empty state (not an error).
- Adapter command not found (ENOENT): typed error naming the adapter and command.
- Adapter prints nothing, garbage, two JSON objects, or more than 10 MB: typed protocol error carrying a short main-process description plus captured stderr tail.
- Backend unreachable or auth rejected: the adapter's `ok:false` error (code `auth | network | notFound | config | internal`) is surfaced verbatim as a typed error; main adds no interpretation and no retry.
- Adapter bound to a project disappears from the directory: `kanban:getConfig` still returns the stored binding; every request through it fails with `not_found` naming the adapter id; the settings section marks the stored adapter "(missing)" and still allows clearing or re-binding.
- Project removed while a request is in flight: the in-flight response is dropped; nothing is persisted.
- Manifest with a `default` for a secret field: allowed on disk but main ignores it for secret masking decisions (a stored value is what counts).

## Errors

- Typed codes: `validation_error` (unconfigured project, empty required field on save, invalid patch), `not_found` (unknown project, missing adapter), `timeout`, `protocol` (contract violations), and the adapter's own `auth | network | notFound | config | internal` surfaced with the adapter's message.
- No silent fallbacks: a skipped manifest never hides the reason (warning names the path), and an adapter warning on stderr never turns a failed action into success.
- Settings save validates only manifest-declared shape (required non-empty); semantic correctness is the adapter's `test` job.

## Acceptance criteria

1. An adapter directory with a valid manifest dropped into the adapters dir appears in Project Settings at the next open of the section, without app restart.
2. A manifest that is invalid JSON, lacks `id`, or declares `protocolVersion: 2` is not listed; a warning naming the path is logged; valid sibling adapters are still listed.
3. Two directories declaring the same `id` yield exactly one entry; a warning names the skipped directory.
4. Selecting an adapter renders exactly its manifest fields with the correct widget per type; required fields block save when empty; a saved secret renders as "stored" and its value never appears in the DOM.
5. Saving the form without retyping a stored secret keeps the old value: the next adapter invocation receives the previously stored secret in `config` (asserted with a fixture adapter).
6. Test connection renders success inline and failure inline with the typed error message; neither uses a toast.
7. `kanban:listBoard` on a project bound to a fixture adapter returns the fixture's states/items normalized to the spec shapes; items or states outside the `stateGroup` enum produce a typed protocol error.
8. `kanban:updateItem(ref, { stateRef: 'done' })` sends `stateRef: 'done'` to the adapter unresolved; the adapter's returned WorkItem is returned unchanged.
9. `kanban:*` on an unconfigured project rejects with `validation_error` naming the project; on a bound-but-missing adapter with `not_found` naming the adapter id.
10. An adapter that sleeps past the timeout yields a typed `timeout` error and leaves no orphaned process (process tree killed; asserted in the fixture test).
11. The spawned process's command line never contains any config value: the fixture adapter writes its argv to stderr, and the test asserts none of the stored values appear.
12. `projects:remove` removes both `project.kanbanAdapter:*` and `project.kanbanConfig:*` rows from `app_state`.
13. Settings offer no adapters directory change; a manifest with a `kind` field (for example `task-progress-example`) is not listed as a task adapter (NEKODE-132).
14. (Presence rule replaced by the [project home spec](../project-home/spec.md) AC1-4; the list and review checks stay.) A project with a stored Kanban binding shows a `Kanban` tile directly under its name in the left navigation and a `Kanban` tab in the top tab strip beside the chat and file tabs; a project without one shows neither, and no separate `Files | Kanban` view-switch strip exists. Selecting the tile or the tab shows the board in the center surface on its default List view (the items grouped in state order; each item shows its slug and title in separate columns, plus its priority; hover underlines the slug, the title, enabled Start, and shown Resume, and only those handle a click), with a refresh icon on the header's right side. The item review is two columns, and the right column is one quarter of the width: the ref, full title, and description on the left, and Priority and Status on the right. Status and Priority save. The ref, title, and description stay read-only and can be selected and copied. `New task` is in the header when the review is closed. The editing rules are in "Kanban item editing amendment (user decision 2026-10-11)" and "Kanban row and review amendment (user decision 2026-10-12)". The refresh icon re-runs the load. Selecting the chat tab or a file tab returns to that surface. A bound-but-missing adapter surfaces the typed error inline; the not-configured inline state with a Configure button opening Project Settings on the Tasks section renders when the board is shown for a project whose binding no longer resolves.
15. The Kanban section of Project Settings is reachable as its own tab, labeled `Tasks` since the [project home spec](../project-home/spec.md) Behaviour 6, without changing the existing Configuration or Actions sections' behavior.

## Cached board rendering amendment (user decision 2026-10-06)

This amendment replaces the destructive loading behavior in Behaviour 14 and
extends AC14. It changes renderer presentation only; adapter protocol v1 and
`kanban:listBoard` continue to return a complete board snapshot.

- Cache the last successful board separately for each project for the lifetime
  of the current application session. Fetch lazily on its first activation.
  Returning from a chat, file, or another project shows the cached board
  immediately and starts one background refresh. Hidden boards do not poll.
- Manual Refresh uses the same background path. While a request is pending,
  keep the existing list and item review visible and usable. Show an
  accessible `Refreshing board...` status and disable duplicate refreshes.
  Without cached data, retain the initial loading state.
- Reconcile the returned snapshot by work-item `ref` and state `id`: add new
  entries, remove absent entries, and update changed fields and ordering.
  Preserve unchanged item identity and existing keyed DOM nodes where an item
  stays in the same group. Moving an item between states updates its group.
- Preserve scroll position and the open review across tab switches. A changed
  reviewed item updates in place; removing it returns to the list. No
  additional request is made for the review.
- Refresh failures retain the last successful board and show the typed error
  inline. The refresh status ends and retry remains available. A missing or
  cleared binding shows the established error or not-configured state without
  presenting another binding's cached data.
- A removed project or a saved adapter/configuration change invalidates that
  project's cache. Late responses from a disposed or superseded session must
  never repopulate it or overwrite another project's board. Deduplicate loads
  while a request for the same cache generation remains pending.
- Set all visible Kanban surface text to 12.6px (reduced by 30% from 18px per user decision
  2026-10-06) and headings to 14.7px (reduced by 30% from 21px). This includes List,
  Board, review, inline loading/error/empty states, and textual controls.
  Keep the established font family and colors, and adjust layout constraints
  where needed to keep priority labels readable.
- Required renderer coverage: instant cached return under a deferred request;
  visible refresh status with retained content; add/remove/edit/reorder and
  state movement; unchanged DOM identity; review update/removal; retained view
  and scroll; refresh failure and retry; project isolation; removed project
  and configuration invalidation; stale response exclusion; no duplicate load.

The same iteration fixes the existing welcome SVG accessibility lint error by
adding a non-empty title without changing the artwork.

## Required tests

- Manifest validation: happy path; each rejection rule (bad JSON, missing id, bad id format, unknown protocolVersion, bad config field type); duplicate-id resolution order.
- Adapter host: argv correctness and cwd; stdin request framing (single object, stdin closed); single-JSON stdout parsing; `ok:false` mapping; exit-code violations; protocol violations (no output, garbage, two objects, oversized stdout, non-UTF8); timeout kill with no orphan; ENOENT mapping; stderr captured but unparsed.
- Secret handling: `getConfig` masking plus `secretKeys`; setConfig keep-secret rule (empty secret field) and clear-on-empty rule (non-secret).
- Persistence: adapter+config key roundtrip; `projects:remove` cleanup.
- IPC contract: channel presence and typed payload roundtrips in the shared contract test style.
- Renderer (vitest): settings tab states — no adapters, adapter selected with dynamic fields, required validation, test in-progress/success/failure, "(missing)" adapter, no directory choice; board surface states — the grouped list, the Refresh icon on the header's right side, rows with ref, title, and priority, an item review in two columns with Priority and Status on the right, the full title and description, loading, error, empty, not-configured with Configure, refresh; the left-navigation Kanban tile and the top-strip Kanban tab (both present only for a bound project, the tile directly under the project name), and the return to the chat tab and a file tab. The link, copy menu, New task form, and review status change are covered by the 2026-10-11 editing amendment.
- Fixture adapters (node scripts) serve as protocol doubles in vitest; the Python reference Plane adapter is verified manually against the user's Plane instance (documented steps in the task), not in vitest.

## Relevant SDD / ADR

- `docs/architecture/sdd.md` §6, §44 (typed IPC pattern, main-process services).
- ADR: none. The language-agnostic process-protocol decision (protocol v1: JSON over stdio, one process per request, manifest-declared invocation) is recorded in this spec; promote to an ADR if the architecture doc grows that mechanism.

## Kanban task launch amendment (user decision 2026-10-07)

The [session label contract](../session-labels/spec.md) adds launch-time task ref
and agent display identity to the persisted chat returned by Start and Resume.
It owns left-navigation labels; stored names and launch/retry semantics below
remain unchanged.

This section is the NEKODE-28 contract, accepted by the user on
2026-10-07. The acceptance covers the specification. The section replaces the limit on card actions
in Goal and Non-goals and the way
details open from Behaviour 14 and AC14. The rest of the adapter contract,
including the cached board rendering amendment, stays in force.

### Goal and audience

The user starts work on a task from the Kanban list or columns in a new
chat of the chosen agent. The user can also resume work from a specific handoff
linked to that task. NeKode handles the configuration and the launch;
Harness stays an independent agent tool.

### Scope and exclusions

- List and columns: Start and Resume. The separate slug and title controls are replaced by the "Kanban item editing amendment" section.
- List: a row 50% taller. Columns: room for the buttons without forcing
  the card height to grow by 50%.
- Agent profiles in Project Settings, an agent choice modal and a launch
  in a new chat with an instruction about the chosen task.
- Finding handoffs in the configured project directory by a matching
  file name, and choosing the matched candidate in the Resume modal.
- Out of scope: drag-and-drop, a new local Task entity, automatic task status
  changes in the backend, worktrees, model APIs, installing agents,
  resuming the internal CLI session identifier, and Harness changes.
- The existing Resume on the action bar still works according to
  [handoff-resume-flow](../handoff-resume-flow/spec.md). The new task Resume
  has a separate flow that requires a linked file and creates a new chat.

### Navigation and appearance

1. Clicking the slug (`WorkItem.ref`) or the title opens the existing details
   view. Clicking the background, the priority or empty space does not open it.
   Hover highlights the whole row. Focus and underline point to the specific
   controls. Start and Resume do not open the details.
2. The slug and the title are separate controls reachable from the keyboard. Buttons must not
   be nested in a shared row button. The modal has a description,
   Escape handling, keeps focus inside and returns focus after cancelling.
   The "Kanban item editing amendment" section replaces the separate slug
   and title controls with one link. The sentences of this point about the modal stay.
3. The target minimum height of a single-line list row is 1.5 times its
   height before the change. The base height must be measured before the edit
   with the default theme and 100% scale; the tolerance is 1 px. Increasing
   the padding by 50% does not meet this condition by itself. Typography
   12.6px / 14.7px, colors, sorting, grouping and group collapsing stay.
4. Start is always visible in both layouts, also without an active chat.
   User decision 2026-10-11: when Resume is visible for a task,
   Start is inactive, does not take focus and does not open the modal.
   When Resume disappears, Start is active again.
   Resume visibility is defined in the "Resume availability and handoff producer
   contract" section below. At a small width, the actions do not cover the title or the priority;
   a separate row of buttons is allowed. The backend state alone does not block
   these actions. Interface labels and generated instructions are in English.

### Agent profiles

The user decision of 2026-10-14 replaces the per-project profile definitions
of 2026-10-07 with a global library and a per-project opt-in. The
configuration, form, assignments and migration are owned by
[global-agent-profiles](../global-agent-profiles/spec.md). This is an accepted
contract for implementation, not a statement of a finished implementation. Profiles are not
a list of all Actions and are not detected from button names.

- A profile has a stable local id, a name and a launch configuration:
  an executable and an argument array. In the arguments, exactly one element
  `{prompt}` stands for the whole initial instruction passed as one argument.
  A profile is meant for an interactive CLI that accepts such a prompt.
  A wrapper can handle a CLI with a different interface, but the app does not generate it.
- Definitions are managed in App Settings. Project Settings lets you select
  the available profiles and set a default profile among the selected ones. A new
  project has an empty selection (opt-in). Without selected profiles, the modal shows
  Configure agents and opens the project Agents tab; it does not create a chat.
  Command validation and migration are defined by the global-agent-profiles contract.
- The working directory is the directory of the project the task comes from. Profiles
  do not change the global shell configuration or existing Actions.
- The list in the modal shows the profile names and marks the default. The user
  confirms with the Start or Resume button. No choice blocks confirmation.
  Deleting the default profile clears the default choice.

### Start

1. Start opens a modal with the task ref and title and the agent choice. Cancel
   and Escape do not create a chat or a process.
2. After confirmation, the app checks that the project exists, the current adapter
   binding, and that the task and the chosen profile are current. It fetches the current task
   description through the adapter, so it does not send a stale description from the cache.
3. Exactly one new chat of this project is created, visible in the navigation.
   The app activates the chat surface in the existing tab system.
   It does not rebuild the system into a separate top bar tab for every chat.
   The previous chat and the Kanban session keep their state.
4. The chosen agent starts in a new terminal session, with the initial
   instruction passed when the process starts. The app does not type
   the prompt into the shell before the agent starts or after a fixed delay.
5. The instruction starts with `Work on task <ref>: <title>.`, then contains
   the description (or a note that there is none) and the URL, if the adapter returns it.
   It also contains `Follow the project's instructions. Do not assume approval
   for actions that require it.` and information about the handoff directory, if
   one is configured. It recommends keeping the full ref in the name of the future
   local record and handoff, following the project's instructions.
6. Confirmation means launching and passing the instruction, regardless of
   `handoffResume.autoSend`. That existing option applies to the action bar.
   A successful launch does not mean the agent has done the task.

### Linking a handoff to a task

The proposed bridge between the app and any agent tool is based
on files and the task ref. NeKode does not import Harness, does not run
`taskctl`, does not read `.agents/.env` and does not modify Harness templates or
records. A `task_id` alone means a local record and is not a Kanban ref.

1. The search scope is the configured `project.handoffDir:<projectId>`.
   A relative path resolves against the project directory; an absolute one
   may point outside the project. The scan is shallow: regular `.md` files,
   without `README.md`, directories, archives in subdirectories and links.
2. Automatic matching is based only on the file name.
   NeKode does not interpret `work_item_ref`, `work_item_id` or
   `work_item_adapter` in the handoff content. The producer does not have to write them.
3. The full ref must be the start of the name
   without the extension: `nekode-28` or `nekode-28-<description>`. The comparison ignores
   letter case. `nekode-2` does not match `nekode-20`, `nekode-28` or
   `old-nekode-2`. This is the only automatic matching;
   the modal does not distinguish kinds of matches and shows only the file name
   (user decision 2026-10-09).
4. NeKode does not offer manual handoff assignment. A Link handoff link
   does not appear in the task details or in the Resume modal. A change of
   directory needs a new check of the automatic candidates.
5. Automatic candidates are sorted by modification time, newest first,
   with ties broken by name. All matching files are visible; the newest
   may be selected, but the user confirms a specific file. A name
   and a `task_id` without a recognizable ref do not lead to guessing by the task
   title or by any mention in the handoff content.

### Resume

1. A visible Resume opens a modal for the task and starts a fresh read of its handoffs.
   Without a directory, it shows Configure handoffs. Without matches, it shows
   `No linked handoff`. It does not offer manual file assignment and does not switch automatically
   to Start or to a Resume instruction without a path.
2. The modal has a choice of a specific handoff and the same kind of agent profile
   as Start. Confirmation is possible only after the search has finished
   and an existing linked file and a profile are chosen.
3. Right before creating the chat, main checks the file, its link
   and the current configuration again. A file that was deleted, became unreadable, was replaced or changed
   after it was shown requires refreshing the choice. No chat is created then.
4. The Start flow then applies, but the default prompt has the form
   `Resume from <handoff file path>`. The approved NEKODE-83 change
   lets a local JSON template replace it, according to the
   [Resume template contract](../handoff-resume-flow/spec.md#resume-template-amendment-nekode-83),
   approved on 2026-10-17.
   User decision 2026-10-11: resume instructions belong to the
   handoff/resume skill. Without an override, Resume passes only the instruction and the file path.
   The Start prompt keeps the description and context.
   The path is relative to the project if the file lies inside it;
   otherwise absolute. It is prompt data, not shell code.
5. Resume starts a new session of the chosen agent with the file context.
   It does not require the same agent that wrote the handoff, or the old CLI session.

### Data, permissions and compatibility

- The renderer uses typed IPC. Main owns file reads,
  the project check, profiles, the task link and the process launch.
  It does not accept an arbitrary path from the renderer as a trusted handoff source.
- Profiles and the default choice are local settings per
  project in the existing `app_state`; deleting them is part of deleting
  the project. There is no new Task entity and no migration of the project or chat tables.
- The contract needs operations to list/save profiles, to find
  handoffs, and to launch a task with a profile and an optional
  handoff. The detailed IPC names and code split belong to a later plan.
- Task identity uses the existing WorkItem.id and WorkItem.ref; the title
  and description can change without changing the name matching rule.
- File reads require UTF-8 and a 1 MiB limit; matching does not parse frontmatter.
  A larger or invalid file has a visible rejection reason. The renderer does not
  receive the whole file content. Resume availability is checked by the batch scan
  described below; the modal repeats the search when Resume opens or on an
  explicit Refresh, without scanning the disk on hover and without constant polling.
- The task description, URL, ref and path are never interpolated as shell code.
  The executable and arguments come from the profile the user chose;
  the prompt goes in as a single process argument. It does not go into logs,
  diagnostic messages or instructions published on the Kanban board.
  Process arguments may be visible to local system tools.
- NeKode validates the link and readability. Whether the handoff matches
  the current repository state is checked by the agent according to the project's instructions;
  the app does not treat a detected file as approval of a plan.
- The existing handoffs:list and the action bar Resume keep their contract,
  including paste-only / auto-send. The new filtering applies only to the task
  Resume. The adapter's Protocol v1 needs no change.

### Errors and races

- A missing directory, wrong permissions, an adapter error and a missing executable
  have separate, visible messages in the matching modal or chat.
  There is no replacement of the agent with another profile and no silent skipping of an error.
- An unreadable file does not hide valid candidates;
  the modal shows a warning with the name of the rejected file. A failure to read
  the directory is not presented as no handoffs.
- While confirming, the controls are locked. A double click or Enter
  creates at most one chat and process for that confirmation. After it finishes,
  the user can explicitly start the next chat for the same task.
- Cancelling, closing the modal or deleting the project before confirmation
  invalidates pending responses. A late scan of another project or
  task must not change the choice or start a process.
- An error after the chat was created leaves that specific chat with a readable error
  and an explicit Retry. Retry does not create an extra chat and does not blindly repeat
  a prompt that was already delivered. Reopening the app does not start the task
  automatically and does not replay the initial instruction.

### Acceptance criteria

1. In both views, only the title and the slug open the details. The background, the priority,
   Start and Resume do not open the details; the keyboard handles every action.
2. The list row height has a factor of 1.5 relative to the recorded base
   value, with a tolerance of 1 px. The buttons stay readable in both layouts.
3. An added profile is available after reopening the settings and after a restart;
   a profile of another project does not appear in the modal of the current project.
4. Cancelling the Start modal creates no session. Confirmation starts the chosen
   profile in a new chat of the right project with the ref, the title and the current description.
5. Without profiles or on a validation error, nothing starts. A prompt
   with spaces, quotes, new lines and shell characters is still
   a single argument and does not run extra commands.
6. Resume automatically detects matching names and tells NEKODE-2 apart from
   NEKODE-20. Identity metadata does not affect matching.
7. Several candidates require confirming a specific matched file.
   The details and the modal have no Link handoff and no manual assignment list.
8. No linked file, no configuration or a read error does not start
   Resume. A file changed or deleted after the scan blocks confirmation.
9. Resume creates a new chat of the chosen profile and passes the specific path
   and the task ref. A match result does not carry over to another adapter binding.
10. A double confirmation does not duplicate the chat; an error and Retry do not duplicate
    the process or the instruction. A late scan result does not carry over between
    projects. Existing chats and the Kanban cache behavior keep working.
11. The feature works without Harness. No flow writes Harness files,
    changes the task status or calls a model API.

The button availability criteria and the recommended handoff producer contract
are defined by the NEKODE-30 addition below.

### Required verification

- Service tests: saving and isolation of profiles; matching the full ref
  in names; no matching through metadata; invalidation of results;
  a missing directory, read refusal, bad UTF-8, the size limit, links,
  revalidation of the file and deleting the project.
- IPC and launch tests: validation of the sender and inputs; current task data;
  argv with exactly one prompt; a process error, deduplication and Retry.
- Renderer tests: the click scope, the modal and focus, no profiles, the agent/file
  choice, cancelling, loading and error states, stale responses,
  project isolation, and keeping the old Resume and the Kanban cache.
- Verification in the real Electron app: measuring the row height,
  the list and columns with a narrow panel, opening a new chat and starting the CLI
  in the right project directory with the correct prompt. A local test
  CLI must show the received arguments without contacting a model. A separate smoke
  of a chosen configured agent confirms that the CLI accepts the prompt;
  jsdom tests alone do not prove that the terminal works.

### Sources and accepted decisions

- The list row is not a `WorkItemButton` button. At HEAD `7e40e49` the surface is `WorkItemSurface` (`src/renderer/src/components/kanban/KanbanBoard.tsx:500`). There is no `ITEM_BUTTON_CLASS` class. The control style is `ITEM_CONTROL_CLASS` (`:157`), and the hover underline is `ACTION_HOVER_CLASS` (`:161`). The item editing section of 2026-10-11 replaces the single-button model.
- The existing directory and listing without content: `HandoffsService.list` in
  `src/main/services/handoffs/handoffs-service.ts:85` and the
  [handoff-resume-flow](../handoff-resume-flow/spec.md) contract.
- A new chat and surface activation: `handleCreateChat` in
  `src/renderer/src/App.tsx:1692`; running an action in `new-terminal` mode:
  `src/main/services/action-service.ts:306`.
- The link is based on the full ref matching the handoff file name:
  the file name comes from the task identifier and does not contain a reference
  to the backend work item. This justifies the separate matching.
- [Product requirements](../../product/requirements.md), section 3: the local Task entity and handoffs linked to tasks stay post-MVP (`docs/product/requirements.md:67`, `:68`). The adapter board is delivered and is not that entity (`docs/product/requirements.md:70`). This contract does not introduce a local Task entity.
- On 2026-10-07 the user accepted the whole specification, including the handoff
  matching rules, manual assignments, the `{prompt}` argv and the use of
  the existing chat surface. Separate profiles in Project Settings were
  an earlier accepted decision of the same day.
- The user decision of 2026-10-09 replaces the earlier matching by
  metadata: one naming convention and a one-time data adjustment,
  without support for the old format. A later instruction of the same day
  removes Link handoff from the interface; the manual assignment feature can
  return only after a future decision.

## Resume availability and handoff producer contract (NEKODE-30)

User requirement of 2026-10-08: Resume on the Kanban list is visible
only when a handoff for the given task exists in the configured directory.
The same rule applies in the Board view, which uses the same actions.
The naming convention comes from the user decision of 2026-10-09. The rest of the Stage 2 scope
in NeKode was approved on 2026-10-09; the request to prepare the specification
did not by itself approve the implementation.
This section updates the contract in place instead of creating a second specification.

### Goal and scope

The user sees Resume only for a task with a confirmed matched
handoff. The user can configure the directory and confirm a specific candidate.
The agent that writes the handoff keeps the full ref in its name. Changing the task
title does not change the ref or the required name prefix.

The scope covers batch handoff availability in Kanban, navigation to the
configuration, the full ref in prompts, a one-time data
adjustment and the producer contract for Harness. The producer change belongs to the owner
of the Harness template, not to the running NeKode app.

Split accepted on 2026-10-09: HARNESS-24 covers the producer in Agent
Harness; NEKODE-30 covers the consumer and the final integration in NeKode.
The tasks have separate records, tests, reviews and acceptance. The integration in NeKode
needs an accepted producer change and an approved sync.

Out of scope: storing the local path in the Kanban backend, automatic
handoff creation during Start, permanent support for old formats,
recursive scanning, watchers and polling, and changing the action bar Resume.
Neither a successful agent launch nor a local record alone means that a handoff exists.

### Visibility and flow

1. Resume is rendered only after a successful check of the configured
   directory, if the task has at least one readable, accepted
   candidate matched by the full ref in the name.
   The existence of any file in the directory is not enough.
   A missing agent profile does not hide Resume; the modal keeps Configure agents.
2. During the first scan, after a result is invalidated, without a directory, without
   a linked file or on a scan error, Resume is hidden, also
   from the keyboard and assistive technologies. Start stays available.
   The task status in the backend alone does not decide availability.
3. Without a configuration, Kanban shows the message
   `Handoff directory is not configured.` and Configure handoffs, which leads to the existing
   `project.handoffDir:<projectId>` setting. It does not set a directory by default. For
   a project with Harness, the user points to `.agents/handoffs`; for other
   producers, the user points to the actual output directory.
4. A directory read error is a separate visible state with a message and Retry.
   A correctly read directory without candidates is an empty state, not an error.
   Rejected files have visible warnings with the name and the reason; valid
   candidates stay available. A scan failure does not remove the loaded board.
5. User decision 2026-10-09: Link handoff is removed from the interface.
   The task details and the Resume modal offer no button, list
   or confirmation for manual assignment. Bringing this feature back
   needs a future product decision. The details still use
   the data of the loaded board.
6. Availability is checked on the first Kanban activation, on return to
   its tab, on an explicit Refresh and after saving a change of the directory
   or the adapter binding. A change of the directory or
   the binding immediately invalidates the previous result. There are no scans on hover,
   on sorting, on a List/Board switch or on collapsing groups. Hidden sessions do not
   start scans; a return refreshes their result.
7. One check cycle for the active project reads the directory and each
   qualifying file at most once, and then matches the same
   set against all loaded tasks. A full scan must not be called
   separately for each row. Rendering the board does not wait for the scan.
8. The result is a snapshot. A file change outside the app shows up after Refresh
   or a return to the tab. Opening the modal and confirming Resume always
   check the file again; the list snapshot does not replace this validation.
   A deleted, unreadable or changed file blocks the launch and refreshes
   availability. No chat or process is created for a rejected confirmation.
9. Late responses must not bring Resume back after a change of project,
   directory, binding, task set or a newer scan. Parallel
   triggers of the same check are merged. Each result belongs to
   a specific project, configuration and request generation.

### Uniform producer naming convention

User decision 2026-10-09: the producer and NeKode use one naming
convention. There is no exchange of three work_item fields and no parser of their metadata
in the NeKode runtime. Existing data is adjusted once.

1. The Start prompt passes the actual full ref, the description and URL of the task, and
   the configured directory. Resume passes the full ref, the title, the handoff path
   and the instructions from the Resume section above. It does not require the producer to persist
   work_item_ref/id/adapter. The id and the adapter stay
   internal NeKode data for isolating Kanban operations and assignments.
   A missing directory does not block Start and is not set by default.
2. For a task with a safe full ref, the local `task_id` starts with
   its full normalized form, for example `nekode-30-kanban-handoff-availability`.
   The record directory keeps the task_id name, and the handoff the name `<task_id>.md`.
   A short description and a suffix tell records apart without shortening the ref. No
   separate handoff subdirectory is created, because the NeKode scan is shallow. A ref that does not fit
   the task_id limits is not changed arbitrarily. The producer reports
   that the convention cannot be applied; it does not start an alternative
   link through metadata. NeKode does not guess by title or content.
3. Existing data for Kanban tasks must follow the same convention.
   The one-time adjustment covers the record directory name, the task_id,
   the handoff name and references to these paths. Tasks from outside Kanban
   keep their own names. There are no exceptions for old Kanban records.
4. The producer does not derive the Harness directory from the app setting.
   Harness keeps `.agents/handoffs/<task_id>.md`, its validation,
   the link to the record and the create, replace and close cycle.
   For such a project, the configured NeKode directory must point to the same
   output directory. A mismatch does not start file copying.
5. NeKode compares the full ref with the name without the extension: a name matches if it
   equals the ref or starts with the ref and the `-` separator, ignoring
   letter case. A prefix only in the directory name is not enough.
   A configured directory corresponds to one Kanban project; files from
   different sources with an identical ref cannot be told apart by name alone.
6. Link handoff is not part of the current feature. The only way
   to link is a full ref matching the file name. A name that does not match
   needs a data adjustment according to the approved list.

Example names for this task:

```text
.agents/tasks/nekode-30-kanban-handoff-availability/task.md
.agents/handoffs/nekode-30-kanban-handoff-availability.md
```

The internal format of the record and the handoff and their validation belong to Harness.
NeKode does not need to know the task_id, phases, the Harness version or the record path.

### One-time data adjustment

Before the renaming, a list of the specific old and new paths and of the
references that need updating is made. A link to a task needs an exact
ref confirmed in Kanban or by the user; the title is not proof.
The list shows name collisions and records without a confirmed link.
The change covers only the approved list, not other tasks or projects.
After the change, the Harness validators check the record and the handoff, and NeKode recognizes
the file by its new name. No permanent migration mechanism is added to the app.

### Data, authorization and compatibility

- A new typed IPC operation accepts a projectId and a set of `{ itemId, ref }`
  of the loaded tasks. It returns `not-configured`, `error` with a message or
  `ready` with the availability of each task and warnings. Availability is
  a boolean, not a promise of a launch or a choice of a specific file.
- Main validates the project, the binding, the input identities and the current directory.
  The renderer does not name a disk path. The result contains no file content
  and no adapter configuration. Refs and paths never become shell code.
- The batch scan and `handoffCandidates` use the same matching
  and rejection rules. The list and the modal must not
  decide differently for the same file and task with the same snapshot.
- The existing limits apply: a shallow scan of regular `.md` files, without
  `README.md` and links, UTF-8 and a 1 MiB limit. Availability is session state,
  not a persistent task field, and needs no database migration.
- Reading the board writes nothing to the Kanban backend, to files or to
  Harness. The interface does not store manual handoff assignments.
  A launch still requires confirming the file and the agent in the modal.
- The producer change requires work in the Harness template source and its tests.
  Deploying it to a project must use the intended sync;
  the NeKode app does not edit the shared harness while it runs.
  The request to write this contract does not authorize changing it.

### Acceptance criteria and required verification

1. List and Board show Resume only for a task with a
   matched readable handoff. No configuration, an empty result, loading
   and a scan error do not render this control. Start is inactive exactly
   when Resume is visible for this task, in the List and Board views.
2. Configure handoffs is available without Resume. Configuring the right
   directory causes a new scan; a read error has a separate message and Retry.
3. The details and the Resume modal contain no Link handoff and no
   manual assignment flow. Choosing and confirming a matched candidate,
   Configure handoffs, Configure agents and Refresh are still available.
4. For many tasks, the file adapter counters confirm one read of the
   directory and at most one read of each file per batch cycle.
   Sorting, collapsing, hover and a List/Board switch do not repeat the scan.
5. The tests cover a name with the full ref, NEKODE-2 versus NEKODE-20,
   no matching by title and metadata, several candidates,
   no manual assignment in the UI, and rejected files.
   A rejected file does not hide a valid candidate.
6. A change of directory, adapter or project removes the old result, and late
   responses do not bring the button back. A hidden session does not scan; a return
   and Refresh refresh availability.
7. Deleting or changing a file after the list or modal scan blocks
   confirmation without creating a chat and a process. There is no Resume without a path.
8. Both prompts pass the actual full ref, and Start also passes a naming
   instruction without secrets. The launch
   test keeps the single prompt argument and the current logging rules.
9. The Harness producer tests confirm the full ref prefix in the task_id,
   keeping the name on handoff-create and replace, and that the handoff name
   matches the task_id. The one-time adjustment has an approved list
   of changes and correct validation of records, handoffs and references.
   Tasks from outside Kanban do not get a forced Kanban prefix.
10. A smoke in real Electron uses local files and a test CLI:
    no file, creating a valid file and Refresh, choosing a matched
    file, deleting after the scan, and a project without Harness. The action bar regression
    does not change its existing Resume or paste-only / auto-send.

Service, IPC and renderer tests prove availability, errors and session isolation;
producer tests prove the naming convention. No automated test
needs contact with a model or a write to a production Kanban.

### Basis for the recommendation

- `src/main/services/handoffs/handoff-matcher-service.ts:96` (`filenameMatchesRef`) matches the full ref or the `ref-` prefix and rejects a longer ref such as NEKODE-20. The consumer contract allows only this path; parsing identity metadata is not part of matching.
- The `kanban:linkHandoff` channel does not appear in `src/shared/ipc-contract.ts`. `src/main/ipc/ipc-validation.test.ts:512` checks that it is absent. The only link stays a full ref matching the file name.
- `src/renderer/src/components/kanban/KanbanBoard.tsx:920` makes Resume depend on a successful scan and on handoff availability for the given task.
- The handoff directory is configured per project, and the file name comes from
  the task identifier; a name matching the full ref is a requirement
  of the consumer contract.
- The handoff template contains the task_id. The new contract does not require adding
  work_item_ref, work_item_id or work_item_adapter to the template.

## Kanban item editing amendment (user decision 2026-10-11)

This section is the NEKODE-41 contract. The decisions come from the user's answers
of 2026-10-11. It replaces the separate slug and title controls from the
"Navigation and appearance" section, items 1-2, and the sentences about a separate ref, a separate title
and a read-only preview in Goal, Behaviour 14, AC14 and
in `docs/UX-UI.md` §18. It does not change Start, Resume, the row height,
sorting or the ban on dragging. The board cache stays,
except for item 8 of the "New task" section.

### Goal

On the board and on the list, the user sees one task link, copies its
slug or address, adds a task and changes the status in the preview.

### Scope and exclusions

In scope: one underlined link on the card and in the row, a `Copy slug`
and `Copy link` menu, a `New task` form with the Status, Title and Description fields,
and changing the status only in the preview.

Out of scope: dragging between columns, editing the title, description
and priority, building the Plane address in the renderer, new IPC channels, a menu
on Start, Resume, the priority and the card background, and changing the sorting rules.

### Link

1. On Board and on List, one control shows `WorkItem.ref`, one space
   and `WorkItem.title`. The text is always underlined.
2. A click and Enter and Space open the existing preview. Start, Resume
   and the priority do not open the preview.
3. On the list, the link takes the flexible title space and is truncated.
   On the card, the link wraps in full. The preview still shows the full title.
4. The control's test identifier is `kanban-item-link-<ref>`. The separate
   `kanban-item-ref-<ref>` and `kanban-item-title-<ref>` disappear from the card
   and from the row.
5. Sorting by slug still compares `WorkItem.ref` alone.

### Copy menu

1. The menu opens with a right click on the link and with the context menu key
   or Shift+F10 when the link has focus.
2. The items have English labels: `Copy slug` and `Copy link`.
3. `Copy slug` writes exactly `WorkItem.ref` to the clipboard.
4. `Copy link` writes exactly `WorkItem.url`. When `url` is `null`
   or empty after trimming whitespace, the item is inactive and writes
   nothing.
5. A successful write, Escape and the pointer outside the menu close the menu.
6. A clipboard error stays visible. The interface does not present a failed write
   as a successful one.

### New task

1. The `New task` button is in the header when the board is ready and the preview
   is closed. It is on Board and on List.
2. The form under the header has the Status, Title and Description fields and
   the Create and Cancel buttons. There is no separate column field: the chosen status
   is the board column.
3. Status lists `board.states` in the adapter's order. The label and the value
   `stateRef` are `state.name`.
4. The default status is the first state named `Todo`, ignoring letter
   case. When there is no such state, nothing is selected and Create is
   inactive.
5. Title is required. Create is inactive when the title is empty after trimming
   whitespace.
6. Description may be empty. An empty value or one made only of whitespace
   does not go into the request.
7. Create calls the existing `kanban:createItem` with `title`, `stateRef`
   and an optional `description`. It does not send `priority`.
8. Success closes the form, removes the draft and inserts the returned `WorkItem`
   into the loaded board by `ref`, without a second copy. The view stays.
   The preview does not open. A `kanban:listBoard` response that was already
   in progress at the moment of this success keeps this ref when the snapshot does not
   contain it. A refresh started after the success still removes a ref that is absent
   from the snapshot.
9. An error keeps the form and the entered values and shows the error text.
   No local item is created.
10. Cancel, opening an item and switching Board or List close the form
    and remove the draft. Escape does the same when focus is in the form.

### Status in the preview

1. The preview has a Status list with the same states. The name of the
   confirmed item is selected.
2. When the current name is not among `board.states`, it stays an extra
   selected option.
3. A change calls the existing `kanban:updateItem` with only `stateRef` equal to
   the chosen name.
4. Success replaces this item with the returned `WorkItem` and keeps the preview
   open.
5. An error restores the confirmed state name and shows the error text.
6. The ref, title, description and priority in the preview stay read-only.
7. The card and the row have no status control.

### Errors

An IPC error is shown at the form or at the preview. There is no silent
switch to another state and no refresh that hides the error.

### Acceptance criteria

1. The card and the row have one underlined `ref title` link. A click opens
   the preview. Start, Resume and the priority stay separate controls.
2. A right click and the menu key on the focused link give `Copy slug`
   and `Copy link`. The first item copies the ref. The second copies `url`,
   and with an empty `url` it is inactive.
3. `New task` shows Status, Title and Description. The default status is
   `Todo` when such a state is on the board. An empty title does not create a task.
   An empty description is allowed and is not sent. The priority is not sent.
4. A successful create inserts the returned item into the column of the chosen status
   and closes the form. An error keeps the draft.
5. In the preview, a Status change calls the update with `stateRef`. Success
   keeps the preview and shows the returned state. An error keeps the previous state.
6. The card, the row and the form do not change the status other than through the
   Status field of the form or the list in the preview.

### Required verification

The board renderer tests cover the link, the menu, the form, the default `Todo`,
an empty title, an empty description, create success and error, and status change
success and error. They do not need the Plane network. The sentences of `docs/UX-UI.md` §18 about a separate
ref and title and about a read-only preview are corrected
in the stages that introduce these behaviors.

### Sources

- The user's answers of 2026-10-11: status only in the preview; a form with
  Status, Title, Description and a default `Todo`; one link that opens
  the preview; a `Copy slug` and `Copy link` menu.
- `KanbanCreateInput`, `KanbanUpdatePatch` and `WorkItem.url` in
  `src/shared/ipc-contract.ts`.
- The Plane item address is built by the adapter in `adapters/plane/plane_adapter.py`
  (`issue_url`). The renderer copies the ready field.

## Kanban row and review amendment (user decision 2026-10-12)

This section replaces, in the "Kanban item editing amendment (user decision 2026-10-11)" section, the single underlined `ref title` link, the `kanban-item-link-<ref>` identifier and the sentence that the priority in the preview stays read-only. It does not change the `New task` form, the `Copy slug` and `Copy link` menu, the ban on dragging or the rule that the status changes only in the preview. Creating a task still does not send the priority.

A later decision of the same day keeps the whole-row highlight on hover. Hover underlines only the slug, the title, an enabled Start and a shown Resume. Only these elements have a click action.

Another decision of the same day removes the Board view and the List | Board switch. Only the list stays. The preview has two columns: the left one is three quarters wide and contains the ref, title and description, the right one is one quarter wide and contains Priority and Status. The Back button has the same style as Back to Projects and is in the header right after the Kanban label.

### Columns

1. On the list, the slug (`WorkItem.ref`) and the title are separate columns. At rest, no text is underlined. Hover underlines the slug, the title, an enabled Start and a shown Resume. The width of these controls is the width of the text, so a click outside the text does nothing.
2. The rows share the width of the slug column. The title is truncated.
3. Hover highlights the whole row. The underline is only on text that has an action.
4. A click, Enter and Space on the slug or on the title open the preview. A click on an enabled Start opens the launch confirmation. A click on a shown Resume opens the resume confirmation. A disabled Start, the priority text and the row background have no action and are not underlined.
5. The identifiers are `kanban-item-ref-<ref>` and `kanban-item-title-<ref>`.
6. The copy menu stays on the slug and on the title. It does not open on Start, Resume, the priority or the background.

### Priority in the preview

1. The preview has a Priority list: Urgent, High, Medium, Low, None, in the right column next to Status. The row shows the priority as text.
2. A change calls the existing `kanban:updateItem` with only `priority`. None sends `null`. An omitted field still changes nothing.
3. Success, error and the lock on a second change work the same as for Status. One preview save is in progress at a time, so Status and Priority do not overtake each other.
4. `KanbanUpdatePatch.priority` accepts a named priority or `null`. `KanbanCreateInput.priority` still does not accept `null`.
5. The Plane adapter treats a present `null` as `none`. A missing key leaves the priority unchanged.

### Text selection

1. The ref, title and description in the preview can be selected, despite `select-none` on `body`.
2. A right click outside a button and the list opens `Copy`. The item copies the selection from the moment the menu opened. An empty selection leaves it inactive.
3. Ctrl+C copies the current browser selection.

### Acceptance criteria

1. The row has a separate slug and title. Hover highlights the whole row and underlines the slug, the title, an enabled Start and a shown Resume. Only these elements handle a click. There is no Board view.
2. The priority changes only in the preview. The list does not have this control. Priority and Status are in the right column of the preview. This column is one quarter wide. Back has a border, the panel background and an icon, like Back to Projects, and is in the header right after the Kanban label.
3. None sends `priority: null`. A named priority sends that name and nothing else.
4. Selected preview text can be copied. An empty selection is not copied as a success.

## Kanban review Start and Resume buttons amendment (NEKODE-84)

An extension of the task preview (`ItemReview`) with launch and resume buttons, introduced in task NEKODE-84:

1. The task preview (`ItemReview`) has the Start and Resume controls (`ItemLaunchButtons`) in the right column, above the Priority and Status fields.
2. Start is always visible, and disabled when Resume is active for the given task (consistent with the list row).
3. Resume renders only for a task for which the batch handoff check confirmed that a linked file is available.
4. A click on Start opens the launch confirmation (`onStart(item)`), a click on Resume opens the resume confirmation (`onResume(item)`).
5. The visual style of the controls is consistent with the list row (`text-ink` with `hover:underline` for active actions).
6. The context menu for copying preview text does not open on a right click on the Start and Resume buttons.
7. The test identifiers of the controls are `kanban-item-start-<ref>` and `kanban-item-resume-<ref>`.

## Kanban task comments and completion amendment (NEKODE-85)

An extension of the task preview (`ItemReview`) with a comments section, and support for comments when closing a task, introduced in task NEKODE-85:

### Goal and scope

1. The task preview (`ItemReview` in `KanbanBoard.tsx`) shows a `Comments` section in the left column under the description (`Description`).
2. Without comments, the section shows the text `No comments.` (like `No description.`).
3. With comments, a list is shown where each comment has:
   - the author (display name, email or user identifier from the project member map),
   - the creation timestamp (formatted for reading),
   - the comment text (safe text converted from HTML by the adapter's parser).
4. Fetching comments:
   - Comments are fetched lazily (on demand) after the task preview (`ItemReview`) opens, through a new adapter action `listComments` with the `{ ref }` parameter and the IPC channel `kanban:getComments(projectId, ref)`, which returns `KanbanComment[]`.
   - This prevents a flood of HTTP requests (N+1) while the whole board loads (`listBoard`).
5. IPC contract types (`src/shared/ipc-contract.ts`):
   - `KanbanComment`: `{ id: string; author: string | null; text: string; createdAt: string | null }`.
   - A new channel in `IPC_CHANNEL`: `kanbanGetComments: 'kanban:getComments'`.
   - A method in `AppApi`: `kanbanGetComments(projectId: string, ref: string): Promise<KanbanComment[]>`.
6. The Plane adapter (`adapters/plane/plane_adapter.py`):
   - A new action `listComments(cfg, params)`: queries the Plane endpoint `/workspaces/{ws}/projects/{project_id}/work-items/{uuid}/comments/`, maps the author through `member_map(cfg)`, converts `comment_html` to readable text through `_DescriptionParser`, and returns an array of `{ id, author, text, createdAt }` objects.
7. Harness tools (`.agents/skills/kanban/` and `.agents/skills/task-close/`):
   - In `kanban_cli.py`: a new subcommand `comment <ref> <text>` (adds a comment through POST `/workspaces/{ws}/projects/{pid}/work-items/{uuid}/comments/` with `comment_html`).
   - In the `kanban` skill (`.agents/skills/kanban/SKILL.md`): documents the use of `comment <ref> <text>`.
   - In the task closing procedure (the `task-close` skill in `.agents/skills/task-close/SKILL.md`): a step is added in which, for tasks linked to Kanban (identified by the ref in the task name), the agent posts a comment that summarizes the main delivered changes (for example added/modified files, key delivery points) before closing.

### Acceptance criteria

1. `kanban:getComments` validates `projectId` and `ref`.
2. The Plane adapter's `listComments` action correctly reads the comments of the given task and returns normalized `KanbanComment` objects.
3. `ItemReview` in NeKode fetches and shows the task comments; the empty state shows `No comments.`.
4. `kanban_cli.py comment <ref> <text>` adds a comment to the task in Plane and confirms the creation.
5. The `task-close` skill tells the agent to add a summary comment to the Kanban task after verification passes.

## Kanban Start without sending amendment (NEKODE-99)

Decyzja użytkownika 2026-10-22: tekst trafia do pola promptu NeKode, nie do pola wejściowego agenta. Sekcja rozszerza "Kanban task launch amendment" (Start) oraz "Kanban review Start and Resume buttons amendment" (NEKODE-84). Zwykły Start, Resume i menu kopiowania zostają bez zmian.

### Cel i zakres

Użytkownik uruchamia agenta dla zadania tak jak przez Start, ale polecenie zadania nie jest wysyłane. Polecenie czeka w polu promptu nowego czatu; użytkownik je przegląda, uzupełnia i sam wysyła klawiszem Enter.

Poza zakresem: wpisywanie tekstu do terminala agenta, wykrywanie gotowości TUI agenta, zmiana treści polecenia Start, wariant bez wysyłania dla Resume, nowe pole profilu agenta.

### Menu przycisku Start

1. Prawy przycisk myszy na aktywnym Start oraz klawisz menu kontekstowego albo Shift+F10, gdy Start ma fokus, otwierają menu w każdym miejscu, gdzie jest Start: wiersz listy i podgląd zadania (`ItemReview`).
2. Menu ma dwie pozycje z angielskimi etykietami: `Start` i `Start without sending`. `Start` działa jak kliknięcie Start. `Start without sending` otwiera ten sam modal wyboru agenta w wariancie bez wysyłania.
3. Nieaktywny Start (widoczny Resume) nie otwiera menu. Escape, wybór pozycji i wskaźnik poza menu zamykają menu, tak jak menu kopiowania. Menu kopiowania podglądu nadal nie otwiera się na Start.

### Modal i uruchomienie

1. Wariant bez wysyłania ma tytuł `Start task without sending` i przycisk zatwierdzenia `Start without sending`. Wybór profilu, Cancel, Escape, Configure agents, stan pusty i komunikaty błędów działają jak w zwykłym Start.
2. Main wykonuje te same kontrole co Start (projekt, powiązanie adaptera, aktualność zadania przez `getItem`, profil) i tworzy dokładnie jeden czat z tą samą nazwą i tożsamością (`taskRef`, nazwa agenta).
3. Agent uruchamia się z argumentami interaktywnymi, jak w New Chat: `interactiveArgs`, gdy profil je ma, w przeciwnym razie argumenty profilu bez elementu `{prompt}` ([new-chat-agent-menu](../new-chat-agent-menu/spec.md#interactive-profile-arguments-nekode-78)). Argumenty procesu nie zawierają polecenia zadania.
4. Main buduje polecenie tą samą funkcją co Start (Start.5) i zwraca je w wyniku uruchomienia. Renderer nie składa polecenia.
5. Po udanym uruchomieniu NeKode aktywuje nowy czat i wstawia polecenie do jego pola promptu przez istniejący mechanizm wypełniania (`PromptInjection`), zastępując pustą wartość. Nic nie jest zapisywane do PTY. Enter albo Send wysyła tekst istniejącą ścieżką pola promptu.
6. Ustawienie `handoffResume.autoSend` nie wpływa na ten wariant.
7. Gdy proces agenta nie wystartuje, obowiązuje istniejące zachowanie wstrzymanego uruchomienia (held launch) i ponowienia. Polecenie trafia do pola promptu dopiero po udanym ponowieniu. Ponowienie używa trybu bez wysyłania.

### Dane i zgodność

- `kanban:launchTask` przyjmuje trzeci tryb `mode: 'draft'` z polami wspólnymi Start. Walidacja IPC i usługi odrzuca nieznane pola, tak jak dla `start`.
- `KanbanLaunchResult` zawiera opcjonalne `draftPrompt: string`, obecne tylko dla trybu `draft` przy `delivered: true`. Tryby `start` i `resume` nie zmieniają kształtu wyniku.
- Brak migracji danych i zmian profili. Uprawnienia jak w Start.

### Kryteria akceptacji

1. Prawy przycisk, klawisz menu i Shift+F10 na aktywnym Start w liście i podglądzie otwierają menu z `Start` i `Start without sending`; nieaktywny Start menu nie otwiera.
2. `Start` z menu zachowuje się jak kliknięcie Start.
3. `Start without sending` po zatwierdzeniu tworzy jeden czat, uruchamia profil bez polecenia w argv (z `interactiveArgs`, jeśli są) i wstawia polecenie Start do pola promptu tego czatu; do PTY nie trafia żaden zapis.
4. Polecenie w polu jest identyczne z poleceniem zwykłego Start dla tego samego zadania.
5. Błąd spawnu daje held launch; po udanym ponowieniu polecenie trafia do pola promptu.
6. Kontrakt IPC odrzuca `draft` z nadmiarowymi polami; `start` i `resume` działają bez zmian.

### Wymagana weryfikacja

- Testy jednostkowe usługi uruchomienia: argv trybu `draft` (z `interactiveArgs` i bez), zwrócone `draftPrompt` równe poleceniu Start, ponowienie.
- Testy walidacji IPC dla `mode: 'draft'`.
- Testy komponentów: menu Start (mysz, klawiatura, nieaktywny Start, podgląd), wariant modalu, wypełnienie pola promptu po uruchomieniu.
- Ręczna próba z Claude Code: wieloliniowe polecenie wysłane z pola promptu dociera do agenta jako jedna wiadomość. Jeżeli nie, wynik jest zgłaszany użytkownikowi przed zamknięciem zadania.
