#!/usr/bin/env python3
"""Git operations module for the unified CI skill."""

from __future__ import annotations

import datetime
import os
import re
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[3] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from common import ROOT, commit_paths, git_output, run


def get_git_status(root: Path | None = None) -> dict[str, list[str]]:
    """Return dictionary of modified, staged, and untracked files."""
    cwd = str(root or ROOT)
    modified = [f for f in git_output("-C", cwd, "diff", "--name-only").splitlines() if f.strip()]
    staged = [f for f in git_output("-C", cwd, "diff", "--cached", "--name-only").splitlines() if f.strip()]
    untracked = [f for f in git_output("-C", cwd, "ls-files", "--others", "--exclude-standard").splitlines() if f.strip()]
    return {
        "modified": sorted(set(modified)),
        "staged": sorted(set(staged)),
        "untracked": sorted(set(untracked)),
    }


def is_dirty(status: dict[str, list[str]]) -> bool:
    """Return True if working tree contains modified, staged, or untracked files."""
    return bool(status.get("modified") or status.get("staged") or status.get("untracked"))


def get_current_branch(root: Path | None = None) -> str:
    """Return name of the active Git branch."""
    cwd = str(root or ROOT)
    branch = git_output("-C", cwd, "rev-parse", "--abbrev-ref", "HEAD").strip()
    return branch or "main"


def get_available_branches(root: Path | None = None) -> set[str]:
    """Return set of local and remote branch names."""
    cwd = str(root or ROOT)
    local = [b.strip() for b in git_output("-C", cwd, "branch", "--format=%(refname:short)").splitlines() if b.strip()]
    remote = [
        b.strip().replace("origin/", "")
        for b in git_output("-C", cwd, "branch", "-r", "--format=%(refname:short)").splitlines()
        if b.strip() and "HEAD" not in b
    ]
    return set(local) | set(remote)


def execute_commit(
    message: str,
    all_files: bool = False,
    files: list[str] | None = None,
    allow_empty: bool = False,
    dry_run: bool = False,
    root: Path | None = None,
) -> dict[str, str | bool | list[str]]:
    """Create a scoped or all-inclusive Git commit."""
    target_root = root or ROOT
    status = get_git_status(target_root)
    scoped_files = [item for item in (files or []) if item]

    if all_files and scoped_files:
        return {
            "success": False,
            "error": "Use either --files for an explicit file scope or --all for the complete worktree, not both.",
        }
    if not all_files and not scoped_files:
        return {
            "success": False,
            "error": "Commit requires an explicit file scope (--files) or --all when the complete worktree is authorized.",
        }

    if dry_run:
        return {
            "success": True,
            "dry_run": True,
            "message": message,
            "all_files": all_files,
            "files": scoped_files,
            "status": status,
        }

    if all_files:
        run(["git", "-C", str(target_root), "add", "-A"], check=True)
        refreshed_status = get_git_status(target_root)
        if not refreshed_status["staged"] and not allow_empty:
            return {
                "success": False,
                "error": "Nothing to commit for the authorized complete worktree.",
            }
        cmd = ["git", "-C", str(target_root), "commit", "-m", message]
        if allow_empty:
            cmd.append("--allow-empty")
        commit_res = run(cmd, capture=True)
        staged_files = refreshed_status["staged"]
    elif scoped_files:
        commit_res = commit_paths(
            target_root,
            scoped_files,
            message,
            runner=run,
            allow_empty=allow_empty,
        )
        staged_files = scoped_files
    else:
        return {
            "success": False,
            "error": "Commit requires an explicit file scope (--files) or --all when the complete worktree is authorized.",
        }
    if commit_res.returncode != 0:
        return {
            "success": False,
            "error": f"git commit failed: {commit_res.stderr.strip() or commit_res.stdout.strip()}",
        }

    commit_hash = git_output("-C", str(target_root), "rev-parse", "--short", "HEAD").strip()
    return {
        "success": True,
        "commit": commit_hash,
        "message": message,
        "staged_files": staged_files,
    }


