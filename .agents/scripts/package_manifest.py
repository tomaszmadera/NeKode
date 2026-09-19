"""Strict reader for the development-only harness package manifest."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any


class PackageManifestError(ValueError):
    """Raised when package.yaml cannot define one unambiguous delivery package."""


@dataclass(frozen=True)
class AdapterRule:
    host: str
    source: Path
    output: Path
    format: str


@dataclass(frozen=True)
class PackageManifest:
    ship_directories: tuple[Path, ...]
    ship_files: tuple[Path, ...]
    render_files: tuple[Path, ...]
    template_only_paths: tuple[Path, ...]
    adapters: tuple[AdapterRule, ...]
    remove_paths: tuple[Path, ...]

    @property
    def adapter_outputs(self) -> tuple[Path, ...]:
        return tuple(rule.output for rule in self.adapters)

    def is_template_only(self, path: Path) -> bool:
        return any(path == excluded or excluded in path.parents for excluded in self.template_only_paths)


def _parse_scalar(value: str, field: str) -> str | int:
    if not value:
        raise PackageManifestError(f"manifest field '{field}' must not be empty")
    if value.isdecimal():
        return int(value)
    if value[0:1] in {'"', "'"}:
        if len(value) < 2 or value[-1] != value[0]:
            raise PackageManifestError(f"manifest field '{field}' has an unterminated quote")
        return value[1:-1]
    if any(char in value for char in "{}[]#"):
        raise PackageManifestError(f"manifest field '{field}' uses unsupported YAML syntax")
    return value


def _parse_yaml(text: str) -> dict[str, Any]:
    """Parse the small indentation-only YAML subset used by package.yaml."""
    tokens: list[tuple[int, str, int]] = []
    for number, raw in enumerate(text.splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if "\t" in raw:
            raise PackageManifestError(f"manifest line {number} contains a tab")
        indent = len(raw) - len(raw.lstrip(" "))
        if indent % 2:
            raise PackageManifestError(f"manifest line {number} has invalid indentation")
        tokens.append((indent, raw.strip(), number))

    def block(index: int, indent: int, field: str) -> tuple[Any, int]:
        if index >= len(tokens) or tokens[index][0] != indent:
            raise PackageManifestError(f"manifest field '{field}' has no value")
        is_list = tokens[index][1].startswith("- ")
        value: Any = [] if is_list else {}
        while index < len(tokens) and tokens[index][0] == indent:
            _level, content, number = tokens[index]
            if content.startswith("- ") != is_list:
                raise PackageManifestError(f"manifest line {number} mixes lists and mappings")
            if is_list:
                item = content[2:].strip()
                if not item:
                    raise PackageManifestError(f"manifest line {number} has an empty list item")
                if ":" not in item:
                    value.append(_parse_scalar(item, field))
                    index += 1
                    continue
                key, raw_value = (part.strip() for part in item.split(":", 1))
                record: dict[str, Any] = {}
                if not key:
                    raise PackageManifestError(f"manifest line {number} has an empty key")
                record[key] = _parse_scalar(raw_value, f"{field}.{key}")
                index += 1
                while index < len(tokens) and tokens[index][0] == indent + 2:
                    _, child, child_number = tokens[index]
                    if child.startswith("- ") or ":" not in child:
                        raise PackageManifestError(f"manifest line {child_number} has invalid record syntax")
                    child_key, child_value = (part.strip() for part in child.split(":", 1))
                    if child_key in record:
                        raise PackageManifestError(f"duplicate manifest field '{field}.{child_key}'")
                    record[child_key] = _parse_scalar(child_value, f"{field}.{child_key}")
                    index += 1
                value.append(record)
                continue
            if ":" not in content:
                raise PackageManifestError(f"manifest line {number} must be a mapping entry")
            key, raw_value = (part.strip() for part in content.split(":", 1))
            if not key or key in value:
                raise PackageManifestError(f"duplicate or empty manifest field '{field}.{key}'")
            if raw_value == "[]":
                value[key] = []
                index += 1
            elif raw_value:
                value[key] = _parse_scalar(raw_value, f"{field}.{key}")
                index += 1
            else:
                index += 1
                if index >= len(tokens) or tokens[index][0] != indent + 2:
                    raise PackageManifestError(f"manifest field '{field}.{key}' has no value")
                value[key], index = block(index, indent + 2, f"{field}.{key}")
        return value, index

    if not tokens:
        raise PackageManifestError("manifest is empty")
    parsed, end = block(0, 0, "package")
    if end != len(tokens) or not isinstance(parsed, dict):
        raise PackageManifestError("manifest root must be a mapping")
    return parsed


def _mapping(value: Any, field: str, keys: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise PackageManifestError(f"manifest field '{field}' must be a mapping")
    unknown = set(value) - keys
    missing = keys - set(value)
    if unknown:
        raise PackageManifestError(f"unknown manifest field '{field}.{sorted(unknown)[0]}'")
    if missing:
        raise PackageManifestError(f"missing manifest field '{field}.{sorted(missing)[0]}'")
    return value


def _path_list(value: Any, field: str) -> tuple[Path, ...]:
    if not isinstance(value, list):
        raise PackageManifestError(f"manifest field '{field}' must be a list")
    result: list[Path] = []
    for index, raw in enumerate(value):
        item_field = f"{field}[{index}]"
        if not isinstance(raw, str) or not raw:
            raise PackageManifestError(f"manifest field '{item_field}' must be a path string")
        pure = PurePosixPath(raw)
        if raw.startswith("/") or "\\" in raw or any(part in {"", ".", ".."} for part in raw.split("/")):
            raise PackageManifestError(f"manifest field '{item_field}' has invalid path '{raw}'")
        if pure.is_absolute() or pure.as_posix() != raw:
            raise PackageManifestError(f"manifest field '{item_field}' has non-normalized path '{raw}'")
        result.append(Path(*pure.parts))
    if len(result) != len(set(result)):
        raise PackageManifestError(f"manifest field '{field}' contains duplicate paths")
    return tuple(result)


def load_package_manifest(source_root: Path) -> PackageManifest:
    path = source_root / "tools" / "harness" / "package.yaml"
    try:
        data = _parse_yaml(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise PackageManifestError(f"missing harness package manifest: {path}") from error
    except (OSError, UnicodeError) as error:
        raise PackageManifestError(f"cannot read harness package manifest '{path}': {error}") from error

    root = _mapping(data, "package", {"schema_version", "ship", "render", "template_only", "adapters", "remove"})
    if root["schema_version"] != 1:
        raise PackageManifestError(f"unsupported manifest schema_version: {root['schema_version']!r}")
    ship = _mapping(root["ship"], "ship", {"directories", "files"})
    render = _mapping(root["render"], "render", {"files"})
    template_only = _mapping(root["template_only"], "template_only", {"paths"})
    adapters_data = _mapping(root["adapters"], "adapters", {"generated"})["generated"]
    remove = _mapping(root["remove"], "remove", {"paths"})
    directories = _path_list(ship["directories"], "ship.directories")
    files = _path_list(ship["files"], "ship.files")
    rendered = _path_list(render["files"], "render.files")
    excluded = _path_list(template_only["paths"], "template_only.paths")
    removed = _path_list(remove["paths"], "remove.paths")
    if not isinstance(adapters_data, list):
        raise PackageManifestError("manifest field 'adapters.generated' must be a list")
    adapters: list[AdapterRule] = []
    for index, raw_rule in enumerate(adapters_data):
        field = f"adapters.generated[{index}]"
        rule = _mapping(raw_rule, field, {"host", "source", "output", "format"})
        if not all(isinstance(rule[key], str) for key in rule):
            raise PackageManifestError(f"manifest field '{field}' values must be strings")
        source = _path_list([rule["source"]], f"{field}.source")[0]
        output = _path_list([rule["output"]], f"{field}.output")[0]
        if rule["format"] != "skill-pointer-v1":
            raise PackageManifestError(f"unsupported adapter format in '{field}.format': {rule['format']!r}")
        adapters.append(AdapterRule(rule["host"], source, output, rule["format"]))
    if not adapters:
        raise PackageManifestError("manifest field 'adapters.generated' must not be empty")
    if len({rule.host for rule in adapters}) != len(adapters):
        raise PackageManifestError("manifest field 'adapters.generated' contains duplicate hosts")

    delivery = (*directories, *files, *rendered, *(rule.output for rule in adapters))
    for index, left in enumerate(delivery):
        for right in delivery[index + 1:]:
            if left == right or left in right.parents or right in left.parents:
                raise PackageManifestError(
                    f"conflicting delivery membership: '{left.as_posix()}' and '{right.as_posix()}'"
                )
    for delivered in delivery:
        for non_delivered in (*excluded, *removed):
            if (
                delivered == non_delivered
                or non_delivered in delivered.parents
                or (delivered not in directories and delivered in non_delivered.parents)
            ):
                category = "template_only" if non_delivered in excluded else "remove"
                raise PackageManifestError(
                    f"conflicting manifest path between delivery and {category}: '{delivered.as_posix()}' and '{non_delivered.as_posix()}'"
                )
    for relative in (*directories, *files, *(rule.source for rule in adapters)):
        source = source_root / relative
        expected = "directory" if relative in directories or any(rule.source == relative for rule in adapters) else "file"
        exists = source.is_dir() if expected == "directory" else source.is_file()
        if not exists:
            raise PackageManifestError(
                f"manifest source '{relative.as_posix()}' is missing or is not a {expected}"
            )
    manifest_relative = Path("tools/harness/package.yaml")
    if any(manifest_relative == item or item in manifest_relative.parents for item in directories + files + rendered):
        raise PackageManifestError("tools/harness/package.yaml must be template-only and cannot be delivered")
    package = PackageManifest(directories, files, rendered, excluded, tuple(adapters), removed)
    if not package.is_template_only(manifest_relative):
        raise PackageManifestError("tools/harness/package.yaml must be template-only and declared in template_only.paths")
    return package
