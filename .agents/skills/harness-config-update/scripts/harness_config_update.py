#!/usr/bin/env python3
"""Deterministic project-template harness and agent configuration update script."""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path
from typing import Iterable, Sequence

SCRIPTS_DIR = Path(__file__).resolve().parents[3] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from common import (
    ROOT,
    SkillWrapperError,
    commit_paths,
    git_output,
    profile_value,
    profile_values,
    render_skill_wrapper_plan,
    run,
)
from sync_policy import SyncPolicy, SyncPolicyError, load_policy
from package_manifest import PackageManifest, PackageManifestError, load_package_manifest
from lessons_store import (
    LessonsStoreError,
    empty_index,
    index_text,
    load_index,
    migrate_legacy_store,
    parse_legacy_store,
)

SEMVER_REGEX = re.compile(
    r"^(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)"
    r"(?:-(?P<prerelease>[0-9A-Za-z.-]+))?$"
)
DEFAULT_TEMPLATE_REPO = "git@gitlab.com:tomasz-madera/project-template.git"


class SymlinkedTargetError(RuntimeError):
    """Raised when a managed harness path in the target resolves through a symlink."""

DEPRECATED_HARNESS_SKILLS = {"bump", "release"}

STANDARD_HARNESS_COMMANDS = {
    "preflight": "{python} .agents/scripts/preflight",
    "validate_agent_config": "{python} .agents/scripts/validate-config",
    "task_status": "{python} .agents/scripts/task-status",
    "handoff_status": "{python} .agents/scripts/handoff-status",
    "ci": "{python} .agents/skills/ci/scripts/ci.py",
    "bump": "{python} .agents/skills/ci/scripts/ci.py bump",
    "release": "{python} .agents/skills/ci/scripts/ci.py release",
    "harness_config_update": "{python} .agents/skills/harness-config-update/scripts/harness_config_update.py",
    "verify_targeted": "{python} .agents/scripts/verify-targeted --",
    "verify_changed": "{python} .agents/scripts/verify-changed",
    "verify_full": "{python} .agents/scripts/verify-full",
}


def parse_semver(version: str) -> tuple[int, int, int, str | None]:
    match = SEMVER_REGEX.match(version.strip())
    if not match:
        raise ValueError(f"invalid semver version: '{version}'")
    return (
        int(match.group("major")),
        int(match.group("minor")),
        int(match.group("patch")),
        match.group("prerelease"),
    )


def is_valid_semver(version: str) -> bool:
    return bool(SEMVER_REGEX.match(version.strip()))


def bump_semver(current: str, bump_type: str) -> str:
    major, minor, patch, prerelease = parse_semver(current)
    if bump_type == "major":
        return f"{major + 1}.0.0"
    if bump_type == "minor":
        return f"{major}.{minor + 1}.0"
    if bump_type == "patch":
        return f"{major}.{minor}.{patch + 1}"
    if SEMVER_REGEX.match(bump_type):
        return bump_type
    raise ValueError(f"unsupported bump or version string: '{bump_type}'")


def get_current_harness_version(target_dir: Path) -> str:
    profile_path = target_dir / ".agents" / "project-profile.yaml"
    if not profile_path.is_file():
        return "0.0.0"
    values = profile_values(profile_path)
    return values.get("harness", {}).get("version", "0.0.0")


def get_excluded_skills(target_profile_path: Path) -> set[str]:
    """Return excluded_skills from target profile as a set. Empty if missing or invalid."""
    try:
        values = profile_values(target_profile_path)
    except Exception:
        return set()
    raw = values.get("harness", {}).get("excluded_skills", [])
    if isinstance(raw, list):
        result: set[str] = set()
        for item in raw:
            s = str(item).strip()
            if s:
                result.add(s)
        return result
    # String or other non-list is treated as empty (validation will error elsewhere)
    return set()


def _is_excluded_rel_path(rel_path: Path, excluded_skills: set[str]) -> bool:
    """Check if a relative template path corresponds to an excluded skill."""
    if not excluded_skills:
        return False
    parts = rel_path.parts
    # .agents/skills/<skill> and .grok/skills/<skill>
    if len(parts) >= 3 and parts[0] == ".agents" and parts[1] == "skills" and parts[2] in excluded_skills:
        return True
    if len(parts) >= 3 and parts[0] == ".grok" and parts[1] == "skills" and parts[2] in excluded_skills:
        return True
    # .codex/<skill> or .codex/skills/<skill>
    if parts[0] == ".codex":
        if len(parts) >= 2 and parts[1] in excluded_skills:
            return True
        if len(parts) >= 3 and parts[1] == "skills" and parts[2] in excluded_skills:
            return True
    # .opencode/<skill> or .opencode/skills/<skill> or .opencode/plugins/<skill>
    if parts[0] == ".opencode":
        if len(parts) >= 2 and parts[1] in excluded_skills:
            return True
        if len(parts) >= 3 and parts[1] in ("skills", "plugins") and parts[2] in excluded_skills:
            return True
    # skills-available catalog
    if "skills-available" in parts:
        try:
            idx = parts.index("skills-available")
        except ValueError:
            idx = -1
        if idx != -1 and idx + 1 < len(parts) and parts[idx + 1] in excluded_skills:
            return True
    return False


def is_template_source(cand: Path) -> bool:
    if not cand.is_dir() or not (cand / ".git").exists():
        return False
    profile = cand / ".agents" / "project-profile.yaml"
    if profile.is_file():
        try:
            values = profile_values(profile)
            if values.get("project", {}).get("status") == "template":
                return True
        except Exception:
            pass
    return cand.name == "project-template"


def discover_available_versions(source_path_or_url: str | Path | None = None) -> list[str]:
    """List semver tags available from source repository or git remotes."""
    tags = []
    # 1. Local path / sibling
    candidate_paths = []
    if source_path_or_url and Path(source_path_or_url).is_dir():
        candidate_paths.append(Path(source_path_or_url))
    candidate_paths.extend([
        ROOT.parent / "project-template",
        Path.cwd().parent / "project-template",
        ROOT,
    ])

    for cand in candidate_paths:
        if cand.is_dir() and (cand / ".git").exists():
            if cand == ROOT and not is_template_source(cand) and (not source_path_or_url or Path(source_path_or_url) != ROOT):
                continue
            out = git_output("-C", str(cand), "tag", "-l")
            for line in out.splitlines():
                tag = line.strip().lstrip("v")
                if is_valid_semver(tag) and tag not in tags:
                    tags.append(tag)
            if tags:
                break

    # 2. Remote git ls-remote if needed and no local tags found
    if not tags:
        repo_url = str(source_path_or_url) if source_path_or_url and not Path(source_path_or_url).exists() else DEFAULT_TEMPLATE_REPO
        try:
            res = subprocess.run(
                ["git", "ls-remote", "--tags", repo_url],
                capture_output=True, text=True, timeout=10, check=False,
            )
            if res.returncode == 0:
                for line in res.stdout.splitlines():
                    match = re.search(r"refs/tags/v?([0-9A-Za-z.-]+)$", line.strip())
                    if match:
                        tag = match.group(1).rstrip("^{}")
                        if is_valid_semver(tag) and tag not in tags:
                            tags.append(tag)
        except Exception:
            pass

    # Sort semver ascending
    try:
        tags.sort(key=lambda v: parse_semver(v))
    except Exception:
        tags.sort()
    return tags


def extract_template_tar(archive: bytes, dest_dir: Path) -> None:
    """Extract a git-archive tar into dest_dir, refusing members that could escape it.

    The data filter refuses symlink and hardlink escapes and special files, and contains
    absolute-path members inside dest_dir, so nothing is ever written outside dest_dir
    even from a crafted archive.
    """
    with tarfile.open(fileobj=io.BytesIO(archive)) as tf:
        tf.extractall(path=dest_dir, filter="data")