def execute_checkpoint(
    message: str | None = None,
    dry_run: bool = False,
    root: Path | None = None,
) -> dict[str, str | bool | list[str]]:
    """Stage all current working changes and create a checkpoint commit."""
    target_root = root or ROOT
    status = get_git_status(target_root)

    if not is_dirty(status):
        return {
            "success": True,
            "noop": True,
            "message": "Working tree is clean; no checkpoint commit needed.",
        }

    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
    commit_msg = message or f"chore: checkpoint work-in-progress [{timestamp}]"

    if dry_run:
        return {
            "success": True,
            "dry_run": True,
            "message": commit_msg,
            "dirty_files": status["modified"] + status["staged"] + status["untracked"],
        }

    run(["git", "-C", str(target_root), "add", "-A"], check=True)
    commit_res = run(["git", "-C", str(target_root), "commit", "-m", commit_msg], capture=True)
    if commit_res.returncode != 0:
        return {
            "success": False,
            "error": f"Checkpoint commit failed: {commit_res.stderr.strip() or commit_res.stdout.strip()}",
        }

    commit_hash = git_output("-C", str(target_root), "rev-parse", "--short", "HEAD").strip()
    return {
        "success": True,
        "commit": commit_hash,
        "message": commit_msg,
        "checkpoint": True,
    }


def ls_remote_sha(root: Path, remote: str, ref: str) -> tuple[str | None, str | None]:
    """Return (sha, error) for an exact remote ref. Peeled tag lines are ignored."""
    ls_res = run(["git", "-C", str(root), "ls-remote", remote, ref], capture=True)
    if ls_res.returncode != 0:
        return None, ls_res.stderr.strip() or ls_res.stdout.strip() or "ls-remote failed"
    for line in ls_res.stdout.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1] == ref:
            return parts[0].strip(), None
    return None, None


def _is_ancestor(root: Path, maybe_ancestor: str, maybe_descendant: str) -> bool:
    result = run(
        ["git", "-C", str(root), "merge-base", "--is-ancestor", maybe_ancestor, maybe_descendant],
        capture=True,
    )
    return result.returncode == 0


def push_exact_ref(root: Path, remote: str, local_ref: str, remote_ref: str) -> dict[str, str | bool | None]:
    """Push one exact refspec without force and verify the published remote object."""
    local_sha = git_output("-C", str(root), "rev-parse", local_ref).strip()
    if not local_sha:
        return {
            "success": False,
            "ref": remote_ref,
            "error": f"Local ref '{local_ref}' does not exist.",
        }
    remote_sha, ls_error = ls_remote_sha(root, remote, remote_ref)
    if ls_error:
        return {
            "success": False,
            "ref": remote_ref,
            "local_sha": local_sha,
            "error": f"Remote verification unavailable for '{remote_ref}': {ls_error}",
        }
    if remote_sha == local_sha:
        return {
            "success": True,
            "ref": remote_ref,
            "local_sha": local_sha,
            "remote_sha": remote_sha,
            "already_published": True,
        }
    if remote_sha and remote_sha != local_sha:
        if remote_ref.startswith("refs/tags/"):
            return {
                "success": False,
                "ref": remote_ref,
                "local_sha": local_sha,
                "remote_sha": remote_sha,
                "error": (
                    f"Refusing to rewrite published tag '{remote_ref}' on '{remote}': "
                    f"remote has {remote_sha[:7]} but local is {local_sha[:7]}."
                ),
            }
        if not _is_ancestor(root, remote_sha, local_sha):
            return {
                "success": False,
                "ref": remote_ref,
                "local_sha": local_sha,
                "remote_sha": remote_sha,
                "error": (
                    f"Refusing to force-push '{remote_ref}' on '{remote}': "
                    f"remote has {remote_sha[:7]} and local {local_sha[:7]} is not a fast-forward."
                ),
            }
    push_res = run(
        ["git", "-C", str(root), "push", remote, f"{local_ref}:{remote_ref}"],
        capture=True,
    )
    if push_res.returncode != 0:
        return {
            "success": False,
            "ref": remote_ref,
            "local_sha": local_sha,
            "error": f"git push failed for '{remote_ref}': {push_res.stderr.strip() or push_res.stdout.strip()}",
        }
    published_sha, verify_error = ls_remote_sha(root, remote, remote_ref)
    if verify_error:
        return {
            "success": False,
            "ref": remote_ref,
            "local_sha": local_sha,
            "error": f"Remote verification unavailable for '{remote_ref}' after push: {verify_error}",
        }
    if not published_sha:
        return {
            "success": False,
            "ref": remote_ref,
            "local_sha": local_sha,
            "error": f"Remote verification failed: '{remote_ref}' is missing on '{remote}' after push.",
        }
    if published_sha != local_sha:
        return {
            "success": False,
            "ref": remote_ref,
            "local_sha": local_sha,
            "remote_sha": published_sha,
            "error": (
                f"Remote verification failed: '{remote}' has {published_sha[:7]} for '{remote_ref}' "
                f"but local is {local_sha[:7]}."
            ),
        }
    return {
        "success": True,
        "ref": remote_ref,
        "local_sha": local_sha,
        "remote_sha": published_sha,
    }


