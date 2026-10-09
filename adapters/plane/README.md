# Plane (CE) adapter for NeKode

NeKode reference adapter for **Plane Community Edition**. It implements the
NeKode kanban **adapter protocol v1** and lets NeKode read and change work
items from a Plane CE instance through the application's Kanban surface.

- Language/runtime: **Python 3.11+**, standard library only (`urllib`, `json`,
  `html`, `re`). No third-party packages.
- Process model: **one OS process per request**. NeKode writes exactly one JSON
  request object to the process's stdin and closes stdin; the adapter writes
  exactly one JSON response object to stdout and exits `0` for `ok: true` or
  `1` for `ok: false`. Diagnostics go to stderr only and are never parsed by
  the app.

The files in this directory:

| File | Purpose |
| --- | --- |
| `adapter.json` | Manifest read by NeKode: id `plane`, name `Plane (CE)`, protocol version 1, invocation `python plane_adapter.py`, and the config fields below. |
| `plane_adapter.py` | The adapter itself. |

## Prerequisite

A `python` executable (Python 3.11 or newer) must be available on `PATH`. The
manifest invokes `python plane_adapter.py` with the working directory set to
this adapter directory, so `plane_adapter.py` is resolved relative to
`adapter.json`.

## Installation

NeKode discovers adapters one level deep in its **adapters directory**. A
subdirectory containing a valid `adapter.json` is an adapter. There are two
ways to make this adapter visible:

**Option A — install into the app's adapters directory.** Copy this entire
`plane/` directory (both `adapter.json` and `plane_adapter.py`) into the app's
adapters directory so the result is:

```text
<userData>/kanban-adapters/plane/adapter.json
<userData>/kanban-adapters/plane/plane_adapter.py
```

`<userData>/kanban-adapters` is the default adapters directory. Project Settings
→ Kanban shows the stored adapters-directory override when one is set, or the
literal label `Default (application data folder)` when none is set (the
resolved default path is not rendered in the UI).

**Option B — run it directly from this repository.** Leave the directory here
and point NeKode at this repository's `adapters/` folder (the folder that
contains adapter subdirectories): in **Project Settings → Kanban**, use
**Browse** under the adapters directory and select this repository's
`adapters/` directory. NeKode re-scans immediately, and the adapter is listed
without copying any files.

## Configuration fields

The manifest declares four fields. NeKode renders them in Project Settings →
Kanban and passes their values to the adapter on every invocation.

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `PLANE_API_KEY` | secret | yes | Plane Personal Access Token used as the `X-API-Key` header. Masked in the UI; never shown again after saving. |
| `PLANE_WORKSPACE_SLUG` | string | yes | Workspace slug of the Plane workspace that owns the project. |
| `PLANE_BASE_URL` | string | no | Base URL of the Plane instance (scheme + host + optional port, e.g. `https://plane.example.com`), with no `/api/v1` suffix — the adapter appends `/api/v1`. Defaults to `http://localhost` when left empty. |
| `PLANE_PROJECT_ID` | string | yes | Plane project UUID, **or** a full Plane project web URL from which the adapter extracts the project id. **Convenience:** pasting a full project URL also supplies the base URL (and the workspace slug if `PLANE_WORKSPACE_SLUG` is still empty). This adapter does **not** resolve a project *identifier* (for example `NEKODE`); use the UUID or a project URL. |

### Secret handling

All field values — including `PLANE_API_KEY` — travel to the adapter **only
inside the `config` object of the JSON request on stdin**. Config values are
never placed on the command line (argv is world-readable on Windows), never in
environment variables, and never in the manifest. The adapter reads no
configuration from argv or the environment.

## Binding this adapter in NeKode

1. Open **Project Settings → Kanban**.
2. In the adapter selector, choose **`Plane (CE)`**.
3. Fill in the four fields. For a self-hosted instance set `PLANE_BASE_URL`
   and `PLANE_WORKSPACE_SLUG`; for a project, paste its UUID (or a full Plane
   project URL) into `PLANE_PROJECT_ID`.
4. Click **Save**. NeKode stores the adapter id and the field values for the
   project. (Re-saving without re-typing a stored secret keeps the old value.)
5. Click **Test connection**. This invokes the adapter's `test` action with the
   currently entered values; success is shown inline, and any failure is shown
   inline with the adapter's error message.
6. Select the project's **Kanban** tile or its top **Kanban** tab. List is the
   default view; the **Board view** icon switches to one column per state.
   Select an item to review its full title and description. See the
   [application contract](../../docs/features/kanban-adapter-interface/spec.md)
   for loading, refresh, and error behavior.

