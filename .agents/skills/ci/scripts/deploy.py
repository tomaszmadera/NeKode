#!/usr/bin/env python3
"""Deployment execution and pre-deploy validation module."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import sys
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = Path(__file__).resolve().parents[3] / "scripts"
for p in (str(CURRENT_DIR), str(SCRIPTS_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from common import ROOT, profile_values, run, run_full_gate

from git_ops import get_current_branch, get_git_status, is_dirty


def run_predeploy_checks(root: Path | None = None) -> list[str]:
    return run_full_gate(root or ROOT, runner=run)


def execute_deploy(
    target: str = "test",
    allow_dirty: bool = False,
    skip_checks: bool = False,
    dry_run: bool = False,
    root: Path | None = None,
) -> dict[str, str | bool | list[str]]:
    """Execute deployment to target environment (test, prod)."""
    target_root = root or ROOT
    current_branch = get_current_branch(target_root)

    # 1. Dirty check
    status = get_git_status(target_root)
    if is_dirty(status) and not allow_dirty and not dry_run:
        dirty_items = status["modified"] + status["staged"] + status["untracked"]
        return {
            "success": False,
            "error": f"Working tree is dirty with {len(dirty_items)} file(s). Use --allow-dirty or commit/stash changes first before deploying.",
            "dirty_files": dirty_items,
        }

    # 2. Pre-deploy quality checks
    if not skip_checks and not dry_run:
        check_errors = run_predeploy_checks(target_root)
        if check_errors:
            return {
                "success": False,
                "error": "Pre-deploy quality checks failed",
                "check_errors": check_errors,
            }

    # 3. Read profile command
    profile_path = target_root / ".agents" / "project-profile.yaml"
    if not profile_path.is_file():
        return {
            "success": False,
            "error": "Missing .agents/project-profile.yaml",
        }

    profile = profile_values(profile_path)
    commands = profile.get("commands", {})

    cmd_key = f"deploy_{target}"
    deploy_cmd = commands.get(cmd_key, "")

    if not deploy_cmd or deploy_cmd in ("not-configured", "none", "null"):
        return {
            "success": False,
            "error": f"Deployment command '{cmd_key}' is not configured in .agents/project-profile.yaml.",
        }

    # Format command (substitute {python})
    deploy_cmd_resolved = deploy_cmd.replace("{python}", sys.executable)

    if dry_run:
        return {
            "success": True,
            "dry_run": True,
            "target": target,
            "branch": current_branch,
            "command": deploy_cmd_resolved,
        }

    # 4. Execute deployment command
    deploy_res = run(shlex.split(deploy_cmd_resolved), capture=True)
    if deploy_res.returncode != 0:
        return {
            "success": False,
            "error": f"Deployment to '{target}' failed with exit code {deploy_res.returncode}",
            "command": deploy_cmd_resolved,
            "output": deploy_res.stdout.strip() + "\n" + deploy_res.stderr.strip(),
        }

    return {
        "success": True,
        "target": target,
        "branch": current_branch,
        "command": deploy_cmd_resolved,
        "output": deploy_res.stdout.strip(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", nargs="?", default="test", choices=["test", "prod"], help="Target environment: test (default) or prod")
    parser.add_argument("--allow-dirty", action="store_true", help="Allow deploying with dirty working tree")
    parser.add_argument("--skip-checks", action="store_true", help="Skip pre-deploy tests and validations")
    parser.add_argument("--dry-run", action="store_true", help="Simulate deployment without executing command")
    parser.add_argument("--json", action="store_true", help="Output in JSON format")

    args = parser.parse_args()

    try:
        result = execute_deploy(
            target=args.target,
            allow_dirty=args.allow_dirty,
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
                print(f"[DRY-RUN] Deploy to '{result['target']}' on branch '{result['branch']}' ready.")
                print(f"Command: {result['command']}")
            else:
                print(f"Deployment to '{result['target']}' completed successfully.")
                print(f"Command: {result['command']}")
                if result.get("output"):
                    print(result["output"])
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

    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
