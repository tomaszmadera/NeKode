#!/usr/bin/env python3
"""Shared helpers for repository agent scripts."""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence


ROOT = Path(__file__).resolve().parents[2]

SEMVER_REGEX = re.compile(
    r"^(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)"
    r"(?:-(?P<prerelease>[0-9A-Za-z.-]+))?$"
)


class SkillWrapperError(ValueError):
    """Raised when canonical skill metadata cannot produce a safe wrapper plan."""


def skill_metadata(path: Path) -> tuple[str, str]:
    """Read portable discovery metadata from a canonical skill file."""
    text = path.read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---\n", text, flags=re.DOTALL)
    if not match:
        raise ValueError("missing YAML frontmatter")
    values: dict[str, str] = {}
    for line in match.group(1).splitlines():
        key, separator, value = line.partition(":")
        if separator:
            values[key.strip()] = value.strip()
    name = values.get("name", "")
    description = values.get("description", "")
    if not name or not description:
        raise ValueError("frontmatter requires name and description")
    return name, description


def render_skill_wrapper(canonical_skill: Path, canonical_relative: Path | str) -> str:
    """Render a host wrapper containing only canonical metadata and a pointer."""
    name, description = skill_metadata(canonical_skill)
    pointer = f"../../../{Path(canonical_relative).as_posix()}"
    return (
        "---\n"
        f"name: {name}\n"
        f"description: {description}\n"
        "---\n\n"
        f"# {name}\n\n"
        f"Read and follow [`{pointer}`]({pointer}) completely. "
        "That file is the only source of workflow behavior.\n"
    )


def render_skill_wrapper_plan(canonical_skills: Mapping[str, Path]) -> dict[str, str]:
    """Validate canonical skills and render every wrapper before filesystem mutation."""
    wrappers: dict[str, str] = {}
    for directory_name, canonical in sorted(canonical_skills.items()):
        try:
            name, _description = skill_metadata(canonical)
            if name != directory_name:
                raise ValueError(
                    f"frontmatter name '{name}' differs from directory '{directory_name}'"
                )
            wrappers[name] = render_skill_wrapper(
                canonical,
                Path(".agents") / "skills" / name / "SKILL.md",
            )
        except (OSError, UnicodeError, ValueError) as error:
            raise SkillWrapperError(f"invalid canonical skill {canonical}: {error}") from error
    return wrappers


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
    if bump_type.startswith("rc") or bump_type.startswith("alpha") or bump_type.startswith("beta"):
        return f"{major}.{minor}.{patch}-{bump_type}"
    if SEMVER_REGEX.match(bump_type):
        return bump_type
    raise ValueError(f"unsupported bump type: '{bump_type}'")