## State groups and aliases

NeKode's normalized state group enum is
`backlog | unstarted | started | completed | cancelled`. The adapter maps Plane's
`group` values to that enum:

- Plane groups are passed through when they already match the enum:
  `backlog`, `unstarted`, `started`, `completed`, `cancelled`.
- Plane's extra **`triage`** group is **folded into `backlog`**.
- Any other unrecognized group is also folded into `backlog`, and a warning is
  written to stderr. A response never carries a group outside the enum.

Where a state is referred to by name (for example when creating or updating an
item via `stateRef`), the adapter accepts either the concrete state name
(case-insensitive) or one of these group aliases:

| Alias | Group |
| --- | --- |
| `backlog` | `backlog` |
| `todo`, `unstarted` | `unstarted` |
| `in progress`, `in_progress`, `started` | `started` |
| `done`, `complete`, `completed` | `completed` |
| `cancelled`, `canceled` | `cancelled` |

## Actions

The adapter implements the protocol v1 actions:

- `test` — connection/credentials check; returns the connected user, workspace,
  project id and state count.
- `listStates` — the project's concrete states, normalized to
  `{ id, name, group, order }` and ordered by Plane `sequence`.
- `listItems` — work items, normalized to the `WorkItem` shape, optionally
  filtered by `stateId` or `stateGroup`.
- `getItem` — one work item by reference (a `PREFIX-<n>` ref or a UUID).
- `createItem` — create a work item.
- `updateItem` — patch an existing work item; only provided fields change.
  **Adapter extension:** passing `"dryRun": true` in `params` returns the
  computed `{ "dryRun": true, "method": "PATCH", "path": ..., "payload": ... }`
  without calling Plane.

## Error codes

On failure the adapter emits `{ "ok": false, "error": { "code", "message" } }`
and exits `1`. The code is one of:

| Code | Meaning |
| --- | --- |
| `auth` | Plane rejected the API key (HTTP 401) or denied access (HTTP 403). Check `PLANE_API_KEY` and workspace/project membership. |
| `network` | The Plane instance could not be reached — connection refused, DNS failure, or a request timeout. Check `PLANE_BASE_URL` and that the server is running. |
| `notFound` | Plane returned 404, or the named work item / state does not exist (including a malformed reference). Check `PLANE_WORKSPACE_SLUG`, `PLANE_PROJECT_ID`, and the reference. |
| `config` | A required config field is missing, or an argument is invalid (for example an unknown priority, state group, or a missing title/ref). |
| `internal` | Unexpected adapter error, an unreadable/JSON-invalid Plane response, an unmapped Plane API status, or a protocol-framing error (invalid/empty stdin, wrong `protocolVersion`, unknown action). |

## Smoke check

Run these from the repository root. They pipe one JSON request object into the
adapter exactly as NeKode does and show the raw response. In each case the
adapter must print **exactly one JSON object** to stdout and exit `1`.

```bash
# From the repository root.
cd adapters/plane

# (a) Unreachable backend -> ok:false, code "network", exit 1.
echo '{"protocolVersion":1,"action":"test","config":{"PLANE_API_KEY":"dummy","PLANE_WORKSPACE_SLUG":"dummy","PLANE_BASE_URL":"http://127.0.0.1:9/","PLANE_PROJECT_ID":"00000000-0000-0000-0000-000000000000"},"params":{}}' | python plane_adapter.py
echo "exit: $?"

# (b) Unsupported protocolVersion -> ok:false (typed protocol rejection), exit 1.
echo '{"protocolVersion":2,"action":"test","config":{"PLANE_API_KEY":"dummy","PLANE_WORKSPACE_SLUG":"dummy","PLANE_BASE_URL":"http://127.0.0.1:9/","PLANE_PROJECT_ID":"00000000-0000-0000-0000-000000000000"},"params":{}}' | python plane_adapter.py
echo "exit: $?"

# (c) Empty config -> ok:false, code "config", naming the missing required keys, exit 1.
echo '{"protocolVersion":1,"action":"test","config":{},"params":{}}' | python plane_adapter.py
echo "exit: $?"

cd ../..
```

Expected stdout shapes:

```json
{"ok": false, "error": {"code": "network", "message": "cannot reach Plane at <base> ..."}}
{"ok": false, "error": {"code": "internal", "message": "protocol error: unsupported protocolVersion 2 (expected 1)"}}
{"ok": false, "error": {"code": "config", "message": "missing required config: PLANE_API_KEY, PLANE_WORKSPACE_SLUG, PLANE_PROJECT_ID"}}
```