def fetch_template_to_directory(
    target_version: str,
    source: str | Path | None,
    dest_dir: Path,
) -> None:
    """Fetch or extract project-template tree at target_version into dest_dir."""
    # 1. Try local directory with git archive
    candidate_paths: list[Path] = []
    if source and Path(source).is_dir():
        candidate_paths.append(Path(source))
    candidate_paths.extend([
        ROOT.parent / "project-template",
        Path.cwd().parent / "project-template",
        ROOT,
    ])

    for cand in candidate_paths:
        if cand.is_dir() and (cand / ".git").exists():
            if cand == ROOT and not is_template_source(cand) and (not source or Path(source) != ROOT):
                continue
            # Check if tag or ref exists
            tag_name = target_version
            existing_tags = git_output("-C", str(cand), "tag", "-l").splitlines()
            if f"v{target_version}" in existing_tags:
                tag_name = f"v{target_version}"
            elif target_version not in existing_tags:
                # Check if current HEAD in template matches version in profile
                cand_version = get_current_harness_version(cand)
                if cand_version == target_version:
                    tag_name = "HEAD"
                else:
                    continue

            # Run git archive
            res = subprocess.run(
                ["git", "-C", str(cand), "archive", tag_name],
                capture_output=True, check=False,
            )
            if res.returncode == 0 and len(res.stdout) > 0:
                extract_template_tar(res.stdout, dest_dir)
                return

    # 2. Try git clone shallowly from remote
    repo_url = str(source) if source and not Path(source).exists() else os.environ.get("PROJECT_TEMPLATE_REPO", DEFAULT_TEMPLATE_REPO)
    for tag_candidate in (target_version, f"v{target_version}"):
        res = subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", tag_candidate, repo_url, str(dest_dir)],
            capture_output=True, text=True, check=False,
        )
        if res.returncode == 0:
            return

    raise RuntimeError(
        f"Unable to fetch project-template for version '{target_version}' from local paths or remote '{repo_url}'."
    )


# Harness paths named in template guidance, with or without backticks: the Core rules bullet about
# runtime adapters names `.codex/`, `.claude/`, `.opencode/` and `opencode.json` in plain prose.
HARNESS_REF = re.compile(
    r"(?<![\w./-])"
    r"(\.agents/[\w./*-]*|\.codex/?[\w./*-]*|\.grok/?[\w./*-]*|\.opencode/?[\w./*-]*|\.claude/?[\w./*-]*"
    r"|opencode\.json|CLAUDE\.md|\.gitlab-ci\.yml)"
)


def _template_line_applies(line: str, target_dir: Path, policy: SyncPolicy | None) -> bool:
    """Drop template guidance that points at a harness file the project neither has nor manages.

    A selective project must not inherit rules it cannot follow: a row naming `.agents/workflow.md`
    is actionable only when that file exists or the update is allowed to create it.
    """
    if policy is None or not policy.is_selective:
        return True
    for ref in HARNESS_REF.findall(line):
        ref_path = ref.strip().rstrip("/").rstrip(".,;:").rstrip("/")
        if (target_dir / ref_path).exists():
            continue
        if policy.is_managed(ref_path):
            continue
        area = policy.area_of(ref_path)
        if area is None:
            continue
        return False
    return True


def _filter_template_block(body: str, target_dir: Path, policy: SyncPolicy | None) -> str:
    """Keep only the template rows and bullets a selective project can actually act on."""
    if policy is None or not policy.is_selective:
        return body
    kept = [line for line in body.splitlines() if _template_line_applies(line, target_dir, policy)]
    return "\n".join(kept).strip()


CODE_SPAN = re.compile(r"`([^`]+)`")

# These names are used only to recognize stale references while merging AGENTS.md. Removal
# membership itself comes from package.yaml.
OBSOLETE_GUIDANCE_PATHS = frozenset({
    ".agents/tests",
    ".agents/bootstrap-workflow.md",
    ".agents/workflow.md",
    ".agents/harness-architecture.md",
    ".agents/capabilities.json",
    ".agents/budgets.json",
    ".agents/skill-manifest.json",
    ".agents/workflows/development.md",
    ".agents/workflows/small.md",
    ".agents/workflows/recorded-development.md",
    ".agents/workflows/recorded-investigation.md",
    ".agents/workflows/standard.md",
    ".agents/workflows/large.md",
    ".agents/workflows/recorded-debug.md",
    ".agents/workflows/recorded-review.md",
    ".agents/workflows/recorded-analysis.md",
    ".agents/workflows/analysis.md",
    ".agents/workflows/pipelines.json",
    ".agents/workflows/recorded-task.md",
    ".agents/workflows/lifecycle.md",
    ".agents/workflows/context-succession.md",
    ".agents/references/python-unittest.md",
    ".agents/references/harness-architecture.md",
    ".agents/references/runtime-adapters.md",
    ".agents/references/context-succession.md",
    ".agents/docs/project-profile.md",
    ".agents/communication.md",
    ".agents/lessons.md",
    ".agents/state/improvement-events.ndjson",
    ".agents/state/improvement-summary.json",
    ".agents/state/proposal-backups",
    ".agents/state/lessons",
})

# The legacy single-file lessons store is project knowledge, so the removal loop does not touch it:
# the lessons migration below deletes it only after every lesson it holds reached the selective
# store, and keeps it otherwise.
MIGRATED_HARNESS_PATHS = frozenset({".agents/lessons.md"})

# Retired project-section titles, mapped to the `###` subsection they migrate into inside the
# single `## Project rules` section. Order decides the order of the migrated subsections.
LEGACY_PROJECT_SECTIONS = {
    "Project Constitution": "Constitution",
    "Project-specific rules": "Rules",
}

# Former catch-all row that loaded lessons for every Standard+ task.
OBSOLETE_ROUTING_SITUATIONS = frozenset({"Standard or larger work"})

# Harness sections a newer template no longer owns, mapped to a marker from the harness-authored
# body. A target that still carries one keeps a rule whose canonical owner has moved, so the merge
# drops it - but only when the body is still the harness text. A project that rewrote the section
# with its own rules keeps it, and `sync.agents_md: keep-sections` with the title in
# `sync.keep_sections` restores it in either case.
OBSOLETE_SECTIONS = {
    "Context discipline": "At most one extra agent session may exist beside Main",
}


def _is_obsolete_harness_section(title: str, body: str) -> bool:
    marker = OBSOLETE_SECTIONS.get(title)
    return marker is not None and marker in body


def _is_obsolete_routing_line(line: str) -> bool:
    stripped = line.strip()
    if stripped.startswith("|") and not stripped.startswith("|---") and not stripped.startswith("| Task or situation"):
        situation = stripped.strip("|").split("|")[0].strip()
        if situation in OBSOLETE_ROUTING_SITUATIONS:
            return True
    refs = set(CODE_SPAN.findall(stripped))
    refs.update(ref.strip().rstrip("/") for ref in HARNESS_REF.findall(stripped))
    return bool(refs & OBSOLETE_GUIDANCE_PATHS)


def _migrate_obsolete_routing(body: str) -> str:
    return "\n".join(line for line in body.splitlines() if not _is_obsolete_routing_line(line)).strip()


def _routing_section_has_entries(body: str) -> bool:
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("|---") or stripped.startswith("| Task or situation"):
            continue
        return True
    return False


