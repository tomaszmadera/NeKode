#!/usr/bin/env python3
"""plane_cli.py - CLI for managing backlog and kanban work items in Plane CE.

Python 3.11+, standard library only.
Config via env vars PLANE_BASE_URL, PLANE_API_KEY, PLANE_WORKSPACE_SLUG,
PLANE_PROJECT_ID (fallbacks: project .agents/.env, ~/.secrets/plane.env).
Supports direct Plane URLs for --project / --url.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

TIMEOUT = 30
PRIORITIES = ("urgent", "high", "medium", "low", "none")
STATE_GROUPS = ("backlog", "unstarted", "started", "completed", "cancelled", "triage")
GROUP_ALIASES = {
    "done": "completed",
    "complete": "completed",
    "in progress": "started",
    "in_progress": "started",
    "todo": "unstarted",
}

PLANE_URL_PATTERN = re.compile(
    r"^(?P<base>https?://[^/]+)/(?P<ws>[^/]+)/projects/(?P<project>[0-9a-fA-F-]+)(?:/.*)?$"
)

_config: dict[str, Any] | None = None
_ws_override: str | None = None
_base_url_override: str | None = None
_states_cache: dict[str, list[dict[str, Any]]] = {}
_members_cache: dict[str, list[dict[str, Any]]] = {}
_projects_cache: list[dict[str, Any]] | None = None


def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr)


def fail(message: str, code: int = 1) -> None:
    eprint(f"error: {message}")
    sys.exit(code)


def parse_plane_url(url: str) -> dict[str, str] | None:
    """Extract base_url, workspace, and project_id from a Plane web URL."""
    m = PLANE_URL_PATTERN.match(url.strip())
    if not m:
        return None
    return {
        "base_url": m.group("base"),
        "workspace": m.group("ws"),
        "project": m.group("project"),
    }


def find_repo_root(start_dir: Path | None = None) -> Path:
    """Find repository root by looking for .agents/project-profile.yaml or .git."""
    curr = (start_dir or Path.cwd()).resolve()
    for parent in [curr, *curr.parents]:
        if (parent / ".agents" / "project-profile.yaml").is_file() or (parent / ".git").exists():
            return parent
    return curr


def _read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            values[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return values


def load_config() -> dict[str, Any]:
    """Load PLANE_* config strictly from os.environ or repo .agents/.env."""
    global _config
    if _config is not None:
        return _config

    root = find_repo_root()
    env_file_vars = _read_env_file(root / ".agents" / ".env")

    def get_val(name: str) -> str:
        val = os.environ.get(name)
        if val:
            return val
        return env_file_vars.get(name, "")

    missing = [
        name
        for name, value in (
            ("PLANE_API_KEY", get_val("PLANE_API_KEY")),
            ("PLANE_BASE_URL", _base_url_override or get_val("PLANE_BASE_URL")),
            ("PLANE_WORKSPACE_SLUG", _ws_override or get_val("PLANE_WORKSPACE_SLUG")),
            ("PLANE_PROJECT_ID", get_val("PLANE_PROJECT_ID")),
        )
        if not str(value).strip()
    ]
    if missing:
        fail(
            "{} not set (configure in .agents/.env or export {}).".format(
                ", ".join(missing), " / ".join(f"{name}=..." for name in missing)
            ),
            code=2,
        )

    base_url = _base_url_override or get_val("PLANE_BASE_URL")
    workspace = _ws_override or get_val("PLANE_WORKSPACE_SLUG")
    project = get_val("PLANE_PROJECT_ID")

    cfg: dict[str, Any] = {
        "base_url": base_url.rstrip("/"),
        "api_key": get_val("PLANE_API_KEY").strip(),
        "workspace": workspace,
        "project": project,
        "project_prv": get_val("PLANE_PROJECT_PRV"),
    }

    cfg["api_base"] = cfg["base_url"] + "/api/v1"
    _config = cfg
    return cfg


def api_request(
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
) -> tuple[int, Any]:
    """Perform an API request; returns (status, parsed_json_or_None). Exits on error."""
    cfg = load_config()
    url = cfg["api_base"] + path
    if params:
        query_items = [(k, str(v)) for k, v in params.items() if v is not None]
        if query_items:
            url += "?" + urllib.parse.urlencode(query_items)

    body: bytes | None = None
    headers = {"X-API-Key": cfg["api_key"], "Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    for attempt in range(2):
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                raw = resp.read()
                if not raw:
                    return resp.status, None
                return resp.status, json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt == 0:
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                try:
                    delay = float(retry_after) if retry_after else 2.0
                except ValueError:
                    delay = 2.0
                eprint(f"rate limited (429), retrying in {delay:g}s...")
                time.sleep(delay)
                continue
            handle_http_error(exc)
        except urllib.error.URLError as exc:
            fail(f"network error contacting Plane at {cfg['base_url']}: {exc.reason}")
        except TimeoutError:
            fail(f"request to Plane timed out after {TIMEOUT}s")
    fail("unreachable")


def handle_http_error(exc: urllib.error.HTTPError) -> None:
    """Print a readable message for a non-2xx response and exit 1."""
    try:
        raw = exc.read()
        data = json.loads(raw.decode("utf-8")) if raw else None
    except (OSError, ValueError):
        data = None
    code = exc.code
    if code == 400:
        msg = "validation error (400)"
        if isinstance(data, dict):
            parts = []
            for field, errs in data.items():
                if isinstance(errs, list):
                    errs = "; ".join(str(x) for x in errs)
                parts.append(f"{field}: {errs}")
            if parts:
                msg += " - " + " | ".join(parts)
        fail(msg)
    elif code == 403:
        detail = ""
        if isinstance(data, dict) and data.get("detail"):
            detail = f" ({data['detail']})"
        fail(
            f"permission denied (403){detail} - check API key and "
            "workspace/project membership (see: members)"
        )
    elif code == 404:
        fail("resource not found or wrong workspace slug (404)")
    elif code == 429:
        fail("rate limited (429) - Plane rate limit reached; retry shortly")
    elif 500 <= code < 600:
        fail(f"Plane server error ({code})")
    else:
        detail = ""
        if isinstance(data, dict):
            detail = " " + json.dumps(data, ensure_ascii=False)[:300]
        fail(f"API error {code}{detail}")


def print_json(data: Any) -> None:
    print(json.dumps(data, indent=2, ensure_ascii=False))


def dry_run(method: str, path: str, payload: dict[str, Any] | None = None) -> None:
    """Print the request that would be sent (never the auth header) and exit 0."""
    cfg = load_config()
    print(f"DRY-RUN {method} {cfg['api_base']}{path}")
    if payload is not None:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    sys.exit(0)


# ---------------------------------------------------------------------------
# Caches / name resolution
# ---------------------------------------------------------------------------


def ws() -> str:
    return _ws_override or load_config()["workspace"]


def get_states(project_id: str) -> list[dict[str, Any]]:
    """Return cached list of states for a project."""
    if project_id not in _states_cache:
        _, data = api_request("GET", f"/workspaces/{ws()}/projects/{project_id}/states/")
        states = data if isinstance(data, list) else data.get("results", [])
        states.sort(key=lambda s: (s.get("sequence", 0), s.get("name", "")))
        _states_cache[project_id] = states
    return _states_cache[project_id]


def get_members() -> list[dict[str, Any]]:
    """Return cached list of workspace members (members-lite)."""
    slug = ws()
    if slug not in _members_cache:
        _, data = api_request("GET", f"/workspaces/{slug}/members-lite/")
        _members_cache[slug] = data if isinstance(data, list) else data.get("results", [])
    return _members_cache[slug]


def _projects_lite() -> list[dict[str, Any]]:
    global _projects_cache
    if _projects_cache is None:
        _, data = api_request("GET", f"/workspaces/{ws()}/projects-lite/")
        _projects_cache = data if isinstance(data, list) else data.get("results", [])
    return _projects_cache


def resolve_project(ref: str | None) -> str:
    """Resolve project ref (URL, identifier like NAOMEM, or UUID) to UUID."""
    global _base_url_override, _ws_override, _config
    if ref:
        ref = ref.strip()
        url_info = parse_plane_url(ref)
        if url_info:
            _base_url_override = url_info["base_url"]
            _ws_override = url_info["workspace"]
            _config = None
            return url_info["project"]
    cfg = load_config()
    if not ref:
        if not cfg["project"]:
            fail("no project given and PLANE_PROJECT_ID is not set", code=2)
        return cfg["project"]
    projects = _projects_lite()
    for p in projects:
        if p.get("id") == ref:
            return p["id"]
    low = ref.lower()
    for p in projects:
        if (p.get("identifier") or "").lower() == low:
            return p["id"]
    for p in projects:
        if (p.get("name") or "").lower() == low:
            return p["id"]
    known = ", ".join(f"{p.get('identifier')} ({p.get('name')})" for p in projects)
    fail(f"project '{ref}' not found; known: {known}", code=2)


def project_identifier(project_id: str) -> str:
    """Best-effort lookup of a project's short identifier from its UUID."""
    for p in _projects_lite():
        if p.get("id") == project_id:
            return p.get("identifier") or "?"
    return "?"