def get_project_version(root: Path | None = None) -> str:
    """Discover the project's current semantic version from manifests, project profile, or git tags."""
    target_root = root or ROOT

    # 1. Standard manifests
    # 1a. package.json
    pkg_json = target_root / "package.json"
    if pkg_json.is_file():
        try:
            data = json.loads(pkg_json.read_text(encoding="utf-8"))
            ver = str(data.get("version", "")).strip()
            if is_valid_semver(ver):
                return ver
        except (OSError, UnicodeError, json.JSONDecodeError):
            pass

    # 1b. pyproject.toml
    pyproject = target_root / "pyproject.toml"
    if pyproject.is_file():
        try:
            content = pyproject.read_text(encoding="utf-8")
            match = re.search(r'(?m)^version\s*=\s*["\']([^"\']+)["\']', content)
            if match and is_valid_semver(match.group(1)):
                return match.group(1)
        except (OSError, UnicodeError):
            pass

    # 1c. Cargo.toml
    cargo = target_root / "Cargo.toml"
    if cargo.is_file():
        try:
            content = cargo.read_text(encoding="utf-8")
            match = re.search(r'(?m)^version\s*=\s*["\']([^"\']+)["\']', content)
            if match and is_valid_semver(match.group(1)):
                return match.group(1)
        except (OSError, UnicodeError):
            pass

    # 1d. .NET / C# / F# manifests (.csproj, Directory.Build.props, *.props)
    dotnet_candidates = [
        target_root / "Directory.Build.props",
        target_root / "Directory.Build.targets",
        target_root / "Directory.Packages.props",
    ]
    dotnet_candidates.extend(target_root.glob("*.csproj"))
    dotnet_candidates.extend(target_root.glob("*.fsproj"))
    dotnet_candidates.extend(target_root.glob("*.props"))
    dotnet_candidates.extend(target_root.glob("src/*/*.csproj"))
    dotnet_candidates.extend(target_root.glob("src/*/*.fsproj"))
    dotnet_candidates.extend(target_root.glob("src/*/*.props"))
    for f in dotnet_candidates:
        if f.is_file():
            try:
                content = f.read_text(encoding="utf-8")
                match = re.search(r"<Version>([^<]+)</Version>", content)
                if not match:
                    match = re.search(r"<PackageVersion>([^<]+)</PackageVersion>", content)
                if match and is_valid_semver(match.group(1).strip()):
                    return match.group(1).strip()
            except (OSError, UnicodeError):
                pass

    # 1e. pom.xml
    pom = target_root / "pom.xml"
    if pom.is_file():
        try:
            content = pom.read_text(encoding="utf-8")
            match = re.search(r"<version>([^<]+)</version>", content)
            if match and is_valid_semver(match.group(1).strip()):
                return match.group(1).strip()
        except (OSError, UnicodeError):
            pass

    # 1f. build.gradle / build.gradle.kts
    for gradle in (target_root / "build.gradle", target_root / "build.gradle.kts"):
        if gradle.is_file():
            try:
                content = gradle.read_text(encoding="utf-8")
                match = re.search(r'(?m)^version\s*=\s*["\']([^"\']+)["\']', content)
                if match and is_valid_semver(match.group(1)):
                    return match.group(1)
            except (OSError, UnicodeError):
                pass

    # 1g. VERSION / version.txt
    for vfile in (target_root / "VERSION", target_root / "version.txt"):
        if vfile.is_file():
            try:
                ver = vfile.read_text(encoding="utf-8").strip()
                if is_valid_semver(ver):
                    return ver
            except (OSError, UnicodeError):
                pass

    # 2. project.version in .agents/project-profile.yaml (or harness.version if project.status == "template")
    try:
        profile_path = target_root / ".agents" / "project-profile.yaml"
        if profile_path.is_file():
            values = profile_values(profile_path)
            proj_ver = values.get("project", {}).get("version", "not-configured")
            if proj_ver not in ("not-configured", "") and is_valid_semver(proj_ver):
                return proj_ver
            if values.get("project", {}).get("status") == "template":
                harness_ver = values.get("harness", {}).get("version", "")
                if is_valid_semver(harness_ver):
                    return harness_ver
    except Exception:
        pass

    # 3. Git tags
    try:
        git_tags = git_output("-C", str(target_root), "tag", "-l").splitlines()
        valid_tags = []
        for t in git_tags:
            t_clean = t.strip().lstrip("v")
            if is_valid_semver(t_clean):
                valid_tags.append(t_clean)
        if valid_tags:
            valid_tags.sort(key=parse_semver)
            return valid_tags[-1]
    except Exception:
        pass

    # 4. Fallback
    return "0.1.0"


