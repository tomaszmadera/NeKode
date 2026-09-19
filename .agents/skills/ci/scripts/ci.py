#!/usr/bin/env python3
"""Unified CI & Git operations CLI entrypoint."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Add current directory and scripts directory to sys.path
CURRENT_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = CURRENT_DIR.parents[2] / "scripts"
for path in (str(CURRENT_DIR), str(SCRIPTS_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

from bump import execute_bump
from deploy import execute_deploy
from git_flow import execute_finish, execute_git_flow_release, publication_strategy
from git_ops import execute_checkpoint, execute_commit, execute_push, get_git_status
from publication_status import execute_publication_status
from release import execute_release


def _add_root_flag(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--root",
        default=None,
        help="Repository root to operate on (default: this project)",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ci",
        description="Unified CI, Git version control, release, and deployment tool.",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available subcommands")

    # 1. commit
    p_commit = subparsers.add_parser("commit", help="Create a standard or scoped Git commit")
    p_commit.add_argument("-m", "--message", required=True, help="Commit message")
    p_commit.add_argument("-a", "--all", dest="all_files", action="store_true", help="Stage all changes before committing")
    p_commit.add_argument("-f", "--files", nargs="+", help="Specific files to stage and commit")
    p_commit.add_argument("--allow-empty", action="store_true", help="Allow empty commit")
    p_commit.add_argument("--dry-run", action="store_true", help="Preview commit without modifying git state")
    p_commit.add_argument("--json", action="store_true", help="Output in JSON format")
    _add_root_flag(p_commit)

    # 2. checkpoint
    p_checkpoint = subparsers.add_parser("checkpoint", help="Stage all changes and create a work-in-progress checkpoint commit")
    p_checkpoint.add_argument("-m", "--message", help="Optional checkpoint commit message override")
    p_checkpoint.add_argument("--dry-run", action="store_true", help="Preview checkpoint without modifying git state")
    p_checkpoint.add_argument("--json", action="store_true", help="Output in JSON format")
    _add_root_flag(p_checkpoint)

    # 3. bump
    p_bump = subparsers.add_parser("bump", help="Increment project version in manifests, commit and tag")
    p_bump.add_argument("bump_type", nargs="?", default="patch", help="Bump type: patch (default), minor, major, explicit version, or get")
    p_bump.add_argument("-m", "--message", help="Commit message override")
    p_bump.add_argument("-c", "--commit", dest="commit", action="store_true", default=True, help="Create git commit (default: true)")
    p_bump.add_argument("--no-commit", dest="commit", action="store_false", help="Do not create git commit")
    p_bump.add_argument("-t", "--tag", dest="tag", action="store_true", default=True, help="Create git tag (default: true)")
    p_bump.add_argument("--no-tag", dest="tag", action="store_false", help="Do not create git tag")
    p_bump.add_argument("--allow-dirty", action="store_true", help="Allow bumping with dirty working tree")
    p_bump.add_argument("--force-tag", action="store_true", help="Allow overwriting existing tag (git tag -f)")
    p_bump.add_argument("--dry-run", action="store_true", help="Simulate bump without modifying files or git")
    p_bump.add_argument("--json", action="store_true", help="Output in JSON format")
    _add_root_flag(p_bump)

    # 4. tag (identical to bump: updates manifests, commits and tags)
    p_tag = subparsers.add_parser("tag", help="Synchronize manifests and create version tag (alias for bump)")
    p_tag.add_argument("bump_type", nargs="?", default="patch", help="Version bump or explicit tag name: patch (default), minor, major, or explicit version")
    p_tag.add_argument("-m", "--message", help="Commit message override")
    p_tag.add_argument("-c", "--commit", dest="commit", action="store_true", default=True, help="Create git commit (default: true)")
    p_tag.add_argument("--no-commit", dest="commit", action="store_false", help="Do not create git commit")
    p_tag.add_argument("-t", "--tag", dest="tag", action="store_true", default=True, help="Create git tag (default: true)")
    p_tag.add_argument("--no-tag", dest="tag", action="store_false", help="Do not create git tag")
    p_tag.add_argument("--allow-dirty", action="store_true", help="Allow tagging with dirty working tree")
    p_tag.add_argument("--force-tag", action="store_true", help="Allow overwriting existing tag (git tag -f)")
    p_tag.add_argument("--dry-run", action="store_true", help="Simulate tagging without modifying files or git")
    p_tag.add_argument("--json", action="store_true", help="Output in JSON format")
    _add_root_flag(p_tag)

    # 5. push
    p_push = subparsers.add_parser("push", help="Push exact approved branch and tag refs")
    p_push.add_argument("-b", "--branch", help="Target branch name (default: current branch)")
    p_push.add_argument(
        "-t",
        "--tag",
        dest="tags",
        action="append",
        default=None,
        help="Tag name or exact refs/tags/... ref to push (repeatable)",
    )
    p_push.add_argument("-r", "--remote", default="origin", help="Remote name (default: origin)")
    p_push.add_argument("--dry-run", action="store_true", help="Verify remote state without pushing")
    p_push.add_argument("--json", action="store_true", help="Output in JSON format")
    _add_root_flag(p_push)

    # 6. release
    p_release = subparsers.add_parser("release", help="Run quality checks, merge branch, bump version, tag, and publish")
    p_release.add_argument("--bump", default="patch", help="Semver bump: patch (default), minor, major, none, or explicit version")
    p_release.add_argument("--into", dest="into", default=None, help="Target branch to merge into (default: develop or main)")
    p_release.add_argument("--no-merge", action="store_true", help="Do not merge feature branch; release in-place")
    p_release.add_argument("--delete-branch", action="store_true", help="Delete feature branch after successful release")
    p_release.add_argument("-m", "--message", help="Commit message override")
    p_release.add_argument("--allow-dirty", action="store_true", help="Allow staging uncommitted changes into release commit")
    p_release.add_argument("--force-tag", action="store_true", help="Allow overwriting an existing local tag (git tag -f)")
    p_release.add_argument("--skip-push", action="store_true", help="Do not push commits and tags to origin")
    p_release.add_argument("--skip-checks", action="store_true", help="Skip pre-release tests and validations")
    p_release.add_argument("--dry-run", action="store_true", help="Simulate release without modifying git or files")
    p_release.add_argument("--json", action="store_true", help="Output results in JSON format")
    _add_root_flag(p_release)

    # 7. deploy
    p_deploy = subparsers.add_parser("deploy", help="Run pre-deploy checks and execute deployment to target environment")
    p_deploy.add_argument("target", nargs="?", default="test", choices=["test", "prod"], help="Target environment: test (default) or prod")
    p_deploy.add_argument("--allow-dirty", action="store_true", help="Allow deploying with dirty working tree")
    p_deploy.add_argument("--skip-checks", action="store_true", help="Skip pre-deploy tests and validations")
    p_deploy.add_argument("--dry-run", action="store_true", help="Simulate deployment without executing command")
    p_deploy.add_argument("--json", action="store_true", help="Output in JSON format")
    _add_root_flag(p_deploy)

    # 8. status
    p_status = subparsers.add_parser("status", help="Inspect git status and dirty files")
    p_status.add_argument("--json", action="store_true", help="Output in JSON format")
    _add_root_flag(p_status)

    # 8b. finish
    p_finish = subparsers.add_parser("finish", help="Finish the current git-flow feature branch")
    p_finish.add_argument("--dry-run", action="store_true", help="Preview finish without modifying git state")
    p_finish.add_argument("--json", action="store_true", help="Output in JSON format")
    _add_root_flag(p_finish)

    # 9. publication-status
    p_publication = subparsers.add_parser(
        "publication-status",
        help="Report read-only publication facts without recommending an action",
    )
    p_publication.add_argument("--json", action="store_true", help="Output in JSON format")
    p_publication.add_argument(
        "--root",
        default=None,
        help="Repository root to inspect (default: this project)",
    )

    return parser


def _root_from_args(args: argparse.Namespace) -> Path | None:
    value = getattr(args, "root", None)
    return Path(value) if value else None


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    result: dict[str, str | bool | list[str]] = {}
    root = _root_from_args(args)

    try:
        if args.command == "commit":
            result = execute_commit(
                message=args.message,
                all_files=args.all_files,
                files=args.files,
                allow_empty=args.allow_empty,
                dry_run=args.dry_run,
                root=root,
            )
        elif args.command == "checkpoint":
            result = execute_checkpoint(
                message=args.message,
                dry_run=args.dry_run,
                root=root,
            )
        elif args.command in ("bump", "tag"):
            result = execute_bump(
                bump_type=args.bump_type,
                create_commit=args.commit,
                create_tag=args.tag,
                message=args.message,
                allow_dirty=args.allow_dirty,
                force_tag=getattr(args, "force_tag", False),
                dry_run=args.dry_run,
                root=root,
            )
        elif args.command == "push":
            result = execute_push(
                branch=args.branch,
                tags=args.tags,
                remote=args.remote,
                dry_run=args.dry_run,
                root=root,
            )
        elif args.command == "finish":
            result = execute_finish(dry_run=args.dry_run, root=root)
        elif args.command == "release":
            if publication_strategy(root) == "git-flow":
                result = execute_git_flow_release(
                    bump=args.bump,
                    message=args.message,
                    skip_push=args.skip_push,
                    dry_run=args.dry_run,
                    root=root,
                )
            else:
                result = execute_release(
                    bump=args.bump,
                    into=args.into,
                    no_merge=args.no_merge,
                    delete_branch=args.delete_branch,
                    message=args.message,
                    allow_dirty=args.allow_dirty,
                    force_tag=getattr(args, "force_tag", False),
                    skip_push=args.skip_push,
                    skip_checks=args.skip_checks,
                    dry_run=args.dry_run,
                    root=root,
                )
        elif args.command == "deploy":
            result = execute_deploy(
                target=args.target,
                allow_dirty=args.allow_dirty,
                skip_checks=args.skip_checks,
                dry_run=args.dry_run,
                root=root,
            )
        elif args.command == "status":
            status = get_git_status(root)
            result = {
                "success": True,
                "status": status,
                "is_dirty": bool(status["modified"] or status["staged"] or status["untracked"]),
            }
        elif args.command == "publication-status":
            result = execute_publication_status(root=root)
    except Exception as exc:
        result = {"success": False, "error": str(exc)}

    # Output handling
    is_json = getattr(args, "json", False)
    if is_json:
        print(json.dumps(result, indent=2))
    else:
        if result.get("success"):
            if result.get("dry_run"):
                print(f"[DRY-RUN] {args.command.upper()} operation simulation successful:")
                for k, v in result.items():
                    if k not in ("success", "dry_run"):
                        print(f"  {k}: {v}")
            elif args.command in ("bump", "tag"):
                if args.bump_type in ("none", "get"):
                    print(f"Current version: {result['current_version']}")
                else:
                    print(f"Version updated: {result['current_version']} -> {result['target_version']}")
                    if result.get("updated_files"):
                        print("Updated manifests:", ", ".join(result["updated_files"]))
                    if result.get("commit_created"):
                        print(f"Commit created: {result.get('commit')}")
                    if result.get("tag_created"):
                        print(f"Tag created: {result['target_version']}")
            elif args.command == "checkpoint":
                if result.get("noop"):
                    print(result.get("message"))
                else:
                    print(f"Checkpoint created: {result.get('commit')} ({result.get('message')})")
            elif args.command == "commit":
                print(f"Commit created: {result.get('commit')} ({result.get('message')})")
            elif args.command == "push":
                tags = result.get("tags") or []
                tag_info = f" and tags {', '.join(tags)}" if tags else ""
                print(f"Successfully pushed branch '{result['branch']}'{tag_info} to '{result['remote']}'.")
            elif args.command == "finish":
                print(f"Finished git-flow feature '{result.get('feature')}' on '{result.get('branch')}'.")
            elif args.command == "release":
                if result.get("refs"):
                    print(f"Git-flow release {result.get('version')} completed.")
                    for name, entry in result["refs"].items():
                        print(f"  {name}: {entry.get('ref')} verified={entry.get('verified')}")
                else:
                    merge_info = f" (merged '{result['current_branch']}' into '{result['target_branch']}')" if result.get("merged") else ""
                    print(f"Release {result['version']}{merge_info} completed successfully on '{result['target_branch']}'.")
                    print(f"Commit: {result['commit']}, Tag: {result['version']}, Pushed: {result['pushed']}")
            elif args.command == "deploy":
                print(f"Deployment to '{result['target']}' completed successfully.")
                if result.get("output"):
                    print(result["output"])
            elif args.command == "status":
                status = result["status"]
                print(f"Worktree status: {'DIRTY' if result['is_dirty'] else 'CLEAN'}")
                if status["modified"]:
                    print("Modified:", ", ".join(status["modified"]))
                if status["staged"]:
                    print("Staged:", ", ".join(status["staged"]))
                if status["untracked"]:
                    print("Untracked:", ", ".join(status["untracked"]))
            elif args.command == "publication-status":
                print(json.dumps(result, indent=2))
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
            if "output" in result and result.get("output"):
                print("Output:\n" + result["output"], file=sys.stderr)
            if isinstance(result.get("refs"), dict):
                print("Ref verification:", file=sys.stderr)
                for name, entry in result["refs"].items():
                    print(f"  {name}: {entry}", file=sys.stderr)

    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
