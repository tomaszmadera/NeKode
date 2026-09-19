#!/usr/bin/env python3
"""Read-only publication fact discovery for ci publication-status."""

from __future__ import annotations

import importlib.util
import json
import re
import sys
from importlib.machinery import SourceFileLoader
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = Path(__file__).resolve().parents[3] / "scripts"
for path in (str(CURRENT_DIR), str(SCRIPTS_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

from common import ROOT, bump_semver, git_output, is_valid_semver, parse_semver, profile_values, run
from git_ops import get_git_status


def _load_validate_config():
    name = "validate_config"
    loaded = sys.modules.get(name)
    if loaded is not None:
        return loaded
    source = SCRIPTS_DIR / "validate-config"
    spec = importlib.util.spec_from_loader(name, SourceFileLoader(name, str(source)))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {source}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_validate_config = _load_validate_config()
PUBLICATION_STRATEGIES = _validate_config.PUBLICATION_STRATEGIES
PUBLICATION_VERSIONING = _validate_config.PUBLICATION_VERSIONING
publication_field_value = _validate_config.publication_field_value
supported_product_version_sources = _validate_config.supported_product_version_sources

UNCONFIGURED_COMMANDS = {"", "not-configured", "none", "null"}


def _empty_payload() -> dict:
    return {
        "success": True,
        "publication": {
            "strategy": "unknown",
            "versioning": "unknown",
            "missing_facts": [],
        },
        "worktree": {"staged": [], "unstaged": [], "untracked": []},
        "branch": {
            "name": "unknown",
            "role": "unknown",
            "head": None,
            "remote": None,
            "upstream": None,
            "ahead": None,
            "behind": None,
        },
        "refs": {
            "latest_local_semver_tag": None,
            "local_semver_tags_at_head": [],
            "commits_after_latest_local_semver_tag": None,
            "unpublished_local_semver_tags": [],
        },
        "version": {"current": None, "source": None, "candidates": None},
        "deploy": {"targets": []},
        "errors": [],
    }


def _git_config(root: Path, key: str) -> str | None:
    value = git_output("-C", str(root), "config", "--get", key).strip()
    return value or None


def _semver_from_tag_name(name: str) -> str | None:
    cleaned = name[1:] if name.startswith("v") and len(name) > 1 else name
    return cleaned if is_valid_semver(cleaned) else None


def _semver_tag_sort_key(name: str) -> tuple:
    cleaned = _semver_from_tag_name(name) or "0.0.0"
    major, minor, patch, prerelease = parse_semver(cleaned)
    return (major, minor, patch, prerelease is None, prerelease or "")


def _local_semver_tags(root: Path) -> list[str]:
    names = []
    for raw in git_output("-C", str(root), "tag", "-l").splitlines():
        name = raw.strip()
        if name and _semver_from_tag_name(name):
            names.append(name)
    names.sort(key=_semver_tag_sort_key)
    return names


def _source_priority(root: Path) -> list[str]:
    ordered = [
        "package.json",
        "pyproject.toml",
        "Cargo.toml",
    ]
    dotnet_candidates = [
        root / "Directory.Build.props",
        root / "Directory.Build.targets",
        root / "Directory.Packages.props",
        *root.glob("*.csproj"),
        *root.glob("*.fsproj"),
        *root.glob("*.props"),
        *root.glob("src/*/*.csproj"),
        *root.glob("src/*/*.fsproj"),
        *root.glob("src/*/*.props"),
    ]
    for path in dotnet_candidates:
        if not path.is_file():
            continue
        try:
            ordered.append(path.relative_to(root).as_posix())
        except ValueError:
            continue
    ordered.extend(
        [
            "pom.xml",
            "build.gradle",
            "build.gradle.kts",
            "VERSION",
            "version.txt",
            ".agents/project-profile.yaml:project.version",
            ".agents/project-profile.yaml:harness.version",
        ]
    )
    seen: set[str] = set()
    unique: list[str] = []
    for item in ordered:
        if item in seen:
            continue
        seen.add(item)
        unique.append(item)
    return unique


def _read_named_source(root: Path, source: str, profile: dict) -> str | None:
    if source == ".agents/project-profile.yaml:project.version":
        value = str(profile.get("project", {}).get("version", "")).strip().strip("\"'")
        return value if is_valid_semver(value) else None
    if source == ".agents/project-profile.yaml:harness.version":
        value = str(profile.get("harness", {}).get("version", "")).strip().strip("\"'")
        return value if is_valid_semver(value) else None
    path = root / source
    if not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return None
    if source == "package.json":
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return None
        version = str(data.get("version", "")).strip() if isinstance(data, dict) else ""
        return version if is_valid_semver(version) else None
    if path.name in {"VERSION", "version.txt"}:
        version = text.strip()
        return version if is_valid_semver(version) else None
    patterns = (
        re.compile(r'(?m)^version\s*=\s*["\']([^"\']+)["\']'),
        re.compile(r"<Version>([^<]+)</Version>"),
        re.compile(r"<PackageVersion>([^<]+)</PackageVersion>"),
        re.compile(r"<version>([^<]+)</version>"),
    )
    for pattern in patterns:
        match = pattern.search(text)
        if match and is_valid_semver(match.group(1).strip()):
            return match.group(1).strip()
    return None


def _current_product_version(root: Path, profile: dict) -> tuple[str | None, str | None]:
    supported = set(supported_product_version_sources(root, profile))
    if not supported:
        return None, None
    for source in _source_priority(root):
        if source not in supported:
            continue
        version = _read_named_source(root, source, profile)
        if version:
            return version, source
    for source in sorted(supported):
        version = _read_named_source(root, source, profile)
        if version:
            return version, source
    return None, None


def _configured_field(
    raw: object,
    allowed: set[str],
    field_name: str,
    missing: list[str],
    errors: list[str],
) -> str:
    value = publication_field_value(raw)
    if value is None:
        missing.append(field_name)
        errors.append(f"project profile missing {field_name}")
        return "unknown"
    if not isinstance(value, str) or value not in allowed:
        missing.append(field_name)
        errors.append(
            f"project profile {field_name} must be one of: " + ", ".join(sorted(allowed))
        )
        return value if isinstance(value, str) and value else "unknown"
    if value == "not-configured":
        missing.append(field_name)
    return value


def _branch_role(name: str, strategy: str, root: Path) -> str:
    configured_production = _git_config(root, "gitflow.branch.master")
    configured_develop = _git_config(root, "gitflow.branch.develop")
    configured_prefix = _git_config(root, "gitflow.prefix.feature")
    production = configured_production or "main"
    git_flow_roles = (
        strategy == "git-flow"
        or configured_production is not None
        or configured_develop is not None
        or configured_prefix is not None
    )
    if name == production:
        return "production"
    if git_flow_roles:
        develop = configured_develop or "develop"
        prefix = configured_prefix or "feature/"
        if name == develop:
            return "develop"
        if prefix and name.startswith(prefix):
            return "feature"
    return "unknown"


def _remote_tag_names(ls_remote_output: str) -> set[str]:
    names: set[str] = set()
    for line in ls_remote_output.splitlines():
        if "\t" not in line:
            continue
        _object_id, ref = line.split("\t", 1)
        ref = ref.strip()
        if ref.endswith("^{}"):
            ref = ref[:-3]
        if ref.startswith("refs/tags/"):
            names.add(ref[len("refs/tags/") :])
    return names


def _count_commits(root: Path, spec: str) -> int | None:
    raw = git_output("-C", str(root), "rev-list", "--count", spec).strip()
    if raw.isdigit():
        return int(raw)
    return None


def _unpublished_tag(root: Path, tag: str) -> dict[str, str]:
    ref = f"refs/tags/{tag}"
    return {
        "tag": tag,
        "ref": ref,
        "object": git_output("-C", str(root), "rev-parse", ref).strip(),
    }


def execute_publication_status(root: Path | None = None) -> dict:
    """Collect read-only publication facts for the given repository root."""
    target_root = Path(root).resolve() if root is not None else ROOT
    payload = _empty_payload()
    errors: list[str] = []

    inside = run(
        ["git", "-C", str(target_root), "rev-parse", "--is-inside-work-tree"],
        capture=True,
    )
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        payload["success"] = False
        message = inside.stderr.strip() or inside.stdout.strip() or "not a git repository"
        payload["error"] = message
        payload["errors"] = [message]
        return payload

    profile_path = target_root / ".agents" / "project-profile.yaml"
    profile: dict = {}
    if not profile_path.is_file():
        payload["publication"]["missing_facts"] = [
            "publication.strategy",
            "publication.versioning",
        ]
        errors.append("Missing .agents/project-profile.yaml")
        strategy = "unknown"
        versioning = "unknown"
    else:
        try:
            profile = profile_values(profile_path)
        except (OSError, UnicodeError) as exc:
            payload["publication"]["missing_facts"] = [
                "publication.strategy",
                "publication.versioning",
            ]
            errors.append(f"Could not read .agents/project-profile.yaml: {exc}")
            strategy = "unknown"
            versioning = "unknown"
            profile = {}
        else:
            publication = profile.get("publication", {})
            if not isinstance(publication, dict):
                publication = {}
            missing: list[str] = []
            strategy = _configured_field(
                publication.get("strategy"),
                PUBLICATION_STRATEGIES,
                "publication.strategy",
                missing,
                errors,
            )
            versioning = _configured_field(
                publication.get("versioning"),
                PUBLICATION_VERSIONING,
                "publication.versioning",
                missing,
                errors,
            )
            if strategy == "git-flow" and versioning == "none":
                if "publication.versioning" not in missing:
                    missing.append("publication.versioning")
                errors.append("git-flow publication requires semver versioning")
            payload["publication"]["missing_facts"] = missing

    payload["publication"]["strategy"] = strategy
    payload["publication"]["versioning"] = versioning

    status = get_git_status(target_root)
    payload["worktree"] = {
        "staged": list(status["staged"]),
        "unstaged": list(status["modified"]),
        "untracked": list(status["untracked"]),
    }

    name = git_output("-C", str(target_root), "rev-parse", "--abbrev-ref", "HEAD").strip()
    if not name:
        name = "unknown"
        errors.append("current branch could not be established")
    head = git_output("-C", str(target_root), "rev-parse", "HEAD").strip() or None
    if head is None:
        errors.append("HEAD object id could not be established")

    remotes = [item.strip() for item in git_output("-C", str(target_root), "remote").splitlines() if item.strip()]
    upstream_proc = run(
        ["git", "-C", str(target_root), "rev-parse", "--abbrev-ref", "@{upstream}"],
        capture=True,
    )
    upstream = upstream_proc.stdout.strip() if upstream_proc.returncode == 0 else None
    configured_remote = None
    if name and name != "unknown":
        configured_remote = _git_config(target_root, f"branch.{name}.remote")
    remote = configured_remote
    if remote is None and "origin" in remotes:
        remote = "origin"
    elif remote is None and remotes:
        remote = remotes[0]

    ahead = None
    behind = None
    if upstream:
        ahead = _count_commits(target_root, f"{upstream}..HEAD")
        behind = _count_commits(target_root, f"HEAD..{upstream}")
        if ahead is None or behind is None:
            errors.append("ahead and behind counts could not be established")
    else:
        errors.append("current branch has no upstream")

    payload["branch"] = {
        "name": name,
        "role": _branch_role(name, strategy, target_root),
        "head": head,
        "remote": remote,
        "upstream": upstream,
        "ahead": ahead,
        "behind": behind,
    }

    local_tags = _local_semver_tags(target_root)
    latest = local_tags[-1] if local_tags else None
    at_head: list[str] = []
    for raw in git_output("-C", str(target_root), "tag", "--points-at", "HEAD").splitlines():
        tag = raw.strip()
        if tag and _semver_from_tag_name(tag):
            at_head.append(tag)
    at_head.sort(key=_semver_tag_sort_key)
    commits_after = None
    if latest:
        commits_after = [
            item.strip()
            for item in git_output(
                "-C",
                str(target_root),
                "log",
                "--format=%H",
                f"{latest}..HEAD",
            ).splitlines()
            if item.strip()
        ]

    unpublished_tags: list[dict[str, str]] | None
    if remote:
        ls_remote = run(
            ["git", "-C", str(target_root), "ls-remote", "--tags", remote],
            capture=True,
        )
        if ls_remote.returncode != 0:
            errors.append(
                "unpublished local semver tags could not be established: "
                + (ls_remote.stderr.strip() or ls_remote.stdout.strip() or "ls-remote failed")
            )
            unpublished_tags = None
        else:
            published = _remote_tag_names(ls_remote.stdout)
            unpublished_tags = [
                _unpublished_tag(target_root, tag) for tag in local_tags if tag not in published
            ]
    else:
        unpublished_tags = [_unpublished_tag(target_root, tag) for tag in local_tags]

    payload["refs"] = {
        "latest_local_semver_tag": latest,
        "local_semver_tags_at_head": at_head,
        "commits_after_latest_local_semver_tag": commits_after,
        "unpublished_local_semver_tags": unpublished_tags,
    }

    if versioning == "semver":
        current, source = _current_product_version(target_root, profile)
        candidates = None
        if current is None or source is None:
            errors.append(
                "semver publication requires a writable product-version source supported by ci bump"
            )
        else:
            try:
                candidates = {
                    "patch": bump_semver(current, "patch"),
                    "minor": bump_semver(current, "minor"),
                    "major": bump_semver(current, "major"),
                }
            except ValueError as exc:
                errors.append(str(exc))
                candidates = None
        payload["version"] = {
            "current": current,
            "source": source,
            "candidates": candidates,
        }
    else:
        payload["version"] = {"current": None, "source": None, "candidates": None}

    commands = profile.get("commands", {})
    if not isinstance(commands, dict):
        commands = {}
    targets: list[str] = []
    for target in ("test", "prod"):
        command = commands.get(f"deploy_{target}", "")
        if isinstance(command, str):
            command = command.strip()
        if command and command not in UNCONFIGURED_COMMANDS:
            targets.append(target)
    payload["deploy"] = {"targets": targets}
    payload["errors"] = errors
    return payload
