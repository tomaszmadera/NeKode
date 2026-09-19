#!/usr/bin/env python3
"""Minimal Codex hook adapter for repository safety."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
from http.client import HTTPException
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, MutableMapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


POLICY = json.loads(Path(__file__).with_name("policy.json").read_text(encoding="utf-8"))
KIMI_USAGES_URL = "https://api.kimi.com/coding/v1/usages"
Z_AI_USAGES_URL = "https://api.z.ai/api/monitor/usage/quota/limit"
GROK_USAGES_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits"
GROK_TOKEN_AUTH = "xai-grok-cli"
QUOTA_CACHE_SECONDS = 60.0
# Remaining capacity (percent) below which a tool call may carry one quota notice.
QUOTA_LOW_REMAINING_PERCENT = 15.0
QUOTA_LOCK_STALE_SECONDS = 5.0
QUOTA_MEASUREMENT_FRESH_SECONDS = 6 * 3600.0
TASK_REPORT_LOCK_STALE_SECONDS = 60.0
TASK_REPORT_PATH_KEYS = ("file_path", "TargetFile")
QUOTA_REQUEST_TIMEOUT_SECONDS = 1.0
TOKEN_EXPIRY_SKEW_SECONDS = 30.0
TRANSCRIPT_TAIL_BYTES = 262144
QUOTA_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
QUOTA_ENV_KEYS = {
    "HUB_URL",
    "HUB_TOKEN",
    "Z_AI_USAGE_API_KEY",
    "Z_AI_USAGE_API_URL",
    "ZAI_API_KEY",
    "ZHIPUAI_API_KEY",
    "GROK_QUOTA_SOURCE_URL",
    "GROK_HOME",
}


def resolve_quota_endpoint(environment: Mapping[str, str]) -> str:
    hub_url = environment.get("HUB_URL", "").strip().rstrip("/")
    return f"{hub_url}/api/v1/agent-quotas" if hub_url else ""


# Runtime selection. main() sets both from --agent; tests may override directly.
CURRENT_AGENT = "codex"
OUTPUT_PROTOCOL = "codex"


class QuotaError(Exception):
    """Base class for safe quota errors that may be shown to an agent."""


class QuotaConfigurationError(QuotaError):
    """Quota configuration is missing or invalid."""


class QuotaContractError(QuotaError):
    """The quota API returned data outside its published contract."""


class QuotaUnavailableError(QuotaError):
    """The quota API could not be reached successfully."""


class QuotaSourceError(QuotaError):
    """The runtime quota source provided no usable data."""


class QuotaNotReadyError(QuotaSourceError):
    """The runtime quota source is expected to become available later."""


class QuotaSourceUnsupportedError(QuotaSourceError):
    """The runtime has no local quota source and will never provide one."""


@dataclass(frozen=True)
class QuotaConfig:
    url: str
    auth_header: str
    auth_value: str


class RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def load_quota_environment(environment: MutableMapping[str, str], path: Path = QUOTA_ENV_PATH) -> None:
    """Fill missing quota settings from the repository-local ignored environment file."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return
    except (OSError, UnicodeError) as error:
        raise QuotaConfigurationError("local quota environment is not readable") from error
    loaded: dict[str, str] = {}
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key not in QUOTA_ENV_KEYS:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if value:
            loaded[key] = value
    for key, val in loaded.items():
        environment.setdefault(key, val)



def runtime_quota_environment(environment: Mapping[str, str] | None) -> Mapping[str, str]:
    if environment is not None:
        return environment
    current_environment = dict(os.environ)
    load_quota_environment(current_environment)
    return current_environment


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    value = json.loads(raw)
    return value if isinstance(value, dict) else {}


def emit(value: dict[str, Any]) -> None:
    print(json.dumps(value, ensure_ascii=False))


def deny(reason: str) -> None:
    if OUTPUT_PROTOCOL in {"kimi", "opencode", "glm"}:
        print(reason, file=sys.stderr)
        raise SystemExit(2)
    if OUTPUT_PROTOCOL == "agy":
        emit({
            "decision": "deny",
            "reason": reason,
        })
        return
    emit({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }})


def emit_allowed(context: str | None = None) -> None:
    if OUTPUT_PROTOCOL in {"kimi", "opencode", "glm"}:
        if context:
            print(context)
        return
    if OUTPUT_PROTOCOL == "agy":
        result: dict[str, Any] = {"decision": "allow"}
        if context:
            result["reason"] = context
        emit(result)
        return
    if context is None:
        emit({})
        return
    emit({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "additionalContext": context,
    }})


def allowed_override() -> bool:
    return os.environ.get(str(POLICY.get("allow_environment_variable", "AGENT_GUARD_ALLOW"))) == "1"


_QUOTED_ARGUMENTS = re.compile(r"'[^']*'|\"[^\"]*\"")
_READONLY_COMMANDS = frozenset({"echo", "printf", "grep", "egrep", "fgrep", "rg", "cat"})


def unwrap_quoted_arguments(value: str) -> str:
    return _QUOTED_ARGUMENTS.sub(lambda match: match.group(0)[1:-1], value)


def _split_on_unquoted(command: str, *, pipe_splits: bool) -> list[str]:
    parts: list[str] = []
    buf: list[str] = []
    in_single = False
    in_double = False
    index = 0
    while index < len(command):
        char = command[index]
        if char == "'" and not in_double:
            in_single = not in_single
            buf.append(char)
        elif char == '"' and not in_single:
            in_double = not in_double
            buf.append(char)
        elif not in_single and not in_double:
            pair = command[index:index + 2]
            if pair in {"&&", "||"}:
                parts.append("".join(buf))
                buf = []
                index += 2
                continue
            chain_breaks = "|;&\n" if pipe_splits else ";&\n"
            if char in chain_breaks:
                parts.append("".join(buf))
                buf = []
                index += 1
                continue
            buf.append(char)
        else:
            buf.append(char)
        index += 1
    parts.append("".join(buf))
    return [part.strip() for part in parts if part.strip()]


def split_simple_commands(command: str) -> list[str]:
    return _split_on_unquoted(command, pipe_splits=True)


def pipeline_aware_commands(command: str) -> list[tuple[str, bool]]:
    """Yield (simple_command, in_pipe_pipeline) preserving quote-aware separators."""
    results: list[tuple[str, bool]] = []
    for chain in _split_on_unquoted(command, pipe_splits=False):
        stages = _split_on_unquoted(chain, pipe_splits=True)
        in_pipeline = len(stages) > 1
        for stage in stages:
            results.append((stage, in_pipeline))
    return results


def leading_command_name(simple: str) -> str:
    try:
        tokens = shlex.split(simple, posix=True)
    except ValueError:
        tokens = simple.split()
    for token in tokens:
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", token):
            continue
        return Path(token.replace("\\", "/")).name.lower()
    return ""