def _prefer_target_rows(body: str, extras: Sequence[str]) -> str:
    """Drop template bullets a target bullet already documents, so each path keeps one owner.

    The target wording wins because it carries the project meaning (`BACKLOG.md` is a product
    backlog in one project and a deferred-ideas list in another). Canonical sources only: the
    Required context table is keyed by situation, so several rows may legitimately name one file.
    """
    extra_refs = {ref for line in extras for ref in CODE_SPAN.findall(line)}
    if not extra_refs:
        return body
    kept = [
        line for line in body.splitlines()
        if not (set(CODE_SPAN.findall(line)) & extra_refs)
    ]
    return "\n".join(kept)


def _without_project_rules(text: str) -> str:
    """Drop the project-owned `## Project rules` section from a rendered router."""
    stripped = re.sub(
        r"(?m)^##\s+Project rules\s*\n[\s\S]*?(?=^##\s+|\Z)", "", text
    )
    return stripped.rstrip("\n") + "\n"


def merge_agents_md(
    target_agents_path: Path,
    template_agents_path: Path,
    is_windows: bool | None = None,
    keep_sections: Sequence[str] | None = None,
    policy: SyncPolicy | None = None,
    pending_out: list[str] | None = None,
) -> str:
    """Merge target project's AGENTS.md with the template AGENTS.md.

    Sections named in keep_sections are carried over verbatim from the target, in target order,
    after the sections the merge itself rebuilds. Use it for project sections the merge does not
    know (a project workflow, a tools table, validation commands).

    The legacy `## Project Constitution` and `## Project-specific rules` sections migrate into the
    single `## Project rules` section; pending_out receives the reconciliation note when a target
    carries both the new section and a legacy one.
    """
    if not template_agents_path.is_file():
        raise FileNotFoundError(f"Template AGENTS.md not found at {template_agents_path}")

    template_text = template_agents_path.read_text(encoding="utf-8")
    if not target_agents_path.is_file():
        # A project without AGENTS.md receives the template router, minus the template's own
        # `## Project rules`: that section is this repository's harness guidance, and a target
        # project must never be told the harness is its to edit.
        return _without_project_rules(template_text)

    target_text = target_agents_path.read_text(encoding="utf-8")
    target_dir = target_agents_path.resolve().parent

    # If target is template itself, return template text
    # Either dash form: the header used a hyphen from 6.1.x on, earlier copies carry an em dash.
    if re.match(r"^# Project Template [-\u2014] Agent Guide", target_text):
        return template_text

    # Extract target title and summary
    header_match = re.match(r"^([\s\S]*?)(?=^##\s+)", target_text, flags=re.MULTILINE)
    target_header = header_match.group(1).strip() if header_match else "# Application - Agent Guide"

    # Extract sections from target and template
    section_pattern = re.compile(r"(?m)^##\s+([^\n]+)\n([\s\S]*?)(?=(?:^##\s+[^\n]+)|\Z)")
    target_sections = {m.group(1).strip(): m.group(2).strip() for m in section_pattern.finditer(target_text)}
    template_sections = {m.group(1).strip(): m.group(2).strip() for m in section_pattern.finditer(template_text)}

    # Extract extra rows from target's "Required context"
    extra_context_rows = []
    if "Required context" in target_sections and "Required context" in template_sections:
        template_req = template_sections["Required context"]
        target_req = target_sections["Required context"]
        for line in target_req.splitlines():
            line_str = line.strip()
            if line_str.startswith("|") and not line_str.startswith("| Task or situation") and not line_str.startswith("|---"):
                if line_str not in template_req and not _is_obsolete_routing_line(line_str):
                    extra_context_rows.append(line_str)

    # Extract extra items from target's "Canonical sources"
    extra_sources = []
    if "Canonical sources" in target_sections and "Canonical sources" in template_sections:
        template_can = template_sections["Canonical sources"]
        target_can = target_sections["Canonical sources"]
        for line in target_can.splitlines():
            line_str = line.strip()
            if line_str.startswith("- ") and line_str not in template_can and not _is_obsolete_routing_line(line_str):
                extra_sources.append(line_str)

    # `## Project rules` is project-owned: the template body is this repository's own harness
    # guidance and must never reach a target project. The retired `## Project Constitution` and
    # `## Project-specific rules` sections migrate into it once, verbatim, under `###` subsections.
    kept_titles = {str(name).strip() for name in (keep_sections or []) if str(name).strip()}
    legacy_titles = [
        title for title in LEGACY_PROJECT_SECTIONS
        if title in target_sections and title not in kept_titles
    ]
    migrated_blocks = []
    for title in legacy_titles:
        body = target_sections[title].strip()
        if body:
            migrated_blocks.append(f"### {LEGACY_PROJECT_SECTIONS[title]}\n\n{body}")
    target_project_rules = target_sections.get("Project rules", "").strip()
    if migrated_blocks and target_project_rules and pending_out is not None:
        pending_out.append(
            "AGENTS.md: migrated " + " and ".join(f"## {title}" for title in legacy_titles)
            + " into the existing ## Project rules section; reconcile the appended subsections"
        )

    # Build updated AGENTS.md. Every template section is emitted in template order; target
    # sections splice in at their template slots (Project rules, Terminal execution) and any
    # other target-only section appends after the last emitted section, in target order. Known
    # obsolete harness routing is dropped; custom rows stay.
    output_parts = [target_header, ""]

    term_heading = "Terminal execution (for projects that have to run in Windows runtime)"
    template_order = list(dict.fromkeys(
        m.group(1).strip() for m in section_pattern.finditer(template_text)
    ))
    emitted: set[str] = set()

    emitted.update(legacy_titles)
    project_rules_blocks = ([target_project_rules] if target_project_rules else []) + migrated_blocks

    for title in template_order:
        if title not in template_sections or title in OBSOLETE_SECTIONS:
            continue
        # A template that still carries a retired project section never exports it: those
        # sections are project-owned and only migrate out of the target.
        if title in LEGACY_PROJECT_SECTIONS:
            continue
        if title == "Project rules":
            if project_rules_blocks:
                output_parts.extend(["## Project rules", "", "\n\n".join(project_rules_blocks), ""])
                emitted.add(title)
            continue
        if title == term_heading:
            if term_heading in target_sections and term_heading in template_sections:
                output_parts.extend([f"## {term_heading}", "", template_sections[term_heading], ""])
                emitted.add(title)
            elif is_windows and term_heading in template_sections:
                output_parts.extend([f"## {term_heading}", "", template_sections[term_heading], ""])
                emitted.add(title)
            continue
        body = template_sections[title]
        if title == "Core rules":
            body = _filter_template_block(body, target_dir, policy)
        elif title == "Required context":
            body = _filter_template_block(body, target_dir, policy)
            if extra_context_rows:
                body = body.rstrip() + "\n" + "\n".join(extra_context_rows)
        elif title == "Canonical sources":
            body = _filter_template_block(body, target_dir, policy)
            if extra_sources:
                body = _prefer_target_rows(body, extra_sources).rstrip()
                body = body + "\n" + "\n".join(extra_sources)
        output_parts.extend([f"## {title}", "", body, ""])
        emitted.add(title)

    if project_rules_blocks and "Project rules" not in emitted:
        output_parts.extend(["## Project rules", "", "\n\n".join(project_rules_blocks), ""])
        emitted.add("Project rules")

    # Any other target-only section (e.g. 5.x Required context, Completion report, Canonical
    # sources) survives after the last emitted section, in target order. Routing tables drop
    # known obsolete harness pointers and empty leftover tables.
    for title in [m.group(1).strip() for m in section_pattern.finditer(target_text)]:
        if title not in emitted:
            body = target_sections[title]
            if _is_obsolete_harness_section(title, body):
                continue
            if title in {"Required context", "Canonical sources"}:
                body = _migrate_obsolete_routing(body)
                if not _routing_section_has_entries(body):
                    continue
            output_parts.extend([f"## {title}", "", body, ""])
            emitted.add(title)

    # Project sections the merge does not rebuild, preserved verbatim in target order
    if keep_sections:
        requested = [str(name).strip() for name in keep_sections if str(name).strip()]
        for title in [m.group(1).strip() for m in section_pattern.finditer(target_text)]:
            if title in requested and title not in emitted:
                output_parts.extend([f"## {title}", "", target_sections[title], ""])
                emitted.add(title)

    return "\n".join(output_parts).strip() + "\n"


