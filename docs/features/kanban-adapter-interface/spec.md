# Kanban adapter interface: plugin discovery, project binding, normalized board data

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

Let NeKode read and change work items from an external Kanban backend (Plane today, others later) through user-provided adapter plugins, without building any backend knowledge into the application. The user drops adapters into one directory, binds one adapter per project in Project Settings, fills the adapter's declared config fields, and the application talks to that backend only through a versioned process protocol. This feature also ships the first real Kanban surface, reached from a `Kanban` tile under the project's name in the left navigation and a `Kanban` tab in the top tab strip. The tab is read-only and unstyled beyond the basics: a List | Board icon switch (List is the default), a grouped list or state columns, each item showing its ref, title, and priority, an item review with the full title and description, and a refresh icon on the header's right side. Drag-and-drop, card actions (Implement/Resume), and the visual design in UX-UI §26–30 remain later work.

## Related requirements

- UX-UI §26–30 (Kanban as a primary product surface, post-MVP) — this spec is its data layer.
- requirements.md §3 keeps functional Kanban out of MVP; this feature is the post-MVP integration groundwork (user decision 2026-10-04).
- First adapter target: Plane CE REST API — the same backend the harness Kanban CLI (`.agents/skills/kanban`) already uses, so its state-group and alias semantics carry over.

## Scope

- Shared: typed IPC contract additions (`kanban` namespace), normalized domain types (`KanbanState`, `WorkItem`, config-field types), `APP_STATE_KEY` entries and per-project key helpers.
- Main: adapter discovery (manifest scan), adapter host (spawn + stdio JSON protocol + timeout + kill), `KanbanService` facade behind IPC, per-project config persistence and cleanup on `projects:remove`.
- Renderer: Project Settings "Kanban" section — adapter select, dynamic config form driven by the adapter manifest (secret masking), Test connection, adapters directory display and override.
- Read-only board surface: a `Kanban` tile in the left navigation directly under the name of a project that has a stored Kanban binding, plus a `Kanban` tab in the top tab strip beside the chat and file tabs, both opening the board in that project's center surface. `kanban:listBoard` renders as a List view (the items grouped under the state names — the default) or a Board view (one column per state name); the view switch and the refresh control are icon controls on the header's right side, each with an accessible name. Each item shows its ref, truncated title, and priority. Opening an item shows a review with the full title and the description. No styling beyond minimal layout. No separate center-surface `Files | Kanban` view-switch strip is added.
- Reference adapter (Python, outside the app contract): a Plane adapter implementing protocol v1 against the Plane REST API, reusing the semantics of the harness `kanban_cli.py` (state groups, alias resolution, `.agents/.env`-compatible field names).

## Non-goals

- Drag-and-drop, card actions (Implement/Resume), and the visual design in UX-UI §26–30. Ref, title, priority, the list view, and the read-only item review are in scope; those later card actions are not.
- A separate center-surface `Files | Kanban` view-switch strip: the board is a `Kanban` tab in the existing top tab strip (beside the chat and file tabs) and a tile in the left navigation; no second, project-view tab pair is added.
- The full tabbed Project Settings rebuild: in this feature the Kanban settings render as their own tab/section inside the existing Project Settings dialog without reworking the dialog's other sections.
- Two-way automatic synchronization with a NeKode Task entity.
- Long-lived adapter daemons: every invocation is one process.
- Plugin signing, marketplace, or sandboxing beyond directory discovery and manifest validation.
- Bundling adapters with the app; adapters are always user-installed files.
- More than one bound adapter per project.
- Reading or writing the harness `.agents/.env` or project profile: NeKode stores its own per-project config (entering the API token twice is accepted for v1).

## Behaviour