def drop_readonly_quoted_spans(simple: str, *, in_pipeline: bool) -> str:
    """Drop passive quoted spans; keep expanding or piped quoted text for scanning."""

    def replacer(match: re.Match[str]) -> str:
        quoted = match.group(0)
        inner = quoted[1:-1]
        if in_pipeline or "$" in inner or "`" in inner:
            return quoted
        return " "

    return _QUOTED_ARGUMENTS.sub(replacer, simple)


def executable_command_text(command: str) -> str:
    """Quoted read-only arguments are passive; other quote contents stay executable."""
    kept: list[str] = []
    for simple, in_pipeline in pipeline_aware_commands(command):
        if leading_command_name(simple) in _READONLY_COMMANDS:
            kept.append(drop_readonly_quoted_spans(simple, in_pipeline=in_pipeline))
        else:
            kept.append(unwrap_quoted_arguments(simple))
    return "\n".join(kept)


def contains_protected_path(value: str) -> bool:
    normalized = unwrap_quoted_arguments(value).replace("\\", "/")
    for pattern in POLICY.get("safe_file_patterns", []):
        normalized = re.sub(pattern, "", normalized, flags=re.IGNORECASE)
    return any(re.search(pattern, normalized, flags=re.IGNORECASE) for pattern in POLICY.get("blocked_file_patterns", []))


def command_from(payload: dict[str, Any]) -> str:
    for key in ("tool_input", "toolInput"):
        tool_input = payload.get(key, {})
        if isinstance(tool_input, dict) and tool_input.get("command") is not None:
            return str(tool_input.get("command", ""))
    tool_call = payload.get("toolCall", {})
    if isinstance(tool_call, dict):
        args = tool_call.get("args", {})
        if isinstance(args, dict):
            for key in ("CommandLine", "command", "cmd"):
                if key in args and args[key] is not None:
                    return str(args[key])
    return ""


def check_command(payload: dict[str, Any]) -> None:
    command = command_from(payload)
    if not command or allowed_override():
        emit_allowed(low_capacity_notice(payload))
        return
    executable = executable_command_text(command)
    for item in POLICY.get("blocked_command_patterns", []):
        if re.search(item["pattern"], executable, flags=re.IGNORECASE | re.MULTILINE):
            deny(f"Blocked by repository safety policy: {item['reason']}. Use AGENT_GUARD_ALLOW=1 only after explicit user authorization.")
            return
    if contains_protected_path(command):
        deny("Blocked command referencing a protected secret-bearing file. Use an example file or request a narrowly scoped override.")
        return
    emit_allowed(low_capacity_notice(payload))


def paths_from(payload: dict[str, Any]) -> list[str]:
    values: list[str] = []
    sources: list[Any] = [payload, payload.get("tool_input", {}), payload.get("toolInput", {})]
    tool_call = payload.get("toolCall")
    if isinstance(tool_call, dict):
        args = tool_call.get("args")
        if isinstance(args, dict):
            sources.append(args)
    for source in sources:
        if isinstance(source, dict):
            for key in (
                "file_path",
                "path",
                "AbsolutePath",
                "TargetFile",
                "SearchPath",
                "DirectoryPath",
                "SearchDirectory",
            ):
                val = source.get(key)
                if isinstance(val, str) and val:
                    values.append(val)
                elif isinstance(val, list):
                    for item in val:
                        if isinstance(item, str) and item:
                            values.append(item)
            for key in ("paths", "ImagePaths"):
                val = source.get(key)
                if isinstance(val, list):
                    for item in val:
                        if isinstance(item, str) and item:
                            values.append(item)
            command = source.get("command") or source.get("CommandLine")
            if isinstance(command, str):
                values.extend(re.findall(r"^\*\*\* (?:Add|Update|Delete) File: (.+)$", command, flags=re.MULTILINE))
    return values


def check_paths(payload: dict[str, Any]) -> None:
    if allowed_override():
        emit_allowed(low_capacity_notice(payload))
        return
    blocked = next((path for path in paths_from(payload) if contains_protected_path(path)), None)
    if blocked:
        deny(f"Blocked access to protected file: {blocked}. Use an example file or request a narrowly scoped override.")
        return
    emit_allowed(low_capacity_notice(payload))


def quota_config_from(environment: Mapping[str, str]) -> QuotaConfig:
    hub_url = environment.get("HUB_URL", "")
    token = environment.get("HUB_TOKEN", "")
    if not hub_url.strip():
        raise QuotaConfigurationError("HUB_URL is not configured")
    if any(ord(character) < 32 or ord(character) == 127 for character in hub_url):
        raise QuotaConfigurationError("HUB_URL contains a control character")
    try:
        parsed = urlsplit(hub_url.strip())
        parsed.port
    except ValueError as error:
        raise QuotaConfigurationError("HUB_URL is invalid") from error
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise QuotaConfigurationError("HUB_URL must be an absolute HTTP or HTTPS URL")
    if parsed.username is not None or parsed.password is not None:
        raise QuotaConfigurationError("HUB_URL must not contain credentials")
    if parsed.query or parsed.fragment:
        raise QuotaConfigurationError("HUB_URL must be a base URL without a query or fragment")
    if not token.strip():
        raise QuotaConfigurationError("authentication is not configured")
    if any(ord(character) < 32 or ord(character) == 127 for character in token):
        raise QuotaConfigurationError("authentication value contains a control character")
    stripped_token = token.strip()
    auth_value = (
        stripped_token
        if stripped_token.lower().startswith("bearer ")
        else f"Bearer {stripped_token}"
    )
    return QuotaConfig(
        url=resolve_quota_endpoint(environment),
        auth_header="Authorization",
        auth_value=auth_value,
    )


def quota_batch_url_from(environment: Mapping[str, str]) -> str:
    return quota_config_from(environment).url.rstrip("/") + "/batch"


def _string_or_none(record: dict[str, Any], key: str) -> str | None:
    value = record.get(key)
    if value is not None and not isinstance(value, str):
        raise QuotaContractError(f"field {key} has an invalid type")
    return value


def _percent_field_or_none(record: dict[str, Any], key: str) -> str | None:
    value = record.get(key)
    if value is None:
        return None
    if isinstance(value, bool):
        raise QuotaContractError(f"field {key} has an invalid type")
    if isinstance(value, (int, float)):
        return f"{float(value):.2f}"
    if isinstance(value, str):
        return value
    raise QuotaContractError(f"field {key} has an invalid type")


def _integer_or_none(record: dict[str, Any], key: str) -> int | None:
    value = record.get(key)
    if value is not None and (not isinstance(value, int) or isinstance(value, bool)):
        raise QuotaContractError(f"field {key} has an invalid type")
    return value


def _percent(value: str | None) -> str:
    if value is None:
        return "unavailable"
    return value if value.endswith("%") else f"{value}%"


