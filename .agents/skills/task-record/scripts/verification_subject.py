#!/usr/bin/env python3
"""Capture and compare immutable task verification subjects."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import Any


SUBJECT_SCHEMA_VERSION = 1
SUBJECT_HEADING = re.compile(r"^### Verification subject (\d+)$")
HEX_DIGEST = re.compile(r"^[0-9a-f]{64}$")
HEAD_OID = re.compile(r"^[0-9a-f]{40,64}$")
TASK_RECORD_PATH = re.compile(r"^\.agents/tasks/[^/]+/task\.md$")
HASH_FIELDS = (
    "staged_diff_sha256",
    "unstaged_diff_sha256",
    "untracked_files_sha256",
)
SUBJECT_FIELDS = {
    "schema_version",
    "attempt",
    "head",
    "paths",
    *HASH_FIELDS,
    "subject_sha256",
}


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def subject_digest(subject: dict[str, Any]) -> str:
    unsigned = {key: value for key, value in subject.items() if key != "subject_sha256"}
    return sha256(canonical_json(unsigned))


def normalize_paths(root: Path, record_path: Path, paths: list[str]) -> list[str]:
    root = root.resolve()
    record = record_path.resolve()
    try:
        record_relative = record.relative_to(root).as_posix()
    except ValueError as exc:
        raise ValueError("task record must be inside the repository") from exc

    normalized: set[str] = set()
    for raw in paths:
        value = raw.replace("\\", "/").strip()
        posix = PurePosixPath(value)
        if not value or "\x00" in value or "\n" in value or "\r" in value:
            raise ValueError("verification subject paths must be non-empty single-line paths")
        if Path(raw).is_absolute() or posix.is_absolute() or re.match(r"^[A-Za-z]:", value):
            raise ValueError(f"verification subject path must be repository-relative: {raw}")
        if any(part in {"", ".", ".."} for part in posix.parts):
            raise ValueError(f"verification subject path is not normalized: {raw}")
        candidate = posix.as_posix()
        if candidate == record_relative or TASK_RECORD_PATH.fullmatch(candidate):
            raise ValueError("task record path cannot be part of the verification subject")
        try:
            (root / Path(*posix.parts)).resolve().relative_to(root)
        except ValueError as exc:
            raise ValueError(f"verification subject path escapes the repository: {raw}") from exc
        normalized.add(candidate)
    if not normalized:
        raise ValueError("verification subject requires at least one task-owned path")
    return sorted(normalized)


def git_bytes(root: Path, *args: str) -> bytes:
    proc = subprocess.run(
        ["git", "-C", str(root), *args],
        check=False,
        capture_output=True,
    )
    if proc.returncode != 0:
        message = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"git {' '.join(args)} failed: {message}")
    return proc.stdout


def untracked_manifest(root: Path, paths: list[str]) -> list[dict[str, str]]:
    output = git_bytes(root, "ls-files", "--others", "--exclude-standard", "-z", "--", *paths)
    entries: list[dict[str, str]] = []
    for raw in output.split(b"\0"):
        if not raw:
            continue
        relative = raw.decode("utf-8", errors="surrogateescape")
        path = root / Path(*PurePosixPath(relative).parts)
        if path.is_symlink():
            data = os.readlink(path).encode("utf-8", errors="surrogateescape")
            kind = "symlink"
        else:
            data = path.read_bytes()
            kind = "file"
        entries.append({"path": relative, "kind": kind, "sha256": sha256(data)})
    return sorted(entries, key=lambda item: item["path"])


def capture_state(root: Path, paths: list[str]) -> dict[str, Any]:
    head = git_bytes(root, "rev-parse", "HEAD").decode("ascii").strip()
    staged = git_bytes(root, "diff", "--cached", "--binary", "--no-ext-diff", "--", *paths)
    unstaged = git_bytes(root, "diff", "--binary", "--no-ext-diff", "--", *paths)
    untracked = untracked_manifest(root, paths)
    return {
        "head": head,
        "paths": paths,
        "staged_diff_sha256": sha256(staged),
        "unstaged_diff_sha256": sha256(unstaged),
        "untracked_files_sha256": sha256(canonical_json(untracked)),
    }


def validate_subject(subject: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(subject, dict):
        return ["verification subject must be a JSON object"]
    missing = SUBJECT_FIELDS - set(subject)
    extra = set(subject) - SUBJECT_FIELDS
    if missing:
        errors.append("verification subject missing fields: " + ", ".join(sorted(missing)))
    if extra:
        errors.append("verification subject has unknown fields: " + ", ".join(sorted(extra)))
    if subject.get("schema_version") != SUBJECT_SCHEMA_VERSION:
        errors.append(f"verification subject schema_version must be {SUBJECT_SCHEMA_VERSION}")
    attempt = subject.get("attempt")
    if not isinstance(attempt, int) or isinstance(attempt, bool) or attempt < 1:
        errors.append("verification subject attempt must be a positive integer")
    head = subject.get("head")
    if not isinstance(head, str) or not HEAD_OID.fullmatch(head):
        errors.append("verification subject head must be a lowercase Git object id")
    paths = subject.get("paths")
    if not isinstance(paths, list) or not paths or not all(isinstance(item, str) for item in paths):
        errors.append("verification subject paths must be a non-empty string array")
    elif paths != sorted(set(paths)):
        errors.append("verification subject paths must be sorted and unique")
    elif any(TASK_RECORD_PATH.fullmatch(item) for item in paths):
        errors.append("verification subject paths must exclude task records")
    for field in (*HASH_FIELDS, "subject_sha256"):
        value = subject.get(field)
        if not isinstance(value, str) or not HEX_DIGEST.fullmatch(value):
            errors.append(f"verification subject {field} must be a lowercase SHA-256")
    if not errors and subject["subject_sha256"] != subject_digest(subject):
        errors.append("verification subject subject_sha256 does not match its immutable content")
    return errors


def parse_subjects(text: str) -> tuple[list[dict[str, Any]], list[str]]:
    lines = text.splitlines()
    subjects: list[dict[str, Any]] = []
    errors: list[str] = []
    index = 0
    while index < len(lines):
        heading = SUBJECT_HEADING.fullmatch(lines[index].strip())
        if heading is None:
            index += 1
            continue
        heading_attempt = int(heading.group(1))
        index += 1
        while index < len(lines) and not lines[index].strip():
            index += 1
        if index >= len(lines) or lines[index].strip() != "```json":
            errors.append(f"verification subject {heading_attempt} is missing its JSON fence")
            continue
        index += 1
        payload_lines: list[str] = []
        while index < len(lines) and lines[index].strip() != "```":
            payload_lines.append(lines[index])
            index += 1
        if index >= len(lines):
            errors.append(f"verification subject {heading_attempt} has an unclosed JSON fence")
            break
        index += 1
        try:
            subject = json.loads("\n".join(payload_lines))
        except json.JSONDecodeError as exc:
            errors.append(f"verification subject {heading_attempt} has invalid JSON: {exc.msg}")
            continue
        subject_errors = validate_subject(subject)
        errors.extend(f"verification subject {heading_attempt}: {error}" for error in subject_errors)
        if isinstance(subject, dict):
            if subject.get("attempt") != heading_attempt:
                errors.append(f"verification subject {heading_attempt} heading does not match its attempt")
            subjects.append(subject)
    attempts = [subject.get("attempt") for subject in subjects]
    if attempts and attempts != list(range(1, len(attempts) + 1)):
        errors.append("verification subject attempts must be append-only and consecutive from 1")
    return subjects, errors


def capture_subject(root: Path, record_path: Path, paths: list[str]) -> dict[str, Any]:
    root = root.resolve()
    normalized = normalize_paths(root, record_path, paths)
    existing_text = record_path.read_text(encoding="utf-8") if record_path.is_file() else ""
    existing, errors = parse_subjects(existing_text)
    if errors:
        raise ValueError("cannot append to invalid verification subjects: " + "; ".join(errors))
    subject = {
        "schema_version": SUBJECT_SCHEMA_VERSION,
        "attempt": len(existing) + 1,
        **capture_state(root, normalized),
    }
    subject["subject_sha256"] = subject_digest(subject)
    return subject


def render_subject_block(subject: dict[str, Any]) -> str:
    errors = validate_subject(subject)
    if errors:
        raise ValueError("cannot render invalid verification subject: " + "; ".join(errors))
    payload = json.dumps(subject, indent=2, sort_keys=True, ensure_ascii=False)
    return f"### Verification subject {subject['attempt']}\n\n```json\n{payload}\n```\n"


def check_latest_subject(root: Path, record_path: Path) -> dict[str, Any]:
    subjects, errors = parse_subjects(record_path.read_text(encoding="utf-8"))
    if errors:
        raise ValueError("invalid verification subjects: " + "; ".join(errors))
    if not subjects:
        raise ValueError("task record has no verification subject")
    expected = subjects[-1]
    actual = capture_state(root.resolve(), expected["paths"])
    compared = ("head", "paths", *HASH_FIELDS)
    mismatches = [field for field in compared if expected[field] != actual[field]]
    return {
        "match": not mismatches,
        "attempt": expected["attempt"],
        "subject_sha256": expected["subject_sha256"],
        "mismatches": mismatches,
        "expected": {field: expected[field] for field in compared},
        "actual": actual,
    }


def find_repo_root(start: Path) -> Path:
    current = start.resolve()
    if current.is_file():
        current = current.parent
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return candidate
    raise ValueError(f"no Git repository found from {start}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Capture or check a task verification subject.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    capture = subparsers.add_parser("capture")
    capture.add_argument("--record", type=Path, required=True)
    capture.add_argument("--path", action="append", dest="paths", required=True)
    check = subparsers.add_parser("check")
    check.add_argument("--record", type=Path, required=True)
    check.add_argument("--json", action="store_true", dest="json_output")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        record = args.record.resolve()
        root = find_repo_root(record)
        if args.command == "capture":
            print(render_subject_block(capture_subject(root, record, args.paths)), end="")
            return 0
        result = check_latest_subject(root, record)
    except (OSError, RuntimeError, ValueError) as exc:
        sys.stderr.write(f"verification subject error: {exc}\n")
        return 2
    if args.json_output or not result["match"]:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(
            f"verification subject matches: attempt {result['attempt']} "
            f"{result['subject_sha256']}"
        )
    return 0 if result["match"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