def resolve_state(project_id: str, name: str) -> str:
    """Resolve state name (case-insensitive) or group keyword to state UUID."""
    states = get_states(project_id)
    low = name.strip().lower()
    group = GROUP_ALIASES.get(low, low)
    if group in STATE_GROUPS:
        candidates = [s for s in states if s.get("group") == group]
        if not candidates:
            fail(f"no state of group '{group}' in project", code=2)
        for s in candidates:
            if s.get("default"):
                return s["id"]
        return candidates[0]["id"]
    for s in states:
        if (s.get("name") or "").lower() == low:
            return s["id"]
    known = ", ".join(s.get("name", "?") for s in states)
    fail(f"state '{name}' not found; known: {known}", code=2)


def state_name(project_id: str, state_id: str | None) -> str:
    if not state_id:
        return "-"
    for s in get_states(project_id):
        if s.get("id") == state_id:
            return s.get("name", "?")
    return "?"


def resolve_user(email: str) -> str:
    """Resolve user by email (case-insensitive). Excludes bots."""
    members = get_members()
    low = email.strip().lower()
    matches = [m for m in members if (m.get("email") or "").lower() == low]
    if not matches:
        fail(f"no workspace member with email '{email}'", code=2)
    humans = [m for m in matches if not m.get("is_bot")]
    if not humans:
        fail(f"member '{email}' is a bot and cannot be assigned", code=2)
    if len(humans) > 1:
        lines = "\n".join(
            f"  {m.get('display_name')} <{m.get('email')}> id={m.get('id')}" for m in humans
        )
        fail(f"ambiguous user '{email}', candidates:\n{lines}", code=2)
    return humans[0]["id"]