def merge_project_profile(
    target_profile_path: Path,
    template_profile_path: Path,
    new_version: str,
) -> str:
    """Merge target project profile with template profile, preserving project configurations."""
    if not target_profile_path.is_file():
        if template_profile_path.is_file():
            content = template_profile_path.read_text(encoding="utf-8")
            return re.sub(r'(?m)^  version:\s*"[^"]+"', f'  version: "{new_version}"', content)
        return f'schema_version: 2\nharness:\n  version: "{new_version}"\n'

    target_lines = target_profile_path.read_text(encoding="utf-8").splitlines()

    new_lines: list[str] = []
    current_section = ""
    commands_in_target: dict[str, str] = {}
    in_commands = False

    for line in target_lines:
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#"):
            new_lines.append(line)
            continue

        if not line.startswith(" ") and line.endswith(":"):
            current_section = line[:-1].strip()
            in_commands = (current_section == "commands")
            new_lines.append(line)
            continue

        if current_section == "harness" and trimmed.startswith("version:"):
            indent = line[: len(line) - len(line.lstrip())]
            new_lines.append(f'{indent}version: "{new_version}"')
            continue
        # Preserve harness.excluded_skills from target (do not overwrite with template)
        # The generic new_lines.append below already keeps excluded_skills lines verbatim,
        # including block-list items (    - <skill>). No injection from template if missing.

        if in_commands:
            key, sep, val = trimmed.partition(":")
            if sep:
                commands_in_target[key.strip()] = val.strip().strip('"\'')
                # If command is a standard harness script command, update to template standard
                if key.strip() in STANDARD_HARNESS_COMMANDS:
                    indent = line[: len(line) - len(line.lstrip())]
                    new_lines.append(f'{indent}{key.strip()}: "{STANDARD_HARNESS_COMMANDS[key.strip()]}"')
                    continue
            new_lines.append(line)
            continue

        new_lines.append(line)

    # Ensure all standard harness commands exist
    if "commands" in target_lines or any(l.startswith("commands:") for l in target_lines):
        missing_commands = {k: v for k, v in STANDARD_HARNESS_COMMANDS.items() if k not in commands_in_target}
        if missing_commands:
            final_lines: list[str] = []
            for line in new_lines:
                final_lines.append(line)
                if line.startswith("commands:"):
                    for k, v in missing_commands.items():
                        final_lines.append(f'  {k}: "{v}"')
            new_lines = final_lines

    return "\n".join(new_lines).strip() + "\n"


