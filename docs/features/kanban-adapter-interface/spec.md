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

## Cached board rendering amendment (user decision 2026-10-06)

This amendment replaces the destructive loading behavior in Behaviour 14 and
extends AC14. It changes renderer presentation only; adapter protocol v1 and
`kanban:listBoard` continue to return a complete board snapshot.

- Cache the last successful board separately for each project for the lifetime
  of the current application session. Fetch lazily on its first activation.
  Returning from a chat, file, or another project shows the cached board
  immediately and starts one background refresh. Hidden boards do not poll.
- Manual Refresh uses the same background path. While a request is pending,
  keep the existing list, columns, and item review visible and usable. Show an
  accessible `Refreshing board...` status and disable duplicate refreshes.
  Without cached data, retain the initial loading state.
- Reconcile the returned snapshot by work-item `ref` and state `id`: add new
  entries, remove absent entries, and update changed fields and ordering.
  Preserve unchanged item identity and existing keyed DOM nodes where an item
  stays in the same group. Moving an item between states updates its group.
- Preserve the chosen List/Board view, scroll position, and open review across
  tab switches. A changed reviewed item updates in place; removing it returns
  to the selected view. No additional request is made for the review.
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
- Persistence: adapter+config key roundtrip; `projects:remove` cleanup; `kanban.adaptersDir` override.
- IPC contract: channel presence and typed payload roundtrips in the shared contract test style.
- Renderer (vitest): settings tab states — no adapters, adapter selected with dynamic fields, required validation, test in-progress/success/failure, "(missing)" adapter, directory override flow; board surface states — the default List view, the icon controls (Board view, List view, Refresh: icon buttons with accessible names, on the header's right side), columns and list with ref, title, and priority, item review with the full title and description, loading, error, empty, not-configured with Configure, refresh; the left-navigation Kanban tile and the top-strip Kanban tab (both present only for a bound project, the tile directly under the project name), and the return to the chat tab and a file tab.
- Fixture adapters (node scripts) serve as protocol doubles in vitest; the Python reference Plane adapter is verified manually against the user's Plane instance (documented steps in the task), not in vitest.

## Relevant SDD / ADR

- `docs/architecture/sdd.md` §6, §44 (typed IPC pattern, main-process services).
- ADR: none. The language-agnostic process-protocol decision (protocol v1: JSON over stdio, one process per request, manifest-declared invocation) is recorded in this spec; promote to an ADR if the architecture doc grows that mechanism.

## Kanban task launch amendment (user decision 2026-10-07)

Ta sekcja jest kontraktem NEKODE-28 zaakceptowanym przez użytkownika
2026-10-07. Akceptacja dotyczy specyfikacji. Sekcja zastępuje ograniczenie dotyczące akcji kart
w Goal i Non-goals oraz sposób
otwierania szczegółów z Behaviour 14 i AC14. Pozostały kontrakt adaptera,
w tym cached board rendering amendment, pozostaje obowiązujący.

### Cel i odbiorca

Użytkownik uruchamia pracę nad zadaniem z listy lub kolumn Kanbana w nowym
czacie wybranego agenta. Może też wznowić pracę z konkretnym handoffem
powiązanym z tym zadaniem. NeKode obsługuje konfigurację i uruchomienie;
Harness pozostaje niezależnym narzędziem agenta.

### Zakres i wyłączenia

- Lista i kolumny: osobne kontrolki tytułu, slugu, Start i Resume.
- Lista: wiersz wyższy o 50%. Kolumny: miejsce na przyciski bez narzucania
  wzrostu wysokości karty o 50%.
- Profile agentów w Project Settings, modal wyboru agenta i uruchomienie
  w nowym czacie z poleceniem dotyczącym wybranego zadania.
- Wyszukiwanie handoffów w istniejącym katalogu projektu i jawne przypisanie
  pliku, którego powiązania nie da się rozpoznać automatycznie.
- Poza zakresem: drag-and-drop, nowa lokalna encja Task, automatyczna zmiana
  statusu zadania w backendzie, worktrees, API modeli, instalowanie agentów,
  wznawianie wewnętrznego identyfikatora sesji CLI oraz zmiany Harness.
- Istniejący Resume na pasku akcji nadal działa według
  [handoff-resume-flow](../handoff-resume-flow/spec.md). Nowy Resume zadania
  ma odrębny przepływ, wymagający powiązanego pliku i tworzący nowy czat.

### Nawigacja i wygląd

1. Kliknięcie slugu (`WorkItem.ref`) lub tytułu otwiera istniejący widok
   szczegółów. Kliknięcie tła, priorytetu albo wolnego miejsca nie otwiera go.
   Hover i fokus wskazują konkretne kontrolki, zamiast sugerować aktywność
   całego wiersza lub karty. Start i Resume nie otwierają szczegółów.
2. Slug i tytuł są oddzielnymi kontrolkami dostępnymi z klawiatury. Nie wolno
   zagnieżdżać przycisków we wspólnym przycisku wiersza. Modal ma opis,
   obsługę Escape, utrzymanie fokusu wewnątrz i powrót fokusu po anulowaniu.
3. Docelowa minimalna wysokość jednoliniowego wiersza listy wynosi 1,5 jego
   wysokości sprzed zmiany. Bazową wysokość trzeba zmierzyć przed edycją
   przy domyślnym motywie i skali 100%; tolerancja wynosi 1 px. Zwiększenie
   paddingu o 50% samo w sobie nie spełnia tego warunku. Typografia
   12.6px / 14.7px, kolory, sortowanie, grupowanie i zwijanie grup zostają.
4. Start i Resume są stale widoczne w obu układach, także bez aktywnego
   czatu. Przy małej szerokości nie zasłaniają tytułu ani priorytetu;
   dopuszczalny jest osobny rząd przycisków. Stan backendu sam nie blokuje
   tych akcji. Etykiety interfejsu i generowane polecenia są angielskie.

### Profile agentów

Osobne profile w Project Settings są zaakceptowaną decyzją użytkownika
z 2026-10-07. Nie są listą wszystkich Actions i nie wykrywają agentów
automatycznie na podstawie nazw przycisków.

- Profil zawiera stabilny lokalny id, nazwę oraz konfigurację uruchomienia:
  executable i tablicę argumentów. W argumentach dokładnie jeden element
  `{prompt}` oznacza całe początkowe polecenie przekazane jako jeden argument.
  Profil jest przeznaczony dla interaktywnego CLI przyjmującego taki prompt.
  Wrapper może obsłużyć CLI o innym interfejsie, ale aplikacja go nie generuje.
- Project Settings pozwala dodawać, edytować i usuwać profile oraz ustawić
  profil domyślny. Bez profili modal pokazuje Configure agents; nie tworzy
  czatu. Formularz odrzuca pustą nazwę, executable i niepoprawny placeholder.
- Katalog pracy to katalog projektu, z którego pochodzi zadanie. Profile
  nie zmieniają globalnej konfiguracji shell ani istniejących Actions.
- Lista w modalu pokazuje nazwy profili i zaznacza domyślny. Użytkownik
  zatwierdza przyciskiem Start albo Resume. Brak wyboru blokuje zatwierdzenie.
  Usunięcie profilu domyślnego czyści domyślny wybór.

### Start

1. Start otwiera modal z ref i tytułem zadania oraz wyborem agenta. Cancel
   i Escape nie tworzą czatu ani procesu.
2. Po zatwierdzeniu aplikacja sprawdza istnienie projektu, bieżące powiązanie
   adaptera, aktualność zadania i wybranego profilu. Pobiera bieżący opis
   zadania przez adapter, aby nie wysyłać nieaktualnego opisu z cache.
3. Powstaje dokładnie jeden nowy czat tego projektu, widoczny w nawigacji.
   Aplikacja aktywuje powierzchnię czatu w istniejącym systemie zakładek.
   Nie przebudowuje systemu na osobną zakładkę górnego paska dla każdego czatu.
   Poprzedni czat i sesja Kanbana zachowują swój stan.
4. Wybrany agent uruchamia się w nowej sesji terminala, z początkowym
   poleceniem przekazanym przy uruchomieniu procesu. Aplikacja nie wpisuje
   promptu do shell przed startem agenta ani po stałym opóźnieniu.
5. Polecenie zaczyna się od `Work on task <ref>: <title>.`, następnie zawiera
   opis (albo informację o jego braku) i URL, jeśli adapter go zwraca.
   Zawiera także `Follow the project's instructions. Do not assume approval
   for actions that require it.` oraz informację o katalogu handoffów, jeżeli
   jest skonfigurowany. Zaleca zachowanie pełnego ref w nazwie przyszłego
   lokalnego rekordu i handoffu, zgodnie z instrukcjami projektu.
6. Zatwierdzenie oznacza uruchomienie i przekazanie polecenia, niezależnie od
   `handoffResume.autoSend`. Ta istniejąca opcja dotyczy paska akcji.
   Sukces uruchomienia nie oznacza wykonania zadania przez agenta.

### Powiązanie handoffu z zadaniem

Proponowany most między aplikacją i dowolnym narzędziem agenta opiera się
na plikach i ref zadania. NeKode nie importuje Harness, nie uruchamia
`taskctl`, nie czyta `.agents/.env` i nie modyfikuje szablonów ani rekordów
Harness. Samo `task_id` oznacza lokalny rekord i nie jest ref Kanbana.

1. Zakres wyszukiwania to skonfigurowany `project.handoffDir:<projectId>`.
   Ścieżka względna rozwiązuje się względem katalogu projektu, absolutna
   może wskazywać poza projekt. Skan jest płytki: regularne pliki `.md`,
   bez `README.md`, katalogów, archiwów w podkatalogach i dowiązań.
2. Preferowane jawne metadane to opcjonalne, płaskie pola frontmatter:
   `work_item_ref: NEKODE-28`, `work_item_id: <backend-native id>` oraz
   `work_item_adapter: <adapter id>`. Ref jest wymagany dla tego sposobu
   dopasowania; pozostałe pola, jeżeli obecne, muszą zgadzać się z zadaniem.
   To konwencja wymiany danych, nie wymaganie zmiany formatu Harness.
3. Dla plików bez tych metadanych pełny ref może być początkiem nazwy
   bez rozszerzenia: `nekode-28` albo `nekode-28-<opis>`. Porównanie ignoruje
   wielkość liter. `nekode-2` nie pasuje do `nekode-20`, `nekode-28` ani
   `old-nekode-2`. Ten sposób oznaczany jest w modalu jako `Filename match`.
   Jawne metadane wskazujące inne zadanie wykluczają dopasowanie po nazwie.
4. Plik o dowolnej innej nazwie można wskazać z listy skonfigurowanego
   katalogu przez `Link handoff`. Użytkownik widzi nazwę i ścieżkę przed
   potwierdzeniem. Przypisanie przechowuje NeKode, bez edycji pliku. Nie
   wolno przypisać pliku z metadanymi wskazującymi inne zadanie.
5. Jawne przypisanie ma pierwszeństwo przed kandydatami automatycznymi.
   Klucz wiązania obejmuje projectId, adapterId i backend-native item id;
   ref jest zachowany jako etykieta. Zmiana konfiguracji powiązania Kanbana
   unieważnia przypisania. Zmiana katalogu wymaga nowego sprawdzenia ścieżek.
6. Kandydaci automatyczni są sortowani po czasie modyfikacji malejąco,
   przy remisie po nazwie. Wszystkie pasujące pliki są widoczne; najnowszy
   może być zaznaczony, lecz użytkownik zatwierdza konkretny plik. Nazwa
   i `task_id` bez rozpoznawalnego ref nie powodują zgadywania po tytule
   zadania ani po dowolnej wzmiance w treści handoffu.

### Resume

1. Resume otwiera modal dla zadania i rozpoczyna odczyt jego handoffów.
   Bez katalogu pokazuje Configure handoffs. Bez dopasowań pokazuje
   `No linked handoff` i Link handoff. Nie przełącza się automatycznie
   na Start ani na polecenie Resume bez ścieżki.
2. Modal zawiera wybór konkretnego handoffu i tego samego rodzaju profil
   agenta co Start. Zatwierdzenie jest możliwe dopiero po zakończeniu
   wyszukiwania i wskazaniu istniejącego powiązanego pliku oraz profilu.
3. Tuż przed utworzeniem czatu main ponownie sprawdza plik, jego powiązanie
   i aktualną konfigurację. Usunięty, nieczytelny, podmieniony lub zmieniony
   po wyświetleniu plik wymaga odświeżenia wyboru. Nie powstaje wtedy czat.
4. Dalej obowiązuje przepływ Start, ale prompt zaczyna się od
   `Resume task <ref>: <title> from handoff <path>. Read the handoff first
   and reconcile it with the current repository state before continuing.`
   Zawiera aktualny opis i URL zadania oraz instrukcje projektu.
   Ścieżka jest względna względem projektu, jeśli plik leży wewnątrz niego;
   w przeciwnym razie absolutna. Jest danymi promptu, nie kodem shell.
5. Resume rozpoczyna nową sesję wybranego agenta z kontekstem pliku.
   Nie wymaga tego samego agenta, który zapisał handoff, ani starej sesji CLI.

### Dane, uprawnienia i zgodność

- Renderer korzysta z typowanego IPC. Main jest właścicielem odczytów plików,
  sprawdzania projektu, profili, powiązania zadania i uruchomienia procesu.
  Nie przyjmuje dowolnej ścieżki od renderer jako zaufanego źródła handoffu.
- Profile, domyślny wybór i jawne powiązania są ustawieniami lokalnymi per
  projekt w istniejącym `app_state`; ich usunięcie jest częścią usuwania
  projektu. Nie ma nowej encji Task ani migracji tabel projektów lub czatów.
- Kontrakt potrzebuje operacji listowania/zapisu profili, znajdowania i
  przypisania handoffów oraz uruchomienia zadania z profilem i opcjonalnym
  handoffem. Szczegółowe nazwy IPC i podział kodu należą do późniejszego planu.
- Tożsamość zadania używa istniejących WorkItem.id i WorkItem.ref; tytuł
  i opis mogą się zmieniać bez utraty jawnego przypisania.
- Odczyt metadanych jest ograniczony do frontmatter plików UTF-8 do 1 MiB.
  Plik większy lub niepoprawny ma widoczny powód odrzucenia. Renderer nie
  otrzymuje całej treści pliku. Wyszukiwanie następuje przy otwarciu Resume
  lub jawnym Refresh, bez skanowania dysku przy hover i bez stałego pollingu.
- Opis zadania, URL, ref i ścieżka nigdy nie są interpolowane jako kod shell.
  Executable i argumenty pochodzą z profilu wybranego przez użytkownika;
  prompt trafia jako pojedynczy argument procesu. Nie trafia do logów,
  komunikatów diagnostycznych ani poleceń publikowanych na Kanbanie.
  Argumenty procesu mogą być widoczne dla lokalnych narzędzi systemowych.
- NeKode waliduje powiązanie i możliwość odczytu. Zgodność handoffu z
  bieżącym stanem repozytorium sprawdza agent według instrukcji projektu;
  aplikacja nie traktuje wykrytego pliku jako zatwierdzenia planu.
- Dotychczasowe handoffs:list i Resume paska akcji zachowują swój kontrakt,
  w tym paste-only / auto-send. Nowe filtrowanie dotyczy wyłącznie Resume
  zadania. Protocol v1 adaptera nie wymaga zmiany.

### Błędy i wyścigi

- Brak katalogu, nieprawidłowe uprawnienia, błąd adaptera i brak executable
  mają osobne, widoczne komunikaty w odpowiednim modalu lub czacie.
  Nie ma zastępowania agenta innym profilem ani cichego pomijania błędu.
- Niepoprawne metadane jednego pliku nie ukrywają poprawnych kandydatów;
  modal pokazuje ostrzeżenie z nazwą odrzuconego pliku. Awaria odczytu
  katalogu nie jest prezentowana jako brak handoffów.
- Podczas zatwierdzania kontrolki są zablokowane. Podwójny klik lub Enter
  tworzy najwyżej jeden czat i proces dla tego zatwierdzenia. Po zakończeniu
  użytkownik może jawnie rozpocząć następny czat tego samego zadania.
- Anulowanie, zamknięcie modalu lub usunięcie projektu przed zatwierdzeniem
  unieważnia oczekujące odpowiedzi. Spóźniony skan innego projektu lub
  zadania nie może zmienić wyboru ani uruchomić procesu.
- Błąd po utworzeniu czatu pozostawia ten konkretny czat z czytelnym błędem
  i jawnym Retry. Retry nie tworzy dodatkowego czatu i nie ponawia w ciemno
  już dostarczonego promptu. Ponowne otwarcie aplikacji nie uruchamia zadania
  automatycznie ani nie odtwarza początkowego polecenia.

### Kryteria akceptacji

1. W obu widokach tylko tytuł i slug otwierają szczegóły. Tło, priorytet,
   Start i Resume nie otwierają szczegółów; klawiatura obsługuje każdą akcję.
2. Wysokość wiersza listy ma współczynnik 1,5 względem zapisanej wartości
   bazowej, z tolerancją 1 px. Przyciski pozostają czytelne w obu układach.
3. Dodany profil jest dostępny po ponownym otwarciu ustawień i restarcie;
   profil innego projektu nie pojawia się w modalu bieżącego projektu.
4. Anulowanie modalu Start nie tworzy sesji. Zatwierdzenie uruchamia wybrany
   profil w nowym czacie właściwego projektu z ref, tytułem i aktualnym opisem.
5. Bez profili albo przy błędzie walidacji nic się nie uruchamia. Prompt
   ze spacjami, cudzysłowami, nowymi liniami i znakami shell jest nadal
   pojedynczym argumentem i nie wykonuje dodatkowych poleceń.
6. Resume wykrywa jawne metadane i zgodne nazwy, odróżnia NEKODE-2 od
   NEKODE-20, respektuje sprzeczne metadane oraz ręczne przypisanie.
7. Kilka kandydatów wymaga zatwierdzenia konkretnego pliku. Plik o dowolnej
   nazwie może zostać jawnie przypisany bez zmiany jego zawartości.
8. Brak powiązanego pliku, brak konfiguracji albo błąd odczytu nie uruchamia
   Resume. Plik zmieniony lub usunięty po skanie blokuje zatwierdzenie.
9. Resume tworzy nowy czat wybranego profilu i przekazuje konkretną ścieżkę
   oraz ref zadania. Przypisanie nie przechodzi na inne powiązanie adaptera.
10. Podwójne zatwierdzenie nie duplikuje czatu; błąd i Retry nie duplikują
    procesu ani polecenia. Wynik spóźnionego skanu nie przechodzi między
    projektami. Istniejące czaty i zachowanie cache Kanbana działają dalej.
11. Funkcja działa bez Harness. Żaden przepływ nie zapisuje plików Harness,
    nie zmienia statusu zadania i nie uruchamia modelowego API.

### Wymagana weryfikacja

- Testy usług: zapis i izolacja profili; dopasowanie metadanych i granic ref
  w nazwach; konflikt metadanych; ręczne przypisania i ich unieważnianie;
  brak katalogu, odmowa odczytu, zły UTF-8, limit rozmiaru, dowiązania,
  ponowna walidacja pliku i usunięcie projektu.
- Testy IPC i uruchomienia: walidacja nadawcy i wejść; bieżące dane zadania;
  argv z dokładnie jednym promptem; błąd procesu, deduplikacja i Retry.
- Testy renderer: zakres kliknięcia, modal i fokus, brak profili, wybór
  agenta/pliku, anulowanie, stany ładowania i błędów, stale responses,
  izolacja projektu oraz zachowanie starego Resume i cache Kanbana.
- Weryfikacja rzeczywistej aplikacji Electron: pomiar wysokości wiersza,
  lista i kolumny przy wąskim panelu, otwarcie nowego czatu i start CLI
  w katalogu właściwego projektu z poprawnym promptem. Testowy lokalny
  CLI musi pokazać odebrane argumenty bez kontaktu z modelem. Osobny smoke
  wybranego skonfigurowanego agenta potwierdza przyjęcie promptu przez CLI;
  same testy jsdom nie dowodzą działania terminala.

### Źródła i zaakceptowane decyzje

- Bieżący wiersz i karta są jednym przyciskiem: `WorkItemButton` w
  `src/renderer/src/components/kanban/KanbanBoard.tsx:181`; wspólny hover
  pochodzi z `ITEM_BUTTON_CLASS` w tym pliku, linia 157.
- Istniejący katalog i listowanie bez treści: `HandoffsService.list` w
  `src/main/services/handoffs/handoffs-service.ts:84` oraz kontrakt
  [handoff-resume-flow](../handoff-resume-flow/spec.md).
- Nowy czat i aktywacja powierzchni: `handleCreateChat` w
  `src/renderer/src/App.tsx:1204`; uruchomienie istniejącej akcji w nowym
  terminalu: `src/main/services/action-service.ts:278`.
- Harness wymaga nazwy pliku zgodnej z lokalnym task_id:
  `.agents/scripts/handoff-status:85`. Template `.agents/templates/handoff.md`
  ma task_id, ale nie ma ref backendu. To uzasadnia oddzielne dopasowanie.
- [Product requirements](../../product/requirements.md), sekcja 3, traktują
  Kanban i handoffy powiązane z zadaniami jako post-MVP bez obowiązkowego
  Harness. Ten kontrakt realizuje taki kierunek bez lokalnej encji Task.
- Użytkownik zaakceptował 2026-10-07 całą specyfikację, w tym zasady
  dopasowania handoffów, ręczne przypisania, argv `{prompt}` oraz użycie
  istniejącej powierzchni czatu. Osobne profile w Project Settings były
  wcześniej zaakceptowaną decyzją tego samego dnia.
