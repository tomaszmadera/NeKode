#!/usr/bin/env python3
"""Report agent task progress snapshot to Personal Data Hub Agent Tasks API."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


def find_repo_root(start_dir: Path | None = None) -> Path:
    """Find repository root by looking for .git or .agents/project-profile.yaml."""
    curr = (start_dir or Path.cwd()).resolve()
    for parent in [curr, *curr.parents]:
        if (parent / ".agents" / "project-profile.yaml").is_file() or (parent / ".git").exists():
            return parent
    return curr


def parse_env_file(env_path: Path) -> dict[str, str]:
    """Simple parser for KEY=VALUE pairs in .env files."""
    env_vars: dict[str, str] = {}
    if not env_path.is_file():
        return env_vars

    try:
        content = env_path.read_text(encoding="utf-8")
        for line in content.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip("'\"")
            if key and val:
                env_vars[key] = val
    except Exception:
        pass
    return env_vars


def resolve_config(
    cli_url: str | None = None,
    cli_token: str | None = None,
    repo_root: Path | None = None,
    allow_default: bool = True,
) -> tuple[str | None, str | None]:
    """Resolve API URL and token strictly from CLI args, .agents/.env, or default."""
    root = repo_root or find_repo_root()
    env_file_vars = parse_env_file(root / ".agents" / ".env")

    # Resolve URL: CLI -> AGENT_TASKS_API_URL -> HUB_URL -> optional localhost default
    url = (
        cli_url
        or env_file_vars.get("AGENT_TASKS_API_URL")
        or env_file_vars.get("HUB_URL")
        or ("http://localhost:8081" if allow_default else None)
    )

    if url:
        url = url.rstrip("/")

    # Resolve Token: CLI -> AGENT_TASKS_API_TOKEN -> HUB_TOKEN
    token = (
        cli_token
        or env_file_vars.get("AGENT_TASKS_API_TOKEN")
        or env_file_vars.get("HUB_TOKEN")
    )

    return url, token


def resolve_auto_report_config(repo_root: Path | None = None) -> tuple[str | None, str | None]:
    """Resolve automatic reporting config only when the local standing grant is enabled."""
    root = repo_root or find_repo_root()
    env_file_vars = parse_env_file(root / ".agents" / ".env")
    if env_file_vars.get("AGENT_TASKS_AUTO_REPORT") != "1":
        return None, None
    return resolve_config(repo_root=root, allow_default=False)


def extract_snapshot_data(repo_root: Path, task_id: str | None = None, timeout: float = 30.0) -> dict[str, Any]:
    """Extract project task snapshot via task-status script."""
    task_status_script = repo_root / ".agents" / "scripts" / "task-status"
    if not task_status_script.is_file():
        raise FileNotFoundError(f"Task status script not found at {task_status_script}")

    try:
        proc = subprocess.run(
            [sys.executable, str(task_status_script), "--json"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"task-status --json timed out after {timeout} seconds") from exc

    if proc.returncode != 0:
        err_msg = proc.stderr.strip() or proc.stdout.strip()
        raise RuntimeError(f"task-status --json failed: {err_msg}")

    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON from task-status --json: {exc}") from exc

    # Ensure project_id is present
    if "project_id" not in data and "project" in data:
        data["project_id"] = data["project"]

    if "project_name" not in data and "project" in data:
        data["project_name"] = data["project"]

    # Filter to specific task if requested
    if task_id:
        tasks = data.get("tasks", [])
        if not isinstance(tasks, list):
            tasks = []
        matching = [t for t in tasks if isinstance(t, dict) and t.get("id") == task_id]
        if not matching:
            raise ValueError(f"Task '{task_id}' not found in task-status snapshot")
        data["tasks"] = matching

    return data


def post_snapshot(
    api_url: str,
    token: str | None,
    payload: dict[str, Any],
    timeout: float = 10.0,
) -> tuple[int, dict[str, Any]]:
    """Send HTTP POST request with task snapshot to the Agent Tasks API."""
    api_url = api_url.rstrip("/")
    if not api_url.endswith("/api/v1/agent-tasks/snapshot"):
        if "/api/v1" in api_url:
            endpoint = f"{api_url}/agent-tasks/snapshot" if not api_url.endswith("/agent-tasks") else f"{api_url}/snapshot"
        else:
            endpoint = f"{api_url}/api/v1/agent-tasks/snapshot"
    else:
        endpoint = api_url

    data_bytes = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(endpoint, data=data_bytes, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    if token:
        auth_value = token if token.startswith("Bearer ") else f"Bearer {token}"
        req.add_header("Authorization", auth_value)

    with urllib.request.urlopen(req, timeout=timeout) as response:
        status_code = response.getcode()
        resp_body = response.read().decode("utf-8")
        try:
            parsed = json.loads(resp_body)
        except json.JSONDecodeError:
            parsed = {"raw": resp_body}
        return status_code, parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Report agent task progress snapshot to Personal Data Hub.",
    )
    parser.add_argument(
        "--url",
        help="Base or endpoint URL of Personal Data Hub (default: AGENT_TASKS_API_URL or HUB_URL in .agents/.env, or http://localhost:8081)",
    )
    parser.add_argument(
        "--token",
        help="Sanctum Bearer token with agent:push or admin ability (default: AGENT_TASKS_API_TOKEN or HUB_TOKEN in .agents/.env)",
    )

    parser.add_argument(
        "--task",
        dest="task_id",
        help="Limit snapshot to a single task ID",
    )
    parser.add_argument(
        "--root",
        type=Path,
        help="Repository root directory (default: auto-detected)",
    )
    parser.add_argument(
        "--strict",
        "--fail-fast",
        dest="strict",
        action="store_true",
        help="Exit with non-zero code on report failure (default: log warning and exit 0 to avoid blocking workflows)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Extract snapshot and print payload without sending HTTP request",
    )
    parser.add_argument(
        "--json",
        dest="json_output",
        action="store_true",
        help="Output raw JSON response",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    root = find_repo_root(args.root)
    url, token = resolve_config(cli_url=args.url, cli_token=args.token, repo_root=root)

    try:
        snapshot = extract_snapshot_data(repo_root=root, task_id=args.task_id)
    except Exception as exc:
        msg = f"[warn] Failed to extract agent task snapshot: {exc}"
        if args.strict:
            sys.stderr.write(f"{msg}\n")
            return 1
        sys.stderr.write(f"{msg} (ignored in non-strict mode)\n")
        return 0

    if args.dry_run:
        print(json.dumps(snapshot, indent=2))
        return 0

    if not token:
        msg = (
            "[warn] No Sanctum token provided for Agent Tasks reporting. "
            "Set AGENT_TASKS_API_TOKEN or HUB_TOKEN in .agents/.env, or provide --token."
        )

        if args.strict:
            sys.stderr.write(f"{msg}\n")
            return 1
        sys.stderr.write(f"{msg} (ignored in non-strict mode)\n")
        return 0

    try:
        status_code, resp = post_snapshot(api_url=url, token=token, payload=snapshot)
    except urllib.error.HTTPError as exc:
        err_body = ""
        try:
            err_body = exc.read().decode("utf-8")
        except Exception:
            pass
        msg = f"[warn] Agent tasks HTTP error {exc.code}: {exc.reason}. Response: {err_body}"
        if args.strict:
            sys.stderr.write(f"{msg}\n")
            return 1
        sys.stderr.write(f"{msg} (ignored in non-strict mode)\n")
        return 0
    except urllib.error.URLError as exc:
        msg = f"[warn] Agent tasks network error connecting to {url}: {exc.reason}"
        if args.strict:
            sys.stderr.write(f"{msg}\n")
            return 1
        sys.stderr.write(f"{msg} (ignored in non-strict mode)\n")
        return 0
    except Exception as exc:
        msg = f"[warn] Agent tasks reporting error: {exc}"
        if args.strict:
            sys.stderr.write(f"{msg}\n")
            return 1
        sys.stderr.write(f"{msg} (ignored in non-strict mode)\n")
        return 0

    if args.json_output:
        print(json.dumps(resp))
    else:
        project_id = snapshot.get("project_id", "unknown")
        task_count = len(snapshot.get("tasks", []))
        print(f"[ok] Reported {task_count} task(s) for project '{project_id}' to {url} (HTTP {status_code})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
