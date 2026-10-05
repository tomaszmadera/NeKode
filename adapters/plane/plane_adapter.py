#!/usr/bin/env python3
"""Plane (Community Edition) reference adapter for NeKode kanban protocol v1.

One process per request. stdin carries exactly one JSON request object followed
by EOF; stdout carries exactly one JSON response object and nothing else; the
process exits 0 for `ok: true` and 1 for `ok: false`. Diagnostics go to stderr,
which the host never parses. All configuration arrives in the request `config`
object -- nothing is read from argv or the environment (spec Behaviour 6).

Endpoints, state-group handling and alias semantics mirror the harness
`.agents/skills/kanban/scripts/kanban_cli.py` reference. Standard library only
(urllib). No third-party imports.
"""

from __future__ import annotations

import html
import json
import re
import sys
import traceback
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

PROTOCOL_VERSION = 1
HTTP_TIMEOUT = 20
PER_PAGE = 100

# spec KanbanStateGroup enum. Plane additionally exposes the `triage` group,
# which is not part of the normalized enum; it folds into `backlog` (documented
# in README.md). Any other unknown group also folds to `backlog` with a stderr
# warning, so a response can never carry a group outside the enum.
STATE_GROUPS = ("backlog", "unstarted", "started", "completed", "cancelled")
PLANE_GROUP_FOLD = {"triage": "backlog"}

# stateRef group aliases (spec Behaviour 4), same set the harness CLI accepts.
GROUP_ALIASES = {
    "backlog": "backlog",
    "todo": "unstarted",
    "unstarted": "unstarted",
    "in progress": "started",
    "in_progress": "started",
    "started": "started",
    "done": "completed",
    "complete": "completed",
    "completed": "completed",
    "cancelled": "cancelled",
    "canceled": "cancelled",
}

# spec WorkItem.priority enum (Plane's `none` normalizes to null).
PRIORITIES = ("urgent", "high", "medium", "low")

DEFAULT_BASE_URL = "http://localhost"

PLANE_URL_PATTERN = re.compile(
    r"^(?P<base>https?://[^/]+)/(?P<ws>[^/]+)/projects/(?P<project>[0-9a-fA-F-]+)(?:/.*)?$"
)

# Per-process memo (one process = one request); never shared across requests.
_cache: dict[str, Any] = {}


# Protocol stream encodings, pinned to UTF-8 once at startup (see
# pin_utf8_streams). stdout must carry the exact UTF-8 bytes of the single
# response object -- the host decodes stdout with a fatal UTF-8 decoder -- and
# a stderr diagnostic must never raise on a character the locale code page
# cannot encode. `ensure_ascii=False` stays, so the stdout bytes are real
# UTF-8 rather than \uXXXX escapes.
_STDOUT_UTF8 = False
_STDERR_UTF8 = False


def _reconfigure_utf8(stream: Any) -> bool:
    reconfigure = getattr(stream, "reconfigure", None)
    if reconfigure is None:
        return False
    try:
        reconfigure(encoding="utf-8", errors="strict")
        return True
    except (ValueError, OSError):
        return False


def pin_utf8_streams() -> None:
    """Pin sys.stdout and sys.stderr to UTF-8 once, before any output."""
    global _STDOUT_UTF8, _STDERR_UTF8
    _STDOUT_UTF8 = _reconfigure_utf8(sys.stdout)
    _STDERR_UTF8 = _reconfigure_utf8(sys.stderr)


def _write_text(stream: Any, text: str, pinned: bool) -> None:
    if pinned:
        stream.write(text)
        stream.flush()
        return
    # reconfigure unavailable: write real UTF-8 bytes to the binary buffer.
    buffer = getattr(stream, "buffer", None)
    if buffer is not None:
        buffer.write(text.encode("utf-8"))
        buffer.flush()
        return
    stream.write(text)
    stream.flush()


def eprint(*args: Any) -> None:
    try:
        _write_text(sys.stderr, " ".join(str(arg) for arg in args) + "\n", _STDERR_UTF8)
    except Exception:  # noqa: BLE001 - diagnostics must never break the protocol
        pass