def member_name(user_id: str) -> str:
    for m in get_members():
        if m.get("id") == user_id:
            return m.get("display_name") or m.get("email") or "?"
    return "?"


def resolve_label(project_id: str, name: str) -> str:
    """Resolve label by name: exact literal match first, then case-insensitive."""
    _, data = api_request("GET", f"/workspaces/{ws()}/projects/{project_id}/labels/")
    labels = data if isinstance(data, list) else data.get("results", [])
    for lb in labels:
        if lb.get("name") == name:
            return lb["id"]
    low = name.lower()
    for lb in labels:
        if (lb.get("name") or "").lower() == low:
            return lb["id"]
    known = ", ".join(lb.get("name", "?") for lb in labels)
    fail(f"label '{name}' not found; known: {known}", code=2)


def _looks_like_uuid(s: str) -> bool:
    return len(s) == 36 and s.count("-") == 4


def resolve_issue_ref(ref: str, project_id: str | None = None) -> tuple[str, str, str]:
    """Resolve a work item argument (UUID or REF like NAOMEM-42) to its UUID.

    Returns (uuid, project_id, ref_string).
    """
    ref = ref.strip()
    if "-" in ref and not _looks_like_uuid(ref):
        prefix, _, seq = ref.rpartition("-")
        if not seq.isdigit():
            fail(f"invalid work item reference '{ref}' (expected UUID or REF-42)", code=2)
        path = f"/workspaces/{ws()}/work-items/{prefix.upper()}-{seq}/"
        _, data = api_request("GET", path)
        return data["id"], data.get("project"), f"{prefix.upper()}-{seq}"
    pid = project_id or resolve_project(None)
    _, data = api_request("GET", f"/workspaces/{ws()}/projects/{pid}/work-items/{ref}/")
    ident = project_identifier(data.get("project") or pid)
    return data["id"], data.get("project") or pid, f"{ident}-{data.get('sequence_id')}"


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------