def agent_label(agent: str) -> str:
    return {"glm": "GLM"}.get(agent, agent.capitalize())


def measurement_freshness_label(updated_at: str | None, *, now: float) -> str:
    """Describe Hub/source measurement freshness for quota context lines."""
    if updated_at is None or not str(updated_at).strip():
        return "updated unavailable (stale)"
    text = str(updated_at).strip()
    parsed = _parse_expiry(text)
    if parsed is None:
        return f"updated {text} (stale)"
    age = now - parsed
    if age >= QUOTA_MEASUREMENT_FRESH_SECONDS or age < -TOKEN_EXPIRY_SKEW_SECONDS:
        return f"updated {text} (stale)"
    return f"updated {text}"


def format_quota_response(payload: Any, agent: str = "codex", *, now: float | None = None) -> str:
    label = agent_label(agent)
    current_time = time.time() if now is None else now
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise QuotaContractError("response data is not an array")
    records: list[str] = []
    for item in payload["data"]:
        if not isinstance(item, dict) or not isinstance(item.get("agent"), str):
            raise QuotaContractError("quota record is invalid")
        if item["agent"].lower() != agent:
            continue
        required = {
            "window",
            "used_percent",
            "used_tokens",
            "limit_tokens",
            "remaining_percent",
            "reset_at",
        }
        if not required.issubset(item):
            raise QuotaContractError("quota record is missing required fields")
        window = item.get("window")
        if not isinstance(window, str) or not window:
            raise QuotaContractError("field window is missing or invalid")
        used_percent = _percent_field_or_none(item, "used_percent")
        remaining_percent = _percent_field_or_none(item, "remaining_percent")
        used_tokens = _integer_or_none(item, "used_tokens")
        limit_tokens = _integer_or_none(item, "limit_tokens")
        reset_at = _string_or_none(item, "reset_at")
        updated_at = _string_or_none(item, "updated_at")
        if used_tokens is None and limit_tokens is None:
            tokens = "tokens unavailable"
        elif used_tokens is not None and limit_tokens is not None:
            tokens = f"tokens {used_tokens}/{limit_tokens}"
        else:
            used_value = str(used_tokens) if used_tokens is not None else "unavailable"
            limit_value = str(limit_tokens) if limit_tokens is not None else "unavailable"
            tokens = f"tokens {used_value}/{limit_value}"
        reset = reset_at if reset_at is not None else "unavailable"
        freshness = measurement_freshness_label(updated_at, now=current_time)
        records.append(
            f"{window}: used {_percent(used_percent)}, {tokens}, "
            f"remaining {_percent(remaining_percent)}, reset {reset}, {freshness}"
        )
    if not records:
        return f"{label} quota unavailable: no {label} records."
    return f"{label} quota: " + "; ".join(records)


def _open_request(request: Request, opener: Callable[..., Any] | None) -> bytes:
    open_request = opener or build_opener(RejectRedirects()).open
    try:
        with open_request(request, timeout=QUOTA_REQUEST_TIMEOUT_SECONDS) as response:
            status = getattr(response, "status", 200)
            if not isinstance(status, int) or not 200 <= status < 300:
                raise QuotaUnavailableError(f"HTTP {status}")
            return response.read()
    except QuotaError:
        raise
    except HTTPError as error:
        raise QuotaUnavailableError(f"HTTP {error.code}") from error
    except TimeoutError as error:
        raise QuotaUnavailableError("request timed out") from error
    except URLError as error:
        reason = "request timed out" if isinstance(error.reason, TimeoutError) else "network error"
        raise QuotaUnavailableError(reason) from error
    except OSError as error:
        raise QuotaUnavailableError("network error") from error
    except (ValueError, HTTPException) as error:
        raise QuotaUnavailableError("invalid HTTP response") from error


def _decode_json(raw: bytes) -> Any:
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise QuotaContractError("response is not valid JSON") from error


def retrieve_quota_context(
    environment: Mapping[str, str],
    opener: Callable[..., Any] | None = None,
    *,
    agent: str = "codex",
) -> str:
    config = quota_config_from(environment)
    request = Request(
        config.url,
        headers={config.auth_header: config.auth_value, "Accept": "application/json"},
        method="GET",
    )
    raw = _open_request(request, opener)
    return format_quota_response(_decode_json(raw), agent)


