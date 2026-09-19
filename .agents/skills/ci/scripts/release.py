#!/usr/bin/env python3
"""Unified Git release, branch integration, tagging, and publishing module."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = Path(__file__).resolve().parents[3] / "scripts"
for p in (str(CURRENT_DIR), str(SCRIPTS_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from common import (
    ROOT,
    bump_semver,
    get_project_version,
    git_output,
    is_valid_semver,
    parse_semver,
    run,
    run_full_gate,
    update_project_manifests,
)

from git_ops import execute_push, get_available_branches, get_current_branch, get_git_status, is_dirty


def resolve_target_branch(current_branch: str, explicit_into: str | None = None, root: Path | None = None) -> str:
    """Determine integration/release branch (develop, main, master, or explicit)."""
    if explicit_into:
        return explicit_into
    available = get_available_branches(root)
    if "develop" in available and current_branch != "develop":
        return "develop"
    if "main" in available and current_branch != "main":
        return "main"
    if "master" in available and current_branch != "master":
        return "master"
    return current_branch


def run_checks(root: Path | None = None) -> list[str]:
    return run_full_gate(root or ROOT, runner=run)


def execute_release(
    bump: str = "patch",
    into: str | None = None,
    no_merge: bool = False,
    delete_branch: bool = False,
    message: str | None = None,
    allow_dirty: bool = False,
    force_tag: bool = False,
    skip_push: bool = False,
    skip_checks: bool = False,
    dry_run: bool = False,
    root: Path | None = None,
) -> dict[str, str | bool | list[str]]:
    """Execute complete Git release pipeline."""
    target_root = root or ROOT
    current_branch = get_current_branch(target_root)

    if no_merge:
        target_branch = current_branch
    else:
        target_branch = resolve_target_branch(current_branch, into, target_root)

    should_merge = (target_branch != current_branch)

    status = get_git_status(target_root)
    if is_dirty(status) and not allow_dirty and not dry_run:
        dirty_items = status["modified"] + status["staged"] + status["untracked"]
        return {
            "success": False,
            "error": f"Working tree is dirty with {len(dirty_items)} file(s). Use --allow-dirty or commit/stash changes first.",
            "dirty_files": dirty_items,
        }

    # Determine current version
    current_version = get_project_version(target_root)

    # Calculate target version
    if bump == "none":
        target_version = current_version
    else:
        target_version = bump_semver(current_version, bump)

    existing_tags: list[str] = []
    if not dry_run and bump != "none":
        existing_tags = git_output("-C", str(target_root), "tag", "-l", target_version).splitlines()
        if target_version in existing_tags and not force_tag:
            return {
                "success": False,
                "error": f"Tag '{target_version}' already exists locally. Use --force-tag to overwrite existing tag.",
            }

    commit_msg = message or f"chore(release): {target_version}"

    if dry_run:
        return {
            "success": True,
            "dry_run": True,
            "current_branch": current_branch,
            "target_branch": target_branch,
            "should_merge": should_merge,
            "current_version": current_version,
            "target_version": target_version,
            "commit_message": commit_msg,
            "will_push": not skip_push,
            "delete_branch": delete_branch if should_merge else False,
        }

    # If dirty and allow_dirty on feature branch before merge
    if is_dirty(status) and allow_dirty:
        run(["git", "-C", str(target_root), "add", "-A"], check=True)
        run(["git", "-C", str(target_root), "commit", "-m", f"chore: stage working changes on {current_branch} before release"], check=False)

    # If merging feature branch into base/target branch
    if should_merge:
        # 1. Ensure target branch is available locally
        local_branches = [b.strip() for b in git_output("-C", str(target_root), "branch", "--format=%(refname:short)").splitlines()]
        if target_branch not in local_branches:
            checkout_res = run(["git", "-C", str(target_root), "checkout", "-b", target_branch, f"origin/{target_branch}"], capture=True)
            if checkout_res.returncode != 0:
                run(["git", "-C", str(target_root), "checkout", "-b", target_branch], check=True)
            run(["git", "-C", str(target_root), "checkout", current_branch], check=True)

        # 2. Fetch remote target branch and verify no divergence before merging
        fetch_res = run(["git", "-C", str(target_root), "fetch", "origin", target_branch], capture=True)
        if fetch_res.returncode == 0:
            local_sha = git_output("-C", str(target_root), "rev-parse", target_branch).strip()
            remote_sha = git_output("-C", str(target_root), "rev-parse", f"origin/{target_branch}").strip()
            if remote_sha and local_sha and remote_sha != local_sha:
                behind_remote = git_output("-C", str(target_root), "rev-list", "--count", f"{target_branch}..origin/{target_branch}").strip()
                ahead_remote = git_output("-C", str(target_root), "rev-list", "--count", f"origin/{target_branch}..{target_branch}").strip()
                if behind_remote and behind_remote != "0":
                    return {
                        "success": False,
                        "error": f"Local branch '{target_branch}' is behind 'origin/{target_branch}' by {behind_remote} commit(s) (local {local_sha[:7]} vs remote {remote_sha[:7]}). Fetch and sync before releasing.",
                    }
                if ahead_remote and ahead_remote != "0":
                    return {
                        "success": False,
                        "error": f"Local branch '{target_branch}' has diverged from 'origin/{target_branch}' (local {local_sha[:7]} ahead by {ahead_remote}, remote {remote_sha[:7]}). Sync before releasing.",
                    }
                return {
                    "success": False,
                    "error": f"Local branch '{target_branch}' ({local_sha[:7]}) diverges from 'origin/{target_branch}' ({remote_sha[:7]}). Sync before releasing.",
                }

        # 3. Check if target_branch is ahead and sync into current_branch first
        behind_count = git_output("-C", str(target_root), "rev-list", "--count", f"HEAD..{target_branch}").strip()
        if behind_count and behind_count != "0":
            sync_res = run(["git", "-C", str(target_root), "merge", "--no-edit", target_branch], capture=True)
            if sync_res.returncode != 0:
                run(["git", "-C", str(target_root), "merge", "--abort"], check=False)
                return {
                    "success": False,
                    "error": f"Conflict while synchronizing '{current_branch}' with '{target_branch}'. Resolve conflicts manually before releasing.",
                }

        # 4. Checkout target branch
        checkout_target = run(["git", "-C", str(target_root), "checkout", target_branch], capture=True)
        if checkout_target.returncode != 0:
            return {
                "success": False,
                "error": f"Failed to checkout target branch '{target_branch}': {checkout_target.stderr.strip()}",
            }

        # 5. Merge feature branch into target branch with --no-ff
        merge_res = run(["git", "-C", str(target_root), "merge", "--no-ff", current_branch, "-m", f"Merge branch '{current_branch}' into {target_branch}"], capture=True)
        if merge_res.returncode != 0:
            run(["git", "-C", str(target_root), "merge", "--abort"], check=False)
            run(["git", "-C", str(target_root), "checkout", current_branch], check=False)
            return {
                "success": False,
                "error": f"Conflict while merging '{current_branch}' into '{target_branch}': {merge_res.stderr.strip() or merge_res.stdout.strip()}",
            }

    # Run checks on target branch before tagging
    if not skip_checks:
        check_errors = run_checks(target_root)
        if check_errors:
            return {
                "success": False,
                "error": "Quality checks failed before release",
                "check_errors": check_errors,
            }

    # Apply version changes
    updated_files = []
    if bump != "none":
        updated_files = update_project_manifests(target_version, target_root)

    # Stage files
    if updated_files:
        for f in updated_files:
            run(["git", "-C", str(target_root), "add", str(target_root / f)], check=False)
        run(["git", "-C", str(target_root), "commit", "-m", commit_msg], check=True)

    commit_hash = git_output("-C", str(target_root), "rev-parse", "--short", "HEAD").strip()

    # Create tag
    tag_created = False
    if target_version != "0.0.0":
        tag_args = ["git", "-C", str(target_root), "tag", "-a", target_version, "-m", target_version]
        if target_version in existing_tags:
            tag_args.insert(4, "-f")
        run(tag_args, check=True)
        tag_created = True

    # Push the branch through the canonical push path (remote-ref verification), then push
    # the tag and verify its remote ref before reporting success. The tag is never pushed
    # with -f, so a moved local tag cannot force-update the remote tag.
    pushed = False
    if not skip_push:
        push_result = execute_push(branch=target_branch, remote="origin", root=target_root)
        if not push_result.get("success") or push_result.get("verification_warning"):
            if should_merge:
                run(["git", "-C", str(target_root), "checkout", current_branch], check=False)
            return {
                "success": False,
                "error": f"Push failed: {push_result.get('error') or push_result.get('verification_warning') or 'unknown error'}",
                "version": target_version,
                "commit": commit_hash,
                "tag_created": tag_created,
            }
        if tag_created:
            tag_push_res = run(["git", "-C", str(target_root), "push", "origin", target_version], capture=True)
            if tag_push_res.returncode != 0:
                if should_merge:
                    run(["git", "-C", str(target_root), "checkout", current_branch], check=False)
                return {
                    "success": False,
                    "error": f"Tag push failed: {tag_push_res.stderr.strip() or tag_push_res.stdout.strip()}",
                    "version": target_version,
                    "commit": commit_hash,
                    "tag_created": tag_created,
                    "branch_pushed": True,
                }
            tag_ref = f"refs/tags/{target_version}"
            ls_res = run(["git", "-C", str(target_root), "ls-remote", "origin", tag_ref], capture=True)
            remote_sha = ""
            if ls_res.returncode == 0:
                for line in ls_res.stdout.splitlines():
                    parts = line.split()
                    if len(parts) == 2 and parts[1] == tag_ref:
                        remote_sha = parts[0]
                        break
            if ls_res.returncode != 0:
                if should_merge:
                    run(["git", "-C", str(target_root), "checkout", current_branch], check=False)
                return {
                    "success": False,
                    "error": f"Tag verification unavailable: {ls_res.stderr.strip() or ls_res.stdout.strip() or 'ls-remote failed'}",
                    "version": target_version,
                    "commit": commit_hash,
                    "tag_created": tag_created,
                    "branch_pushed": True,
                }
            if not remote_sha:
                if should_merge:
                    run(["git", "-C", str(target_root), "checkout", current_branch], check=False)
                return {
                    "success": False,
                    "error": f"Tag verification failed: '{tag_ref}' is missing on remote 'origin' after push.",
                    "version": target_version,
                    "commit": commit_hash,
                    "tag_created": tag_created,
                    "branch_pushed": True,
                }
            local_tag_sha = git_output("-C", str(target_root), "rev-parse", target_version).strip()
            if local_tag_sha and remote_sha != local_tag_sha:
                if should_merge:
                    run(["git", "-C", str(target_root), "checkout", current_branch], check=False)
                return {
                    "success": False,
                    "error": f"Tag verification failed: remote 'origin' has {remote_sha[:7]} for '{tag_ref}' but the local tag is {local_tag_sha[:7]}.",
                    "version": target_version,
                    "commit": commit_hash,
                    "tag_created": tag_created,
                    "branch_pushed": True,
                }
        pushed = True

    # Optional feature branch deletion after successful release
    if should_merge and delete_branch:
        run(["git", "-C", str(target_root), "branch", "-d", current_branch], check=False)

    return {
        "success": True,
        "current_branch": current_branch,
        "target_branch": target_branch,
        "merged": should_merge,
        "version": target_version,
        "commit": commit_hash,
        "tag_created": tag_created,
        "pushed": pushed,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bump", default="patch", help="Semver bump: patch (default), minor, major, none, or explicit version")
    parser.add_argument("--into", dest="into", default=None, help="Target branch to merge into (default: auto-detect develop or main/master)")
    parser.add_argument("--no-merge", action="store_true", help="Do not merge feature branch; release directly on active branch")
    parser.add_argument("--delete-branch", action="store_true", help="Delete feature branch after successful merge and release")
    parser.add_argument("-m", "--message", help="Commit message override")
    parser.add_argument("--allow-dirty", action="store_true", help="Allow staging uncommitted changes into release commit")
    parser.add_argument("--force-tag", action="store_true", help="Allow overwriting an existing local tag (git tag -f)")
    parser.add_argument("--skip-push", action="store_true", help="Do not push commits and tags to origin")
    parser.add_argument("--skip-checks", action="store_true", help="Skip pre-release tests and validations")
    parser.add_argument("--dry-run", action="store_true", help="Simulate release without modifying git or files")
    parser.add_argument("--json", action="store_true", help="Output results in JSON format")

    args = parser.parse_args()

    try:
        result = execute_release(
            bump=args.bump,
            into=args.into,
            no_merge=args.no_merge,
            delete_branch=args.delete_branch,
            message=args.message,
            allow_dirty=args.allow_dirty,
            force_tag=args.force_tag,
            skip_push=args.skip_push,
            skip_checks=args.skip_checks,
            dry_run=args.dry_run,
        )
    except Exception as exc:
        result = {"success": False, "error": str(exc)}

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if result.get("success"):
            if result.get("dry_run"):
                merge_info = f" -> merge into '{result['target_branch']}'" if result.get("should_merge") else ""
                print(f"[DRY-RUN] Release {result['target_version']} on branch '{result['current_branch']}'{merge_info} ready.")
                print(f"Commit message: {result['commit_message']}")
            else:
                merge_info = f" (merged '{result['current_branch']}' into '{result['target_branch']}')" if result.get("merged") else ""
                print(f"Release {result['version']}{merge_info} completed successfully on '{result['target_branch']}'.")
                print(f"Commit: {result['commit']}, Tag: {result['version']}, Pushed: {result['pushed']}")
        else:
            print(f"ERROR: {result.get('error')}", file=sys.stderr)
            if "dirty_files" in result:
                print("Dirty files:", file=sys.stderr)
                for item in result["dirty_files"]:
                    print(f"  - {item}", file=sys.stderr)
            if "check_errors" in result:
                print("Check errors:", file=sys.stderr)
                for item in result["check_errors"]:
                    print(f"  - {item}", file=sys.stderr)

    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