class AdapterError(Exception):
    """Adapter-reported failure carrying one of the protocol's error codes."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


def load_config(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise AdapterError("config", "request config must be an object")

    def get(key: str) -> str:
        value = raw.get(key)
        return value.strip() if isinstance(value, str) else ""

    base_url = get("PLANE_BASE_URL") or DEFAULT_BASE_URL
    workspace = get("PLANE_WORKSPACE_SLUG")
    project = get("PLANE_PROJECT_ID")
    api_key = get("PLANE_API_KEY")

    # Convenience parity with the harness CLI: PROJECT_ID may be a Plane web
    # URL, which also supplies base URL and workspace.
    if project:
        match = PLANE_URL_PATTERN.match(project)
        if match:
            base_url = match.group("base")
            workspace = workspace or match.group("ws")
            project = match.group("project")

    missing = [
        name
        for name, value in (
            ("PLANE_API_KEY", api_key),
            ("PLANE_WORKSPACE_SLUG", workspace),
            ("PLANE_PROJECT_ID", project),
        )
        if not value
    ]
    if missing:
        raise AdapterError(
            "config",
            "missing required config: " + ", ".join(missing),
        )

    base_url = base_url.rstrip("/")
    return {
        "base_url": base_url,
        "api_base": base_url + "/api/v1",
        "api_key": api_key,
        "workspace": workspace,
        "project": project,
    }


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def _http_error(exc: urllib.error.HTTPError) -> AdapterError:
    detail = ""
    try:
        raw = exc.read()
        data = json.loads(raw.decode("utf-8")) if raw else None
        if isinstance(data, dict):
            detail = str(data.get("detail") or data.get("error") or "")
            if not detail:
                detail = json.dumps(data, ensure_ascii=False)[:300]
        elif data is not None:
            detail = json.dumps(data, ensure_ascii=False)[:300]
    except (OSError, ValueError, UnicodeDecodeError):
        detail = ""
    suffix = f": {detail}" if detail else ""

    code = exc.code
    if code == 401:
        return AdapterError("auth", f"Plane rejected the API key (401){suffix}")
    if code == 403:
        return AdapterError(
            "auth",
            "Plane denied access (403)"
            f"{suffix} - check the API key and workspace/project membership",
        )
    if code == 404:
        return AdapterError(
            "notFound",
            "Plane resource not found (404)"
            f"{suffix} - check PLANE_WORKSPACE_SLUG and PLANE_PROJECT_ID",
        )
    return AdapterError("internal", f"Plane API error {code}{suffix}")


def api_request(
    cfg: dict[str, Any],
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
) -> tuple[int, Any]:
    url = cfg["api_base"] + path
    if params:
        query = [(k, str(v)) for k, v in params.items() if v is not None]
        if query:
            url += "?" + urllib.parse.urlencode(query)

    body: bytes | None = None
    headers = {
        "X-API-Key": cfg["api_key"],
        "Accept": "application/json",
        "User-Agent": "nekode-plane-adapter/1",
    }
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
            raw = response.read()
            if not raw:
                return response.status, None
            return response.status, json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise _http_error(exc) from None
    except TimeoutError:
        raise AdapterError(
            "network", f"request to Plane timed out after {HTTP_TIMEOUT}s"
        ) from None
    except urllib.error.URLError as exc:
        reason = exc.reason
        if isinstance(reason, TimeoutError) or "timed out" in str(reason).lower():
            raise AdapterError(
                "network", f"request to Plane timed out after {HTTP_TIMEOUT}s"
            ) from None
        raise AdapterError(
            "network", f"cannot reach Plane at {cfg['base_url']}: {reason}"
        ) from None
    except (ValueError, UnicodeDecodeError) as exc:
        raise AdapterError("internal", f"invalid JSON from Plane: {exc}") from None


def _results(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [entry for entry in data if isinstance(entry, dict)]
    if isinstance(data, dict):
        return [entry for entry in (data.get("results") or []) if isinstance(entry, dict)]
    return []


# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------


def plane_group(value: Any) -> str:
    group = str(value or "").strip().lower()
    group = PLANE_GROUP_FOLD.get(group, group)
    if group not in STATE_GROUPS:
        eprint(f"warning: folding unknown Plane state group {value!r} to 'backlog'")
        return "backlog"
    return group


def normalize_priority(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    low = value.strip().lower()
    return low if low in PRIORITIES else None


def to_plane_priority(value: Any) -> str:
    low = str(value).strip().lower() if value is not None else "none"
    if low in PRIORITIES:
        return low
    if low in ("none", "", "null"):
        return "none"
    raise AdapterError(
        "config",
        f"invalid priority {value!r} (expected urgent|high|medium|low|null)",
    )


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def normalize_updated_at(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        stamp = datetime.fromisoformat(text)
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def text_to_html(text: str) -> str:
    parts = []
    for paragraph in text.strip().split("\n\n"):
        clean = html.escape(paragraph.strip()).replace("\n", "<br/>")
        if clean:
            parts.append(f"<p>{clean}</p>")
    return "".join(parts)


def description_of(issue: dict[str, Any]) -> str | None:
    for key in ("description_stripped", "description_html", "description"):
        value = issue.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _looks_like_uuid(value: str) -> bool:
    return len(value) == 36 and value.count("-") == 4


def issue_url(cfg: dict[str, Any], project_id: str, issue_id: Any) -> str | None:
    if not cfg["base_url"] or not cfg["workspace"] or not project_id or not issue_id:
        return None
    return f"{cfg['base_url']}/{cfg['workspace']}/projects/{project_id}/issues/{issue_id}/"


# ---------------------------------------------------------------------------
# Plane reads (cached per process)
# ---------------------------------------------------------------------------


def states_for(cfg: dict[str, Any], project_id: str) -> list[dict[str, Any]]:
    cache = _cache.setdefault("states", {})
    if project_id not in cache:
        _, data = api_request(
            cfg,
            "GET",
            f"/workspaces/{cfg['workspace']}/projects/{project_id}/states/",
        )
        states = _results(data)
        states.sort(key=lambda s: (_num(s.get("sequence")), str(s.get("name") or "")))
        cache[project_id] = states
    return cache[project_id]


def identifier_for(cfg: dict[str, Any], project_id: str) -> str:
    cache = _cache.setdefault("identifiers", {})
    if project_id not in cache:
        identifier = ""
        try:
            _, data = api_request(
                cfg, "GET", f"/workspaces/{cfg['workspace']}/projects/{project_id}/"
            )
            if isinstance(data, dict) and data.get("identifier"):
                identifier = str(data["identifier"])
        except AdapterError as exc:
            eprint(f"warning: could not read project identifier: {exc.message}")
        cache[project_id] = identifier
    return cache[project_id]


def member_map(cfg: dict[str, Any]) -> dict[str, str]:
    if "members" not in _cache:
        mapping: dict[str, str] = {}
        try:
            _, data = api_request(
                cfg, "GET", f"/workspaces/{cfg['workspace']}/members-lite/"
            )
            for member in _results(data):
                if member.get("id"):
                    mapping[str(member["id"])] = str(
                        member.get("display_name") or member.get("email") or member["id"]
                    )
        except AdapterError as exc:
            eprint(f"warning: could not read workspace members: {exc.message}")
        _cache["members"] = mapping
    return _cache["members"]


def fetch_items(cfg: dict[str, Any], project_id: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        params: dict[str, Any] = {"per_page": PER_PAGE}
        if cursor:
            params["cursor"] = cursor
        _, data = api_request(
            cfg,
            "GET",
            f"/workspaces/{cfg['workspace']}/projects/{project_id}/work-items/",
            params=params,
        )
        if isinstance(data, list):
            items.extend(entry for entry in data if isinstance(entry, dict))
            break
        if not isinstance(data, dict):
            break
        items.extend(_results(data))
        next_cursor = data.get("next_cursor")
        if data.get("next_page_results") and next_cursor:
            cursor = str(next_cursor)
        else:
            break
    return items


def resolve_issue_identity(
    cfg: dict[str, Any], ref: str
) -> tuple[str, str, dict[str, Any] | None]:
    """Resolve a ref (UUID or PREFIX-<n>) to (uuid, project_id, raw_issue|None)."""
    ref = ref.strip()
    if "-" in ref and not _looks_like_uuid(ref):
        prefix, _, seq = ref.rpartition("-")
        if not seq.isdigit():
            raise AdapterError(
                "notFound",
                f"invalid work item reference {ref!r} (expected a UUID or PREFIX-<n>)",
            )
        _, data = api_request(
            cfg, "GET", f"/workspaces/{cfg['workspace']}/work-items/{prefix.upper()}-{seq}/"
        )
        if not isinstance(data, dict) or not data.get("id"):
            raise AdapterError("notFound", f"work item {ref!r} not found")
        return str(data["id"]), str(data.get("project") or cfg["project"]), data
    return ref, str(cfg["project"]), None


# ---------------------------------------------------------------------------
# Mapping to the protocol shapes
# ---------------------------------------------------------------------------


def map_state(state: dict[str, Any], order: int) -> dict[str, Any]:
    return {
        "id": str(state.get("id") or ""),
        "name": str(state.get("name") or ""),
        "group": plane_group(state.get("group")),
        "order": int(order),
    }


def map_issue(
    cfg: dict[str, Any],
    issue: dict[str, Any],
    states_by_id: dict[str, dict[str, Any]],
    project_id: str,
) -> dict[str, Any]:
    state_id = str(issue.get("state") or "")
    state = states_by_id.get(state_id)
    sequence = issue.get("sequence_id")
    identifier = identifier_for(cfg, project_id)
    if identifier and sequence is not None:
        ref = f"{identifier}-{sequence}"
    elif sequence is not None:
        ref = str(sequence)
    else:
        ref = str(issue.get("id") or "")

    assignees = issue.get("assignees") or []
    assignee: str | None = None
    if assignees:
        first = str(assignees[0])
        assignee = member_map(cfg).get(first, first) or None

    return {
        "ref": ref,
        "id": str(issue.get("id") or ""),
        "title": str(issue.get("name") or ""),
        "description": description_of(issue),
        "stateId": state_id or "unassigned",
        "stateName": str(state.get("name") or "") if state else "Unassigned",
        "stateGroup": plane_group(state.get("group")) if state else "backlog",
        "priority": normalize_priority(issue.get("priority")),
        "assignee": assignee,
        "url": issue_url(cfg, project_id, issue.get("id")),
        "updatedAt": normalize_updated_at(issue.get("updated_at")),
    }


def map_single_issue(cfg: dict[str, Any], issue: Any, project_id: str) -> dict[str, Any]:
    if not isinstance(issue, dict) or not issue.get("id"):
        raise AdapterError("internal", "Plane did not return a work item object")
    states = states_for(cfg, project_id)
    states_by_id = {str(state.get("id")): state for state in states}
    return map_issue(cfg, issue, states_by_id, project_id)


# ---------------------------------------------------------------------------
# stateRef resolution
# ---------------------------------------------------------------------------


def resolve_state_ref(cfg: dict[str, Any], project_id: str, ref: str) -> str:
    states = states_for(cfg, project_id)
    low = ref.strip().lower()
    group = GROUP_ALIASES.get(low, low)
    if group in STATE_GROUPS:
        candidates = [s for s in states if plane_group(s.get("group")) == group]
        if not candidates:
            raise AdapterError("notFound", f"no state in group {group!r}")
        for state in candidates:
            if state.get("default"):
                return str(state["id"])
        return str(candidates[0]["id"])
    for state in states:
        if str(state.get("name") or "").lower() == low:
            return str(state["id"])
    known = ", ".join(str(state.get("name")) for state in states) or "(none)"
    raise AdapterError("notFound", f"state {ref!r} not found; known states: {known}")


def normalize_group_param(value: Any) -> str:
    low = str(value).strip().lower()
    group = GROUP_ALIASES.get(low, low)
    if group not in STATE_GROUPS:
        raise AdapterError(
            "config",
            f"unknown stateGroup {value!r} (expected backlog|unstarted|started|completed|cancelled)",
        )
    return group


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------


def action_test(cfg: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    _, me = api_request(cfg, "GET", "/users/me/")
    states = states_for(cfg, cfg["project"])
    user = ""
    if isinstance(me, dict):
        user = str(me.get("display_name") or me.get("email") or me.get("id") or "")
    return {
        "connected": True,
        "user": user,
        "workspace": cfg["workspace"],
        "projectId": cfg["project"],
        "stateCount": len(states),
    }


def action_list_states(cfg: dict[str, Any], params: dict[str, Any]) -> list[dict[str, Any]]:
    states = states_for(cfg, cfg["project"])
    return [map_state(state, index) for index, state in enumerate(states)]


def action_list_items(cfg: dict[str, Any], params: dict[str, Any]) -> list[dict[str, Any]]:
    project_id = cfg["project"]
    states = states_for(cfg, project_id)
    states_by_id = {str(state.get("id")): state for state in states}
    items = fetch_items(cfg, project_id)

    state_id = params.get("stateId")
    state_group = params.get("stateGroup")
    if state_id:
        items = [item for item in items if str(item.get("state")) == str(state_id)]
    elif state_group:
        wanted = normalize_group_param(state_group)
        allowed = {
            sid
            for sid, state in states_by_id.items()
            if plane_group(state.get("group")) == wanted
        }
        items = [item for item in items if str(item.get("state")) in allowed]

    return [map_issue(cfg, item, states_by_id, project_id) for item in items]


def action_get_item(cfg: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    ref = str(params.get("ref") or "").strip()
    if not ref:
        raise AdapterError("config", "getItem requires a ref")
    uuid, project_id, raw = resolve_issue_identity(cfg, ref)
    if raw is None:
        _, raw = api_request(
            cfg,
            "GET",
            f"/workspaces/{cfg['workspace']}/projects/{project_id}/work-items/{uuid}/",
        )
    return map_single_issue(cfg, raw, project_id)


def action_create_item(cfg: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    title = str(params.get("title") or "").strip()
    if not title:
        raise AdapterError("config", "createItem requires a non-empty title")

    payload: dict[str, Any] = {"name": title}
    if params.get("description") is not None:
        payload["description_html"] = text_to_html(str(params["description"]))
    if params.get("stateRef") is not None:
        payload["state"] = resolve_state_ref(cfg, cfg["project"], str(params["stateRef"]))
    if params.get("priority") is not None:
        payload["priority"] = to_plane_priority(params["priority"])

    path = f"/workspaces/{cfg['workspace']}/projects/{cfg['project']}/work-items/"
    _, data = api_request(cfg, "POST", path, payload=payload)
    return map_single_issue(cfg, data, cfg["project"])


def action_update_item(cfg: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    ref = str(params.get("ref") or "").strip()
    if not ref:
        raise AdapterError("config", "updateItem requires a ref")

    uuid, project_id, _ = resolve_issue_identity(cfg, ref)

    payload: dict[str, Any] = {}
    if params.get("title") is not None:
        payload["name"] = str(params["title"])
    if params.get("description") is not None:
        payload["description_html"] = text_to_html(str(params["description"]))
    if params.get("stateRef") is not None:
        payload["state"] = resolve_state_ref(cfg, project_id, str(params["stateRef"]))
    if params.get("priority") is not None:
        payload["priority"] = to_plane_priority(params["priority"])
    if not payload:
        raise AdapterError("config", "updateItem requires at least one field to change")

    path = f"/workspaces/{cfg['workspace']}/projects/{project_id}/work-items/{uuid}/"
    if params.get("dryRun") is True:
        return {"dryRun": True, "method": "PATCH", "path": path, "payload": payload}
    _, data = api_request(cfg, "PATCH", path, payload=payload)
    return map_single_issue(cfg, data, project_id)


ACTIONS = {
    "test": action_test,
    "listStates": action_list_states,
    "listItems": action_list_items,
    "getItem": action_get_item,
    "createItem": action_create_item,
    "updateItem": action_update_item,
}


# ---------------------------------------------------------------------------
# Protocol framing
# ---------------------------------------------------------------------------


def read_request() -> dict[str, Any]:
    raw = sys.stdin.buffer.read()
    if not raw:
        raise AdapterError("internal", "protocol error: no request received on stdin")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise AdapterError("internal", f"protocol error: stdin is not valid UTF-8 ({exc})") from None
    text = text.strip()
    if not text:
        raise AdapterError("internal", "protocol error: empty request on stdin")
    try:
        request = json.loads(text)
    except ValueError as exc:
        raise AdapterError("internal", f"protocol error: stdin is not valid JSON ({exc})") from None
    if not isinstance(request, dict):
        raise AdapterError("internal", "protocol error: request must be a JSON object")
    return request


def emit(response: dict[str, Any]) -> None:
    _write_text(sys.stdout, json.dumps(response, ensure_ascii=False), _STDOUT_UTF8)


def respond_ok(data: Any) -> int:
    emit({"ok": True, "data": data})
    return 0


def respond_err(code: str, message: str) -> int:
    eprint(f"error: {message}")
    emit({"ok": False, "error": {"code": code, "message": message}})
    return 1


def main() -> int:
    pin_utf8_streams()
    try:
        request = read_request()
    except AdapterError as exc:
        return respond_err(exc.code, exc.message)

    version = request.get("protocolVersion")
    if version != PROTOCOL_VERSION:
        return respond_err(
            "internal",
            f"protocol error: unsupported protocolVersion {version!r} (expected {PROTOCOL_VERSION})",
        )

    action = request.get("action")
    if not isinstance(action, str) or action not in ACTIONS:
        return respond_err("internal", f"protocol error: unknown action {action!r}")

    params = request.get("params")
    if params is None:
        params = {}
    if not isinstance(params, dict):
        return respond_err("config", "request params must be an object")

    try:
        cfg = load_config(request.get("config"))
        data = ACTIONS[action](cfg, params)
    except AdapterError as exc:
        return respond_err(exc.code, exc.message)
    except Exception as exc:  # noqa: BLE001 - last-resort typed internal error
        eprint(traceback.format_exc())
        return respond_err("internal", f"unexpected adapter error: {exc}")

    return respond_ok(data)


if __name__ == "__main__":
    sys.exit(main())