def sync_harness(
    template_dir: Path,
    target_dir: Path,
    target_version: str,
    dry_run: bool = False,
    excluded_skills: set[str] | None = None,
    policy: SyncPolicy | None = None,
    skipped_out: list[str] | None = None,
    pending_out: list[str] | None = None,
    package: PackageManifest | None = None,
) -> tuple[list[str], list[str], list[str]]:
    """Synchronize harness directories and files from template_dir to target_dir.

    The target project's sync policy (`sync:` in .agents/project-profile.yaml) decides which
    harness areas may be written. A project without that section keeps the full-sync behaviour.
    """
    updated_files: list[str] = []
    added_files: list[str] = []
    deleted_files: list[str] = []
    skipped: list[str] = skipped_out if skipped_out is not None else []
    # Work no policy withheld and this run could not finish: the operator has to act on it.
    pending: list[str] = pending_out if pending_out is not None else []
    package = package or load_package_manifest(template_dir)

    # Resolve excluded skills from target profile if not explicitly passed
    if excluded_skills is None:
        try:
            excluded_skills = get_excluded_skills(target_dir / ".agents" / "project-profile.yaml")
        except Exception:
            excluded_skills = set()
    else:
        excluded_skills = set(excluded_skills)

    if policy is None:
        policy = load_policy(target_dir / ".agents" / "project-profile.yaml")

    sync_dirs = list(package.ship_directories)
    sync_files = list(package.ship_files)

    target_is_template = is_template_source(target_dir)
    # Excluded handling only for non-template targets
    effective_excluded: set[str] = set() if target_is_template else set(excluded_skills)
    # The template repository always syncs itself in full; a policy only governs target projects.
    effective_policy = SyncPolicy() if target_is_template else policy

    def skill_is_template_only(name: str) -> bool:
        return package.is_template_only(Path(".agents") / "skills" / name)

    def may_write(rel_path: Path | str) -> bool:
        """True when the policy lets the update write or delete this path."""
        return effective_policy.is_managed(rel_path)

    replaceable_adapter_roots = {
        root for root in package.adapter_outputs
        if may_write(root)
    }

    def guard_symlink(rel_path: Path | str) -> None:
        """Refuse to write through, or into, a symlinked harness path unless explicitly allowed."""
        if effective_policy.allow_symlinked_dirs:
            return
        parts = Path(str(rel_path)).parts
        for depth in range(1, len(parts) + 1):
            subpath = Path(*parts[:depth])
            candidate = target_dir.joinpath(*parts[:depth])
            if candidate.is_symlink():
                if subpath in replaceable_adapter_roots:
                    # An adapter root (like .claude/skills) that is a symlink will be
                    # safely unlinked and replaced with a real directory before writing
                    # wrappers. It is not traversed, and subsequent segments resolve in the
                    # newly created directory, not through the symlink.
                    break
                raise SymlinkedTargetError(
                    f"managed harness path '{rel_path}' resolves through the symlink "
                    f"'{'/'.join(parts[:depth])}' -> '{candidate.resolve()}'. Writing would modify "
                    "content outside this repository. Protect the path in sync.protected_paths, "
                    "drop its area from sync.managed_areas, replace the symlink with a real "
                    "directory, or set sync.allow_symlinked_dirs: true to accept the write."
                )

    def guard_all(rel_paths: Iterable[Path | str]) -> None:
        """Guard every candidate path before the first write, so a failure leaves nothing behind."""
        for rel_path in rel_paths:
            if may_write(rel_path):
                guard_symlink(rel_path)

    projected_skill_sources: dict[str, Path] = {
        path.parent.name: path
        for path in sorted((target_dir / ".agents" / "skills").glob("*/SKILL.md"))
        if path.parent.name not in effective_excluded
        and path.parent.name not in DEPRECATED_HARNESS_SKILLS
        and (target_is_template or not skill_is_template_only(path.parent.name))
    }
    for path in sorted((template_dir / ".agents" / "skills").glob("*/SKILL.md")):
        name = path.parent.name
        relative = Path(".agents") / "skills" / name / "SKILL.md"
        if (
            name in effective_excluded
            or name in DEPRECATED_HARNESS_SKILLS
            or (not target_is_template and skill_is_template_only(name))
            or not may_write(relative)
        ):
            continue
        projected_skill_sources[name] = path
    if not target_is_template:
        template_available = template_dir / "tools" / "harness" / "skills-available"
        if not template_available.is_dir():
            template_available = template_dir / ".agents" / "skills-available"
        for path in sorted(template_available.glob("*/SKILL.md")):
            name = path.parent.name
            target_skill = target_dir / ".agents" / "skills" / name
            relative = Path(".agents") / "skills" / name / "SKILL.md"
            if target_skill.is_dir() and name not in effective_excluded and may_write(relative):
                projected_skill_sources[name] = path
    wrapper_plan = render_skill_wrapper_plan(projected_skill_sources)

    def remove_managed_tree(dir_path: Path) -> None:
        """Delete the files under a directory the policy allows, and record the rest as skipped.

        Deleting the directory in one call would ignore a protected_paths entry naming a single
        file inside it, so the removal is per file and the directory goes only when it is empty.
        """
        rel_dir = dir_path.relative_to(target_dir)
        for entry in sorted(dir_path.glob("**/*")):
            if not (entry.is_file() or entry.is_symlink()):
                continue
            rel_entry = entry.relative_to(target_dir)
            if not may_write(rel_entry):
                skipped.append(str(rel_entry))
                continue
            guard_symlink(rel_entry)
            deleted_files.append(str(rel_entry))
            if not dry_run:
                entry.unlink(missing_ok=True)
        if not dry_run and may_write(rel_dir) and not effective_policy.protects_under(rel_dir) and dir_path.is_dir():
            remaining = [e for e in dir_path.glob("**/*") if e.is_file() or e.is_symlink()]
            if not remaining:
                shutil.rmtree(dir_path, ignore_errors=True)
            else:
                for sub in sorted(dir_path.glob("**/*"), reverse=True):
                    if sub.is_dir():
                        try:
                            sub.rmdir()
                        except OSError:
                            pass

    # Guard every path this run could touch before writing anything: a symlink discovered halfway
    # through would otherwise abort the run with part of the harness already replaced.
    candidate_paths: list[Path | str] = list(sync_files) + [
        Path(".agents") / "project-profile.yaml",
        Path("AGENTS.md"),
        # Managed outside the manifest loops; guarded up front so a symlink on them fails
        # before the first write instead of midway through the run.
        Path(".agents") / "lessons" / "index.json",
        Path(".agents") / "lessons" / "items",
        *package.adapter_outputs,
        # Removed legacy sources: guarded here so a symlinked leftover fails before the first
        # write rather than midway through the run.
        *package.remove_paths,
    ]
    for rel_dir in sync_dirs:
        src_dir = template_dir / rel_dir
        if src_dir.is_dir():
            candidate_paths.extend(
                src_file.relative_to(template_dir)
                for src_file in src_dir.glob("**/*")
                if src_file.is_file() and "__pycache__" not in src_file.parts
            )
    for adapter_root_relative in package.adapter_outputs:
        adapter_root = target_dir / adapter_root_relative
        if adapter_root.is_dir() and not adapter_root.is_symlink():
            to_visit = list(adapter_root.iterdir())
            while to_visit:
                entry = to_visit.pop()
                candidate_paths.append(entry.relative_to(target_dir))
                if entry.is_dir() and not entry.is_symlink():
                    to_visit.extend(entry.iterdir())
        for name in wrapper_plan:
            candidate_paths.extend(
                (
                    adapter_root_relative / name,
                    adapter_root_relative / name / "SKILL.md",
                )
            )
    for removed_path in package.remove_paths:
        target_removed = target_dir / removed_path
        if target_removed.is_dir() and not target_removed.is_symlink():
            to_visit = list(target_removed.iterdir())
            while to_visit:
                entry = to_visit.pop()
                candidate_paths.append(entry.relative_to(target_dir))
                if entry.is_dir() and not entry.is_symlink():
                    to_visit.extend(entry.iterdir())
    if not target_is_template:
        for existing in (target_dir / ".agents" / "skills", target_dir / ".grok" / "skills"):
            if existing.exists():
                candidate_paths.append(existing.relative_to(target_dir))
    guard_all(candidate_paths)

    blocked_adapter_roots: set[Path] = set()
    replaced_adapter_entries: set[Path] = set()
    blocked_adapter_entries: set[Path] = set()
    for adapter_root_relative in package.adapter_outputs:
        adapter_root = target_dir / adapter_root_relative
        if not adapter_root.is_symlink() and (not adapter_root.exists() or adapter_root.is_dir()):
            continue
        if not may_write(adapter_root_relative):
            skipped.append(adapter_root_relative.as_posix())
            blocked_adapter_roots.add(adapter_root_relative)
            continue
        deleted_files.append(adapter_root_relative.as_posix())
        if dry_run:
            blocked_adapter_roots.add(adapter_root_relative)
        else:
            adapter_root.unlink()

    for adapter_root_relative in package.adapter_outputs:
        if adapter_root_relative in blocked_adapter_roots:
            continue
        for skill_name in wrapper_plan:
            entry_relative = adapter_root_relative / skill_name
            entry = target_dir / entry_relative
            if not (entry.is_symlink() or (entry.exists() and not entry.is_dir())):
                continue
            if not may_write(entry_relative):
                skipped.append(entry_relative.as_posix())
                blocked_adapter_entries.add(entry_relative)
                continue
            deleted_files.append(entry_relative.as_posix())
            replaced_adapter_entries.add(entry_relative)
            if not dry_run:
                entry.unlink()

    def below_blocked_adapter(path: Path) -> bool:
        relative = path.relative_to(target_dir)
        return any(root == relative or root in relative.parents for root in blocked_adapter_roots)

    # Parse the retired lessons store and the index now: a title that yields no id or a hand-edited
    # index must fail before the first write, not halfway through the harness trees.
    legacy_lessons_path = target_dir / ".agents" / "lessons.md"
    lessons_index_rel = Path(".agents") / "lessons" / "index.json"
    if (
        legacy_lessons_path.is_file()
        and may_write(".agents/lessons.md")
        and may_write(lessons_index_rel)
    ):
        parse_legacy_store(legacy_lessons_path.read_text(encoding="utf-8"))
        load_index(target_dir / ".agents" / "lessons" / "index.json")

    for rel_dir in sync_dirs:
        src_dir = template_dir / rel_dir
        dest_dir = target_dir / rel_dir
        if not src_dir.is_dir():
            continue

        for src_file in src_dir.glob("**/*"):
            if not src_file.is_file() or "__pycache__" in src_file.parts:
                continue
            rel_file = src_file.relative_to(template_dir)

            # Skip excluded skills before template-only checks
            if not target_is_template and effective_excluded and _is_excluded_rel_path(rel_file, effective_excluded):
                continue
            if not may_write(rel_file):
                skipped.append(str(rel_file))
                continue
            guard_symlink(rel_file)
            # Skip template-only assets if target is not template
            if not target_is_template and package.is_template_only(rel_file):
                continue

            if rel_file.parts[:2] == (".grok", "skills"):
                continue
            if rel_file.parts[:2] == (".opencode", "node_modules"):
                continue

            dest_file = target_dir / rel_file

            src_content = src_file.read_bytes()
            if dest_file.is_file():
                if dest_file.read_bytes() != src_content:
                    if not dry_run:
                        dest_file.parent.mkdir(parents=True, exist_ok=True)
                        dest_file.write_bytes(src_content)
                    updated_files.append(str(rel_file))
            else:
                if not dry_run:
                    dest_file.parent.mkdir(parents=True, exist_ok=True)
                    dest_file.write_bytes(src_content)
                added_files.append(str(rel_file))

    # Remove excluded skills that already exist in target (reported as deleted_files, respecting dry-run)
    if not target_is_template and effective_excluded:
        for skill in sorted(effective_excluded):
            candidates: list[Path] = [
                target_dir / ".agents" / "skills" / skill,
                target_dir / ".grok" / "skills" / skill,
                target_dir / ".codex" / skill,
                target_dir / ".codex" / "skills" / skill,
                target_dir / ".opencode" / skill,
                target_dir / ".opencode" / "skills" / skill,
                target_dir / ".agents" / "skills-available" / skill,
                target_dir / ".grok" / "skills-available" / skill,
            ]
            for cand in candidates:
                if below_blocked_adapter(cand):
                    continue
                if cand.is_dir():
                    remove_managed_tree(cand)
                elif cand.is_file() and may_write(cand.relative_to(target_dir)):
                    deleted_files.append(str(cand.relative_to(target_dir)))
                    if not dry_run:
                        try:
                            cand.unlink(missing_ok=True)
                        except Exception:
                            pass

    # Clean up deprecated template-only and obsolete harness files in target projects
    if not target_is_template:
        template_only_skills = {
            path.parts[2]
            for path in package.template_only_paths
            if len(path.parts) == 3 and path.parts[:2] == (".agents", "skills")
        }
        for skill in (template_only_skills | DEPRECATED_HARNESS_SKILLS):
            skill_dir = target_dir / ".agents" / "skills" / skill
            if skill_dir.is_dir():
                remove_managed_tree(skill_dir)
            grok_skill_dir = target_dir / ".grok" / "skills" / skill
            if not below_blocked_adapter(grok_skill_dir) and grok_skill_dir.is_dir():
                remove_managed_tree(grok_skill_dir)
        template_only_templates = {
            path
            for path in package.template_only_paths
            if len(path.parts) == 3 and path.parts[:2] == (".agents", "templates")
        }
        for relative in template_only_templates:
            tmpl_file = target_dir / relative
            if tmpl_file.is_file() and may_write(tmpl_file.relative_to(target_dir)):
                guard_symlink(tmpl_file.relative_to(target_dir))
                deleted_files.append(str(tmpl_file.relative_to(target_dir)))
                if not dry_run:
                    tmpl_file.unlink(missing_ok=True)
        # Merged-away and legacy harness sources: registering a path as removed must actually
        # delete it downstream, otherwise a target keeps both the merged file and its sources.
        for relative in sorted(set(package.remove_paths) - {Path(path) for path in MIGRATED_HARNESS_PATHS}):
            rel = relative.as_posix()
            legacy_path = target_dir / relative
            if not legacy_path.exists():
                continue
            if legacy_path.is_dir():
                remove_managed_tree(legacy_path)
                continue
            if not may_write(rel):
                skipped.append(rel)
                continue
            # A project that skips the AGENTS.md update still loads the removed policy
            # from its unchanged router, so keep the file until that router is rewritten.
            if (
                rel == ".agents/communication.md"
                and (
                    effective_policy.agents_md == "skip"
                    or effective_policy.is_protected("AGENTS.md")
                )
            ):
                agents_path = target_dir / "AGENTS.md"
                if agents_path.is_file() and ".agents/communication.md" in agents_path.read_text(
                    encoding="utf-8"
                ):
                    skipped.append(rel)
                    continue
            guard_symlink(rel)
            deleted_files.append(rel)
            if not dry_run:
                legacy_path.unlink(missing_ok=True)

        if not dry_run:
            for rel in (".agents/references", ".agents/docs"):
                retired_dir = target_dir / rel
                if (
                    retired_dir.is_dir()
                    and may_write(rel)
                    and not effective_policy.protects_under(rel)
                    and not any(retired_dir.iterdir())
                ):
                    retired_dir.rmdir()

        if not dry_run and (target_dir / ".agents" / "state").is_dir():
            try:
                (target_dir / ".agents" / "state").rmdir()
            except OSError:
                pass

        legacy_principles = target_dir / ".agents" / "principles.md"
        if legacy_principles.is_file() and may_write(legacy_principles.relative_to(target_dir)):
            guard_symlink(legacy_principles.relative_to(target_dir))
            deleted_files.append(str(legacy_principles.relative_to(target_dir)))
            if not dry_run:
                legacy_principles.unlink(missing_ok=True)

    # Sync any optional skills that were previously enabled in target
    if not target_is_template:
        template_avail_skills = template_dir / "tools" / "harness" / "skills-available"
        if not template_avail_skills.is_dir():
            template_avail_skills = template_dir / ".agents" / "skills-available"
        if template_avail_skills.is_dir():
            for opt_skill_dir in template_avail_skills.iterdir():
                if not opt_skill_dir.is_dir():
                    continue
                opt_name = opt_skill_dir.name
                if opt_name in effective_excluded:
                    continue
                target_skill_dir = target_dir / ".agents" / "skills" / opt_name
                if target_skill_dir.is_dir():
                    for sfile in opt_skill_dir.glob("**/*"):
                        if not sfile.is_file() or "__pycache__" in sfile.parts:
                            continue
                        rpath = sfile.relative_to(opt_skill_dir)
                        dest_file = target_skill_dir / rpath
                        src_content = sfile.read_bytes()
                        rel_record = str(Path(".agents") / "skills" / opt_name / rpath)
                        if not may_write(rel_record):
                            skipped.append(rel_record)
                            continue
                        guard_symlink(rel_record)
                        if dest_file.is_file():
                            if dest_file.read_bytes() != src_content:
                                if not dry_run:
                                    dest_file.parent.mkdir(parents=True, exist_ok=True)
                                    dest_file.write_bytes(src_content)
                                updated_files.append(rel_record)
                        else:
                            if not dry_run:
                                dest_file.parent.mkdir(parents=True, exist_ok=True)
                                dest_file.write_bytes(src_content)
                            added_files.append(rel_record)

    expected_names = set(wrapper_plan)
    for adapter_root_relative in package.adapter_outputs:
        adapter_root = target_dir / adapter_root_relative
        if adapter_root_relative not in blocked_adapter_roots and adapter_root.is_dir():
            for existing in sorted(adapter_root.iterdir()):
                if existing.name in expected_names:
                    continue
                relative = existing.relative_to(target_dir)
                if not may_write(relative):
                    skipped.append(relative.as_posix())
                    continue
                if existing.is_symlink():
                    deleted_files.append(relative.as_posix())
                    if not dry_run:
                        existing.unlink()
                elif existing.is_dir():
                    remove_managed_tree(existing)
                else:
                    deleted_files.append(relative.as_posix())
                    if not dry_run:
                        existing.unlink()
        for skill_name, content in sorted(wrapper_plan.items()):
            relative = adapter_root_relative / skill_name / "SKILL.md"
            if relative.parent in blocked_adapter_entries:
                continue
            if not may_write(relative):
                skipped.append(relative.as_posix())
                continue
            guard_symlink(relative)
            destination = target_dir / relative
            skill_dir = destination.parent
            replaced_entry = skill_dir.relative_to(target_dir) in replaced_adapter_entries
            file_is_link = (
                adapter_root_relative not in blocked_adapter_roots
                and not replaced_entry
                and destination.is_symlink()
            )
            existed = (
                adapter_root_relative not in blocked_adapter_roots
                and not replaced_entry
                and not file_is_link
                and destination.is_file()
            )
            if existed and destination.read_text(encoding="utf-8") == content:
                continue
            if file_is_link:
                deleted_files.append(relative.as_posix())
            if not dry_run:
                if file_is_link:
                    destination.unlink()
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(content, encoding="utf-8")
            (updated_files if existed or replaced_entry or file_is_link else added_files).append(
                relative.as_posix()
            )

    # 2. Individual files to sync/overwrite
    for rel_file in sync_files:
        if not target_is_template and package.is_template_only(rel_file):
            continue
        src_file = template_dir / rel_file
        dest_file = target_dir / rel_file
        if not src_file.is_file():
            continue
        if not may_write(rel_file):
            skipped.append(str(rel_file))
            continue
        guard_symlink(rel_file)

        src_content = src_file.read_bytes()
        if dest_file.is_file():
            if dest_file.read_bytes() != src_content:
                if not dry_run:
                    dest_file.parent.mkdir(parents=True, exist_ok=True)
                    dest_file.write_bytes(src_content)
                updated_files.append(str(rel_file))
        else:
            if not dry_run:
                dest_file.parent.mkdir(parents=True, exist_ok=True)
                dest_file.write_bytes(src_content)
            added_files.append(str(rel_file))

    # 3b. The selective lessons store. Projects keep their lessons here, so an index that already
    # exists is never overwritten and the absent-only creation stays invisible to updated/added (no
    # report noise, no second-run effective change). A target that still carries the retired
    # single-file store has its lessons migrated into items first: the lessons themselves are
    # project knowledge and must survive the layout change.
    lessons_rel = Path(".agents") / "lessons" / "index.json"
    lessons_index = target_dir / lessons_rel
    legacy_rel = ".agents/lessons.md"
    legacy_lessons = target_dir / legacy_rel
    index_rel_str = str(lessons_rel).replace("\\", "/")
    index_existed = lessons_index.is_file()
    if may_write(lessons_rel):
        guard_symlink(lessons_rel)
        if legacy_lessons.is_file():
            if may_write(legacy_rel):
                guard_symlink(legacy_rel)
                guard_symlink(Path(".agents") / "lessons" / "items")
                migration = migrate_legacy_store(
                    target_dir / ".agents", dry_run=dry_run, can_write=may_write
                )
                added_files.extend(migration.added_items)
                if migration.index_written:
                    (updated_files if index_existed else added_files).append(index_rel_str)
                if migration.legacy_removed:
                    deleted_files.append(legacy_rel)
                else:
                    # Lessons this run could not migrate: keep the file and name the leftovers
                    # instead of dropping a project's own lessons.
                    pending.append(
                        f"{legacy_rel}: unmigrated lessons or lines remain "
                        f"({', '.join(migration.pending[:6])})"
                    )
            else:
                skipped.append(legacy_rel)
        if not index_existed and not lessons_index.is_file():
            if not dry_run:
                lessons_index.parent.mkdir(parents=True, exist_ok=True)
                lessons_index.write_text(index_text(empty_index()), encoding="utf-8")
    elif legacy_lessons.is_file():
        skipped.append(legacy_rel)

    # 3. Smart merge .agents/project-profile.yaml
    # The profile carries harness.version, so it is written regardless of managed_areas; a project
    # that protects it in sync.protected_paths deliberately freezes its recorded harness version.
    target_profile = target_dir / ".agents" / "project-profile.yaml"
    template_profile = template_dir / ".agents" / "project-profile.yaml"
    profile_rel = Path(".agents") / "project-profile.yaml"
    if effective_policy.is_protected(profile_rel):
        skipped.append(str(profile_rel))
    else:
        guard_symlink(profile_rel)
        merged_profile = merge_project_profile(target_profile, template_profile, target_version)
        if target_profile.is_file():
            if target_profile.read_text(encoding="utf-8") != merged_profile:
                if not dry_run:
                    target_profile.write_text(merged_profile, encoding="utf-8")
                updated_files.append(str(target_profile.relative_to(target_dir)))
        else:
            if not dry_run:
                target_profile.parent.mkdir(parents=True, exist_ok=True)
                target_profile.write_text(merged_profile, encoding="utf-8")
            added_files.append(str(target_profile.relative_to(target_dir)))

    # 4. Smart merge AGENTS.md
    target_agents = target_dir / "AGENTS.md"
    template_agents = template_dir / "AGENTS.md"
    if effective_policy.agents_md == "skip" or effective_policy.is_protected("AGENTS.md"):
        skipped.append("AGENTS.md")
    elif template_agents.is_file():
        guard_symlink("AGENTS.md")
        keep_sections = (
            effective_policy.keep_sections
            if effective_policy.agents_md == "keep-sections"
            else None
        )
        merged_agents = merge_agents_md(
            target_agents,
            template_agents,
            keep_sections=keep_sections,
            policy=effective_policy,
            pending_out=pending,
        )
        if target_agents.is_file():
            if target_agents.read_text(encoding="utf-8") != merged_agents:
                if not dry_run:
                    target_agents.write_text(merged_agents, encoding="utf-8")
                updated_files.append("AGENTS.md")
        else:
            if not dry_run:
                target_agents.write_text(merged_agents, encoding="utf-8")
            added_files.append("AGENTS.md")

    return updated_files, added_files, deleted_files