def post_quota_records(
    records: list[dict[str, Any]],
    environment: Mapping[str, str],
    opener: Callable[..., Any] | None = None,
) -> str:
    if not records:
        raise QuotaSourceError("no quota records to register")
    config = quota_config_from(environment)
    url = config.url.rstrip("/") + "/batch"
    body = json.dumps({"quotas": records}).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={
            config.auth_header: config.auth_value,
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    _open_request(request, opener)
    return f"registered {len(records)} quota records"


def _iso_from_epoch(value: Any) -> str | None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        if isinstance(value, str):
            val = value.strip()
            if val.isdigit():
                value = int(val)
            elif val:
                return val
            else:
                return None
        else:
            return None
    seconds = value / 1000.0 if value > 1e11 else float(value)
    try:
        return datetime.fromtimestamp(seconds, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (OSError, OverflowError, ValueError):
        return None


def _find_rate_limits(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        candidate = value.get("rate_limits")
        if isinstance(candidate, dict) and isinstance(candidate.get("primary"), dict):
            return candidate
        for item in value.values():
            found = _find_rate_limits(item)
            if found is not None:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _find_rate_limits(item)
            if found is not None:
                return found
    return None


def codex_records_from_transcript(transcript_path: Any) -> list[dict[str, Any]]:
    if not isinstance(transcript_path, str) or not transcript_path:
        raise QuotaSourceError("hook payload has no transcript path")
    path = Path(transcript_path)
    try:
        with path.open("rb") as handle:
            handle.seek(0, os.SEEK_END)
            handle.seek(max(0, handle.tell() - TRANSCRIPT_TAIL_BYTES))
            tail = handle.read().decode("utf-8", errors="replace")
    except OSError as error:
        raise QuotaSourceError(f"transcript is not readable: {error}") from error
    rate_limits: dict[str, Any] | None = None
    for line in reversed(tail.splitlines()):
        line = line.strip()
        if not line or '"rate_limits"' not in line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        rate_limits = _find_rate_limits(record)
        if rate_limits is not None:
            break
    if rate_limits is None:
        raise QuotaNotReadyError("transcript has no rate limits snapshot")
    records: list[dict[str, Any]] = []
    for key, window in (("primary", "5h"), ("secondary", "weekly")):
        entry = rate_limits.get(key)
        if not isinstance(entry, dict):
            continue
        used_percent = entry.get("used_percent")
        if not isinstance(used_percent, (int, float)) or isinstance(used_percent, bool):
            continue
        records.append({
            "agent": "codex",
            "window": window,
            "used_percent": float(used_percent),
            "used_tokens": None,
            "limit_tokens": None,
            "remaining_percent": round(max(0.0, 100.0 - float(used_percent)), 2),
            "reset_at": _iso_from_epoch(entry.get("resets_at")),
        })
    if not records:
        raise QuotaSourceError("rate limits snapshot has no usable windows")
    return records


def kimi_credentials_path(environment: Mapping[str, str]) -> Path:
    home = environment.get("KIMI_CODE_HOME", "").strip()
    root = Path(home) if home else Path.home() / ".kimi-code"
    return root / "credentials" / "kimi-code.json"


def kimi_access_token(environment: Mapping[str, str], *, now: float | None = None) -> str:
    path = kimi_credentials_path(environment)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise QuotaSourceError("Kimi credentials file is missing") from error
    except (OSError, json.JSONDecodeError) as error:
        raise QuotaSourceError("Kimi credentials file is not readable") from error
    if not isinstance(data, dict):
        raise QuotaSourceError("Kimi credentials file is not readable")
    token = data.get("access_token")
    if not isinstance(token, str) or not token:
        raise QuotaSourceError("Kimi credentials have no access token")
    expires_at = data.get("expires_at")
    current = time.time() if now is None else now
    if (
        not isinstance(expires_at, (int, float))
        or isinstance(expires_at, bool)
        or expires_at <= current + TOKEN_EXPIRY_SKEW_SECONDS
    ):
        raise QuotaSourceError("Kimi OAuth token is expired")
    return token


def retrieve_kimi_usages(
    environment: Mapping[str, str],
    opener: Callable[..., Any] | None = None,
    *,
    now: float | None = None,
) -> Any:
    token = kimi_access_token(environment, now=now)
    url = environment.get("KIMI_QUOTA_SOURCE_URL", KIMI_USAGES_URL).strip()
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise QuotaConfigurationError("Kimi usages URL must be an absolute HTTP or HTTPS URL")
    request = Request(
        url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        method="GET",
    )
    return _decode_json(_open_request(request, opener))


def _source_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _kimi_window_record(window: str, detail: Mapping[str, Any]) -> dict[str, Any] | None:
    used = _source_int(detail.get("used"))
    limit = _source_int(detail.get("limit"))
    if used is None and limit is None:
        return None
    used_percent: float | None = None
    remaining_percent: float | None = None
    if used is not None and limit:
        used_percent = round(used / limit * 100, 2)
        remaining_percent = round(100.0 - used_percent, 2)
    reset_at = detail.get("resetTime")
    return {
        "agent": "kimi",
        "window": window,
        "used_percent": used_percent,
        "used_tokens": used,
        "limit_tokens": limit,
        "remaining_percent": remaining_percent,
        "reset_at": reset_at if isinstance(reset_at, str) and reset_at else None,
    }


def kimi_records_from_usages(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, dict):
        raise QuotaSourceError("usages response is not an object")
    records: list[dict[str, Any]] = []
    usage = data.get("usage")
    if isinstance(usage, dict):
        record = _kimi_window_record("weekly", usage)
        if record is not None:
            records.append(record)
    limits = data.get("limits")
    if isinstance(limits, list):
        for entry in limits:
            if not isinstance(entry, dict):
                continue
            window_info = entry.get("window")
            if not isinstance(window_info, dict):
                continue
            if str(window_info.get("duration")) != "300":
                continue
            if window_info.get("timeUnit") != "TIME_UNIT_MINUTE":
                continue
            detail = entry.get("detail")
            record = _kimi_window_record("5h", detail if isinstance(detail, dict) else {})
            if record is not None:
                records.append(record)
            break
    if not records:
        raise QuotaSourceError("usages response has no quota windows")
    return records


def retrieve_agy_usages(
    environment: Mapping[str, str],
    *,
    runner: Callable[..., Any] | None = None,
) -> Any:
    cmd = environment.get("AGY_USAGE_COMMAND", "agy --print /usage --output-format json")
    run = runner or (lambda c: subprocess.run(c, shell=True, capture_output=True, text=True, timeout=15))
    try:
        proc = run(cmd)
    except (OSError, subprocess.SubprocessError) as error:
        raise QuotaUnavailableError(f"failed to run agy usage command: {error}") from error
    if getattr(proc, "returncode", 0) != 0:
        stderr = getattr(proc, "stderr", "")
        raise QuotaUnavailableError(f"agy usage command failed: {stderr.strip() or 'exit code ' + str(getattr(proc, 'returncode', 1))}")
    stdout = getattr(proc, "stdout", "")
    if not stdout or not stdout.strip():
        raise QuotaSourceError("agy usage command produced empty output")
    try:
        return json.loads(stdout)
    except json.JSONDecodeError as error:
        raise QuotaSourceError(f"agy usage output is not valid JSON: {error}") from error


def agy_records_from_usages(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, dict):
        raise QuotaSourceError("usages response is not an object")
    command = data.get("command")
    if isinstance(command, dict):
        cmd_data = command.get("data")
        if isinstance(cmd_data, dict):
            data = cmd_data
    groups = data.get("groups")
    if not isinstance(groups, list):
        raise QuotaSourceError("usage data has no groups")

    selected_group: dict[str, Any] | None = None
    for group in groups:
        if isinstance(group, dict) and "gemini" in str(group.get("name", "")).lower():
            selected_group = group
            break
    if selected_group is None:
        for group in groups:
            if isinstance(group, dict) and isinstance(group.get("buckets"), list):
                selected_group = group
                break
    if selected_group is None:
        raise QuotaSourceError("no valid quota groups found")

    buckets = selected_group.get("buckets")
    if not isinstance(buckets, list):
        raise QuotaSourceError("quota group has no buckets")

    records: list[dict[str, Any]] = []
    for bucket in buckets:
        if not isinstance(bucket, dict):
            continue
        window = bucket.get("window")
        if not isinstance(window, str) or window not in {"5h", "weekly"}:
            continue
        rem_frac = bucket.get("remaining_fraction")
        if rem_frac is None or isinstance(rem_frac, bool) or not isinstance(rem_frac, (int, float)):
            continue
        remaining_percent = round(max(0.0, min(100.0, float(rem_frac) * 100.0)), 2)
        used_percent = round(max(0.0, min(100.0, 100.0 - remaining_percent)), 2)
        reset_time = bucket.get("reset_time")
        records.append({
            "agent": "agy",
            "window": window,
            "used_percent": used_percent,
            "used_tokens": None,
            "limit_tokens": None,
            "remaining_percent": remaining_percent,
            "reset_at": reset_time if isinstance(reset_time, str) and reset_time else None,
        })
    if not records:
        raise QuotaSourceError("usages response has no quota windows")
    return records


def z_ai_api_key(environment: Mapping[str, str]) -> str:
    token = (
        environment.get("Z_AI_USAGE_API_KEY")
        or environment.get("ZAI_API_KEY")
        or environment.get("ZHIPUAI_API_KEY")
        or ""
    ).strip()
    if not token:
        raise QuotaSourceError("Z.ai API key is missing (set Z_AI_USAGE_API_KEY in .agents/.env)")
    return token


def retrieve_glm_usages(
    environment: Mapping[str, str],
    opener: Callable[..., Any] | None = None,
    *,
    now: float | None = None,
) -> Any:
    token = z_ai_api_key(environment)
    url = environment.get("Z_AI_USAGE_API_URL", Z_AI_USAGES_URL).strip()
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise QuotaConfigurationError("Z.ai usages URL must be an absolute HTTP or HTTPS URL")
    request = Request(
        url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        method="GET",
    )
    return _decode_json(_open_request(request, opener))


def glm_records_from_usages(data: Any, agent: str = "opencode") -> list[dict[str, Any]]:
    if not isinstance(data, dict):
        raise QuotaSourceError("GLM usages response is not an object")
    inner = data.get("data")
    if isinstance(inner, dict):
        data = inner
    limits = data.get("limits")
    if not isinstance(limits, list):
        raise QuotaSourceError("GLM usages data has no limits")

    records: list[dict[str, Any]] = []
    seen_windows: set[str] = set()
    for index, entry in enumerate(limits):
        if not isinstance(entry, dict):
            continue
        unit = entry.get("unit")
        window_name = entry.get("window")
        if isinstance(window_name, str) and window_name in {"5h", "weekly"}:
            window = window_name
        elif unit == 3 or str(unit) == "3":
            window = "5h"
        elif unit in {5, 6} or str(unit) in {"5", "6"}:
            window = "weekly"
        elif "5h" not in seen_windows and index == 0:
            window = "5h"
        elif "weekly" not in seen_windows:
            window = "weekly"
        else:
            continue

        if window in seen_windows:
            continue
        seen_windows.add(window)

        pct = entry.get("percentage")
        if pct is None or isinstance(pct, bool) or not isinstance(pct, (int, float)):
            used_percent = None
            remaining_percent = None
        else:
            used_percent = round(max(0.0, min(100.0, float(pct))), 2)
            remaining_percent = round(max(0.0, min(100.0, 100.0 - used_percent)), 2)

        reset_at = _iso_from_epoch(entry.get("nextResetTime") or entry.get("resetTime") or entry.get("reset_at"))

        records.append({
            "agent": agent,
            "window": window,
            "used_percent": used_percent,
            "used_tokens": _source_int(entry.get("currentValue") or entry.get("used_tokens") or entry.get("usedTokens")),
            "limit_tokens": _source_int(entry.get("usage") or entry.get("limit_tokens") or entry.get("limitTokens") or entry.get("total_tokens")),
            "remaining_percent": remaining_percent,
            "reset_at": reset_at,
        })

    if not records:
        raise QuotaSourceError("GLM usages response has no valid quota windows")
    return records


def grok_credentials_path(environment: Mapping[str, str]) -> Path:
    home = environment.get("GROK_HOME", "").strip()
    root = Path(home) if home else Path.home() / ".grok"
    return root / "auth.json"


def _parse_expiry(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        seconds = value / 1000.0 if value > 1e11 else float(value)
        return seconds
    if isinstance(value, str) and value.strip():
        text = value.strip()
        if text.isdigit():
            return float(int(text))
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    return None


def grok_credentials(
    environment: Mapping[str, str],
    *,
    now: float | None = None,
) -> tuple[str, str | None]:
    path = grok_credentials_path(environment)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise QuotaSourceError("Grok credentials file is missing") from error
    except (OSError, json.JSONDecodeError) as error:
        raise QuotaSourceError("Grok credentials file is not readable") from error
    if not isinstance(data, dict):
        raise QuotaSourceError("Grok credentials file is not readable")
    current = time.time() if now is None else now
    saw_key = False
    expired_only = False
    for entry in data.values():
        if not isinstance(entry, dict):
            continue
        key = entry.get("key")
        if not isinstance(key, str) or not key.strip():
            continue
        saw_key = True
        expires_at = _parse_expiry(entry.get("expires_at"))
        if expires_at is not None and expires_at <= current + TOKEN_EXPIRY_SKEW_SECONDS:
            expired_only = True
            continue
        user_id = entry.get("user_id")
        uid = user_id.strip() if isinstance(user_id, str) and user_id.strip() else None
        return key.strip(), uid
    if expired_only:
        raise QuotaSourceError("Grok OAuth token is expired")
    raise QuotaSourceError("Grok credentials have no access token")


def retrieve_grok_usages(
    environment: Mapping[str, str],
    opener: Callable[..., Any] | None = None,
    *,
    now: float | None = None,
) -> Any:
    key, user_id = grok_credentials(environment, now=now)
    url = environment.get("GROK_QUOTA_SOURCE_URL", GROK_USAGES_URL).strip()
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise QuotaConfigurationError("Grok usages URL must be an absolute HTTP or HTTPS URL")
    headers = {
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "X-XAI-Token-Auth": GROK_TOKEN_AUTH,
    }
    if user_id:
        headers["x-userid"] = user_id
    request = Request(url, headers=headers, method="GET")
    return _decode_json(_open_request(request, opener))


def grok_records_from_usages(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, dict):
        raise QuotaSourceError("usages response is not an object")
    config = data.get("config")
    if not isinstance(config, dict):
        raise QuotaSourceError("usages response has no config")
    period = config.get("currentPeriod") or config.get("current_period")
    period_type = None
    reset_at = None
    if isinstance(period, dict):
        raw_type = period.get("type") or period.get("period_type")
        if isinstance(raw_type, str) and raw_type.strip():
            period_type = raw_type.strip().upper()
        end = period.get("end")
        if isinstance(end, str) and end.strip():
            reset_at = end.strip()
    if reset_at is None:
        end = config.get("billingPeriodEnd") or config.get("billing_period_end")
        if isinstance(end, str) and end.strip():
            reset_at = end.strip()
    if period_type and "WEEKLY" not in period_type and "MONTHLY" in period_type:
        raise QuotaSourceError("usages response has no weekly quota window")
    pct = config.get("creditUsagePercent")
    if pct is None:
        pct = config.get("credit_usage_percent")
    if pct is None or isinstance(pct, bool) or not isinstance(pct, (int, float)):
        raise QuotaSourceError("usages response has no quota windows")
    used_percent = round(max(0.0, min(100.0, float(pct))), 2)
    return [{
        "agent": "grok",
        "window": "weekly",
        "used_percent": used_percent,
        "used_tokens": None,
        "limit_tokens": None,
        "remaining_percent": round(max(0.0, min(100.0, 100.0 - used_percent)), 2),
        "reset_at": reset_at,
    }]


# Records from the most recent successful registration; read by remaining_capacity_percent().
LAST_REGISTRATION_RECORDS: list[dict[str, Any]] = []


def remaining_capacity_percent(records: Iterable[Mapping[str, Any]]) -> float | None:
    """Lowest remaining percent across the collected windows, or None when unknown."""
    values = [
        float(record["remaining_percent"])
        for record in records
        if isinstance(record.get("remaining_percent"), (int, float))
        and not isinstance(record.get("remaining_percent"), bool)
    ]
    return min(values) if values else None


def collect_registration_records(
    payload: dict[str, Any],
    environment: Mapping[str, str],
) -> list[dict[str, Any]]:
    if CURRENT_AGENT == "claude":
        # Claude Code exposes no local quota source; registering the Codex transcript
        # reading under this agent would mislabel another runtime's measurement.
        raise QuotaSourceUnsupportedError("Claude Code exposes no local quota source")
    if CURRENT_AGENT == "kimi":
        return kimi_records_from_usages(retrieve_kimi_usages(environment))
    if CURRENT_AGENT == "agy":
        return agy_records_from_usages(retrieve_agy_usages(environment))
    if CURRENT_AGENT in {"opencode", "glm"}:
        return glm_records_from_usages(retrieve_glm_usages(environment), agent=CURRENT_AGENT)
    if CURRENT_AGENT == "grok":
        return grok_records_from_usages(retrieve_grok_usages(environment))
    return codex_records_from_transcript(payload.get("transcript_path") or payload.get("transcriptPath"))


def read_cache_key(endpoint: str, agent: str) -> str:
    return f"{endpoint}#read:{agent}"


def register_cache_key(endpoint: str, agent: str) -> str:
    return f"{endpoint}#register:{agent}"


def _cache_path(cache_dir: Path, endpoint: str) -> Path:
    digest = hashlib.sha256(endpoint.encode("utf-8")).hexdigest()
    return cache_dir / f"{digest}.json"


def quota_cache_root(cache_dir: Path | None = None) -> Path:
    return cache_dir or Path(tempfile.gettempdir()) / "project-template-agent-quota-v1"


def _session_state_path(cache_dir: Path | None, key: str) -> Path:
    # Not a *.json name: _trim_cache prunes measurement caches, not session state.
    return _cache_path(quota_cache_root(cache_dir), key).with_suffix(".session")


def _read_session_state(cache_dir: Path | None, key: str) -> dict[str, Any]:
    return _read_cache(_session_state_path(cache_dir, key)) or {}


def _update_session_state(cache_dir: Path | None, key: str, **changes: Any) -> None:
    path = _session_state_path(cache_dir, key)
    state = _read_session_state(cache_dir, key)
    state.update(changes)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def _read_cache(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, UnicodeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _cache_is_fresh(path: Path, endpoint: str, now: float) -> bool:
    value = _read_cache(path)
    if value is None:
        return False
    refreshed_at = value.get("refreshed_at")
    return (
        value.get("endpoint") == endpoint
        and isinstance(refreshed_at, (int, float))
        and not isinstance(refreshed_at, bool)
        and abs(now - float(refreshed_at)) < QUOTA_CACHE_SECONDS
    )


def _acquire_lock(path: Path, now: float, stale_seconds: float = QUOTA_LOCK_STALE_SECONDS) -> bool:
    for _attempt in range(2):
        try:
            descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            try:
                if now - path.stat().st_mtime <= stale_seconds:
                    return False
                path.unlink()
            except FileNotFoundError:
                continue
            except OSError:
                return False
        else:
            with os.fdopen(descriptor, "w", encoding="utf-8") as lock_file:
                lock_file.write(str(now))
            return True
    return False


def _write_cache(path: Path, endpoint: str, refreshed_at: float, outcome: str) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    payload = {
        "endpoint": endpoint,
        "refreshed_at": refreshed_at,
        "outcome": outcome,
    }
    try:
        temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _trim_cache(cache_dir: Path, now: float) -> None:
    for path in cache_dir.glob("*.json"):
        lock = path.with_suffix(".lock")
        if not _acquire_lock(lock, now):
            continue
        try:
            value = _read_cache(path)
            refreshed_at = value.get("refreshed_at") if isinstance(value, dict) else None
            fresh = (
                isinstance(refreshed_at, (int, float))
                and not isinstance(refreshed_at, bool)
                and abs(now - float(refreshed_at)) < QUOTA_CACHE_SECONDS
            )
            if not fresh:
                path.unlink()
        except OSError:
            continue
        finally:
            try:
                lock.unlink()
            except FileNotFoundError:
                pass


def refresh_quota_context(
    environment: Mapping[str, str] | None = None,
    *,
    cache_dir: Path | None = None,
    now: float | None = None,
    fetcher: Callable[[Mapping[str, str]], str] | None = None,
) -> str | None:
    current_environment = runtime_quota_environment(environment)
    endpoint = resolve_quota_endpoint(current_environment)

    key = read_cache_key(endpoint, CURRENT_AGENT)
    label = agent_label(CURRENT_AGENT)
    current_time = time.time() if now is None else now
    root = quota_cache_root(cache_dir)
    cache = _cache_path(root, key)
    lock = cache.with_suffix(".lock")
    try:
        root.mkdir(parents=True, exist_ok=True)
        if _cache_is_fresh(cache, key, current_time):
            return None
        if not _acquire_lock(lock, current_time):
            return None
        try:
            if _cache_is_fresh(cache, key, current_time):
                return None
            _write_cache(cache, key, current_time, f"{label} quota unavailable: refresh in progress.")
            if fetcher is not None:
                fetch = fetcher
            else:
                fetch = lambda env: retrieve_quota_context(env, agent=CURRENT_AGENT)
            try:
                outcome = fetch(current_environment)
            except QuotaError as error:
                outcome = f"{label} quota unavailable: {error}."
            try:
                _write_cache(cache, key, current_time, outcome)
            except OSError:
                pass
            _trim_cache(root, time.time() if now is None else now)
            return outcome
        finally:
            try:
                lock.unlink()
            except FileNotFoundError:
                pass
    except OSError:
        return f"{label} quota unavailable: local throttle is unavailable."


def refresh_registration(
    payload: dict[str, Any],
    environment: Mapping[str, str] | None = None,
    *,
    force: bool,
    defer_not_ready: bool = False,
    cache_dir: Path | None = None,
    now: float | None = None,
    collector: Callable[[dict[str, Any], Mapping[str, str]], list[dict[str, Any]]] | None = None,
    poster: Callable[[list[dict[str, Any]], Mapping[str, str]], str] | None = None,
) -> tuple[str | None, str | None]:
    """Attempt one quota registration.

    Returns `(failure, measurement)`. `failure` is a non-secret reason when
    registration fails. `measurement` is the formatted current source reading
    after a successful collect+POST. A failed attempt never returns a
    measurement (no manufactured fresh Hub state). Throttled skips return
    `(None, None)`.
    """
    current_environment = runtime_quota_environment(environment)
    endpoint = resolve_quota_endpoint(current_environment)

    key = register_cache_key(endpoint, CURRENT_AGENT)
    label = agent_label(CURRENT_AGENT)
    current_time = time.time() if now is None else now
    root = quota_cache_root(cache_dir)
    cache = _cache_path(root, key)
    lock = cache.with_suffix(".lock")
    try:
        root.mkdir(parents=True, exist_ok=True)
        if not force and _cache_is_fresh(cache, key, current_time):
            return None, None
        if not _acquire_lock(lock, current_time):
            return None, None
        try:
            if not force and _cache_is_fresh(cache, key, current_time):
                return None, None
            _write_cache(cache, key, current_time, f"{label} quota registration in progress.")
            outcome: str | None = None
            measurement: str | None = None
            cache_outcome = f"{label} quota registration succeeded."
            try:
                global LAST_REGISTRATION_RECORDS
                LAST_REGISTRATION_RECORDS = []
                records = (collector or collect_registration_records)(payload, current_environment)
                (poster or post_quota_records)(records, current_environment)
                LAST_REGISTRATION_RECORDS = list(records)
                updated = datetime.fromtimestamp(current_time, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                display = [{**record, "updated_at": updated} for record in records]
                try:
                    measurement = format_quota_response(
                        {"data": display},
                        agent=CURRENT_AGENT,
                        now=current_time,
                    )
                except QuotaContractError:
                    measurement = None
            except QuotaSourceUnsupportedError as error:
                # Permanent absence of a source is not a failure to report every session.
                cache_outcome = f"{label} has no local quota source: {error}."
            except QuotaNotReadyError as error:
                if defer_not_ready:
                    try:
                        cache.unlink()
                    except FileNotFoundError:
                        pass
                    return None, None
                outcome = f"{label} quota registration unavailable: {error}."
                cache_outcome = outcome
            except QuotaError as error:
                outcome = f"{label} quota registration unavailable: {error}."
                cache_outcome = outcome
            try:
                _write_cache(cache, key, current_time, cache_outcome)
            except OSError:
                pass
            _trim_cache(root, time.time() if now is None else now)
            return outcome, measurement
        finally:
            try:
                lock.unlink()
            except FileNotFoundError:
                pass
    except OSError:
        return f"{label} quota registration unavailable: local throttle is unavailable.", None


def quota_only(payload: dict[str, Any]) -> None:
    emit_allowed(low_capacity_notice(payload))


def registration_state_key(environment: Mapping[str, str] | None = None) -> str:
    return register_cache_key(resolve_quota_endpoint(runtime_quota_environment(environment)), CURRENT_AGENT)


def due_measurement(
    measurement: str | None,
    *,
    session_event: bool,
    cache_dir: Path | None = None,
) -> str | None:
    """Decide whether this measurement must change agent behavior.

    A measurement reaches the model only when remaining capacity crosses below
    the low threshold, once per crossing; recovery above the threshold re-arms
    the notice. Routine readings, including a session's first reading, stay
    system-side.
    """
    key = registration_state_key()
    state = _read_session_state(cache_dir, key)
    remaining = remaining_capacity_percent(LAST_REGISTRATION_RECORDS) if measurement else None
    low = remaining is not None and remaining < QUOTA_LOW_REMAINING_PERCENT
    if session_event:
        _update_session_state(cache_dir, key, low_announced=low)
        return measurement if low else None
    if not measurement:
        return None
    if low and not state.get("low_announced"):
        _update_session_state(cache_dir, key, low_announced=True)
        return measurement
    if not low and state.get("low_announced"):
        _update_session_state(cache_dir, key, low_announced=False)
    return None


def low_capacity_notice(payload: dict[str, Any]) -> str | None:
    """Quota text for an allowed tool call: only a low-capacity threshold crossing.

    An allowed call carries no routine quota banner and never surfaces a quota
    failure, so a broken quota source cannot disturb it. Throttling is unchanged:
    registration keeps its own 60-second cache window.
    """
    _failure, measurement = refresh_registration(payload, force=False)
    return due_measurement(measurement, session_event=False)


def pre_tool_use(payload: dict[str, Any]) -> None:
    if command_from(payload):
        check_command(payload)
    elif paths_from(payload):
        check_paths(payload)
    else:
        emit_allowed(low_capacity_notice(payload))


def session_start(payload: dict[str, Any]) -> None:
    failure, collected = refresh_registration(payload, force=True, defer_not_ready=True)
    measurement = due_measurement(collected, session_event=True)
    if OUTPUT_PROTOCOL in {"kimi", "opencode", "glm"}:
        lines = [item for item in (measurement, failure) if item]
        if lines:
            print("\n".join(lines))
        return
    parts = ["Read AGENTS.md. Keep simple work lightweight and never invent missing data or verification."]
    if measurement:
        parts.append(measurement)
    if failure:
        parts.append(failure)
    if OUTPUT_PROTOCOL == "agy":
        emit({"injectSteps": [{"ephemeralMessage": "\n".join(parts)}]})
        return
    emit({"hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": "\n".join(parts),
    }})


def session_end(payload: dict[str, Any]) -> None:
    failure, _measurement = refresh_registration(payload, force=True)
    if OUTPUT_PROTOCOL in {"kimi", "opencode", "glm"}:
        if failure:
            print(failure)
        return
    if OUTPUT_PROTOCOL == "agy":
        emit({})
        return
    if failure:
        emit({"hookSpecificOutput": {
            "hookEventName": "SessionEnd",
            "additionalContext": failure,
        }})
        return
    emit({})


def pre_invocation(payload: dict[str, Any]) -> None:
    # One registration attempt owns display; do not register twice against a fresh
    # cache, which would drop the source measurement.
    failure, measurement = refresh_registration(payload, force=False, defer_not_ready=True)
    messages: list[str] = []
    inv_num = payload.get("invocationNum")
    first_invocation = inv_num == 1
    if first_invocation:
        messages.append("Read AGENTS.md. Keep simple work lightweight and never invent missing data or verification.")
    due = due_measurement(measurement, session_event=first_invocation)
    if due:
        messages.append(due)
    if failure:
        messages.append(failure)
    if OUTPUT_PROTOCOL == "agy":
        if messages:
            emit({"injectSteps": [{"ephemeralMessage": "\n".join(messages)}]})
        else:
            emit({"injectSteps": []})
        return
    if OUTPUT_PROTOCOL in {"opencode", "glm"}:
        if messages:
            print("\n".join(messages))
        return
    if messages:
        emit_allowed("\n".join(messages))
    else:
        emit_allowed()


TASK_RECORD_PATH = re.compile(
    r"(?:^|[/\\])\.agents[/\\]tasks[/\\][^/\\]+[/\\]task\.md$",
    re.IGNORECASE,
)
_REPORT_TASKS: Any = None


def _task_report_module() -> Any:
    global _REPORT_TASKS
    if _REPORT_TASKS is None:
        scripts = Path(__file__).resolve().parents[1] / "skills" / "use-task-board" / "scripts"
        if str(scripts) not in sys.path:
            sys.path.insert(0, str(scripts))
        import report_tasks as report_tasks_module

        _REPORT_TASKS = report_tasks_module
    return _REPORT_TASKS


def is_task_record_path(path: str) -> bool:
    return bool(path) and bool(TASK_RECORD_PATH.search(path.replace("\\", "/")))


def written_paths_from(payload: dict[str, Any]) -> list[str]:
    values: list[str] = []
    sources: list[Any] = [payload, payload.get("tool_input", {}), payload.get("toolInput", {})]
    tool_call = payload.get("toolCall")
    if isinstance(tool_call, dict):
        args = tool_call.get("args")
        if isinstance(args, dict):
            sources.append(args)
    for source in sources:
        if not isinstance(source, dict):
            continue
        for key in TASK_REPORT_PATH_KEYS:
            val = source.get(key)
            if isinstance(val, str) and val:
                values.append(val)
        command = source.get("command") or source.get("CommandLine")
        if isinstance(command, str):
            values.extend(re.findall(r"^\*\*\* (?:Add|Update|Delete) File: (.+)$", command, flags=re.MULTILINE))
    return values


def task_record_changed(payload: dict[str, Any]) -> bool:
    return any(is_task_record_path(path) for path in written_paths_from(payload))


def snapshot_digest(snapshot: Mapping[str, Any]) -> str:
    canonical = json.dumps(snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _task_report_cache_dir(cache_dir: Path | None) -> Path:
    return cache_dir or Path(tempfile.gettempdir()) / "project-template-agent-tasks-v1"


def _task_report_cache_path(cache_dir: Path, repo_root: Path, url: str) -> Path:
    digest = hashlib.sha256(f"{repo_root.resolve()}#{url}".encode("utf-8")).hexdigest()
    return cache_dir / f"{digest}.json"


def _read_snapshot_hash(path: Path, repo_root: Path, url: str) -> str | None:
    value = _read_cache(path)
    if value is None:
        return None
    if value.get("repo") != str(repo_root.resolve()) or value.get("url") != url:
        return None
    digest = value.get("snapshot_hash")
    return digest if isinstance(digest, str) and digest else None


def _write_snapshot_hash(path: Path, repo_root: Path, url: str, digest: str) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    payload = {
        "repo": str(repo_root.resolve()),
        "url": url,
        "snapshot_hash": digest,
    }
    try:
        temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _spawn_task_report(repo_root: Path) -> None:
    subprocess.Popen(
        [
            sys.executable,
            str(Path(__file__).resolve()),
            "--event",
            "task-report-send",
            "--agent",
            CURRENT_AGENT,
        ],
        cwd=str(repo_root),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )


def send_task_report(
    *,
    repo_root: Path | None = None,
    cache_dir: Path | None = None,
    snapshot_loader: Callable[[], Any] | None = None,
    poster: Callable[..., Any] | None = None,
) -> None:
    report_tasks = _task_report_module()
    root = Path(repo_root) if repo_root is not None else report_tasks.find_repo_root()
    url, token = report_tasks.resolve_auto_report_config(repo_root=root)
    if not url or not token:
        return
    cache_root = _task_report_cache_dir(cache_dir)
    cache_path = _task_report_cache_path(cache_root, root, url)
    lock = cache_path.with_suffix(".lock")
    now = time.time()
    try:
        cache_root.mkdir(parents=True, exist_ok=True)
        if not _acquire_lock(lock, now, TASK_REPORT_LOCK_STALE_SECONDS):
            return
        try:
            try:
                snapshot = snapshot_loader() if snapshot_loader is not None else report_tasks.extract_snapshot_data(root)
            except Exception:
                return
            if not isinstance(snapshot, dict):
                return
            try:
                digest = snapshot_digest(snapshot)
            except (TypeError, ValueError):
                return
            if _read_snapshot_hash(cache_path, root, url) == digest:
                return
            post = poster if poster is not None else (
                lambda api_url, api_token, payload: report_tasks.post_snapshot(api_url, api_token, payload)
            )
            try:
                post(url, token, snapshot)
            except Exception:
                pass
            try:
                _write_snapshot_hash(cache_path, root, url, digest)
            except OSError:
                pass
        finally:
            try:
                lock.unlink()
            except FileNotFoundError:
                pass
    except OSError:
        return


def maybe_report_tasks(
    payload: dict[str, Any],
    *,
    force: bool = False,
    repo_root: Path | None = None,
    cache_dir: Path | None = None,
    snapshot_loader: Callable[[], Any] | None = None,
    poster: Callable[..., Any] | None = None,
    spawner: Callable[[Path], None] | None = None,
    sync: bool = False,
) -> None:
    report_tasks = _task_report_module()
    root = Path(repo_root) if repo_root is not None else report_tasks.find_repo_root()
    if not force and not task_record_changed(payload):
        return
    url, token = report_tasks.resolve_auto_report_config(repo_root=root)
    if not url or not token:
        return
    if sync or snapshot_loader is not None or poster is not None:
        send_task_report(
            repo_root=root,
            cache_dir=cache_dir,
            snapshot_loader=snapshot_loader,
            poster=poster,
        )
        return
    (spawner or _spawn_task_report)(root)


def task_report(payload: dict[str, Any], *, force: bool = False, **kwargs: Any) -> None:
    try:
        maybe_report_tasks(payload, force=force, **kwargs)
    except Exception:
        pass
    emit({})


def task_report_send() -> None:
    try:
        send_task_report()
    except Exception:
        pass


def main() -> int:
    global CURRENT_AGENT, OUTPUT_PROTOCOL
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--event",
        choices=(
            "command",
            "path",
            "pretool",
            "preinvocation",
            "quota",
            "session",
            "session-end",
            "task-report",
            "task-report-send",
        ),
        required=True,
    )
    parser.add_argument(
        "--agent",
        choices=("codex", "claude", "kimi", "agy", "opencode", "glm", "grok"),
        default="codex",
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    CURRENT_AGENT = args.agent
    OUTPUT_PROTOCOL = args.agent
    payload = read_payload()
    actions = {
        "command": lambda: check_command(payload),
        "path": lambda: check_paths(payload),
        "pretool": lambda: pre_tool_use(payload),
        "preinvocation": lambda: pre_invocation(payload),
        "quota": lambda: quota_only(payload),
        "session": lambda: session_start(payload),
        "session-end": lambda: session_end(payload),
        "task-report": lambda: task_report(payload, force=args.force),
        "task-report-send": lambda: task_report_send(),
    }
    actions[args.event]()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
