#!/usr/bin/env python3
"""Canonical harness update policy: which harness areas a target project lets the update write.

The policy lives in the optional `sync:` section of `.agents/project-profile.yaml`. A profile
without that section keeps the historical behaviour: every harness area is managed, `AGENTS.md`
is merged, and `validate-config` requires the full harness contract.

Both `.agents/scripts/validate-config` and
`.agents/skills/harness-config-update/scripts/harness_config_update.py` read the policy from here,
so the area map has exactly one definition.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping

# Area -> repository paths it owns. A pattern without a wildcard also matches everything below it.
AREA_PATHS: dict[str, tuple[str, ...]] = {
    "communication": (".agents/communication.md",),
    "engineering": (".agents/engineering.md", ".agents/principles.md"),
    "safety": (".agents/safety.md",),
    "workflow": (".agents/workflows", ".agents/workflow.md"),
    "agents-readme": (".agents/README.md",),
    "scripts": (".agents/scripts",),
    "hooks": (".agents/hooks", ".agents/hooks.json"),
    "templates": (".agents/templates",),
    "skills": (".agents/skills", ".agents/skills-available"),
    # `.agents/lessons.md` is the retired single-file store: the area still names it so a
    # selective target can have it migrated into `.agents/lessons/` items.
    "records": (".agents/tasks/README.md", ".agents/handoffs/README.md", ".agents/lessons.md", ".agents/lessons"),
    "profile": (".agents/project-profile.yaml",),
    "adapter-claude": ("CLAUDE.md", ".claude"),
    "adapter-codex": (".codex",),
    "adapter-grok": (".grok",),
    "adapter-opencode": ("opencode.json", ".opencode"),
    "adapter-agy": (".agents/rules/agy.md",),
    "ci": (".gitlab-ci.yml", ".gitattributes"),
}

# Convenience groups expanded at load time. Carve a single file out again with protected_paths.
AREA_ALIASES: dict[str, tuple[str, ...]] = {
    "policies": ("communication", "engineering", "safety", "workflow", "agents-readme"),
    "adapters": ("adapter-claude", "adapter-codex", "adapter-grok", "adapter-opencode", "adapter-agy"),
}

MODES = ("full", "selective")
AGENTS_MD_MODES = ("merge", "keep-sections", "skip")
VALIDATE_MODES = ("full", "managed-only")

DEFAULT_MODE = "full"
DEFAULT_AGENTS_MD = "merge"
DEFAULT_VALIDATE = "full"

BOOL_TRUE = {"true", "yes", "on", "1"}
BOOL_FALSE = {"false", "no", "off", "0"}


class SyncPolicyError(ValueError):
    """Raised when a profile declares a sync policy that cannot be applied as written."""


def _segment_to_regex(segment: str) -> str:
    """Translate one path segment; `*` and `?` never cross a path separator."""
    out = []
    for char in segment:
        if char == "*":
            out.append("[^/]*")
        elif char == "?":
            out.append("[^/]")
        else:
            out.append(re.escape(char))
    return "".join(out)


def _glob_to_regex(pattern: str) -> re.Pattern[str]:
    """Translate a policy glob segment by segment, matched against a leading-slash path.

    `**` stands for zero or more whole segments, so `**/x.md` never matches `yx.md` and a trailing
    `/**` matches the directory itself as well as its subtree - a protected directory must stay
    protected against operations that act on the directory rather than on each file inside it.
    """
    out = ["^"]
    for segment in pattern.split("/"):
        if segment == "**":
            out.append("(?:/[^/]*)*")
        else:
            out.append("/" + _segment_to_regex(segment))
    out.append("$")
    return re.compile("".join(out))


def path_matches(pattern: str, rel_path: str) -> bool:
    """Match a repository-relative POSIX path against one policy pattern."""
    pattern = pattern.strip().strip("/")
    rel_path = rel_path.replace("\\", "/").strip("/")
    if not pattern or not rel_path:
        return False
    if not any(token in pattern for token in ("*", "?")):
        return rel_path == pattern or rel_path.startswith(f"{pattern}/")
    return bool(_glob_to_regex(pattern).match(f"/{rel_path}"))


@dataclass(frozen=True)
class SyncPolicy:
    """Effective update policy for one target project."""

    mode: str = DEFAULT_MODE
    managed_areas: frozenset[str] = frozenset()
    agents_md: str = DEFAULT_AGENTS_MD
    keep_sections: tuple[str, ...] = ()
    protected_paths: tuple[str, ...] = ()
    allow_symlinked_dirs: bool = False
    validate: str = DEFAULT_VALIDATE

    @property
    def is_selective(self) -> bool:
        return self.mode == "selective"

    def area_of(self, rel_path: str | Path) -> str | None:
        """Return the harness area owning a path, or None when the harness does not own it."""
        text = str(rel_path).replace("\\", "/")
        for area, patterns in AREA_PATHS.items():
            if any(path_matches(pattern, text) for pattern in patterns):
                return area
        return None

    def is_protected(self, rel_path: str | Path) -> bool:
        text = str(rel_path).replace("\\", "/")
        return any(path_matches(pattern, text) for pattern in self.protected_paths)

    def protects_under(self, rel_dir: str | Path) -> bool:
        """True when any protected pattern can match a path inside this directory.

        Directory-granularity operations (a recursive delete) must refuse when a single file below
        them is protected, because matching the directory alone would not see that file.
        """
        text = str(rel_dir).replace("\\", "/").strip("/")
        if not text:
            return bool(self.protected_paths)
        if self.is_protected(text):
            return True
        return any(
            pattern.strip().strip("/").startswith(f"{text}/") for pattern in self.protected_paths
        )

    def area_managed(self, area: str) -> bool:
        if not self.is_selective:
            return True
        return area in self.managed_areas

    def is_managed(self, rel_path: str | Path) -> bool:
        """True when the update may write or delete this path in the target project."""
        if self.is_protected(rel_path):
            return False
        if not self.is_selective:
            return True
        area = self.area_of(rel_path)
        return area is not None and area in self.managed_areas


def expand_areas(names: Iterable[str]) -> set[str]:
    expanded: set[str] = set()
    for name in names:
        key = str(name).strip()
        if not key:
            continue
        if key in AREA_ALIASES:
            expanded.update(AREA_ALIASES[key])
        else:
            expanded.add(key)
    return expanded


def _as_list(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    text = str(raw).strip()
    return [text] if text else []


def _as_bool(raw: Any, default: bool) -> bool:
    if raw is None:
        return default
    text = str(raw).strip().lower()
    if text in BOOL_TRUE:
        return True
    if text in BOOL_FALSE:
        return False
    return default


def _enumerated(section: Mapping[str, Any], key: str, allowed: tuple[str, ...], default: str, strict: bool) -> str:
    """Read one enumerated policy value. A value outside the set is a policy error, not a default.

    Silently falling back would turn `mode: selectiv` into a full sync that overwrites every
    unprotected harness path, so strict callers fail instead. `validate-config` is the one lenient
    caller: it reports the same problem through validate_policy_values.
    """
    value = str(section.get(key, default) or default).strip()
    if value in allowed:
        return value
    if strict:
        raise SyncPolicyError(f"sync.{key} must be one of {', '.join(allowed)}: {value}")
    return default


def policy_from_values(values: Mapping[str, Any], *, strict: bool = True) -> SyncPolicy:
    """Build the effective policy from parsed profile values. Absent section means full sync."""
    section = values.get("sync", {}) if isinstance(values, Mapping) else {}
    if not isinstance(section, Mapping):
        if strict:
            raise SyncPolicyError("sync must be a mapping of policy keys")
        section = {}
    mode = _enumerated(section, "mode", MODES, DEFAULT_MODE, strict)
    agents_md = _enumerated(section, "agents_md", AGENTS_MD_MODES, DEFAULT_AGENTS_MD, strict)
    validate = _enumerated(section, "validate", VALIDATE_MODES, DEFAULT_VALIDATE, strict)
    if strict and mode == "selective" and not expand_areas(_as_list(section.get("managed_areas"))):
        raise SyncPolicyError("sync.mode selective requires a non-empty sync.managed_areas")
    return SyncPolicy(
        mode=mode,
        managed_areas=frozenset(expand_areas(_as_list(section.get("managed_areas")))),
        agents_md=agents_md,
        keep_sections=tuple(_as_list(section.get("keep_sections"))),
        protected_paths=tuple(_as_list(section.get("protected_paths"))),
        allow_symlinked_dirs=_as_bool(section.get("allow_symlinked_dirs"), False),
        validate=validate,
    )


def load_policy(profile_path: Path) -> SyncPolicy:
    """Read the policy from a target project profile. A missing profile means full sync."""
    if not profile_path.is_file():
        return SyncPolicy()
    import sys

    scripts_dir = str(Path(__file__).resolve().parent)
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    from common import profile_values  # local import: shared parser lives next to this module

    return policy_from_values(profile_values(profile_path))


def validate_policy_values(values: Mapping[str, Any]) -> list[str]:
    """Reject an unusable sync policy instead of silently ignoring parts of it."""
    section = values.get("sync") if isinstance(values, Mapping) else None
    if section is None:
        return []
    if not isinstance(section, Mapping):
        return ["sync must be a mapping of policy keys"]

    errors: list[str] = []
    known_keys = {
        "mode", "managed_areas", "agents_md", "keep_sections",
        "protected_paths", "allow_symlinked_dirs", "validate",
    }
    for key in sorted(set(section) - known_keys):
        errors.append(f"unknown sync key: {key}")

    mode = str(section.get("mode", DEFAULT_MODE) or DEFAULT_MODE).strip()
    if mode not in MODES:
        errors.append(f"sync.mode must be one of {', '.join(MODES)}: {mode}")

    raw_areas = section.get("managed_areas")
    if raw_areas is not None and not isinstance(raw_areas, list):
        errors.append("sync.managed_areas must be a list")
    areas = _as_list(raw_areas)
    for name in areas:
        if name not in AREA_PATHS and name not in AREA_ALIASES:
            errors.append(f"unknown sync managed area: {name}")
    if len(areas) != len(set(areas)):
        duplicates = sorted({name for name in areas if areas.count(name) > 1})
        errors.append(f"duplicate sync managed area: {', '.join(duplicates)}")
    if mode == "selective" and not areas:
        errors.append("sync.mode selective requires a non-empty sync.managed_areas")
    if mode == "full" and areas:
        errors.append("sync.managed_areas applies only to sync.mode selective")

    agents_md = str(section.get("agents_md", DEFAULT_AGENTS_MD) or DEFAULT_AGENTS_MD).strip()
    if agents_md not in AGENTS_MD_MODES:
        errors.append(f"sync.agents_md must be one of {', '.join(AGENTS_MD_MODES)}: {agents_md}")
    keep_sections = _as_list(section.get("keep_sections"))
    if agents_md == "keep-sections" and not keep_sections:
        errors.append("sync.agents_md keep-sections requires a non-empty sync.keep_sections")
    if agents_md != "keep-sections" and keep_sections:
        errors.append("sync.keep_sections applies only to sync.agents_md keep-sections")

    for pattern in _as_list(section.get("protected_paths")):
        if pattern.startswith("/") or pattern.startswith("~") or ".." in Path(pattern).parts:
            errors.append(f"sync.protected_paths must be repository-relative without '..': {pattern}")

    raw_allow = section.get("allow_symlinked_dirs")
    if raw_allow is not None and str(raw_allow).strip().lower() not in (BOOL_TRUE | BOOL_FALSE):
        errors.append(f"sync.allow_symlinked_dirs must be a boolean: {raw_allow}")

    validate = str(section.get("validate", DEFAULT_VALIDATE) or DEFAULT_VALIDATE).strip()
    if validate not in VALIDATE_MODES:
        errors.append(f"sync.validate must be one of {', '.join(VALIDATE_MODES)}: {validate}")

    return errors