def run_validation(target_dir: Path) -> tuple[bool, list[str]]:
    val_script = target_dir / ".agents" / "scripts" / "validate-config"
    if not val_script.is_file():
        return True, []
    res = subprocess.run(
        [sys.executable, str(val_script)],
        cwd=target_dir, capture_output=True, text=True, check=False,
    )
    if res.returncode != 0:
        errors = [line for line in (res.stdout + res.stderr).splitlines() if line.strip()]
        return False, errors
    return True, []


def source_checkout_version(source: str | Path | None) -> str:
    """Harness version of the checkout this updater runs from.

    The refusal gate keys on the updater's own checkout, not on the target: an old copy of this
    script cannot know the manifest of a release it has never seen.
    """
    source_dir = Path(source).resolve() if source and Path(source).is_dir() else Path(__file__).resolve().parents[4]
    try:
        return get_current_harness_version(source_dir)
    except Exception:
        return "0.0.0"


def is_pre_v4_source(source: str | Path | None) -> bool:
    """True when the updater's own checkout predates the v4 layout contract (semver < 6.0.0).

    "v4" names the harness layout generation (`.agents/workflows|references|docs|environments`,
    the eight-section AGENTS.md); in semver it shipped as 6.0.0. A 5.x updater copy - like the
    5.10.1 one that damaged naomem - cannot know that manifest.
    """
    try:
        major, _minor, _patch, _prerelease = parse_semver(source_checkout_version(source))
    except ValueError:
        return True
    return major < 6