def update_project_manifests(new_version: str, root: Path | None = None) -> list[str]:
    """Update product manifests; harness.version is updated only for the template product."""
    target_root = root or ROOT
    updated: list[str] = []

    # 1. package.json
    pkg_json = target_root / "package.json"
    if pkg_json.is_file():
        try:
            data = json.loads(pkg_json.read_text(encoding="utf-8"))
            if "version" in data:
                data["version"] = new_version
                pkg_json.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
                updated.append(str(pkg_json.relative_to(target_root)))
        except (OSError, UnicodeError, json.JSONDecodeError):
            pass

    # 2. pyproject.toml
    pyproject = target_root / "pyproject.toml"
    if pyproject.is_file():
        try:
            content = pyproject.read_text(encoding="utf-8")
            new_content = re.sub(
                r'(?m)^version\s*=\s*["\'][^"\']+["\']',
                f'version = "{new_version}"',
                content,
                count=1,
            )
            if new_content != content:
                pyproject.write_text(new_content, encoding="utf-8")
                updated.append(str(pyproject.relative_to(target_root)))
        except (OSError, UnicodeError):
            pass

    # 3. Cargo.toml
    cargo = target_root / "Cargo.toml"
    if cargo.is_file():
        try:
            content = cargo.read_text(encoding="utf-8")
            new_content = re.sub(
                r'(?m)^version\s*=\s*["\'][^"\']+["\']',
                f'version = "{new_version}"',
                content,
                count=1,
            )
            if new_content != content:
                cargo.write_text(new_content, encoding="utf-8")
                updated.append(str(cargo.relative_to(target_root)))
        except (OSError, UnicodeError):
            pass

    # 4. .NET / C# / F# manifests
    dotnet_candidates = [
        target_root / "Directory.Build.props",
        target_root / "Directory.Build.targets",
        target_root / "Directory.Packages.props",
    ]
    dotnet_candidates.extend(target_root.glob("*.csproj"))
    dotnet_candidates.extend(target_root.glob("*.fsproj"))
    dotnet_candidates.extend(target_root.glob("*.props"))
    dotnet_candidates.extend(target_root.glob("src/*/*.csproj"))
    dotnet_candidates.extend(target_root.glob("src/*/*.fsproj"))
    dotnet_candidates.extend(target_root.glob("src/*/*.props"))
    for f in dotnet_candidates:
        if f.is_file():
            try:
                content = f.read_text(encoding="utf-8")
                new_content = re.sub(r"<Version>[^<]+</Version>", f"<Version>{new_version}</Version>", content)
                new_content = re.sub(r"<PackageVersion>[^<]+</PackageVersion>", f"<PackageVersion>{new_version}</PackageVersion>", new_content)
                if new_content != content:
                    f.write_text(new_content, encoding="utf-8")
                    rel = str(f.relative_to(target_root))
                    if rel not in updated:
                        updated.append(rel)
            except (OSError, UnicodeError):
                pass

    # 5. pom.xml
    pom = target_root / "pom.xml"
    if pom.is_file():
        try:
            content = pom.read_text(encoding="utf-8")
            new_content = re.sub(r"<version>[^<]+</version>", f"<version>{new_version}</version>", content, count=1)
            if new_content != content:
                pom.write_text(new_content, encoding="utf-8")
                updated.append(str(pom.relative_to(target_root)))
        except (OSError, UnicodeError):
            pass

    # 6. build.gradle / build.gradle.kts
    for gradle in (target_root / "build.gradle", target_root / "build.gradle.kts"):
        if gradle.is_file():
            try:
                content = gradle.read_text(encoding="utf-8")
                new_content = re.sub(r'(?m)^version\s*=\s*["\'][^"\']+["\']', f'version = "{new_version}"', content, count=1)
                if new_content != content:
                    gradle.write_text(new_content, encoding="utf-8")
                    updated.append(str(gradle.relative_to(target_root)))
            except (OSError, UnicodeError):
                pass

    # 7. VERSION / version.txt
    for vfile in (target_root / "VERSION", target_root / "version.txt"):
        if vfile.is_file():
            try:
                vfile.write_text(f"{new_version}\n", encoding="utf-8")
                updated.append(str(vfile.relative_to(target_root)))
            except (OSError, UnicodeError):
                pass

    # 8. .agents/project-profile.yaml
    # Update project.version if present; update harness.version ONLY IF project.status == "template"
    profile_path = target_root / ".agents" / "project-profile.yaml"
    if profile_path.is_file():
        lines = profile_path.read_text(encoding="utf-8").splitlines()
        values = profile_values(profile_path)
        is_template = values.get("project", {}).get("status") == "template"
        new_lines = []
        in_project = False
        in_harness = False
        modified = False
        for line in lines:
            if line.startswith("project:"):
                in_project = True
                in_harness = False
                new_lines.append(line)
                continue
            if line.startswith("harness:"):
                in_harness = True
                in_project = False
                new_lines.append(line)
                continue
            if in_project and line.strip().startswith("version:"):
                indent = line[: len(line) - len(line.lstrip())]
                new_lines.append(f'{indent}version: "{new_version}"')
                in_project = False
                modified = True
                continue
            if in_harness and is_template and line.strip().startswith("version:"):
                indent = line[: len(line) - len(line.lstrip())]
                new_lines.append(f'{indent}version: "{new_version}"')
                in_harness = False
                modified = True
                continue
            if not line.startswith(" ") and not line.startswith("\t"):
                in_project = False
                in_harness = False
            new_lines.append(line)
        if modified:
            profile_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
            rel = str(profile_path.relative_to(target_root))
            if rel not in updated:
                updated.append(rel)

    return updated


def run(command: Sequence[str], *, check: bool = False, capture: bool = False, cwd: Path | str | None = None) -> subprocess.CompletedProcess[str]:
    target_cwd = cwd if cwd is not None else ROOT
    return subprocess.run(
        list(command), cwd=target_cwd, text=True, encoding="utf-8", errors="replace",
        check=check, capture_output=capture,
    )


def git_output(*args: str) -> str:
    result = run(["git", *args], capture=True)
    return result.stdout if result.returncode == 0 else ""


