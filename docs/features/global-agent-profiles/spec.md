# Global agent profiles and project opt-in

Status: Delivered (global profile library, project opt-in, one-line command, and the interactive-argument override).
Path: `docs/features/global-agent-profiles/spec.md`.

This document is the behavioral contract of the feature. It does not describe implementation progress.

## Goal

You configure how an agent starts once, in the app settings. In a project you only choose the available profiles and the default profile. Ready templates and one-line command editing replace building the argument array by hand in a form.

## Related requirements

- NEKODE-79: Global agent profiles, ready templates and project opt-in (work item `d23e517c-8d29-4762-8c46-d3e2971db59f`).
- User decision of 2026-10-14: a global profile library made from ready templates or custom configurations; a name and one command line; in a project, a choice of available profiles and a default among them; a new project has no selection, opt-in only. There is no inheritance of a global set.
- [Product requirements](../../product/requirements.md): agents are CLI processes, the interface is in English, and the app does not call model APIs directly.
- [Agent profiles and Start/Resume](../kanban-adapter-interface/spec.md#agent-profiles) and the [New Chat menu](../new-chat-agent-menu/spec.md).
- NEKODE-78 (work item `f7589e3c-daeb-47a2-af5f-552a78ff4d40`): [choosing interactive arguments in New Chat](../new-chat-agent-menu/spec.md#interactive-profile-arguments-nekode-78). The section below defines their configuration; the contract is not proof that the implementation was done.

The decision of 2026-10-14 replaces the per-project storage of profile definitions from 2026-10-07. This document owns the library, the templates, the form and the project assignments. The related contracts still own the launch gestures, task prompts, chat names and terminal lifecycle. The description of a global default agent in `docs/UX-UI.md` §23 does not introduce inheritance or a global default profile in this feature.

## Scope

- An `Agents` tab in App Settings: the profile library, adding from a template, adding a custom profile, editing, copying and deleting.
- A name and one `Command` field instead of `Executable` and `Argument N` rows, with an optional interactive-argument override for New Chat.
- An `Agents` tab in Project Settings: selecting the available profiles, choosing the default, and a `Manage agents` link to the library.
- Limiting the New Chat menu and the agent choice in Kanban Start/Resume to the profiles selected for the given project.
- Validation in main, local persistence and migration of existing configurations.

## Out of scope

- Automatic profile selection for new projects, inheritance and a global default profile.
- Automatically adding all templates to the library, installing CLIs, logging in and cloud sync.
- Direct model APIs, a shared provider/model catalog and storing API keys in NeKode.
- Per-project copies of definitions, overriding single profile fields and extra inheritance levels.
- Changing the New Chat left click, the project shell, Actions, the names of existing chats and running sessions.
- Automatic detection of prompt flags and rewriting existing profiles based on the agent name.

## Behavior

### Global library

1. The library is local to the installation and the app data directory. It is not a file in the project repository. You can open it without a selected project.
2. A new installation has an empty library. `Add agent` offers a ready template or `Custom`. A template is a proposed configuration; it becomes a profile only after saving.
3. The initial catalog covers `Codex CLI`, `Claude Code`, `OpenCode` and `Gemini CLI`, matching the CLI families named in the product requirements. Every template must have a verified interactive start and a verified task prompt handoff. An unverified template, or flags that change consent for operations, the sandbox or permissions, must not be added. If a required template depends on NEKODE-78, that dependency blocks the template's readiness instead of justifying a wrong command.
4. Choosing a template fills in the name and the complete command. The form has the same editing for a ready and a custom profile. Templates use the CLI's own configuration and default model, without forcing a model version. Per NEKODE-87 they propose the names `codex`, `claude`, `opencode` and `gemini` also on Windows, without detecting full paths on PATH or local npm packages. The terminal resolves the name at launch; an installation that needs a different command needs a profile edit.
5. `Custom` requires a name and a command. The help next to the field explains quotes and the `{prompt}` marker; it does not require creating separate argument rows.
6. Copying a profile creates an unsaved form with the same settings. Saving creates a new id and does not assign the copy to any project.
7. Editing a profile keeps its id and applies to the next launches in all assigned projects. The form explains this reach. Running processes keep the parameters they started with.
8. Names may repeat, and the id defines identity. The list also shows the command; profiles with identical names must be distinguishable without guessing the id. For migrated profiles, the name of the source project can be shown as helper information.
9. Deleting a profile that a project uses is rejected with information about where it is selected. You first clear it in those projects. Deleting an unused profile removes only the definition. It does not stop existing processes.

### Project opt-in

1. Every new project starts with an empty list of available profiles and `defaultId: null`, even when the global library is already configured. There is no `Use global default` option.
2. Project Settings shows the library profiles with checkboxes and a default choice among the selected ones only. It has no command editing and no adding of definitions.
3. Saving stores the set of ids and the default choice together. Cancelling the form changes nothing. The app does not automatically set the first selected profile as the default.
4. The default profile is optional, as in the previous contract. Without it, Start/Resume requires an explicit choice. Setting a default profile that is not selected in the project is a validation error.
5. Clearing the default profile clears the default choice in the same form and save. It does not pick another profile as a replacement.
6. Adding or copying a global profile never changes the set of any project. The new profile shows as not selected in the configuration.
7. `Manage agents` opens App Settings on Agents without losing the project context. On return, the list refreshes the definitions. The refresh does not overwrite unsaved choices and does not select new profiles.
8. An empty library points to adding a profile globally. A library with an empty project selection points to selecting profiles for the project. These states are not read errors.

### Launching

1. The New Chat menu and the Kanban modal show only the profiles selected in the given project. The order matches the order of profiles in the global library; the checkbox choice does not change it.
2. The project's default choice is used only where the previous Start/Resume contract used the default profile. It does not start an agent automatically and does not change the plain New Chat.
3. With an empty selection, `Configure agents` opens the project Agents tab. It does not create a chat or a process.
4. Main reads the current definition and the project assignment at every launch. The global existence of a profile alone does not allow launching it in a project through these actions.
5. The working directory stays the project directory. The new chat name, the spawn error rollback and the error transport stay consistent with the launch contracts.

### One-line command

1. The field is a notation for an executable and its arguments, not a shell script. The parser turns it into `executable` and `args`; main starts the process through argv. It does not type text into the terminal and does not pass it to `cmd /c` or PowerShell as a script.
2. Single and double quotes group arguments. Doubling the enclosing quote inside quoted text writes a literal quote. Backslashes are always literal, also directly before a closing quote. Inside quotes, a backtick with the letter n writes LF, a backtick with the letter r writes CR, and two backticks write one literal backtick. Other backtick sequences stay literal. This gives historical arguments that contain CR/LF a reversible one-line notation. An empty quoted argument is kept. There is no expansion of variables, globs or command substitution. An unclosed quote is an error. The parser, the serializer and the UI help use the same grammar.
3. Multi-line commands and unquoted shell operators (`|`, `||`, `&`, `&&`, `;`, `<`, `>`) are rejected with an explanation. These characters inside a quoted argument are data. There is no automatic fallback to running through a shell.
4. The previous prompt representation is kept: exactly one full `{prompt}` argument for Start/Resume; the prompt goes in its place as one argument, regardless of spaces, new lines and shell characters. The template inserts the marker itself. An argument fragment such as `prefix{prompt}` is invalid.
5. Format examples: `claude "{prompt}"` and `"C:\Tools\my-agent.exe" --model "my model" "{prompt}"`. They are syntax examples, not a promise that any CLI supports this interface.
6. Moving saved argv into the form and saving again without edits must give an identical executable and arguments, also for spaces, empty values, quotes and trailing backslashes.
7. A custom provider/model is configured according to what the chosen CLI supports: through parameters, its configuration file or a custom wrapper. NeKode does not interpret model names and does not promise that any provider works with any agent. A wrapper with a suitable interface can be started with the same single line. API keys are not put in the command; logging in stays on the CLI side.

### Interactive arguments (NEKODE-78)

1. The profile form has an `Override interactive arguments for New Chat` option, off by default for a profile without `interactiveArgs`. When on, it shows one `Interactive arguments` field. The field holds only arguments; the executable comes from `Command`. The help explains that the override applies only to New Chat, replaces the whole argument list and does not contain `{prompt}`.
2. The option turned off means no `interactiveArgs`. The option turned on with empty or whitespace text means `interactiveArgs: []`. Turning it off and saving removes the earlier override. The form keeps this distinction while editing and copying.
3. The field uses the same argv grammar as `Command`: quoting, literal backslashes, empty quoted arguments and the CR/LF encoding stay reversible. Unquoted operators, multi-line input and an unclosed quote are errors. There is no shell execution and no variable expansion.
4. In the canonical data and the `agentProfiles:put` input, the field has the optional type `string[]`. Its absence is valid, and so is an empty array. `null`, another field type, a non-string element, NUL and any argument that contains `{prompt}` are rejected. Validation covers IPC, the save service and reading saved profiles; a failed read does not become an empty library.
5. Reading after a restart, editing, copying and the existing profile migration keep the exact argument list when it is present. The optional field fits in the existing version 1 library document; it needs no new table and no SQLite schema migration.
6. Saving `Command` still requires exactly one `{prompt}` argument for Kanban Start/Resume. Interactive arguments do not change this contract, the profile selection in projects or running sessions. The rule for choosing argv at launch is defined by [New Chat](../new-chat-agent-menu/spec.md#interactive-profile-arguments-nekode-78).
7. This correction adds no Hermes/AGY templates and does not change the existing templates. An existing profile with a prompt flag needs the interactive arguments set explicitly. NeKode does not guess which flag belongs to the prompt.

## Business rules

- The profile definition is global, and availability and the default choice are per project. The project stores references, not copies of definitions.
- No selected profile is a valid state. Another agent must not be chosen automatically.
- Selected ids are unique and exist in the library, and a non-empty `defaultId` belongs to the selected set.
- Empty names, an empty executable, NUL, a wrong argument type and an invalid prompt are rejected before saving.
- Saving a project selection, deleting a profile and checking references must not leave partly changed data.
- The project list is a launch preference in NeKode, not a policy that limits manual terminal commands or the model choice inside a CLI.

## Authorization

A local single-user app, with no new roles. The renderer uses only the typed `window.app`; main validates the request, the existence of the project, the profile definition and the current assignment. Relying only on checkboxes or a list in the UI is not allowed.

## Data and API

- A global document in the existing `app_state`: a format version and ordered definitions with a stable id, name, executable and args. The single line is the editing format; argv stays the launch format and the canonical data, to avoid parsing the prompt twice.
- A project document: a format version, the selected ids and `defaultId`. It contains no executable and no args.
- IPC separates the library operations (read, save, delete) from reading and saving the project selection. Reading a project's effective profiles returns only selected, current definitions and a valid defaultId. Main does not accept a launch definition supplied by the renderer instead of an id.
- The implementation sets the exact names of the new channels and keys, keeping `src/shared/ipc-contract.ts` as the only source of the contract. Changes go through preload, validators, registration and services.
- Profiles and assignments survive an app restart. Deleting a project deletes its selection, but not the global profiles. Adding a directory again as a new project needs a new opt-in.
- Whole commands and arguments are not logged. The app does not write profiles to the project repository or to CLI configuration files.

### Migration

1. The migration covers the existing `project.agentProfiles:<projectId>` documents and runs only once for a given format, in a transaction. The next start does not recreate deleted profiles or restore cleared choices.
2. Every existing profile becomes a separate global definition, keeping its name, executable, exact argv and existing extra launch fields. Profiles are not merged by name or by identical command: they were independently editable before.
3. The id can be kept as long as it does not collide. On a collision, a new id is created together with an explicit mapping used in the assignment and defaultId. The source project can be stored as helper provenance to tell names apart.
4. For an existing project, only the profiles that belonged to it before are selected. The default profile and the order of that project's existing profiles stay the same. The migration arranges the global order so that the order in each project is kept, because profiles are not merged.
5. A project without profiles stays without profiles. The exception that keeps existing choices during the migration does not mean inheritance for new projects.
6. Validation of all migrated data comes before saving. A damaged document causes an explicit error with the project identifier, without clearing it or replacing it with an empty configuration. The original data stays available; the current read, which turns invalid JSON into an empty document, is not used as proof of a correct migration.
7. A failed migration rolls back all its writes and does not allow launching an agent from a partly moved configuration. Plain shell chats stay available. A successful migration removes the old documents as an active source, so that a later change is not overwritten.

## Edge cases

- A profile cleared or deleted after the menu was opened: main rejects the start and the UI refreshes the choice; no chat is created.
- A profile edited after the menu was opened: the next start uses the current definition and name; a running session is not modified.
- The library changed while the project selection is being edited: saving validates the ids again; an error does not clear the form or the previous configuration.
- The project changes during a read or save: a late response does not overwrite another project's form.
- Deleting the last selected profile: an empty selection and an empty default; no automatic replacement.
- A missing CLI: the profile can be saved before installation; the start returns the existing spawn error. Adding or saving a profile never starts a process.
- No configuration is distinguished from damaged data or a read error. Damage is not repaired with a silent empty result.

## Errors

A typed `AppError` for validation, a missing project/profile, a cleared profile and persistence errors. The UI shows an English message in the existing error surface and keeps the form and the previous save. A refused deletion names the projects where the profile is selected. A migration error is not an empty library. A start error does not replace the agent with another profile or a plain shell.

## Acceptance criteria

1. Without a selected project, you can open the global library and save a profile from a template or from a custom command in one field, without argument rows.
2. A template fills in a complete configuration; a profile can be edited and copied. None of these actions starts a CLI or selects it in a project.
3. A new project has an empty set and default choice even with a non-empty library; adding another profile globally does not change that.
4. Selecting only the `Claude - work` profile makes only this profile available in the New Chat menu and Kanban Start/Resume of this project. In another project the choice stays independent.
5. The default can only belong to the selected set; clearing it clears defaultId without automatically choosing a successor. An explicit absence of a default stays allowed.
6. The parser and serializer keep the exact argv for quoted paths, spaces, empty arguments, quotes and backslashes. The prompt stays one argument and is not run by a shell.
7. Profiles with a custom model/provider can be saved without a fixed model list, using the parameters or configuration of a supported CLI.
8. Editing a global profile affects future launches in the assigned projects, and a copied profile is independent. Sessions that are already running stay unchanged.
9. Deleting a selected profile is rejected without data changes; deleting a project does not delete a global profile.
10. The migration keeps separate definitions, assignments, default choices and exact commands; it is idempotent. An error in any document leaves no partial migration.
11. A profile that is no longer available is also rejected on a direct IPC request; no chat is created. A plain left click on New Chat still creates a chat with the project shell.
12. Reading after a restart restores the library and the choices. The required tests, lint and typecheck pass, and a Windows smoke confirms both launch modes for every delivered template.

## Required tests

- Services and persistence: global CRUD, independent project selections, opt-in, defaultId validation, refusing to delete a profile in use, atomic saves and cleaning up only the project assignment.
- Migration: a fresh database, several projects (including an empty one), repeated names and commands, id collisions, defaultId null, order, a second start after a later edit, invalid JSON and rollback of a save error.
- Parser: grouping with quotes, a Windows path with a trailing backslash, a literal quote, an empty argument, NUL, an unclosed quote, new lines, operators and a round trip of the exact argv. A prompt test with spaces, a new line and shell characters must prove that one argument is passed, without parsing it again.
- Renderer: both add entry points, no argument rows, copying, selection and default, no automatic selection, the unsaved form after a refresh, empty and error states, a project change during a response, keyboard and accessibility labels.
- Launching: only selected profiles, the current definition, a profile cleared after the menu was opened, no chat after a refusal/spawn failure; regression of the plain New Chat and the Start/Resume prompts.
- IPC: positive pass-through by preload, validation of every new field and refusal of a foreign sender. The assignment error is checked in main, independently of the UI.
- The real Windows app in an isolated userData: creating a profile, opting in two projects, a restart, and the interactive and task launch of the templates. A fixture CLI can prove the argv; template compatibility needs a separate smoke of the specific CLI. A missing CLI is reported as unverified, not as passed.

## Related SDD and ADR

[SDD: IPC boundary, Persistence, Terminal lifecycle](../../architecture/sdd.md#current-implementation-obligations). New ADR: none; the user decision is recorded in this contract.