PRE_V4_REFUSAL_MESSAGE = (
    "refusing to upgrade to harness {version}: this updater runs from a pre-v4 template checkout "
    "(harness {source_version}). Run the updater from an up-to-date template checkout "
    "(git -C ~/projects/project-template pull), then update the target from there."
)


def execute_update(
    version: str | None = None,
    target_path: str | Path | None = None,
    source: str | Path | None = None,
    create_commit: bool = False,
    dry_run: bool = False,
    force: bool = False,
    skip_validation: bool = False,
) -> dict:
    target_dir = Path(target_path).resolve() if target_path else ROOT
    if not (target_dir / ".agents").is_dir():
        return {
            "success": False,
            "error": f"Target directory '{target_dir}' does not appear to be a project-template workspace.",
        }

    current_version = get_current_harness_version(target_dir)
    try:
        policy = load_policy(target_dir / ".agents" / "project-profile.yaml")
    except SyncPolicyError as exc:
        return {
            "success": False,
            "error": f"invalid sync policy in {target_dir / '.agents' / 'project-profile.yaml'}: {exc}",
            "current_version": current_version,
        }
    policy_summary = {
        "mode": policy.mode,
        "managed_areas": sorted(policy.managed_areas),
        "agents_md": policy.agents_md,
        "keep_sections": list(policy.keep_sections),
        "protected_paths": list(policy.protected_paths),
        "allow_symlinked_dirs": policy.allow_symlinked_dirs,
        "validate": policy.validate,
    }

    # Determine target version
    if not version or version == "latest":
        available = discover_available_versions(source)
        if not available:
            return {
                "success": False,
                "error": "No available project-template versions found from source.",
            }
        target_version = available[-1]
    elif version in ("patch", "minor", "major"):
        target_version = bump_semver(current_version, version)
    else:
        target_version = version.strip().lstrip("v")
        if not is_valid_semver(target_version):
            return {
                "success": False,
                "error": f"Invalid semver version: '{version}'",
            }

    # Refusal gate: a pre-v4 updater checkout cannot know the >= 6.0.0 manifest (new sync dirs,
    # section layout), so it refuses loudly before any fetch or write - also under --dry-run and
    # --force. The gate keys on the updater's own source checkout, never on the target version.
    if parse_semver(target_version)[0] >= 6 and is_pre_v4_source(source):
        return {
            "success": False,
            "error": PRE_V4_REFUSAL_MESSAGE.format(
                version=target_version, source_version=source_checkout_version(source)
            ),
            "current_version": current_version,
            "target_version": target_version,
        }

    if current_version == target_version and not force and not dry_run:
        return {
            "success": True,
            "already_up_to_date": True,
            "current_version": current_version,
            "target_version": target_version,
            "message": f"Workspace is already up-to-date with project-template {current_version}.",
            "updated_files": [],
            "added_files": [],
            "deleted_files": [],
        }

    with tempfile.TemporaryDirectory() as temp_dir_str:
        temp_dir = Path(temp_dir_str)
        try:
            fetch_template_to_directory(target_version, source, temp_dir)
        except Exception as exc:
            return {
                "success": False,
                "error": f"Failed to fetch template {target_version}: {exc}",
            }

        try:
            package = load_package_manifest(temp_dir)
        except PackageManifestError as exc:
            return {
                "success": False,
                "error": str(exc),
                "current_version": current_version,
                "target_version": target_version,
                "policy": policy_summary,
            }

        skipped_by_policy: list[str] = []
        pending_actions: list[str] = []
        try:
            updated_files, added_files, deleted_files = sync_harness(
                template_dir=temp_dir,
                target_dir=target_dir,
                target_version=target_version,
                dry_run=dry_run,
                policy=policy,
                skipped_out=skipped_by_policy,
                pending_out=pending_actions,
                package=package,
            )
        except (SymlinkedTargetError, LessonsStoreError, SkillWrapperError, PackageManifestError) as exc:
            return {
                "success": False,
                "error": str(exc),
                "current_version": current_version,
                "target_version": target_version,
                "policy": policy_summary,
            }

    if dry_run:
        return {
            "success": True,
            "dry_run": True,
            "current_version": current_version,
            "target_version": target_version,
            "updated_files": updated_files,
            "added_files": added_files,
            "deleted_files": deleted_files,
            "skipped_by_policy": sorted(set(skipped_by_policy)),
            "pending_actions": sorted(set(pending_actions)),
            "policy": policy_summary,
            "will_commit": create_commit,
        }

    # Run validation
    validation_ok = True
    validation_errors: list[str] = []
    if not skip_validation:
        validation_ok, validation_errors = run_validation(target_dir)
        if not validation_ok:
            return {
                "success": False,
                "error": "Configuration validation failed after update.",
                "current_version": current_version,
                "target_version": target_version,
                "validation_errors": validation_errors,
                "updated_files": updated_files,
                "added_files": added_files,
                "deleted_files": deleted_files,
            }

    # Git commit
    commit_created = False
    commit_hash = ""
    if create_commit and (target_dir / ".git").is_dir() and (updated_files or added_files or deleted_files):
        commit_msg = f"chore: update harness config to {target_version}"
        res = commit_paths(target_dir, updated_files + added_files + deleted_files, commit_msg, runner=run)
        if res.returncode:
            return {'success': False, 'error': f'Harness commit failed: {res.stderr or res.stdout}',
                    'updated_files': updated_files, 'added_files': added_files, 'deleted_files': deleted_files,
                    'commit_created': False}
        if res.returncode == 0:
            commit_created = True
            commit_hash = git_output("-C", str(target_dir), "rev-parse", "--short", "HEAD").strip()

    return {
        "success": True,
        "current_version": current_version,
        "target_version": target_version,
        "updated_files": updated_files,
        "added_files": added_files,
        "deleted_files": deleted_files,
        "skipped_by_policy": sorted(set(skipped_by_policy)),
        "pending_actions": sorted(set(pending_actions)),
        "policy": policy_summary,
        "validation_passed": validation_ok,
        "commit_created": commit_created,
        "commit": commit_hash,
    }