def commit_paths(root: Path, paths: Sequence[str], message: str, *, runner=run, allow_empty: bool = False):
    """Commit exact working-tree paths while preserving unrelated index entries."""
    names = list(dict.fromkeys(paths))
    if not names or any(not name or Path(name).is_absolute() or '..' in Path(name).parts for name in names):
        return subprocess.CompletedProcess([], 1, '', 'Scoped commit requires explicit repository-relative paths')
    prefix = ['git', '-C', str(root), '--literal-pathspecs']
    staged = runner([*prefix, 'add', '--all', '--', *names], capture=True)
    if staged.returncode:
        return staged
    command = [*prefix, 'commit', '--only', '-m', message]
    if allow_empty:
        command.append('--allow-empty')
    return runner([*command, '--', *names], capture=True)


def resolve_command(
    value: str,
    *,
    platform_name: str | None = None,
    python_executable: str | None = None,
) -> list[str]:
    """Split a configured command and expand its supported standalone placeholders."""
    current_platform = platform_name or os.name
    command = shlex.split(value, posix=current_platform != "nt")
    if current_platform == "nt":
        command = [
            item[1:-1]
            if len(item) >= 2 and item[0] == item[-1] == '"'
            else item
            for item in command
        ]

    resolved: list[str] = []
    for item in command:
        if item == "{python}":
            resolved.append(python_executable or sys.executable)
        elif re.fullmatch(r"\{[^{}]+\}", item):
            raise ValueError(f"unknown command placeholder: {item}")
        else:
            resolved.append(item)
    return resolved


def run_full_gate(root: Path, *, runner=run) -> list[str]:
    """Publication uses the same recorded full gate as ordinary verification."""
    try:
        value = profile_values(root / '.agents/project-profile.yaml').get('commands', {}).get('verify_full', '')
        if not value or value in {'none', 'not-configured'}:
            return ['commands.verify_full is not configured']
        command = resolve_command(value)
        result = runner(command, capture=True, cwd=root)
    except (OSError, ValueError) as error:
        return [f'Full verification could not run: {error}']
    if result.returncode:
        return [f'Full verification failed (exit {result.returncode}): {(result.stdout or "") + (result.stderr or "")}']
    return []


def changed_files() -> list[str]:
    names = set(filter(None, git_output("diff", "--name-only").splitlines()))
    names.update(filter(None, git_output("diff", "--cached", "--name-only").splitlines()))
    names.update(filter(None, git_output("ls-files", "--others", "--exclude-standard").splitlines()))
    return sorted(names)


def profile_values(path: Path | None = None) -> dict[str, dict[str, Any]]:
    """Read the deliberately simple two-level project profile, with list support for excluded_skills."""
    source = path or ROOT / ".agents" / "project-profile.yaml"
    values: dict[str, dict[str, Any]] = {}
    section = ""
    pending_list_key: str | None = None
    for raw in source.read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if not raw.startswith(" ") and raw.endswith(":"):
            section = raw[:-1].strip()
            values.setdefault(section, {})
            pending_list_key = None
            continue
        if not section:
            continue
        # Block list items (e.g. "    - ci") following an empty key
        if pending_list_key is not None and raw.startswith("    -"):
            item = raw.strip()[1:].strip().strip('"\'')
            if not isinstance(values[section].get(pending_list_key), list):
                values[section][pending_list_key] = []
            cast = values[section][pending_list_key]
            assert isinstance(cast, list)
            cast.append(item)
            continue
        if raw.startswith("  ") and not raw.startswith("    "):
            pending_list_key = None
            key, sep, value = raw.strip().partition(":")
            if not sep:
                continue
            key = key.strip()
            val = value.strip()
            if val == "":
                values[section][key] = []
                pending_list_key = key
                continue
            if val.startswith("["):
                # Inline list, possibly with trailing comment
                end = val.find("]")
                if end != -1:
                    inner = val[1:end].strip()
                    if not inner:
                        values[section][key] = []
                    else:
                        items: list[str] = []
                        for part in inner.split(","):
                            p2 = part.strip().strip('"\'')
                            if p2:
                                items.append(p2)
                        values[section][key] = items
                    continue
            # Normal scalar
            values[section][key] = val.strip('"\'')
            continue
    return values


def profile_value(section: str, key: str, default: str = "not-configured") -> str:
    try:
        return profile_values().get(section, {}).get(key, default)
    except (OSError, UnicodeError):
        return default


def configured_command(key: str) -> list[str] | None:
    value = profile_value("verification", key)
    if value in {"", "none", "not-configured"}:
        return None
    return resolve_command(value)


def command_exists(name: str) -> bool:
    return shutil.which(name) is not None