def issue_row(issue: dict[str, Any], project_id: str) -> list[str]:
    ident = "?"
    pid = issue.get("project") or project_id
    for p in _projects_lite():
        if p.get("id") == pid:
            ident = p.get("identifier") or "?"
            break
    ref = f"{ident}-{issue.get('sequence_id')}"
    assignees = ", ".join(member_name(u) for u in issue.get("assignees") or []) or "-"
    return [
        ref,
        issue.get("id", ""),
        (issue.get("name") or "")[:60],
        state_name(pid, issue.get("state")),
        issue.get("priority") or "-",
        assignees,
        issue.get("target_date") or "-",
    ]


def print_table(rows: list[list[str]], headers: list[str]) -> None:
    if not rows:
        print("(no results)")
        return
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(str(cell)))
    fmt = "  ".join(f"{{:<{w}}}" for w in widths)
    print(fmt.format(*headers))
    print(fmt.format(*["-" * w for w in widths]))
    for row in rows:
        print(fmt.format(*[str(c) for c in row]))


def print_issues_table(issues: list[dict[str, Any]], project_id: str) -> None:
    rows = [issue_row(i, project_id) for i in issues]
    print_table(rows, ["REF", "ID", "NAME", "STATE", "PRIORITY", "ASSIGNEES", "TARGET_DATE"])


# ---------------------------------------------------------------------------
# Payload building
# ---------------------------------------------------------------------------


def check_date(value: str | None, flag: str) -> str | None:
    if value is None:
        return None
    parts = value.split("-")
    if len(parts) != 3 or not all(p.isdigit() for p in parts) or len(parts[0]) != 4:
        fail(f"{flag} must be YYYY-MM-DD, got '{value}'", code=2)
    return value


def text_to_html(text: str) -> str:
    paragraphs = text.strip().split("\n\n")
    html_parts = []
    for p in paragraphs:
        p_clean = html.escape(p.strip()).replace("\n", "<br/>")
        if p_clean:
            html_parts.append(f"<p>{p_clean}</p>")
    return "".join(html_parts)


def build_payload(args: argparse.Namespace, project_id: str, require_any: bool = False) -> dict[str, Any]:
    """Build create/update payload from CLI args."""
    payload: dict[str, Any] = {}
    if getattr(args, "name", None) is not None:
        payload["name"] = args.name

    desc_html = getattr(args, "description_html", None)
    desc_plain = getattr(args, "description", None)
    if desc_html is not None:
        payload["description_html"] = desc_html
    elif desc_plain is not None:
        payload["description_html"] = text_to_html(desc_plain)

    if getattr(args, "priority", None) is not None:
        if args.priority not in PRIORITIES:
            fail(f"--priority must be one of {', '.join(PRIORITIES)}", code=2)
        payload["priority"] = args.priority

    if getattr(args, "state", None) is not None:
        payload["state"] = resolve_state(project_id, args.state)

    if getattr(args, "assignee", None) is not None:
        payload["assignees"] = [resolve_user(e) for e in args.assignee]

    if getattr(args, "label", None) is not None:
        payload["labels"] = [resolve_label(project_id, n) for n in args.label]

    if getattr(args, "start_date", None) is not None:
        payload["start_date"] = check_date(args.start_date, "--start-date")

    if getattr(args, "target_date", None) is not None:
        payload["target_date"] = check_date(args.target_date, "--target-date")

    if getattr(args, "parent", None) is not None:
        payload["parent"] = args.parent

    if getattr(args, "estimate", None) is not None:
        payload["estimate_point"] = args.estimate

    ext_id = getattr(args, "external_id", None)
    ext_src = getattr(args, "external_source", None)
    if (ext_id is None) != (ext_src is None):
        fail("--external-id and --external-source must be given together", code=2)
    if ext_id is not None:
        payload["external_id"] = ext_id
        payload["external_source"] = ext_src

    if require_any and not payload:
        fail("update requires at least one field flag", code=2)
    return payload


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------