1. Discovery: main scans the adapters directory — default `<userData>/kanban-adapters`, overridable via the app-level `kanban.adaptersDir` app_state key — one level deep. A subdirectory containing a valid `adapter.json` is an adapter; discovery happens on every `kanban:adaptersList` call, so adapters added while the app runs appear at the next settings open without restart. Invalid or missing manifests are skipped with a logged warning naming the path; remaining valid adapters are still listed. Duplicate adapter ids: the first in lexicographic directory-name order wins, later duplicates are skipped with a warning naming the skipped directory.
2. Manifest (`adapter.json`): `{ id, name, protocolVersion, invocation: { command, args? }, configSchema: [ { key, label, type, required?, options?, default? } ] }` where `type` is `string | secret | select | boolean`; `options` applies to `select`; `id` is kebab-case and unique. A manifest with `protocolVersion` other than `1` is rejected with a warning (no best-effort compatibility).
3. Invocation protocol v1: one process per request. Main spawns `invocation.command` + `invocation.args` (argv array, no shell) with cwd = the adapter directory, writes exactly one JSON request object to stdin, closes stdin, reads stdout to EOF, and expects exactly one JSON response object. Request: `{ protocolVersion, action, config, params }`. Response: `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. Exit code 0 must accompany `ok: true` and 1 `ok: false`; any other exit code, invalid UTF-8/JSON, more than one JSON value, or stdout above 10 MB is a typed protocol error. stderr is captured for diagnostics only (never parsed).
4. Actions and params:
   - `test` `{}` — connection/credentials check.
   - `listStates` `{}` — the backend's concrete states.
   - `listItems` `{ stateId?, stateGroup? }` — items across all states when both omitted.
   - `getItem` `{ ref }`.
   - `createItem` `{ title, description?, stateRef?, priority? }`.
   - `updateItem` `{ ref, title?, description?, stateRef?, priority? }` — patch semantics: only provided fields change.
   - `stateRef` accepts a concrete state name (case-insensitive) or a group alias (`backlog`, `todo`/`unstarted`, `in progress`/`started`, `done`/`completed`, `cancelled`) and is resolved by the adapter against its own states — the same semantics as the harness kanban CLI.
5. Timeout: main enforces a per-invocation timeout (30 s default) and kills the adapter's process tree; expiry produces a typed `timeout` error naming the adapter and action.
6. Config delivery: the request `config` object carries all stored field values, secrets included. No config values are placed on the command line (argv is world-readable on Windows) and no secrets go into environment variables or the manifest.
7. Project binding: the Project Settings Kanban section lists discovered adapters (name, id). Selecting one renders its `configSchema` as a form: `secret` inputs are masked and never rendered back after save, `select` renders a dropdown from `options`, `boolean` a checkbox, required fields are marked. Save stores the adapter id and field values; an empty non-secret field clears the stored value; a left-empty secret field keeps the stored secret. Deselecting (none) clears the binding but keeps stored field values. No selection = not configured.
8. Test connection: a button invokes the adapter's `test` action with the currently entered values (unsaved edits included, without persisting them). Success renders an inline confirmation; failure renders the typed error message inline in the section (not a toast).
9. Read path: `kanban:listBoard(projectId)` returns normalized `{ states, items }` via the adapter (`listStates` + `listItems`). Unconfigured project or missing adapter → typed validation error naming the project.
10. Write path: `kanban:createItem(projectId, input)` and `kanban:updateItem(projectId, ref, patch)` forward normalized inputs; the adapter's returned WorkItem is returned to the renderer unchanged.
11. `projects:remove` deletes the project's adapter and config keys (same rule as `project.handoffDir` cleanup).
12. The settings section shows the active adapters directory with a Browse button (`dialogs:pickDirectory`); confirming a directory persists it to `kanban.adaptersDir` and re-scans immediately.
13. The Kanban settings render as their own tab (label `Kanban`) inside the existing Project Settings dialog, separate from Configuration and Actions, without reworking those sections.
14. Board entry points: a project with a stored Kanban binding shows a `Kanban` tile in the left navigation directly under the project's name and a `Kanban` tab in the top tab strip beside the chat and file tabs; a project without a binding shows neither, and no separate center-surface `Files | Kanban` view-switch strip exists. The `Kanban` tab is present for as long as the project is bound and is not closable (it is a project view beside the chat tab, not a document), placed immediately after the chat tab. Selecting either entry point activates the `Kanban` tab, which renders `kanban:listBoard` in the center surface. The tab's header carries, on its right side, a List | Board icon switch and a refresh icon; all three are icon buttons with accessible names (`Board view`, `List view`, `Refresh`). List is the default: it shows the items in the adapter's state `order`, grouped under the state names. Board shows one plain column per state in that `order`, headed by the state name. On both, each item shows its `ref` (the Plane slug), its title truncated to the card or row, and its priority (`Urgent`, `High`, `Medium`, `Low`, or `None` when priority is null). Choosing an item opens a review in place of the board or list: the same ref and priority, the state name, the title wrapped in full, and the description (or `No description.` when the description is null or blank). Back returns to the current view. Choosing Board or List leaves the review for that view. The review uses the loaded board payload and does not call another action. Activating the tab triggers one lazy load; the refresh icon re-runs it. A refresh that drops the open item closes the review. Loading, typed-error, empty-board, and not-configured states are inline text (the not-configured state offers a button opening Project Settings on the Kanban tab, mirroring the Resume picker's Configure affordance). Selecting the chat tab or a file tab shows that surface instead; a content-selection gesture always activates the tab that shows it.

## Business rules

- Protocol version is exact-match: main speaks only `protocolVersion: 1`; a manifest or response declaring another version is a typed protocol error.
- `stateGroup` enum: `backlog | unstarted | started | completed | cancelled` (Plane's groups; parity with the harness CLI aliases). An adapter response containing a state or item outside the enum is a protocol violation.
- WorkItem shape: `{ ref, id, title, description|null, stateId, stateName, stateGroup, priority|null, assignee|null, url|null, updatedAt|null }`. `ref` is the adapter's stable human-readable reference (e.g. `NEKODE-16`); `id` is the backend-native id, opaque to the UI. `priority` normalizes to `urgent | high | medium | low | null`; `updatedAt` is ISO 8601 UTC or null.
- KanbanState shape: `{ id, name, group, order }` with `group` from the enum and `order` an integer sort key from the adapter.
- Storage: `project.kanbanAdapter:<projectId>` holds the adapter id; `project.kanbanConfig:<projectId>` holds the JSON object of field values. Missing or empty adapter key = unconfigured.
- Secret fields are write-only through the UI: `kanban:getConfig` returns `null` for every secret value plus the list of keys that have a stored value, so the UI can show "stored" without echoing the secret.
- Secret values are stored in the local SQLite `app_state` store as plain JSON — the same trust model as the harness `.agents/.env`; they leave the machine only toward the bound adapter process via stdin.
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
- `KanbanAdapterInfo { id, name, configSchema: KanbanConfigField[] }`; `KanbanConfigField { key, label, type: 'string'|'secret'|'select'|'boolean', required: boolean, options?: string[], default?: string | boolean }`.
- `KanbanCreateInput { title, description?, stateRef?, priority? }`; `KanbanUpdatePatch { title?, description?, stateRef?, priority? }`.
- `APP_STATE_KEY` addition: `kanbanAdaptersDir: 'kanban.adaptersDir'`; helpers `projectKanbanAdapterKey(projectId)`, `projectKanbanConfigKey(projectId)`.
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
13. Changing the adapters directory in settings persists `kanban.adaptersDir` and the list re-scans without restart.
14. A project with a stored Kanban binding shows a `Kanban` tile directly under its name in the left navigation and a `Kanban` tab in the top tab strip beside the chat and file tabs; a project without one shows neither, and no separate `Files | Kanban` view-switch strip exists. Selecting the tile or the tab shows the board in the center surface on its default List view (the items grouped in state order; each item shows its ref, truncated title, and priority), with a List | Board icon switch and a refresh icon on the header's right side; Board shows one column per state (state name as heading) and the item review shows the full title and the description. The refresh icon re-runs the load. Selecting the chat tab or a file tab returns to that surface. A bound-but-missing adapter surfaces the typed error inline; the not-configured inline state with a Configure button opening Project Settings on the Kanban tab renders when the board is shown for a project whose binding no longer resolves.
15. The Kanban section of Project Settings is reachable as its own tab labeled `Kanban`, without changing the existing Configuration or Actions sections' behavior.

## Required tests

- Manifest validation: happy path; each rejection rule (bad JSON, missing id, bad id format, unknown protocolVersion, bad config field type); duplicate-id resolution order.
- Adapter host: argv correctness and cwd; stdin request framing (single object, stdin closed); single-JSON stdout parsing; `ok:false` mapping; exit-code violations; protocol violations (no output, garbage, two objects, oversized stdout, non-UTF8); timeout kill with no orphan; ENOENT mapping; stderr captured but unparsed.
- Secret handling: `getConfig` masking plus `secretKeys`; setConfig keep-secret rule (empty secret field) and clear-on-empty rule (non-secret).
- Persistence: adapter+config key roundtrip; `projects:remove` cleanup; `kanban.adaptersDir` override.
- IPC contract: channel presence and typed payload roundtrips in the shared contract test style.
- Renderer (vitest): settings tab states — no adapters, adapter selected with dynamic fields, required validation, test in-progress/success/failure, "(missing)" adapter, directory override flow; board surface states — the default List view, the icon controls (Board view, List view, Refresh: icon buttons with accessible names, on the header's right side), columns and list with ref, title, and priority, item review with the full title and description, loading, error, empty, not-configured with Configure, refresh; the left-navigation Kanban tile and the top-strip Kanban tab (both present only for a bound project, the tile directly under the project name), and the return to the chat tab and a file tab.
- Fixture adapters (node scripts) serve as protocol doubles in vitest; the Python reference Plane adapter is verified manually against the user's Plane instance (documented steps in the task), not in vitest.

## Relevant SDD / ADR

- `docs/architecture/sdd.md` §6, §44 (typed IPC pattern, main-process services).
- ADR: none. The language-agnostic process-protocol decision (protocol v1: JSON over stdio, one process per request, manifest-declared invocation) is recorded in this spec; promote to an ADR if the architecture doc grows that mechanism.
