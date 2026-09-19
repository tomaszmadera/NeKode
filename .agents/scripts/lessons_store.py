#!/usr/bin/env python3
"""Canonical selective lessons store: layout, index schema, and legacy-store migration.

The store lives in `.agents/lessons/`: `index.json` carries compact metadata for every lesson
(`id`, `scopes`, `tags`, `path`) and `items/<id>.md` carries the lesson text. `lesson-select`
reads the index, intersects scopes and tags with the current task, and opens only the matching
items, so no task loads the whole lesson history.

Both `.agents/skills/harness-config-update/scripts/harness_config_update.py` and
`.agents/skills/bootstrap-project/scripts/bootstrap.py` migrate a target project's legacy
single-file store through this module, so the layout has exactly one definition.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Sequence

SCHEMA_VERSION = 1
STORE_DIR = ".agents/lessons"
ITEMS_DIRNAME = "items"
INDEX_FILENAME = "index.json"
LEGACY_STORE_NAME = "lessons.md"

# A lesson carries `harness-development` when it constrains work on this template's harness, and
# `product` when it constrains work in any project regardless of the harness. Both may apply.
SCOPES = ("harness-development", "product")
# A legacy lesson written inside a target project is a project lesson; the migration cannot infer
# a harness scope for it, so it records the one scope it can prove.
MIGRATED_SCOPES = ("product",)

_LESSON_HEADING = re.compile(r"^###\s+(?P<title>.+?)\s*$", re.MULTILINE)
_HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_LESSONS_SECTION = re.compile(r"^##\s+Lessons\s*$", re.MULTILINE)
_NEXT_SECTION = re.compile(r"^##[^#]", re.MULTILINE)
_SLUG_STRIP = re.compile(r"[^a-z0-9]+")

# Prose the retired single-file store and its bootstrap template shipped. A legacy file that holds
# only these lines plus migrated lesson blocks carries no unmigrated project content, so the
# migration may delete it; any other leftover line keeps the file for an agent to finish by hand.
_RETIRED_BOILERPLATE = """
# Project Lessons
This file is the only store for project-specific lessons discovered during development.
Agents read it when starting Standard or larger work. In every phase of any task, an agent immediately records or updates a lesson after an operational tool error, an unavailable tool requiring a fallback, or a user correction. The retro checkpoint reviews already-recorded lessons and checks for additional ones before task completion. There is no separate retro document.
Lessons here are provisional. They become permanent project rules only when explicitly promoted to `AGENTS.md`, `.agents/engineering.md`, or `.agents/safety.md` by the user.
Lessons are provisional. Promote them into standing guidance only with explicit user approval.
## Rules for Lessons
- Record only specific, actionable, verified lessons that are likely to prevent a future mistake or wasted work.
- A lesson should describe a reusable rule or verified project behavior, not merely what happened during a task.
- Prefer lessons derived from observed problems or verified project behavior.
- Do not record obvious facts, temporary conditions, task history, or speculative assumptions.
- Keep each lesson short.
- Update an existing lesson instead of creating duplicates or conflicting entries.
- Remove lessons that are proven incorrect or no longer apply.
- Do not create a parallel event log, proposal queue, or ignored improvement state.
## Lessons
"""
_BOILERPLATE_LINES = frozenset(
    line.strip() for line in _RETIRED_BOILERPLATE.splitlines() if line.strip()
)


class LessonsStoreError(ValueError):
    """Raised when the store or a legacy file cannot be read as the documented layout."""


@dataclass(frozen=True)
class LegacyLesson:
    """One `### title` block parsed out of a legacy single-file store, wording unchanged."""

    id: str
    title: str
    body: str


@dataclass
class MigrationResult:
    """What a legacy-store migration did, so the caller can report it truthfully."""

    added_items: list[str] = field(default_factory=list)
    index_written: bool = False
    legacy_removed: bool = False
    residue: list[str] = field(default_factory=list)
    unmigrated: list[str] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return bool(self.added_items) or self.index_written or self.legacy_removed

    @property
    def pending(self) -> list[str]:
        """What still needs a hand: leftover lines and lessons the migration could not write."""
        return list(self.unmigrated) + list(self.residue)


def slugify(title: str) -> str:
    """Derive a stable, filesystem-safe lesson id from its title."""
    slug = _SLUG_STRIP.sub("-", title.strip().lower()).strip("-")
    if not slug:
        raise LessonsStoreError(f"lesson title yields no id: {title!r}")
    return slug


def empty_index() -> dict:
    """The canonical shape for a project that has recorded no lesson yet."""
    return {"schema_version": SCHEMA_VERSION, "lessons": []}


def load_index(index_path: Path) -> dict:
    """Read an index, or return the empty shape when the project has none yet."""
    if not index_path.is_file():
        return empty_index()
    try:
        data = json.loads(index_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise LessonsStoreError(f"lessons index is not valid JSON: {index_path}: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("lessons"), list):
        raise LessonsStoreError(f"lessons index must be an object with a lessons list: {index_path}")
    return data


def index_text(index: dict) -> str:
    return json.dumps(index, indent=2, ensure_ascii=False) + "\n"


def entry(lesson_id: str, scopes: Sequence[str], tags: Sequence[str]) -> dict:
    """Build one index entry. `path` is repository-relative so any agent can open it directly."""
    return {
        "id": lesson_id,
        "scopes": list(scopes),
        "tags": list(tags),
        "path": f"{STORE_DIR}/{ITEMS_DIRNAME}/{lesson_id}.md",
    }


def select(index: dict, *, scopes: Iterable[str] = (), tags: Iterable[str] = ()) -> list[dict]:
    """Return the entries a request matches, in index order.

    Scope is the outer filter: a requested scope must intersect the entry's scopes, so product work
    never opens a lesson scoped to harness development only. Tags narrow inside that scope, so a
    requested tag must intersect the entry's tags. An entry that carries no tag yet stays selectable
    by scope alone, otherwise a migrated lesson would be unreachable until someone tagged it. An
    empty request selects nothing; returning the whole store is what the selective layout avoids.
    """
    want_scopes = {str(s) for s in scopes}
    want_tags = {str(t) for t in tags}
    if not want_scopes and not want_tags:
        return []
    selected = []
    for item in index.get("lessons", []):
        if want_scopes and not (set(item.get("scopes") or ()) & want_scopes):
            continue
        item_tags = set(item.get("tags") or ())
        if want_tags and item_tags and not (item_tags & want_tags):
            continue
        selected.append(item)
    return selected


def parse_legacy_store(text: str) -> list[LegacyLesson]:
    """Split a legacy single-file store into its lesson blocks, preserving wording exactly."""
    section = _LESSONS_SECTION.search(text)
    body = text[section.end():] if section else text
    body = _HTML_COMMENT.sub("", body)
    # A later `##` heading ends the lessons section; whatever follows is not a lesson block and
    # stays in the residue, so the caller keeps the file instead of absorbing it into an item.
    following = _NEXT_SECTION.search(body)
    if following:
        body = body[: following.start()]
    lessons: list[LegacyLesson] = []
    matches = list(_LESSON_HEADING.finditer(body))
    for position, match in enumerate(matches):
        end = matches[position + 1].start() if position + 1 < len(matches) else len(body)
        title = match.group("title").strip()
        block = body[match.start():end].strip() + "\n"
        lessons.append(LegacyLesson(id=slugify(title), title=title, body=block))
    return lessons


def legacy_residue(text: str, lessons: Sequence[LegacyLesson]) -> list[str]:
    """Lines of a legacy store that no migrated lesson and no retired boilerplate accounts for."""
    stripped = _HTML_COMMENT.sub("", text)
    for lesson in lessons:
        stripped = stripped.replace(lesson.body.strip(), "")
    return [
        line.strip()
        for line in stripped.splitlines()
        if line.strip() and line.strip() not in _BOILERPLATE_LINES
    ]


def migrate_legacy_store(
    agents_dir: Path,
    *,
    scopes: Sequence[str] = MIGRATED_SCOPES,
    dry_run: bool = False,
    can_write: Callable[[str], bool] | None = None,
) -> MigrationResult:
    """Move a project's legacy single-file lessons into the selective layout.

    Lesson wording is copied unchanged. A lesson already migrated under the same id with the same
    text is left alone, so a rerun changes nothing. `can_write` decides per repository-relative path
    whether this caller may write an item, so a protected path is honoured at the write site.

    The legacy file is deleted only when every lesson it holds reached the store and every line it
    still holds is a migrated lesson or retired boilerplate. Anything else - leftover prose, an id
    collision, a path the caller may not write - keeps the file and lands in `pending`, because a
    project's own lessons must survive the migration.
    """
    result = MigrationResult()
    legacy_path = agents_dir / LEGACY_STORE_NAME
    index_path = agents_dir / "lessons" / INDEX_FILENAME
    items_dir = agents_dir / "lessons" / ITEMS_DIRNAME
    if not legacy_path.is_file():
        return result

    text = legacy_path.read_text(encoding="utf-8")
    lessons = parse_legacy_store(text)
    index = load_index(index_path)
    known = {str(item.get("id")) for item in index.get("lessons", [])}

    new_entries = []
    # What this run already migrated, so a dry run reaches the same verdict as a real run instead
    # of reading item files it deliberately did not write.
    migrated_bodies: dict[str, str] = {}
    for lesson in lessons:
        rel = f"{STORE_DIR}/{ITEMS_DIRNAME}/{lesson.id}.md"
        item_path = items_dir / f"{lesson.id}.md"
        if lesson.id in known:
            # The same id with the same text is the idempotent rerun. A different text is an id
            # collision: overwriting it would destroy one lesson and skipping it would destroy the
            # other, so the legacy file stays for a person to resolve.
            if lesson.id in migrated_bodies:
                stored = migrated_bodies[lesson.id]
            elif item_path.is_file():
                stored = item_path.read_text(encoding="utf-8")
            else:
                stored = None
            if stored != lesson.body:
                result.unmigrated.append(lesson.id)
            continue
        if can_write is not None and not can_write(rel):
            result.unmigrated.append(lesson.id)
            continue
        known.add(lesson.id)
        migrated_bodies[lesson.id] = lesson.body
        new_entries.append(entry(lesson.id, scopes, ()))
        result.added_items.append(rel)
        if not dry_run:
            items_dir.mkdir(parents=True, exist_ok=True)
            item_path.write_text(lesson.body, encoding="utf-8")

    index.setdefault("schema_version", SCHEMA_VERSION)
    # The pointer to the retired store goes with it, so persist the removal even when this run
    # migrated no new lesson.
    dropped_pointer = index.pop("legacy_store", None) is not None
    if new_entries or dropped_pointer or not index_path.is_file():
        index["lessons"] = list(index.get("lessons", [])) + new_entries
        result.index_written = True
        if not dry_run:
            index_path.parent.mkdir(parents=True, exist_ok=True)
            index_path.write_text(index_text(index), encoding="utf-8")

    result.residue = legacy_residue(text, lessons)
    if not result.pending:
        result.legacy_removed = True
        if not dry_run:
            legacy_path.unlink(missing_ok=True)
    return result