def cmd_whoami(args: argparse.Namespace) -> None:
    """Show authenticated user info."""
    _, data = api_request("GET", "/users/me/")
    if args.json:
        print_json(data)
        return
    print(f"user:  {data.get('display_name') or data.get('first_name') or '?'}")
    print(f"email: {data.get('email', '?')}")
    print(f"id:    {data.get('id', '?')}")


def cmd_projects(args: argparse.Namespace) -> None:
    """List projects in the workspace."""
    projects = _projects_lite()
    if args.json:
        print_json(projects)
        return
    print_table(
        [[p.get("identifier", "?"), p.get("id", ""), p.get("name", "")] for p in projects],
        ["IDENTIFIER", "ID", "NAME"],
    )


def cmd_states(args: argparse.Namespace) -> None:
    """List states/columns of the project."""
    pid = resolve_project(args.project)
    states = get_states(pid)
    if args.json:
        print_json(states)
        return
    rows = [
        [
            s.get("name", "?"),
            s.get("group", "?"),
            "yes" if s.get("default") else "",
            s.get("id", ""),
        ]
        for s in states
    ]
    print_table(rows, ["NAME", "GROUP", "DEFAULT", "ID"])


def cmd_labels(args: argparse.Namespace) -> None:
    """List labels of the project."""
    pid = resolve_project(args.project)
    _, data = api_request("GET", f"/workspaces/{ws()}/projects/{pid}/labels/")
    labels = data if isinstance(data, list) else data.get("results", [])
    if args.json:
        print_json(labels)
        return
    print_table(
        [[lb.get("name", "?"), lb.get("color", ""), lb.get("id", "")] for lb in labels],
        ["NAME", "COLOR", "ID"],
    )


def cmd_members(args: argparse.Namespace) -> None:
    """List workspace members."""
    members = get_members()
    if args.json:
        print_json(members)
        return
    rows = [
        [
            m.get("display_name", "?"),
            m.get("email", "?"),
            "bot" if m.get("is_bot") else "",
            m.get("id", ""),
        ]
        for m in members
    ]
    print_table(rows, ["DISPLAY_NAME", "EMAIL", "BOT", "ID"])


def _fetch_project_issues(pid: str, fetch_all: bool = False, per_page: int = 100) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        params: dict[str, Any] = {"per_page": per_page}
        if cursor:
            params["cursor"] = cursor
        _, data = api_request("GET", f"/workspaces/{ws()}/projects/{pid}/work-items/", params=params)
        issues.extend(data.get("results", []))
        if not fetch_all:
            break
        if data.get("next_page_results") and data.get("next_cursor"):
            cursor = data["next_cursor"]
        else:
            break
    return issues