def print_policy(result: dict) -> None:
    """Report the update policy that governed this run, so skipped areas are never silent."""
    policy = result.get("policy") or {}
    if not policy:
        return
    if policy.get("mode") == "selective":
        print("Sync policy: selective, managed areas:", ", ".join(policy.get("managed_areas") or []) or "none")
    else:
        print("Sync policy: full")
    if policy.get("protected_paths"):
        print("Protected paths:", ", ".join(policy["protected_paths"]))
    if policy.get("agents_md") != "merge":
        print(f"AGENTS.md handling: {policy.get('agents_md')}")
    skipped = result.get("skipped_by_policy") or []
    if skipped:
        print(f"Skipped by policy ({len(skipped)} files):", ", ".join(skipped[:12]) + (" ..." if len(skipped) > 12 else ""))
    for item in result.get("pending_actions") or []:
        print(f"Needs manual completion: {item}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", nargs="?", default="latest", help="Target version: semver (e.g. 5.4.0), latest (default), patch, minor, major")
    parser.add_argument("--target", help="Target project root directory (default: current workspace root)")
    parser.add_argument("--source", help="Source project-template repository path or URL")
    parser.add_argument("-c", "--commit", dest="commit", action="store_true", default=False, help="Create a git commit with the update (requires explicit authorization; default: false)")
    parser.add_argument("--no-commit", dest="commit", action="store_false", help="Do not create a git commit (default)")
    parser.add_argument("--dry-run", action="store_true", help="Preview update without modifying files")
    parser.add_argument("--force", action="store_true", help="Force update even if version is unchanged")
    parser.add_argument("--skip-validation", action="store_true", help="Skip running validate-config")
    parser.add_argument("--list-versions", action="store_true", help="List available template versions and exit")
    parser.add_argument("--json", action="store_true", help="Output results in JSON format")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.list_versions:
        versions = discover_available_versions(args.source)
        if args.json:
            print(json.dumps({"versions": versions}, indent=2))
        else:
            print("Available project-template versions:")
            for v in versions:
                print(f"  - {v}")
        return 0

    result = execute_update(
        version=args.version,
        target_path=args.target,
        source=args.source,
        create_commit=args.commit,
        dry_run=args.dry_run,
        force=args.force,
        skip_validation=args.skip_validation,
    )

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if result.get("success"):
            if result.get("already_up_to_date"):
                print(result["message"])
            elif result.get("dry_run"):
                print(f"[DRY-RUN] Update harness config: {result['current_version']} -> {result['target_version']}")
                print(f"Files to update ({len(result['updated_files'])}):", ", ".join(result["updated_files"]) or "none")
                print(f"Files to add ({len(result['added_files'])}):", ", ".join(result["added_files"]) or "none")
                print(f"Files to delete ({len(result['deleted_files'])}):", ", ".join(result["deleted_files"]) or "none")
                print_policy(result)
            else:
                print(f"Harness configuration successfully updated: {result['current_version']} -> {result['target_version']}")
                if result.get("updated_files"):
                    print(f"Updated ({len(result['updated_files'])} files):", ", ".join(result["updated_files"]))
                if result.get("added_files"):
                    print(f"Added ({len(result['added_files'])} files):", ", ".join(result["added_files"]))
                if result.get("deleted_files"):
                    print(f"Deleted ({len(result['deleted_files'])} files):", ", ".join(result["deleted_files"]))
                print_policy(result)
                if result.get("commit_created"):
                    print(f"Commit created: {result.get('commit')}")
                print("Configuration validation: PASSED")
        else:
            print(f"ERROR: {result.get('error')}", file=sys.stderr)
            if "validation_errors" in result:
                print("Validation errors:", file=sys.stderr)
                for err in result["validation_errors"]:
                    print(f"  - {err}", file=sys.stderr)

    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