def execute_push(
    branch: str | None = None,
    tags: list[str] | None = None,
    remote: str = "origin",
    dry_run: bool = False,
    root: Path | None = None,
    push_tags: bool = False,
) -> dict[str, str | bool | list[str]]:
    """Publish exact approved branch and tag refs. Never force-push or rewrite a published tag."""
    target_root = root or ROOT
    target_branch = branch or get_current_branch(target_root)
    tag_list = [item for item in (tags or []) if item]
    if push_tags and not tag_list:
        return {
            "success": False,
            "error": "Push requires exact tag refs; unnamed --tags is not allowed.",
        }

    remotes = [r.strip() for r in git_output("-C", str(target_root), "remote").splitlines() if r.strip()]
    if remote not in remotes:
        return {
            "success": False,
            "error": f"Remote '{remote}' is not configured in git repository.",
        }

    tracking_res = run(
        ["git", "-C", str(target_root), "rev-parse", "--abbrev-ref", f"{target_branch}@{{upstream}}"],
        capture=True,
    )
    upstream = tracking_res.stdout.strip() if tracking_res.returncode == 0 else None

    if upstream:
        behind_count = git_output(
            "-C",
            str(target_root),
            "rev-list",
            "--count",
            f"{target_branch}..{upstream}",
        ).strip()
        if behind_count and behind_count != "0":
            return {
                "success": False,
                "error": f"Branch '{target_branch}' is behind upstream '{upstream}' by {behind_count} commit(s). Sync before pushing.",
            }

    branch_ref = f"refs/heads/{target_branch}"
    tag_refs = [tag if tag.startswith("refs/tags/") else f"refs/tags/{tag}" for tag in tag_list]
    if dry_run:
        return {
            "success": True,
            "dry_run": True,
            "remote": remote,
            "branch": target_branch,
            "tags": tag_list,
            "upstream": upstream,
        }

    for tag, tag_ref in zip(tag_list, tag_refs):
        local_tag = git_output("-C", str(target_root), "rev-parse", tag_ref).strip()
        if not local_tag:
            return {
                "success": False,
                "error": f"Local tag '{tag}' does not exist.",
            }
        remote_tag, ls_error = ls_remote_sha(target_root, remote, tag_ref)
        if ls_error:
            return {
                "success": False,
                "error": f"Remote tag verification unavailable for '{tag_ref}': {ls_error}",
            }
        if remote_tag and remote_tag != local_tag:
            return {
                "success": False,
                "error": (
                    f"Refusing to rewrite published tag '{tag}' on '{remote}': "
                    f"remote has {remote_tag[:7]} but local is {local_tag[:7]}."
                ),
                "local_sha": local_tag,
                "remote_sha": remote_tag,
            }

    branch_result = push_exact_ref(target_root, remote, branch_ref, branch_ref)
    if not branch_result.get("success"):
        return {
            "success": False,
            "error": str(branch_result.get("error") or f"Failed to push '{branch_ref}'."),
            "remote": remote,
            "branch": target_branch,
            "tags": tag_list,
        }

    pushed_tags: list[str] = []
    for tag, tag_ref in zip(tag_list, tag_refs):
        tag_result = push_exact_ref(target_root, remote, tag_ref, tag_ref)
        if not tag_result.get("success"):
            return {
                "success": False,
                "error": str(tag_result.get("error") or f"Failed to push '{tag_ref}'."),
                "remote": remote,
                "branch": target_branch,
                "tags": pushed_tags,
                "branch_pushed": True,
            }
        pushed_tags.append(tag)

    return {
        "success": True,
        "remote": remote,
        "branch": target_branch,
        "tags": pushed_tags,
        "tags_pushed": bool(pushed_tags),
    }