def cmd_board(args: argparse.Namespace) -> None:
    """Kanban board view: display tasks grouped by column/state."""
    pid = resolve_project(args.project)
    states = get_states(pid)
    issues = _fetch_project_issues(pid, fetch_all=True)

    columns: dict[str, list[dict[str, Any]]] = {s["id"]: [] for s in states}
    unassigned_state: list[dict[str, Any]] = []

    for item in issues:
        st_id = item.get("state")
        if st_id in columns:
            columns[st_id].append(item)
        else:
            unassigned_state.append(item)

    if args.json:
        output = {
            "project_id": pid,
            "project_identifier": project_identifier(pid),
            "states": [
                {
                    "id": s["id"],
                    "name": s.get("name"),
                    "group": s.get("group"),
                    "count": len(columns[s["id"]]),
                    "items": columns[s["id"]],
                }
                for s in states
            ],
        }
        print_json(output)
        return

    ident = project_identifier(pid)
    total_count = len(issues)
    print(f"=== Kanban Board: {ident} (Total: {total_count}) ===")
    print()

    for s in states:
        col_items = columns[s["id"]]
        st_name = s.get("name", "Unknown")
        st_group = s.get("group", "")
        count = len(col_items)
        print(f"┌─ [{st_name.upper()}] ({count}) [{'group: ' + st_group}]")
        if not col_items:
            print("│  (empty)")
        else:
            for item in col_items:
                ref = f"{ident}-{item.get('sequence_id')}"
                name = item.get("name", "")
                prio = item.get("priority") or "none"
                assignees = ", ".join(member_name(u) for u in item.get("assignees") or [])
                assignee_str = f" @{assignees}" if assignees else ""
                print(f"│  • {ref:<10} [{prio:<6}] {name}{assignee_str}")
        print("└" + "─" * 40)
        print()


def cmd_list(args: argparse.Namespace) -> None:
    """List work items of a project."""
    pid = resolve_project(args.project)
    per_page = args.per_page
    if not (1 <= per_page <= 100):
        fail("--per-page must be between 1 and 100", code=2)
    fetch_all = args.all or args.state or args.priority or args.label

    issues = _fetch_project_issues(pid, fetch_all=fetch_all, per_page=per_page)

    if args.state:
        state_id = resolve_state(pid, args.state)
        issues = [i for i in issues if i.get("state") == state_id]
    if args.priority:
        if args.priority not in PRIORITIES:
            fail(f"--priority must be one of {', '.join(PRIORITIES)}", code=2)
        issues = [i for i in issues if (i.get("priority") or "none") == args.priority]
    if args.label:
        label_id = resolve_label(pid, args.label)
        issues = [i for i in issues if label_id in (i.get("labels") or [])]

    if args.json:
        print_json(issues)
        return
    print_issues_table(issues, pid)


def cmd_backlog(args: argparse.Namespace) -> None:
    """List work items currently in Backlog."""
    args.state = "Backlog"
    args.all = True
    cmd_list(args)


def cmd_get(args: argparse.Namespace) -> None:
    """Show details of one work item."""
    explicit_pid = resolve_project(args.project) if args.project else None
    uuid, pid, ref = resolve_issue_ref(args.ref, explicit_pid)
    _, data = api_request("GET", f"/workspaces/{ws()}/projects/{pid}/work-items/{uuid}/")
    if args.json:
        print_json(data)
        return
    print_issues_table([data], pid)
    desc = data.get("description_html") or data.get("description")
    if desc:
        print("\n--- Description ---")
        print(desc)


def cmd_create(args: argparse.Namespace) -> None:
    """Create a work item in a project."""
    if not args.name:
        fail("create requires --name", code=2)
    pid = resolve_project(args.project)
    payload = build_payload(args, pid)
    path = f"/workspaces/{ws()}/projects/{pid}/work-items/"
    if args.dry_run:
        dry_run("POST", path, payload)
    _, data = api_request("POST", path, payload=payload)
    if args.json:
        print_json(data)
        return
    print_issues_table([data], pid)


def cmd_update(args: argparse.Namespace) -> None:
    """Update fields of a work item."""
    explicit_pid = resolve_project(args.project) if args.project else None
    uuid, real_pid, ref = resolve_issue_ref(args.ref, explicit_pid)
    payload = build_payload(args, real_pid, require_any=True)
    path = f"/workspaces/{ws()}/projects/{real_pid}/work-items/{uuid}/"
    if args.dry_run:
        dry_run("PATCH", path, payload)
    _, data = api_request("PATCH", path, payload=payload)
    if args.json:
        print_json(data)
        return
    print_issues_table([data], real_pid)


