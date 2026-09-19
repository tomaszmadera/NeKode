#!/usr/bin/env python3
"""Git-flow feature finish and develop release entrypoints.

These commands call the git-flow CLI. They do not implement a substitute
protocol and they do not call linear execute_release.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = Path(__file__).resolve().parents[3] / "scripts"
for path in (str(CURRENT_DIR), str(SCRIPTS_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

from common import (
    ROOT,
    bump_semver,
    commit_paths,
    get_project_version,
    git_output,
    profile_values,
    run,
    update_project_manifests,
)
from git_ops import get_current_branch, get_git_status, is_dirty, push_exact_ref

# AVH --nopush does not clear config-driven pushproduction, pushdevelop, or pushtag.
_GIT_FLOW_RELEASE_FINISH_NO_PUSH = (
    "--nopush",
    "--nopushproduction",
    "--nopushdevelop",
    "--nopushtag",
)


def publication_strategy(root: Path | None = None) -> str:
    """Return the recorded publication.strategy scalar, with inline comments stripped."""
    target_root = root or ROOT
    path = target_root / ".agents" / "project-profile.yaml"
    if not path.is_file():
        return "unknown"
    try:
        publication = profile_values(path).get("publication", {})
    except (OSError, UnicodeError):
        return "unknown"
    if not isinstance(publication, dict):
        return "unknown"
    raw = publication.get("strategy", "")
    if not isinstance(raw, str):
        return "unknown"
    return re.split(r"\s+#", raw.strip(), maxsplit=1)[0].strip().strip("\"'") or "unknown"


def git_flow_cli_available() -> bool:
    if shutil.which("git-flow"):
        return True
    result = run(["git", "flow", "version"], capture=True)
    return result.returncode == 0


def _git_config(root: Path, key: str) -> str | None:
    value = git_output("-C", str(root), "config", "--get", key).strip()
    return value or None


def git_flow_names(root: Path) -> dict[str, str]:
    """Resolve production, develop, and prefixes from git-flow config with spec defaults."""
    return {
        "production": _git_config(root, "gitflow.branch.master") or "main",
        "develop": _git_config(root, "gitflow.branch.develop") or "develop",
        "feature_prefix": _git_config(root, "gitflow.prefix.feature") or "feature/",
        "release_prefix": _git_config(root, "gitflow.prefix.release") or "release/",
        "tag_prefix": _git_config(root, "gitflow.prefix.versiontag") or "",
    }


def _dirty_result(status: dict[str, list[str]], action: str) -> dict[str, str | bool | list[str]]:
    dirty_items = status["modified"] + status["staged"] + status["untracked"]
    return {
        "success": False,
        "error": (
            f"Working tree is dirty with {len(dirty_items)} file(s). "
            f"Commit or stash changes before git-flow {action}."
        ),
        "dirty_files": dirty_items,
    }


def _run_git_flow(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["GIT_MERGE_AUTOEDIT"] = "no"
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_EDITOR"] = "true"
    return subprocess.run(
        ["git", "-C", str(root), "flow", *args],
        cwd=str(root),
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        env=env,
    )


def _local_ref_exists(root: Path, ref: str) -> bool:
    result = run(["git", "-C", str(root), "show-ref", "--verify", "--quiet", ref], capture=True)
    return result.returncode == 0


def _cli_missing_error(action: str) -> dict[str, str | bool]:
    return {
        "success": False,
        "error": (
            f"git-flow CLI is not available. Install git-flow to {action}. "
            "This command does not substitute a custom git-flow protocol."
        ),
    }


def execute_finish(
    dry_run: bool = False,
    root: Path | None = None,
) -> dict[str, str | bool | list[str]]:
    """Finish the current configured git-flow feature branch. No commit or release."""
    target_root = root or ROOT
    if publication_strategy(target_root) != "git-flow":
        return {
            "success": False,
            "error": "finish is a git-flow-only action.",
        }
    if not git_flow_cli_available():
        return _cli_missing_error("finish a feature branch")

    status = get_git_status(target_root)
    if is_dirty(status) and not dry_run:
        return _dirty_result(status, "finish")

    names = git_flow_names(target_root)
    current = get_current_branch(target_root)
    prefix = names["feature_prefix"]
    if not prefix or not current.startswith(prefix) or current == prefix:
        return {
            "success": False,
            "error": (
                f"finish runs only on a configured feature branch ({prefix}*). "
                f"Current branch '{current}' is not a feature branch."
            ),
        }
    feature = current[len(prefix) :]
    if dry_run:
        return {
            "success": True,
            "dry_run": True,
            "feature": feature,
            "branch": current,
        }

    # Feature finish only has --[no]push; the AVH release no-push flags are invalid here.
    finished = _run_git_flow(target_root, "feature", "finish", "--nopush", feature)
    if finished.returncode != 0:
        return {
            "success": False,
            "error": (
                "git-flow feature finish failed: "
                + (finished.stderr.strip() or finished.stdout.strip() or f"exit {finished.returncode}")
            ),
        }
    return {
        "success": True,
        "feature": feature,
        "branch": get_current_branch(target_root),
    }


def _ref_entry(result: dict[str, str | bool | None]) -> dict[str, str | bool | None]:
    return {
        "ref": result.get("ref"),
        "verified": bool(result.get("success")),
        "local": result.get("local_sha"),
        "remote": result.get("remote_sha"),
        "error": result.get("error"),
    }


def execute_git_flow_release(
    bump: str = "patch",
    message: str | None = None,
    skip_push: bool = False,
    dry_run: bool = False,
    root: Path | None = None,
) -> dict[str, str | bool | list[str] | dict]:
    """Start or resume a git-flow release from develop and publish production, develop, and the tag."""
    target_root = root or ROOT
    if publication_strategy(target_root) != "git-flow":
        return {
            "success": False,
            "error": "git-flow release requires publication.strategy git-flow.",
        }
    if not git_flow_cli_available():
        return _cli_missing_error("run a git-flow release")

    status = get_git_status(target_root)
    if is_dirty(status) and not dry_run:
        return _dirty_result(status, "release")

    names = git_flow_names(target_root)
    current = get_current_branch(target_root)
    production = names["production"]
    develop = names["develop"]
    feature_prefix = names["feature_prefix"]
    release_prefix = names["release_prefix"]
    tag_prefix = names["tag_prefix"]

    if feature_prefix and current.startswith(feature_prefix):
        return {
            "success": False,
            "error": (
                f"git-flow release refuses a feature branch. Finish '{current}' first and run release from '{develop}'."
            ),
        }
    if current == production:
        return {
            "success": False,
            "error": f"git-flow release refuses the production branch '{production}'. Run it from '{develop}'.",
        }

    on_release = bool(release_prefix and current.startswith(release_prefix) and current != release_prefix)
    if not on_release and current != develop:
        return {
            "success": False,
            "error": (
                f"git-flow release starts or resumes from '{develop}'. "
                f"Current branch '{current}' is not develop or a release branch."
            ),
        }

    if on_release:
        selected = current[len(release_prefix) :]
        resume = True
    else:
        current_version = get_project_version(target_root)
        try:
            selected = current_version if bump == "none" else bump_semver(current_version, bump)
        except ValueError as exc:
            return {"success": False, "error": str(exc)}
        resume = _local_ref_exists(target_root, f"refs/heads/{release_prefix}{selected}")

    tag_name = f"{tag_prefix}{selected}"
    release_branch = f"{release_prefix}{selected}"
    if dry_run:
        return {
            "success": True,
            "dry_run": True,
            "version": selected,
            "resume": resume,
            "release_branch": release_branch,
            "production": production,
            "develop": develop,
            "tag": tag_name,
        }

    if resume:
        if current != release_branch:
            checkout = run(["git", "-C", str(target_root), "checkout", release_branch], capture=True)
            if checkout.returncode != 0:
                return {
                    "success": False,
                    "error": (
                        f"Failed to resume '{release_branch}': "
                        + (checkout.stderr.strip() or checkout.stdout.strip() or f"exit {checkout.returncode}")
                    ),
                }
    else:
        started = _run_git_flow(target_root, "release", "start", selected)
        if started.returncode != 0:
            return {
                "success": False,
                "error": (
                    "git-flow release start failed: "
                    + (started.stderr.strip() or started.stdout.strip() or f"exit {started.returncode}")
                ),
            }

    if get_project_version(target_root) != selected:
        updated = update_project_manifests(selected, target_root)
        if not updated:
            return {
                "success": False,
                "error": "git-flow release requires a writable product-version source supported by ci bump.",
            }
        commit_res = commit_paths(
            target_root,
            updated,
            message or f"chore(release): {selected}",
            runner=run,
        )
        if commit_res.returncode != 0:
            return {
                "success": False,
                "error": f"Version commit failed: {commit_res.stderr.strip() or commit_res.stdout.strip()}",
            }

    finished = _run_git_flow(
        target_root,
        "release",
        "finish",
        *_GIT_FLOW_RELEASE_FINISH_NO_PUSH,
        "-m",
        selected,
        selected,
    )
    if finished.returncode != 0:
        return {
            "success": False,
            "error": (
                "git-flow release finish failed: "
                + (finished.stderr.strip() or finished.stdout.strip() or f"exit {finished.returncode}")
            ),
        }

    refs = {
        "production": f"refs/heads/{production}",
        "develop": f"refs/heads/{develop}",
        "tag": f"refs/tags/{tag_name}",
    }
    verified: dict[str, dict[str, str | bool | None]] = {}
    if skip_push:
        for key, ref in refs.items():
            verified[key] = {
                "ref": ref,
                "verified": False,
                "local": git_output("-C", str(target_root), "rev-parse", ref).strip() or None,
                "remote": None,
                "error": "push skipped",
            }
        return {
            "success": True,
            "version": selected,
            "resume": resume,
            "pushed": False,
            "refs": verified,
        }

    overall = True
    errors: list[str] = []
    for key, ref in refs.items():
        result = push_exact_ref(target_root, "origin", ref, ref)
        verified[key] = _ref_entry(result)
        if not result.get("success"):
            overall = False
            errors.append(str(result.get("error") or f"{key} verification failed"))

    payload: dict[str, str | bool | list[str] | dict] = {
        "success": overall,
        "version": selected,
        "resume": resume,
        "pushed": overall,
        "refs": verified,
    }
    if not overall:
        payload["error"] = "git-flow release ref verification failed: " + "; ".join(errors)
    return payload
