#!/usr/bin/env python3
"""SemVer version bumping, manifest synchronization, and tagging module."""

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
    commit_paths,
    bump_semver,
    get_project_version,
    git_output,
    is_valid_semver,
    parse_semver,
    run,
    update_project_manifests,
)

from git_ops import get_git_status, is_dirty


def execute_bump(
    bump_type: str = "patch",
    create_commit: bool = True,
    create_tag: bool = True,
    message: str | None = None,
    allow_dirty: bool = False,
    force_tag: bool = False,
    dry_run: bool = False,
    root: Path | None = None,
) -> dict[str, str | bool | list[str]]:
    """Increment version in project manifests and create git commit and annotated tag."""
    target_root = root or ROOT
    current_version = get_project_version(target_root)

    if bump_type in ("none", "get"):
        return {
            "success": True,
            "current_version": current_version,
            "target_version": current_version,
            "updated_files": [],
        }

    status = get_git_status(target_root)
    if is_dirty(status) and not allow_dirty and not dry_run:
        dirty_items = status["modified"] + status["staged"] + status["untracked"]
        return {
            "success": False,
            "error": f"Working tree is dirty with {len(dirty_items)} file(s). Use --allow-dirty or commit/stash changes first.",
            "dirty_files": dirty_items,
        }

    target_version = bump_semver(current_version, bump_type)

    if create_tag and target_version != "0.0.0" and not dry_run:
        existing_tags = git_output("-C", str(target_root), "tag", "-l", target_version).splitlines()
        if target_version in existing_tags and not force_tag:
            return {
                "success": False,
                "error": f"Tag '{target_version}' already exists locally. Use --force-tag to overwrite existing tag.",
            }

    if dry_run:
        return {
            "success": True,
            "dry_run": True,
            "current_version": current_version,
            "target_version": target_version,
            "will_commit": create_commit,
            "will_tag": create_tag,
        }

    updated_files = update_project_manifests(target_version, target_root)

    commit_created = False
    commit_hash = ""
    if create_commit:
        commit_msg = message or f"chore: bump version to {target_version}"
        commit_res = commit_paths(target_root, updated_files, commit_msg, runner=run)
        if commit_res.returncode != 0:
            return {'success': False, 'error': f'Version commit failed: {commit_res.stderr or commit_res.stdout}',
                    'updated_files': updated_files, 'commit_created': False, 'tag_created': False}
        if commit_res.returncode == 0:
            commit_created = True
            commit_hash = git_output("-C", str(target_root), "rev-parse", "--short", "HEAD").strip()

    tag_created = False
    if create_tag and target_version != "0.0.0":
        existing_tags = git_output("-C", str(target_root), "tag", "-l", target_version).splitlines()
        if target_version in existing_tags and not force_tag:
            return {
                "success": False,
                "error": f"Tag '{target_version}' already exists locally. Use --force-tag to overwrite existing tag.",
            }
        tag_args = ["git", "-C", str(target_root), "tag", "-a", target_version, "-m", target_version]
        if target_version in existing_tags and force_tag:
            tag_args.insert(4, "-f")
        run(tag_args, check=True)
        tag_created = True

    return {
        "success": True,
        "current_version": current_version,
        "target_version": target_version,
        "updated_files": updated_files,
        "commit_created": commit_created,
        "commit": commit_hash,
        "tag_created": tag_created,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bump", nargs="?", default="patch", help="Bump type: patch (default), minor, major, explicit semver, or get")
    parser.add_argument("-c", "--commit", dest="commit", action="store_true", default=True, help="Create a git commit with the version change (default: true)")
    parser.add_argument("--no-commit", dest="commit", action="store_false", help="Do not create a git commit")
    parser.add_argument("-t", "--tag", dest="tag", action="store_true", default=True, help="Create a git tag for the new version (default: true)")
    parser.add_argument("--no-tag", dest="tag", action="store_false", help="Do not create a git tag")
    parser.add_argument("-m", "--message", help="Commit message override")
    parser.add_argument("--allow-dirty", action="store_true", help="Allow bumping with dirty working tree")
    parser.add_argument("--force-tag", action="store_true", help="Allow overwriting existing tag (git tag -f)")
    parser.add_argument("--dry-run", action="store_true", help="Simulate bump without modifying files")
    parser.add_argument("--json", action="store_true", help="Output in JSON format")

    args = parser.parse_args()

    try:
        result = execute_bump(
            bump_type=args.bump,
            create_commit=args.commit,
            create_tag=args.tag,
            message=args.message,
            allow_dirty=args.allow_dirty,
            force_tag=args.force_tag,
            dry_run=args.dry_run,
        )
    except Exception as exc:
        result = {"success": False, "error": str(exc)}

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if result.get("success"):
            if result.get("dry_run"):
                print(f"[DRY-RUN] Version would bump from {result['current_version']} to {result['target_version']}")
            elif args.bump in ("none", "get"):
                print(f"Current version: {result['current_version']}")
            else:
                print(f"Version bumped: {result['current_version']} -> {result['target_version']}")
                if result.get("updated_files"):
                    print("Updated files:", ", ".join(result["updated_files"]))
                if result.get("commit_created"):
                    print(f"Commit created: {result.get('commit')}")
                if result.get("tag_created"):
                    print(f"Tag created: {result['target_version']}")
        else:
            print(f"ERROR: {result.get('error')}", file=sys.stderr)
            if "dirty_files" in result:
                print("Dirty files:", file=sys.stderr)
                for item in result["dirty_files"]:
                    print(f"  - {item}", file=sys.stderr)

    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