def cmd_delete(args: argparse.Namespace) -> None:
    """Soft-delete a work item."""
    explicit_pid = resolve_project(args.project) if args.project else None
    uuid, real_pid, ref = resolve_issue_ref(args.ref, explicit_pid)
    path = f"/workspaces/{ws()}/projects/{real_pid}/work-items/{uuid}/"
    if args.dry_run:
        dry_run("DELETE", path)
    if not args.yes:
        if sys.stdout.isatty():
            answer = input(f"Delete work item {ref}? Type 'yes' to confirm: ")
            if answer.strip() != "yes":
                eprint("aborted")
                sys.exit(2)
        else:
            fail("delete requires --yes when not running interactively", code=2)
    api_request("DELETE", path)
    print(f"deleted {ref}")


def cmd_search(args: argparse.Namespace) -> None:
    """Search work items by text across the workspace."""
    _, data = api_request(
        "GET",
        f"/workspaces/{ws()}/issues/search/",
        params={"search": args.text, "limit": args.limit},
    )
    hits = data.get("issues", []) if isinstance(data, dict) else []
    if args.json:
        print_json(hits)
        return
    current_pid = load_config()["project"]
    rows = []
    for h in hits:
        ref = f"{h.get('project__identifier', '?')}-{h.get('sequence_id', '?')}"
        mark = ref if h.get("project_id") == current_pid else f"{ref} (other project)"
        rows.append([mark, h.get("id", ""), (h.get("name") or "")[:60]])
    print_table(rows, ["REF", "ID", "NAME"])


# ---------------------------------------------------------------------------
# CLI Parser
# ---------------------------------------------------------------------------


def add_issue_field_flags(p: argparse.ArgumentParser, name_required: bool = False) -> None:
    p.add_argument("--name", required=name_required, help="work item title")
    p.add_argument("--description", help="plain text description (auto-converted to HTML)")
    p.add_argument("--description-html", help="HTML description, passed verbatim")
    p.add_argument("--priority", help=f"one of: {', '.join(PRIORITIES)}")
    p.add_argument("--state", help="state name (e.g. 'In Progress', 'Todo', 'Done') or group")
    p.add_argument("--assignee", action="append", help="assignee email (repeatable)")
    p.add_argument("--label", action="append", help="label name (repeatable)")
    p.add_argument("--start-date", help="YYYY-MM-DD")
    p.add_argument("--target-date", help="YYYY-MM-DD")
    p.add_argument("--parent", help="parent work item UUID")
    p.add_argument("--estimate", type=int, help="estimate points (int)")
    p.add_argument("--external-id", help="external id (requires --external-source)")
    p.add_argument("--external-source", help="external source (requires --external-id)")


def build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--workspace",
        metavar="SLUG",
        default=argparse.SUPPRESS,
        help="override workspace slug (default: PLANE_WORKSPACE_SLUG env)",
    )
    common.add_argument(
        "--base-url",
        metavar="URL",
        default=argparse.SUPPRESS,
        help="override base URL (default: PLANE_BASE_URL env)",
    )
    parser = argparse.ArgumentParser(
        prog="plane_cli.py",
        description="CLI for managing backlog and kanban work items in Plane CE.",
        parents=[common],
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("whoami", parents=[common], help="show which user the API key belongs to")
    p.add_argument("--json", action="store_true", help="raw API JSON output")
    p.set_defaults(func=cmd_whoami)

    p = sub.add_parser("projects", parents=[common], help="list projects in the workspace")
    p.add_argument("--json", action="store_true", help="raw API JSON output")
    p.set_defaults(func=cmd_projects)

    for name, func, helptext in (
        ("states", cmd_states, "list states/columns of the project"),
        ("labels", cmd_labels, "list labels of the project"),
        ("members", cmd_members, "list workspace members"),
    ):
        p = sub.add_parser(name, parents=[common], help=helptext)
        p.add_argument("--json", action="store_true", help="raw API JSON output")
        if name in ("states", "labels"):
            p.add_argument("--project", help="project identifier (NAOMEM), UUID, or Plane web URL")
        p.set_defaults(func=func)

    p = sub.add_parser("board", parents=[common], help="display Kanban board with columns and tasks")
    p.add_argument("--project", help="project identifier, UUID, or Plane web URL")
    p.add_argument("--json", action="store_true", help="structured JSON output")
    p.set_defaults(func=cmd_board)

    p = sub.add_parser("backlog", parents=[common], help="list items currently in Backlog")
    p.add_argument("--project", help="project identifier, UUID, or Plane web URL")
    p.add_argument("--priority", help=f"filter by priority ({', '.join(PRIORITIES)})")
    p.add_argument("--label", help="filter by label name")
    p.add_argument("--per-page", type=int, default=100, help="page size 1..100 (default 100)")
    p.add_argument("--json", action="store_true", help="raw API JSON output")
    p.set_defaults(func=cmd_backlog)

    p = sub.add_parser("list", parents=[common], help="list work items of a project")
    p.add_argument("--project", help="project identifier, UUID, or Plane web URL")
    p.add_argument("--state", help="filter by state name or group")
    p.add_argument("--priority", help=f"filter by priority ({', '.join(PRIORITIES)})")
    p.add_argument("--label", help="filter by label name")
    p.add_argument("--all", action="store_true", help="paginate through all pages")
    p.add_argument("--per-page", type=int, default=100, help="page size 1..100 (default 100)")
    p.add_argument("--json", action="store_true", help="raw API JSON output")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("get", parents=[common], help="show one work item by UUID or REF (e.g. NAOMEM-1)")
    p.add_argument("ref", help="work item UUID or reference like NAOMEM-1")
    p.add_argument("--project", help="project identifier, UUID, or Plane web URL")
    p.add_argument("--json", action="store_true", help="raw API JSON output")
    p.set_defaults(func=cmd_get)

    p = sub.add_parser("create", parents=[common], help="create a work item (Kanban card)")
    p.add_argument("--project", help="project identifier, UUID, or Plane web URL")
    add_issue_field_flags(p, name_required=True)
    p.add_argument("--dry-run", action="store_true", help="print request, do not send")
    p.add_argument("--json", action="store_true", help="raw API JSON output")
    p.set_defaults(func=cmd_create)

    p = sub.add_parser("update", parents=[common], help="update fields or move a work item across columns")
    p.add_argument("ref", help="work item UUID or reference like NAOMEM-1")
    p.add_argument("--project", help="project identifier, UUID, or Plane web URL")
    add_issue_field_flags(p)
    p.add_argument("--dry-run", action="store_true", help="print request, do not send")
    p.add_argument("--json", action="store_true", help="raw API JSON output")
    p.set_defaults(func=cmd_update)

    p = sub.add_parser("delete", parents=[common], help="soft-delete a work item")
    p.add_argument("ref", help="work item UUID or reference like NAOMEM-1")
    p.add_argument("--project", help="project identifier, UUID, or Plane web URL")
    p.add_argument("--yes", action="store_true", help="skip confirmation prompt")
    p.add_argument("--dry-run", action="store_true", help="print request, do not send")
    p.set_defaults(func=cmd_delete)

    p = sub.add_parser("search", parents=[common], help="search work items by text")
    p.add_argument("text", help="search text")
    p.add_argument("--limit", type=int, default=10, help="max results (default 10)")
    p.add_argument("--json", action="store_true", help="raw API JSON output")
    p.set_defaults(func=cmd_search)

    return parser


def main() -> None:
    global _ws_override, _base_url_override
    parser = build_parser()
    args = parser.parse_args()
    _ws_override = getattr(args, "workspace", None)
    _base_url_override = getattr(args, "base_url", None)
    try:
        args.func(args)
    except KeyboardInterrupt:
        eprint("interrupted")
        sys.exit(1)


if __name__ == "__main__":
    main()
