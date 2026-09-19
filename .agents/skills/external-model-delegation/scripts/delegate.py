#!/usr/bin/env python3
"""Consent-bound, provider-neutral advisory delegation through AGY."""

from __future__ import annotations

import argparse
import contextlib
import ctypes
import dataclasses
import datetime as dt
import fnmatch
import hashlib
import json
import math
import os
import queue
import re
import signal
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO, Iterator, NoReturn

if os.name == "nt":
    from ctypes import wintypes
    import msvcrt


SKILL_DIR = Path(__file__).resolve().parents[1]
POLICY_PATH = SKILL_DIR / "policy.json"
CONSENT_RE = re.compile(r"^[0-9a-f]{64}$")
REQUIRED_CAPABILITIES = (
    "--print",
    "--input-format",
    "--output-format",
    "--json-schema",
    "--sandbox",
    "--mode",
    "--model",
    "--effort",
    "--disable-slash-commands",
    "--print-timeout",
)
FORBIDDEN_AGY_FLAGS = (
    "--add-dir",
    "--dangerously-skip-permissions",
    "--continue",
    "--conversation",
    "--project",
)
SAFE_ENVIRONMENT_NAMES = {
    "APPDATA",
    "COMSPEC",
    "HOME",
    "LANG",
    "LC_ALL",
    "LOCALAPPDATA",
    "LOGNAME",
    "PATH",
    "PATHEXT",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USER",
    "USERPROFILE",
    "WINDIR",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
}
SAFE_AGY_ENVIRONMENT_NAMES = {
    "AGY_CONFIG_DIR",
    "AGY_DATA_DIR",
    "AGY_HOME",
    "AGY_LOG_LEVEL",
}


class DelegationError(RuntimeError):
    """A safe, categorized error suitable for stderr."""

    def __init__(self, category: str, message: str, *, transfer_started: bool = False):
        super().__init__(message)
        self.category = category
        self.transfer_started = transfer_started


@dataclasses.dataclass(frozen=True)
class InputItem:
    name: str
    kind: str
    data: bytes
    evidence_path: str | None = None

    def manifest(self) -> dict[str, Any]:
        return {
            "path": self.name,
            "kind": self.kind,
            "byte_count": len(self.data),
            "sha256": hashlib.sha256(self.data).hexdigest(),
        }


@dataclasses.dataclass(frozen=True)
class Prepared:
    preview: dict[str, Any]
    prompt: bytes
    evidence_paths: frozenset[str]
    executable: Path
    timeout: int
    max_output_bytes: int
    max_stderr_bytes: int
    audit_path: Path
    audit_enabled: bool
    repo: Path | None


@dataclasses.dataclass(frozen=True)
class ProcessResult:
    returncode: int
    stdout: bytes
    stderr: bytes
    duration_ms: int


if os.name == "nt":
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9
    JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION_CLASS = 1

    class JobObjectBasicLimitInformation(ctypes.Structure):
        _fields_ = [
            ("per_process_user_time_limit", ctypes.c_longlong),
            ("per_job_user_time_limit", ctypes.c_longlong),
            ("limit_flags", wintypes.DWORD),
            ("minimum_working_set_size", ctypes.c_size_t),
            ("maximum_working_set_size", ctypes.c_size_t),
            ("active_process_limit", wintypes.DWORD),
            ("affinity", ctypes.c_size_t),
            ("priority_class", wintypes.DWORD),
            ("scheduling_class", wintypes.DWORD),
        ]

    class IoCounters(ctypes.Structure):
        _fields_ = [
            ("read_operation_count", ctypes.c_ulonglong),
            ("write_operation_count", ctypes.c_ulonglong),
            ("other_operation_count", ctypes.c_ulonglong),
            ("read_transfer_count", ctypes.c_ulonglong),
            ("write_transfer_count", ctypes.c_ulonglong),
            ("other_transfer_count", ctypes.c_ulonglong),
        ]

    class JobObjectExtendedLimitInformation(ctypes.Structure):
        _fields_ = [
            ("basic_limit_information", JobObjectBasicLimitInformation),
            ("io_info", IoCounters),
            ("process_memory_limit", ctypes.c_size_t),
            ("job_memory_limit", ctypes.c_size_t),
            ("peak_process_memory_used", ctypes.c_size_t),
            ("peak_job_memory_used", ctypes.c_size_t),
        ]

    class JobObjectBasicAccountingInformation(ctypes.Structure):
        _fields_ = [
            ("total_user_time", ctypes.c_longlong),
            ("total_kernel_time", ctypes.c_longlong),
            ("this_period_total_user_time", ctypes.c_longlong),
            ("this_period_total_kernel_time", ctypes.c_longlong),
            ("total_page_fault_count", wintypes.DWORD),
            ("total_processes", wintypes.DWORD),
            ("active_processes", wintypes.DWORD),
            ("total_terminated_processes", wintypes.DWORD),
        ]

    class ByHandleFileInformation(ctypes.Structure):
        _fields_ = [
            ("file_attributes", wintypes.DWORD),
            ("creation_time", wintypes.FILETIME),
            ("last_access_time", wintypes.FILETIME),
            ("last_write_time", wintypes.FILETIME),
            ("volume_serial_number", wintypes.DWORD),
            ("file_size_high", wintypes.DWORD),
            ("file_size_low", wintypes.DWORD),
            ("number_of_links", wintypes.DWORD),
            ("file_index_high", wintypes.DWORD),
            ("file_index_low", wintypes.DWORD),
        ]


class ProcessTreeBoundary:
    def __init__(self, process: subprocess.Popen[bytes]):
        self.process_group = process.pid
        self.job_handle: int | None = None
        if os.name == "nt":
            self.job_handle = self._create_windows_job(process)

    @staticmethod
    def _create_windows_job(process: subprocess.Popen[bytes]) -> int:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateJobObjectW.restype = wintypes.HANDLE
        kernel32.SetInformationJobObject.argtypes = (
            wintypes.HANDLE,
            ctypes.c_int,
            ctypes.c_void_p,
            wintypes.DWORD,
        )
        kernel32.AssignProcessToJobObject.argtypes = (wintypes.HANDLE, wintypes.HANDLE)
        kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
        handle = kernel32.CreateJobObjectW(None, None)
        if not handle:
            fail("process-boundary", "cannot create a Windows Job Object")
        information = JobObjectExtendedLimitInformation()
        information.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not kernel32.SetInformationJobObject(
            handle,
            JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
            ctypes.byref(information),
            ctypes.sizeof(information),
        ):
            kernel32.CloseHandle(handle)
            fail("process-boundary", "cannot configure the Windows Job Object")
        if not kernel32.AssignProcessToJobObject(handle, int(process._handle)):
            kernel32.CloseHandle(handle)
            with contextlib.suppress(OSError):
                process.kill()
            fail("process-boundary", "cannot assign AGY to the Windows Job Object")
        return int(handle)

    def terminate_and_verify(
        self,
        process: subprocess.Popen[bytes],
        timeout: float = 5.0,
    ) -> None:
        if os.name == "nt":
            self._terminate_windows_job(process, timeout)
            return
        with contextlib.suppress(ProcessLookupError):
            os.killpg(self.process_group, signal.SIGKILL)
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            fail("process-boundary", "root process remained active after group termination")
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                os.killpg(self.process_group, 0)
            except ProcessLookupError:
                return
            except PermissionError:
                fail("process-boundary", "cannot verify POSIX process-group teardown")
            time.sleep(0.02)
        fail("process-boundary", "POSIX process group remained active after termination")

    def resume(self, process: subprocess.Popen[bytes]) -> None:
        if os.name != "nt":
            return
        ntdll = ctypes.WinDLL("ntdll", use_last_error=True)
        ntdll.NtResumeProcess.argtypes = (wintypes.HANDLE,)
        ntdll.NtResumeProcess.restype = ctypes.c_long
        if ntdll.NtResumeProcess(wintypes.HANDLE(int(process._handle))) != 0:
            self.terminate_and_verify(process)
            fail("process-boundary", "cannot resume AGY inside the Windows Job Object")

    def _terminate_windows_job(
        self,
        process: subprocess.Popen[bytes],
        timeout: float,
    ) -> None:
        assert self.job_handle is not None
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        handle = wintypes.HANDLE(self.job_handle)
        kernel32.TerminateJobObject.argtypes = (wintypes.HANDLE, wintypes.UINT)
        kernel32.QueryInformationJobObject.argtypes = (
            wintypes.HANDLE,
            ctypes.c_int,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.c_void_p,
        )
        if not kernel32.TerminateJobObject(handle, 1):
            fail("process-boundary", "Windows Job Object termination failed")
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            fail("process-boundary", "root process remained active after Job Object termination")
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            accounting = JobObjectBasicAccountingInformation()
            if not kernel32.QueryInformationJobObject(
                handle,
                JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION_CLASS,
                ctypes.byref(accounting),
                ctypes.sizeof(accounting),
                None,
            ):
                fail("process-boundary", "cannot verify Windows Job Object teardown")
            if accounting.active_processes == 0:
                return
            time.sleep(0.02)
        fail("process-boundary", "Windows Job Object remained active after termination")

    def close(self) -> None:
        if self.job_handle is None:
            return
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
        handle = self.job_handle
        self.job_handle = None
        if not kernel32.CloseHandle(wintypes.HANDLE(handle)):
            fail("process-boundary", "cannot close the Windows Job Object")


def fail(category: str, message: str, *, transfer_started: bool = False) -> NoReturn:
    raise DelegationError(category, message, transfer_started=transfer_started)


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def load_policy() -> dict[str, Any]:
    try:
        policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        fail("policy", f"cannot load policy: {exc.__class__.__name__}")
    required = {
        "schema_version",
        "adapter",
        "roles",
        "limits",
        "sensitive_path_globs",
        "audit",
        "result_schema_version",
    }
    if not isinstance(policy, dict) or set(policy) != required:
        fail("policy", "policy root has missing or unexpected fields")
    if policy["schema_version"] != 1 or policy["result_schema_version"] != 1:
        fail("policy", "unsupported policy or result schema version")
    adapter = policy["adapter"]
    if not isinstance(adapter, dict) or set(adapter) != {
        "name",
        "provider",
        "default_executable",
    } or not all(isinstance(value, str) and value for value in adapter.values()):
        fail("policy", "policy adapter has invalid structure")
    roles = policy["roles"]
    if not isinstance(roles, dict) or not roles:
        fail("policy", "policy roles must be a non-empty object")
    for name, role in roles.items():
        if not isinstance(name, str) or not isinstance(role, dict) or set(role) != {
            "risk",
            "model",
            "effort",
            "input_mode",
            "contract",
        }:
            fail("policy", "policy role has invalid structure")
        if role["risk"] not in {"green", "yellow"}:
            fail("policy", "policy cannot define an external red role")
        if role["effort"] not in {"low", "medium", "high"}:
            fail("policy", "policy role effort is invalid")
        if role["input_mode"] not in {
            "tracked-list",
            "supplied-file",
            "git-diff",
            "repository-files",
        }:
            fail("policy", "policy role input mode is invalid")
        if not isinstance(role["model"], str) or not role["model"]:
            fail("policy", "policy role model is invalid")
        if not isinstance(role["contract"], str) or not role["contract"]:
            fail("policy", "policy role contract is invalid")
    limits = policy["limits"]
    expected_limits = {
        "max_files",
        "max_file_bytes",
        "max_input_bytes",
        "max_output_bytes",
        "max_stderr_bytes",
        "max_timeout_seconds",
        "max_task_bytes",
        "max_array_items",
        "max_text_bytes",
    }
    if not isinstance(limits, dict) or set(limits) != expected_limits:
        fail("policy", "policy limits have missing or unexpected fields")
    if any(type(value) is not int or value <= 0 for value in limits.values()):
        fail("policy", "policy limits must be positive integers")
    patterns = policy["sensitive_path_globs"]
    if not isinstance(patterns, list) or not patterns or not all(
        isinstance(value, str) and value for value in patterns
    ):
        fail("policy", "sensitive path patterns are invalid")
    audit = policy["audit"]
    if not isinstance(audit, dict) or set(audit) != {
        "enabled_by_default",
        "directory_name",
        "file_name",
    }:
        fail("policy", "policy audit settings have invalid structure")
    if audit["enabled_by_default"] is not True or not all(
        isinstance(audit[key], str) and audit[key]
        for key in ("directory_name", "file_name")
    ):
        fail("policy", "audit must be enabled by default with valid destinations")
    return policy


def safe_environment() -> dict[str, str]:
    allowed = SAFE_ENVIRONMENT_NAMES | SAFE_AGY_ENVIRONMENT_NAMES
    return {key: value for key, value in os.environ.items() if key.upper() in allowed}


def command_prefix(executable: Path) -> list[str]:
    return [str(executable)]


def resolve_executable(value: str) -> Path:
    if any(char in value for char in ("\0", "\r", "\n")):
        fail("adapter", "AGY executable contains invalid characters")
    candidate: str | None
    supplied = Path(value).expanduser()
    if supplied.is_absolute() or supplied.parent != Path("."):
        candidate = str(supplied)
    else:
        candidate = shutil.which(value)
    if not candidate:
        fail("adapter", "requested AGY executable was not found")
    path = Path(candidate).resolve(strict=False)
    try:
        mode = path.lstat().st_mode
    except OSError:
        fail("adapter", "requested AGY executable is unavailable")
    if stat.S_ISLNK(mode) or not stat.S_ISREG(mode):
        fail("adapter", "requested AGY executable must be a regular non-symlink file")
    if os.name == "nt" and path.suffix.casefold() != ".exe":
        fail("adapter", "Windows AGY executable must be a native .exe file")
    if os.name != "nt" and not os.access(path, os.X_OK):
        fail("adapter", "requested AGY executable is not executable")
    return path


def _read_pipe(
    name: str,
    pipe: BinaryIO,
    events: queue.Queue[tuple[str, bytes | BaseException | None]],
) -> None:
    try:
        while True:
            chunk = pipe.read(8192)
            if not chunk:
                break
            events.put((name, chunk))
    except BaseException as exc:  # surfaced to the controlling thread
        events.put((name, exc))
    finally:
        events.put((name, None))


def _write_pipe(
    pipe: BinaryIO,
    data: bytes,
    events: queue.Queue[tuple[str, bytes | BaseException | None]],
) -> None:
    try:
        if data:
            pipe.write(data)
            pipe.flush()
    except (BrokenPipeError, OSError) as exc:
        events.put(("stdin-error", exc))
    finally:
        with contextlib.suppress(OSError):
            pipe.close()
        events.put(("stdin", None))


def run_bounded(
    command: list[str],
    *,
    cwd: Path,
    stdin: bytes,
    timeout: int,
    stdout_limit: int,
    stderr_limit: int,
    environment: dict[str, str],
    transfer_started: bool,
) -> ProcessResult:
    started = time.monotonic()
    popen_options: dict[str, Any] = {}
    if os.name == "nt":
        popen_options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | 0x00000004
    else:
        popen_options["start_new_session"] = True
    try:
        process = subprocess.Popen(
            command,
            cwd=str(cwd),
            env=environment,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            **popen_options,
        )
    except OSError as exc:
        fail("adapter", f"cannot start AGY process: {exc.__class__.__name__}", transfer_started=transfer_started)
    assert process.stdin is not None and process.stdout is not None and process.stderr is not None
    boundary: ProcessTreeBoundary | None = None
    try:
        boundary = ProcessTreeBoundary(process)
        boundary.resume(process)
    except DelegationError:
        if boundary is not None:
            with contextlib.suppress(DelegationError):
                boundary.close()
        with contextlib.suppress(OSError):
            process.kill()
        with contextlib.suppress(subprocess.TimeoutExpired):
            process.wait(timeout=2)
        process.stdin.close()
        process.stdout.close()
        process.stderr.close()
        raise
    assert boundary is not None
    events: queue.Queue[tuple[str, bytes | BaseException | None]] = queue.Queue(maxsize=8)
    threads = [
        threading.Thread(target=_read_pipe, args=("stdout", process.stdout, events), daemon=True),
        threading.Thread(target=_read_pipe, args=("stderr", process.stderr, events), daemon=True),
        threading.Thread(target=_write_pipe, args=(process.stdin, stdin, events), daemon=True),
    ]
    for thread in threads:
        thread.start()
    output = {"stdout": bytearray(), "stderr": bytearray()}
    closed: set[str] = set()
    deadline = started + timeout
    error: DelegationError | None = None
    while not {"stdout", "stderr", "stdin"}.issubset(closed):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            error = DelegationError("timeout", "AGY process exceeded the approved timeout", transfer_started=transfer_started)
            break
        try:
            name, payload = events.get(timeout=min(remaining, 0.1))
        except queue.Empty:
            continue
        if payload is None:
            closed.add(name)
            continue
        if isinstance(payload, BaseException):
            if name != "stdin-error":
                error = DelegationError("process", f"failed while reading AGY {name}", transfer_started=transfer_started)
                break
            continue
        assert name in output
        output[name].extend(payload)
        limit = stdout_limit if name == "stdout" else stderr_limit
        if len(output[name]) > limit:
            error = DelegationError(
                "output-limit",
                f"AGY {name} exceeded the approved byte limit",
                transfer_started=transfer_started,
            )
            break
    teardown_error: DelegationError | None = None
    if error is None:
        try:
            returncode = process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            error = DelegationError(
                "timeout",
                "AGY process did not exit after closing its streams",
                transfer_started=transfer_started,
            )
            returncode = process.returncode or -1
    else:
        returncode = process.returncode or -1
    try:
        boundary.terminate_and_verify(process)
        returncode = process.returncode if process.returncode is not None else returncode
    except DelegationError as exc:
        teardown_error = DelegationError(
            "process-boundary",
            str(exc),
            transfer_started=transfer_started,
        )
    try:
        boundary.close()
    except DelegationError as exc:
        teardown_error = DelegationError(
            "process-boundary",
            str(exc),
            transfer_started=transfer_started,
        )
    duration_ms = int((time.monotonic() - started) * 1000)
    if error is not None or teardown_error is not None:
        drain_deadline = time.monotonic() + 2
        while any(thread.is_alive() for thread in threads) and time.monotonic() < drain_deadline:
            with contextlib.suppress(queue.Empty):
                events.get(timeout=0.05)
    for thread in threads:
        thread.join(timeout=1)
    process.stdout.close()
    process.stderr.close()
    if teardown_error is not None:
        raise teardown_error
    if error is not None:
        raise error
    return ProcessResult(
        returncode=returncode,
        stdout=bytes(output["stdout"]),
        stderr=bytes(output["stderr"]),
        duration_ms=duration_ms,
    )
def probe_executable(executable: Path) -> str:
    result = run_bounded(
        [*command_prefix(executable), "--help"],
        cwd=Path(tempfile.gettempdir()).resolve(),
        stdin=b"",
        timeout=10,
        stdout_limit=65536,
        stderr_limit=16384,
        environment=safe_environment(),
        transfer_started=False,
    )
    if result.returncode != 0:
        fail("capability", "AGY capability check failed")
    try:
        help_text = (result.stdout + result.stderr).decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        fail("capability", "AGY help is not valid UTF-8")
    missing = [flag for flag in REQUIRED_CAPABILITIES if flag not in help_text]
    if missing:
        fail("capability", f"AGY is missing required capability: {missing[0]}")
    return help_text


def executable_version(executable: Path) -> str:
    result = run_bounded(
        [*command_prefix(executable), "--version"],
        cwd=Path(tempfile.gettempdir()).resolve(),
        stdin=b"",
        timeout=10,
        stdout_limit=4096,
        stderr_limit=4096,
        environment=safe_environment(),
        transfer_started=False,
    )
    if result.returncode != 0:
        fail("capability", "AGY version check failed")
    try:
        version = result.stdout.decode("utf-8", errors="strict").strip()
    except UnicodeDecodeError:
        fail("capability", "AGY version output is not valid UTF-8")
    if not version or len(version.encode("utf-8")) > 256:
        fail("capability", "AGY version output is invalid")
    return version


def run_git(repo: Path, *args: str) -> bytes:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=str(repo),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        fail("git", f"Git command could not run: {exc.__class__.__name__}")
    if result.returncode != 0:
        fail("git", f"Git command failed: git {args[0]}")
    return result.stdout


def resolve_repo(value: str) -> Path:
    path = Path(value).expanduser().resolve(strict=False)
    if not path.is_dir():
        fail("path", "repository root is not a directory")
    output = run_git(path, "rev-parse", "--show-toplevel")
    try:
        root = Path(output.decode("utf-8", errors="strict").strip()).resolve(strict=True)
    except (UnicodeError, OSError):
        fail("git", "Git returned an invalid repository root")
    return root


def discover_repo(value: str) -> Path | None:
    path = Path(value).expanduser().resolve(strict=False)
    if not path.is_dir():
        return None
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=str(path),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    try:
        root = Path(result.stdout.decode("utf-8", errors="strict").strip()).resolve(strict=True)
    except (UnicodeError, OSError):
        return None
    return root if root.is_dir() else None


def contains_git_marker(path: Path) -> bool:
    return any((candidate / ".git").exists() for candidate in (path, *path.parents))


def decode_utf8(data: bytes, label: str) -> str:
    if b"\0" in data:
        fail("input", f"{label} contains a NUL byte")
    try:
        return data.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        fail("input", f"{label} is not valid UTF-8")


def decode_git_paths(data: bytes, label: str) -> str:
    try:
        return data.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        fail("git", f"{label} is not valid UTF-8")


def normalize_repo_path(value: str) -> str:
    if not value or "\0" in value or "\r" in value or "\n" in value:
        fail("path", "repository path is empty or malformed")
    value = value.replace("\\", "/")
    pure = PurePosixPath(value)
    if pure.is_absolute() or ".." in pure.parts or "." in pure.parts:
        fail("path", "repository path must be normalized and relative")
    normalized = pure.as_posix()
    if normalized in {"", "."} or normalized != value:
        fail("path", "repository path must be normalized and relative")
    return normalized


def is_sensitive_path(path: str, policy: dict[str, Any]) -> bool:
    candidate = path.replace("\\", "/").casefold().lstrip("/")
    patterns = [value.casefold() for value in policy["sensitive_path_globs"]]
    return any(
        fnmatch.fnmatchcase(candidate, pattern)
        or PurePosixPath(candidate).match(pattern)
        for pattern in patterns
    )


def ensure_not_sensitive(path: str, policy: dict[str, Any]) -> None:
    if is_sensitive_path(path, policy):
        fail("path", "selected path is denied by the sensitive-path policy")


def stat_signature(value: os.stat_result) -> tuple[int, int, int, int, int]:
    return (
        value.st_dev,
        value.st_ino,
        value.st_mode,
        value.st_size,
        value.st_mtime_ns,
    )


def open_posix_no_follow(path: Path, allowed_root: Path | None) -> tuple[int, int, str]:
    if allowed_root is not None:
        try:
            parts = path.relative_to(allowed_root).parts
        except ValueError:
            fail("path", "selected path escapes its allowed root")
        starting_path = allowed_root
    else:
        if not path.is_absolute():
            fail("path", "supplied path must be absolute")
        parts = path.parts[1:]
        starting_path = Path(path.anchor)
    if not parts:
        fail("path", "selected path must name a file")
    directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    file_flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    directory_fd = os.open(starting_path, directory_flags)
    try:
        for part in parts[:-1]:
            next_fd = os.open(part, directory_flags, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = next_fd
        file_fd = os.open(parts[-1], file_flags, dir_fd=directory_fd)
        return file_fd, directory_fd, parts[-1]
    except Exception:
        os.close(directory_fd)
        raise


def canonical_windows_handle_path(handle: int) -> Path:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetFinalPathNameByHandleW.argtypes = (
        wintypes.HANDLE,
        wintypes.LPWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
    )
    needed = kernel32.GetFinalPathNameByHandleW(wintypes.HANDLE(handle), None, 0, 0)
    if not needed:
        fail("path", "cannot resolve the opened Windows file handle")
    buffer = ctypes.create_unicode_buffer(needed + 1)
    if not kernel32.GetFinalPathNameByHandleW(
        wintypes.HANDLE(handle), buffer, len(buffer), 0
    ):
        fail("path", "cannot resolve the opened Windows file handle")
    value = buffer.value
    if value.startswith("\\\\?\\UNC\\"):
        value = "\\\\" + value[8:]
    elif value.startswith("\\\\?\\"):
        value = value[4:]
    return Path(value).resolve(strict=False)


def open_windows_no_follow(path: Path, allowed_root: Path | None) -> int:
    generic_read = 0x80000000
    file_share_read = 0x00000001
    open_existing = 3
    file_flag_open_reparse_point = 0x00200000
    file_flag_sequential_scan = 0x08000000
    file_attribute_directory = 0x00000010
    file_attribute_reparse_point = 0x00000400
    invalid_handle_value = ctypes.c_void_p(-1).value
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateFileW.argtypes = (
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.c_void_p,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    )
    kernel32.CreateFileW.restype = wintypes.HANDLE
    kernel32.GetFileInformationByHandle.argtypes = (
        wintypes.HANDLE,
        ctypes.POINTER(ByHandleFileInformation),
    )
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    handle = kernel32.CreateFileW(
        str(path),
        generic_read,
        file_share_read,
        None,
        open_existing,
        file_flag_open_reparse_point | file_flag_sequential_scan,
        None,
    )
    if not handle or int(handle) == invalid_handle_value:
        fail("path", "selected file cannot be opened without following reparse points")
    try:
        information = ByHandleFileInformation()
        if not kernel32.GetFileInformationByHandle(handle, ctypes.byref(information)):
            fail("path", "cannot inspect the opened Windows file handle")
        if information.file_attributes & (file_attribute_directory | file_attribute_reparse_point):
            fail("path", "selected path must be a regular non-reparse file")
        opened_path = canonical_windows_handle_path(int(handle))
        if allowed_root is not None:
            try:
                opened_path.relative_to(allowed_root)
            except ValueError:
                fail("path", "opened file escapes its allowed root")
        descriptor = msvcrt.open_osfhandle(
            int(handle),
            os.O_RDONLY | getattr(os, "O_BINARY", 0),
        )
        handle = None
        return descriptor
    finally:
        if handle is not None:
            kernel32.CloseHandle(wintypes.HANDLE(handle))


def read_regular_stable(
    path: Path,
    limit: int,
    label: str,
    allowed_root: Path | None = None,
) -> bytes:
    descriptor: int
    directory_fd: int | None = None
    final_name: str | None = None
    try:
        if os.name == "nt":
            descriptor = open_windows_no_follow(path, allowed_root)
        else:
            descriptor, directory_fd, final_name = open_posix_no_follow(path, allowed_root)
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            fail("path", f"{label} must be a regular non-symlink file")
        if before.st_size > limit:
            fail("input-limit", f"{label} exceeds the per-file byte limit")
        chunks: list[bytes] = []
        total = 0
        while total <= limit:
            chunk = os.read(descriptor, min(65536, limit + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
        after = os.fstat(descriptor)
        if stat_signature(before) != stat_signature(after):
            fail("input", f"{label} changed during preparation")
        if directory_fd is not None and final_name is not None:
            current = os.stat(final_name, dir_fd=directory_fd, follow_symlinks=False)
            if stat_signature(after) != stat_signature(current):
                fail("input", f"{label} was replaced during preparation")
        data = b"".join(chunks)
    except DelegationError:
        raise
    except OSError as exc:
        fail("input", f"{label} cannot be read safely: {exc.__class__.__name__}")
    finally:
        if "descriptor" in locals():
            with contextlib.suppress(OSError):
                os.close(descriptor)
        if directory_fd is not None:
            with contextlib.suppress(OSError):
                os.close(directory_fd)
    if len(data) > limit:
        fail("input-limit", f"{label} exceeds the per-file byte limit")
    decode_utf8(data, label)
    return data


def tracked_paths(repo: Path) -> list[str]:
    raw = run_git(repo, "ls-files", "-z")
    text = decode_git_paths(raw, "Git tracked-path output")
    result = [normalize_repo_path(value) for value in text.split("\0") if value]
    if len(result) != len(set(os.path.normcase(value) for value in result)):
        fail("path", "Git returned duplicate tracked paths")
    return result


def validate_repo_file(
    repo: Path,
    value: str,
    policy: dict[str, Any],
    per_file_limit: int,
) -> InputItem:
    relative = normalize_repo_path(value)
    ensure_not_sensitive(relative, policy)
    tracked = decode_utf8(
        run_git(repo, "ls-files", "--error-unmatch", "--", f":(literal){relative}"),
        "Git tracking output",
    ).splitlines()
    if relative not in tracked:
        fail("path", "selected repository path is not Git-tracked")
    target = repo.joinpath(*PurePosixPath(relative).parts)
    data = read_regular_stable(target, per_file_limit, relative, repo)
    return InputItem(relative, "repository-file", data, relative)


def validate_supplied_file(
    value: str,
    policy: dict[str, Any],
    per_file_limit: int,
) -> InputItem:
    path = Path(value).expanduser()
    if not path.is_absolute():
        fail("path", "supplied input file must be an exact absolute path")
    try:
        lexical = path.absolute()
        resolved = path.resolve(strict=True)
    except OSError:
        fail("path", "supplied input file is unavailable")
    if lexical != resolved:
        fail("path", "supplied input file must not traverse aliases or symlinks")
    ensure_not_sensitive(resolved.as_posix(), policy)
    actual_repo = discover_repo(str(resolved.parent))
    if actual_repo is None and contains_git_marker(resolved.parent):
        fail("git", "cannot verify supplied-file eligibility in its Git worktree")
    if actual_repo is not None:
        try:
            relative = resolved.relative_to(actual_repo).as_posix()
        except ValueError:
            pass
        else:
            return validate_repo_file(actual_repo, relative, policy, per_file_limit)
    data = read_regular_stable(resolved, per_file_limit, "supplied input file")
    return InputItem(str(resolved), "supplied-file", data)


def validate_unique(items: list[InputItem], max_files: int) -> None:
    if len(items) > max_files:
        fail("input-limit", "selected input exceeds the file-count limit")
    keys = [os.path.normcase(item.name) for item in items]
    if len(keys) != len(set(keys)):
        fail("path", "duplicate input paths are not allowed")


def collect_diff(
    repo: Path,
    base: str,
    requested: list[str],
    policy: dict[str, Any],
    per_file_limit: int,
) -> tuple[list[InputItem], str]:
    if not base or any(char in base for char in ("\0", "\r", "\n")):
        fail("git", "Git base is malformed")
    resolved_base = decode_utf8(
        run_git(repo, "rev-parse", "--verify", "--end-of-options", f"{base}^{{commit}}"),
        "Git base output",
    ).strip()
    if not re.fullmatch(r"[0-9a-fA-F]{40,64}", resolved_base):
        fail("git", "Git base did not resolve to one commit")
    filters: list[str] = []
    seen: set[str] = set()
    for value in requested:
        relative = normalize_repo_path(value)
        key = os.path.normcase(relative)
        if key in seen:
            fail("path", "duplicate input paths are not allowed")
        seen.add(key)
        ensure_not_sensitive(relative, policy)
        decode_utf8(
            run_git(repo, "ls-files", "--error-unmatch", "--", f":(literal){relative}"),
            "Git tracking output",
        )
        filters.append(relative)
    command = ["diff", "--name-only", "-z", "--no-ext-diff", resolved_base]
    if filters:
        command.extend(["--", *(f":(literal){value}" for value in filters)])
    changed_raw = run_git(repo, *command)
    changed = [
        normalize_repo_path(value)
        for value in decode_git_paths(changed_raw, "Git diff path output").split("\0")
        if value
    ]
    items: list[InputItem] = []
    for relative in changed:
        ensure_not_sensitive(relative, policy)
        diff = run_git(
            repo,
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--binary",
            resolved_base,
            "--",
            f":(literal){relative}",
        )
        if len(diff) > per_file_limit:
            fail("input-limit", "one file's Git diff exceeds the per-file byte limit")
        decode_utf8(diff, f"Git diff for {relative}")
        items.append(InputItem(relative, "git-diff", diff, relative))
    return items, resolved_base


def result_schema(version: int) -> dict[str, Any]:
    string = {"type": "string"}
    string_array = {"type": "array", "items": string}
    evidence_array = {
        "type": "array",
        "items": {
            "type": "object",
            "additionalProperties": False,
            "required": ["file_index", "symbol", "line_range", "detail"],
            "properties": {
                "file_index": {"type": ["integer", "null"]},
                "symbol": string,
                "line_range": string,
                "detail": string,
            },
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "schema_version",
            "status",
            "summary",
            "confidence",
            "files",
            "facts",
            "findings",
            "tests",
            "risks",
            "next_actions",
            "proposed_changes",
        ],
        "properties": {
            "schema_version": {"type": "integer", "const": version},
            "status": {"type": "string", "enum": ["ok", "needs-main", "blocked"]},
            "summary": string,
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            "files": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["path", "symbols", "line_ranges", "relevance", "verified"],
                    "properties": {
                        "path": string,
                        "symbols": string_array,
                        "line_ranges": string_array,
                        "relevance": string,
                        "verified": {"type": "boolean"},
                    },
                },
            },
            "facts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["claim", "evidence"],
                    "properties": {"claim": string, "evidence": evidence_array},
                },
            },
            "findings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["severity", "title", "details", "evidence", "suggested_action"],
                    "properties": {
                        "severity": {
                            "type": "string",
                            "enum": ["critical", "high", "medium", "low", "info"],
                        },
                        "title": string,
                        "details": string,
                        "evidence": evidence_array,
                        "suggested_action": string,
                    },
                },
            },
            "tests": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["command", "result", "notes"],
                    "properties": {"command": string, "result": string, "notes": string},
                },
            },
            "risks": string_array,
            "next_actions": string_array,
            "proposed_changes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["path", "change_type", "rationale", "patch"],
                    "properties": {
                        "path": string,
                        "change_type": {
                            "type": "string",
                            "enum": ["add", "modify", "delete", "none"],
                        },
                        "rationale": string,
                        "patch": string,
                    },
                },
            },
        },
    }


def build_prompt(
    role: str,
    role_policy: dict[str, Any],
    task: str,
    items: list[InputItem],
    base: str | None,
    schema: dict[str, Any],
) -> bytes:
    context = []
    for item in items:
        context.append(
            f"===== {item.kind}: {item.name} =====\n{decode_utf8(item.data, item.name)}"
        )
    ownership = (
        "You are a bounded advisory delegate. Main owns repository edits, commands, "
        "verification, canonical review, handoff, decisions, and acceptance. Return only "
        "one JSON packet matching the supplied schema. Do not use tools or request more data."
    )
    boundaries = (
        "Architecture, ambiguous semantics, concurrency, transactions, authorization, "
        "security boundaries, migrations, public compatibility, difficult root-cause "
        "decisions, final review, and final acceptance require status needs-main. "
        "Only test-proposal and change-proposal may return proposed_changes. Evidence about "
        "a path outside the supplied material must set verified=false. Put every file citation "
        "in a structured evidence reference to files[]; never embed path citations only in prose."
    )
    pieces = [
        ownership,
        boundaries,
        f"ROLE: {role}",
        f"ROLE CONTRACT: {role_policy['contract']}",
        f"TASK:\n{task}",
    ]
    if base is not None:
        pieces.append(f"VALIDATED BASE COMMIT: {base}")
    if context:
        pieces.append("SUPPLIED MATERIAL:\n" + "\n\n".join(context))
    pieces.append("RESULT SCHEMA:\n" + canonical_json(schema).decode("utf-8"))
    message = "\n\n".join(pieces)
    frame = {
        "type": "user",
        "event": "user",
        "message": {
            "role": "user",
            "content": [{"type": "text", "text": message}],
        },
    }
    return canonical_json(frame) + b"\n"


def default_cache_directory(policy: dict[str, Any]) -> Path:
    if os.name == "nt" and os.environ.get("LOCALAPPDATA"):
        base = Path(os.environ["LOCALAPPDATA"])
    elif os.environ.get("XDG_CACHE_HOME"):
        base = Path(os.environ["XDG_CACHE_HOME"])
    else:
        base = Path.home() / ".cache"
    return (base / policy["audit"]["directory_name"]).expanduser().resolve(strict=False)


def prepare(args: argparse.Namespace, policy: dict[str, Any]) -> Prepared:
    role_policy = policy["roles"].get(args.role)
    if role_policy is None:
        fail("policy", "requested role is not defined by policy")
    limits = policy["limits"]

    def bounded_override(value: int | None, name: str) -> int:
        maximum = limits[name]
        selected = maximum if value is None else value
        if type(selected) is not int or selected <= 0 or selected > maximum:
            fail("policy", f"{name} override must be between 1 and the policy maximum")
        return selected

    max_files = bounded_override(args.max_files, "max_files")
    max_file_bytes = bounded_override(args.max_file_bytes, "max_file_bytes")
    max_input_bytes = bounded_override(args.max_input_bytes, "max_input_bytes")
    max_output_bytes = bounded_override(args.max_output_bytes, "max_output_bytes")
    max_stderr_bytes = bounded_override(args.max_stderr_bytes, "max_stderr_bytes")
    timeout = bounded_override(args.timeout, "max_timeout_seconds")
    model = args.model or role_policy["model"]
    effort = args.effort or role_policy["effort"]
    if not isinstance(model, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}", model):
        fail("policy", "model must be a safe explicit model identifier")
    mode = role_policy["input_mode"]
    needs_repo = mode in {"tracked-list", "repository-files", "git-diff"}
    repo = resolve_repo(args.repo) if needs_repo else discover_repo(args.repo)

    if bool(args.task) == bool(args.task_file):
        fail("input", "provide exactly one of --task or --task-file")
    task_item: InputItem | None = None
    if args.task_file:
        selected_task = validate_supplied_file(
            args.task_file,
            policy,
            limits["max_task_bytes"],
        )
        task_item = InputItem(selected_task.name, "task-file", selected_task.data)
        task = decode_utf8(selected_task.data, "task file")
    else:
        task = args.task
    task_bytes = task.encode("utf-8")
    if not task.strip() or b"\0" in task_bytes or len(task_bytes) > limits["max_task_bytes"]:
        fail("input", "task text is empty, malformed, or exceeds the task byte limit")

    executable = resolve_executable(args.agy_executable or policy["adapter"]["default_executable"])
    items: list[InputItem] = []
    base: str | None = None
    if mode == "tracked-list":
        if args.files or args.input_file or args.base:
            fail("input", "scout does not accept file, supplied-file, or Git-base inputs")
        for relative in tracked_paths(repo):
            ensure_not_sensitive(relative, policy)
            data = relative.encode("utf-8")
            if len(data) > max_file_bytes:
                fail("input-limit", "tracked path exceeds the per-file byte limit")
            items.append(InputItem(relative, "tracked-path", data))
    elif mode == "repository-files":
        if not args.files or args.input_file or args.base:
            fail("input", "this role requires --file and rejects supplied-file or Git-base inputs")
        items = [
            validate_repo_file(repo, value, policy, max_file_bytes)
            for value in args.files
        ]
    elif mode == "supplied-file":
        if not args.input_file or args.files or args.base:
            fail("input", "this role requires exactly one --input-file")
        items = [validate_supplied_file(args.input_file, policy, max_file_bytes)]
    elif mode == "git-diff":
        if args.input_file:
            fail("input", "review-prescreen does not accept a supplied input file")
        items, base = collect_diff(
            repo,
            args.base or "HEAD",
            args.files,
            policy,
            max_file_bytes,
        )
    else:
        fail("policy", "role input mode is unsupported")
    if task_item is not None:
        items.insert(0, task_item)
    validate_unique(items, max_files)
    schema = result_schema(policy["result_schema_version"])
    prompt = build_prompt(args.role, role_policy, task, items, base, schema)
    if len(prompt) > max_input_bytes:
        fail("input-limit", "assembled input exceeds the aggregate byte limit")
    audit_enabled = policy["audit"]["enabled_by_default"] and not args.no_audit
    audit_path = (
        Path(args.audit_path).expanduser().resolve(strict=False)
        if args.audit_path
        else default_cache_directory(policy) / policy["audit"]["file_name"]
    )
    if repo is not None:
        with contextlib.suppress(ValueError):
            audit_path.relative_to(repo)
            fail("audit", "audit destination must be outside the repository")
    manifest = {
        "schema_version": policy["schema_version"],
        "adapter": policy["adapter"]["name"],
        "provider": policy["adapter"]["provider"],
        "executable": str(executable),
        "role": args.role,
        "risk": role_policy["risk"],
        "model": model,
        "effort": effort,
        "base_commit": base,
        "task_sha256": hashlib.sha256(task_bytes).hexdigest(),
        "prompt_sha256": hashlib.sha256(prompt).hexdigest(),
        "policy_sha256": hashlib.sha256(canonical_json(policy)).hexdigest(),
        "result_schema_sha256": hashlib.sha256(canonical_json(schema)).hexdigest(),
        "inputs": [item.manifest() for item in items],
        "total_input_bytes": len(prompt),
        "limits": {
            "max_files": max_files,
            "max_file_bytes": max_file_bytes,
            "max_input_bytes": max_input_bytes,
            "max_output_bytes": max_output_bytes,
            "max_stderr_bytes": max_stderr_bytes,
            "timeout_seconds": timeout,
        },
        "audit": {"enabled": audit_enabled, "path": str(audit_path) if audit_enabled else None},
    }
    consent_id = hashlib.sha256(canonical_json(manifest)).hexdigest()
    preview = {**manifest, "consent_id": consent_id}
    evidence_paths = frozenset(
        item.evidence_path for item in items if item.evidence_path is not None
    )
    return Prepared(
        preview=preview,
        prompt=prompt,
        evidence_paths=evidence_paths,
        executable=executable,
        timeout=timeout,
        max_output_bytes=max_output_bytes,
        max_stderr_bytes=max_stderr_bytes,
        audit_path=audit_path,
        audit_enabled=audit_enabled,
        repo=repo,
    )


def now_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def append_audit(path: Path, event: dict[str, Any]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and (path.is_symlink() or not path.is_file()):
            fail("audit", "audit destination must be a regular non-symlink file")
        with path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(canonical_json(event).decode("utf-8") + "\n")
            handle.flush()
            os.fsync(handle.fileno())
    except DelegationError:
        raise
    except OSError as exc:
        fail("audit", f"cannot write audit event: {exc.__class__.__name__}")


@contextlib.contextmanager
def invocation_lock(prepared: Prepared, policy: dict[str, Any]) -> Iterator[None]:
    root = default_cache_directory(policy)
    identity = str(prepared.repo or "global").encode("utf-8")
    path = root / ("workspace-" + hashlib.sha256(identity).hexdigest()[:24] + ".lock")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        fail("concurrency", "another external invocation is already active for this workspace")
    except OSError as exc:
        fail("concurrency", f"cannot initialize invocation lock: {exc.__class__.__name__}")
    try:
        os.write(descriptor, str(os.getpid()).encode("ascii"))
        yield
    finally:
        os.close(descriptor)
        with contextlib.suppress(OSError):
            path.unlink()


def audit_base(prepared: Prepared, version: str) -> dict[str, Any]:
    preview = prepared.preview
    return {
        "schema_version": 1,
        "timestamp": now_utc(),
        "consent_id": preview["consent_id"],
        "role": preview["role"],
        "adapter": preview["adapter"],
        "executable": preview["executable"],
        "executable_version": version,
        "model": preview["model"],
        "effort": preview["effort"],
        "inputs": preview["inputs"],
        "total_input_bytes": preview["total_input_bytes"],
    }


def extract_result(stdout: bytes) -> tuple[dict[str, Any], dict[str, Any]]:
    text = decode_utf8(stdout, "AGY stdout")
    final: dict[str, Any] | None = None
    usage: dict[str, Any] = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            event = strict_json_loads(line)
        except json.JSONDecodeError:
            fail("schema", "AGY emitted malformed stream JSON", transfer_started=True)
        if not isinstance(event, dict):
            fail("schema", "AGY stream event is not an object", transfer_started=True)
        if event.get("type") != "result" and event.get("event") != "result":
            continue
        if final is not None:
            fail("schema", "AGY emitted more than one final result", transfer_started=True)
        raw_result = event.get("result")
        if isinstance(raw_result, dict) and "structured_output" in raw_result:
            candidate = raw_result["structured_output"]
        elif event.get("structured_output") is not None:
            candidate = event.get("structured_output")
        else:
            candidate = raw_result
            if isinstance(candidate, dict) and "response" in candidate:
                candidate = candidate["response"]
        if isinstance(candidate, str):
            try:
                candidate = strict_json_loads(candidate)
            except json.JSONDecodeError:
                fail("schema", "AGY final result is not valid JSON", transfer_started=True)
        if isinstance(candidate, dict) and "structured_output" in candidate:
            candidate = candidate["structured_output"]
        if not isinstance(candidate, dict):
            fail("schema", "AGY final result is not an object", transfer_started=True)
        final = candidate
        event_usage = event.get("usage") or (raw_result.get("usage") if isinstance(raw_result, dict) else {})
        usage = safe_usage(event_usage or {})
    if final is None:
        fail("schema", "AGY stream omitted the final result", transfer_started=True)
    return final, usage


def strict_json_loads(value: str) -> Any:
    def object_from_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, item in pairs:
            if key in result:
                raise ValueError("duplicate object key")
            result[key] = item
        return result

    try:
        return json.loads(
            value,
            object_pairs_hook=object_from_pairs,
            parse_constant=lambda constant: (_ for _ in ()).throw(
                ValueError(f"non-finite JSON number: {constant}")
            ),
        )
    except (json.JSONDecodeError, ValueError, RecursionError):
        fail("schema", "AGY emitted malformed or duplicate-key JSON", transfer_started=True)


def safe_usage(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    allowed_key = re.compile(r"(?:^|_)(?:id|request|provider|tokens?|cache|cost|usage)(?:_|$)")
    result: dict[str, Any] = {}
    for key, item in value.items():
        if not isinstance(key, str) or not allowed_key.search(key.casefold()):
            continue
        if isinstance(item, str) and "\0" not in item:
            try:
                if len(item.encode("utf-8", errors="strict")) <= 256:
                    result[key] = item
            except UnicodeEncodeError:
                continue
        elif type(item) in {int, float, bool} or item is None:
            result[key] = item
    return result


def _expect_string(value: Any, label: str, max_bytes: int) -> str:
    try:
        encoded = value.encode("utf-8", errors="strict") if isinstance(value, str) else b""
    except UnicodeEncodeError:
        encoded = b""
        value = None
    if not isinstance(value, str) or "\0" in value or len(encoded) > max_bytes:
        fail("schema", f"result field {label} must be a bounded string", transfer_started=True)
    return value


def _expect_array(value: Any, label: str, max_items: int) -> list[Any]:
    if not isinstance(value, list) or len(value) > max_items:
        fail("schema", f"result field {label} must be a bounded array", transfer_started=True)
    return value


def validate_json_primitives(value: Any, label: str = "result") -> None:
    if value is None or type(value) in {bool, int}:
        return
    if type(value) is float:
        if not math.isfinite(value):
            fail("schema", f"{label} contains a non-finite number", transfer_started=True)
        return
    if isinstance(value, str):
        _expect_string(value, label, 1 << 30)
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            validate_json_primitives(item, f"{label}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                fail("schema", f"{label} contains a non-string object key", transfer_started=True)
            _expect_string(key, f"{label} object key", 1024)
            validate_json_primitives(item, f"{label}.{key}")
        return
    fail("schema", f"{label} contains an invalid JSON primitive", transfer_started=True)


def output_repo_path(value: Any, label: str, max_text: int) -> str:
    text = _expect_string(value, label, max_text)
    try:
        return normalize_repo_path(text)
    except DelegationError as exc:
        raise DelegationError(
            "schema",
            f"result field {label} is not a normalized repository-relative path",
            transfer_started=True,
        ) from exc


def validate_evidence_references(
    value: Any,
    *,
    label: str,
    files: list[Any],
    max_items: int,
    max_text: int,
) -> None:
    references = _expect_array(value, label, max_items)
    expected = {"file_index", "symbol", "line_range", "detail"}
    for index, reference in enumerate(references):
        if not isinstance(reference, dict) or set(reference) != expected:
            fail("schema", f"{label}[{index}] has invalid structure", transfer_started=True)
        file_index = reference["file_index"]
        if file_index is not None and (
            type(file_index) is not int or file_index < 0 or file_index >= len(files)
        ):
            fail("schema", f"{label}[{index}] has an invalid file index", transfer_started=True)
        symbol = _expect_string(reference["symbol"], f"{label}[{index}].symbol", max_text)
        line_range = _expect_string(
            reference["line_range"],
            f"{label}[{index}].line_range",
            max_text,
        )
        _expect_string(reference["detail"], f"{label}[{index}].detail", max_text)
        if file_index is None and (symbol or line_range):
            fail(
                "schema",
                f"{label}[{index}] cannot cite a symbol or line without a file",
                transfer_started=True,
            )


def validate_packet(
    packet: dict[str, Any],
    *,
    role: str,
    evidence_paths: frozenset[str],
    policy: dict[str, Any],
    max_output_bytes: int,
) -> bytes:
    if not isinstance(packet, dict):
        fail("schema", "result must be an object", transfer_started=True)
    try:
        validate_json_primitives(packet)
    except RecursionError as exc:
        raise DelegationError(
            "schema",
            "result nesting exceeds the safe validation depth",
            transfer_started=True,
        ) from exc
    try:
        encoded = canonical_json(packet)
    except (TypeError, ValueError, UnicodeEncodeError, RecursionError) as exc:
        raise DelegationError(
            "schema",
            "result cannot be encoded as strict UTF-8 JSON",
            transfer_started=True,
        ) from exc
    if len(encoded) > max_output_bytes:
        fail("output-limit", "final result exceeds the approved output byte limit", transfer_started=True)
    expected = {
        "schema_version",
        "status",
        "summary",
        "confidence",
        "files",
        "facts",
        "findings",
        "tests",
        "risks",
        "next_actions",
        "proposed_changes",
    }
    if set(packet) != expected:
        fail("schema", "result has missing or unexpected root fields", transfer_started=True)
    if type(packet["schema_version"]) is not int or packet["schema_version"] != policy["result_schema_version"]:
        fail("schema", "result schema version is invalid", transfer_started=True)
    if not isinstance(packet["status"], str) or packet["status"] not in {
        "ok",
        "needs-main",
        "blocked",
    }:
        fail("schema", "result status is invalid", transfer_started=True)
    if not isinstance(packet["confidence"], str) or packet["confidence"] not in {
        "high",
        "medium",
        "low",
    }:
        fail("schema", "result confidence is invalid", transfer_started=True)
    max_items = policy["limits"]["max_array_items"]
    max_text = policy["limits"]["max_text_bytes"]
    _expect_string(packet["summary"], "summary", max_text)
    files = _expect_array(packet["files"], "files", max_items)
    for index, item in enumerate(files):
        keys = {"path", "symbols", "line_ranges", "relevance", "verified"}
        if not isinstance(item, dict) or set(item) != keys or type(item["verified"]) is not bool:
            fail("schema", f"result file {index} has invalid structure", transfer_started=True)
        path = output_repo_path(item["path"], f"files[{index}].path", max_text)
        _expect_string(item["relevance"], f"files[{index}].relevance", max_text)
        for field in ("symbols", "line_ranges"):
            values = _expect_array(item[field], f"files[{index}].{field}", max_items)
            for value in values:
                _expect_string(value, f"files[{index}].{field}", max_text)
        if item["verified"] and path not in evidence_paths:
            fail("schema", "result marks an unconsented evidence path as verified", transfer_started=True)
    facts = _expect_array(packet["facts"], "facts", max_items)
    for index, item in enumerate(facts):
        if not isinstance(item, dict) or set(item) != {"claim", "evidence"}:
            fail("schema", f"result facts[{index}] has invalid structure", transfer_started=True)
        _expect_string(item["claim"], f"facts[{index}].claim", max_text)
        validate_evidence_references(
            item["evidence"],
            label=f"facts[{index}].evidence",
            files=files,
            max_items=max_items,
            max_text=max_text,
        )
    findings = _expect_array(packet["findings"], "findings", max_items)
    finding_keys = {"severity", "title", "details", "evidence", "suggested_action"}
    for index, item in enumerate(findings):
        if not isinstance(item, dict) or set(item) != finding_keys:
            fail("schema", f"result findings[{index}] has invalid structure", transfer_started=True)
        severity = _expect_string(item["severity"], f"findings[{index}].severity", max_text)
        if severity not in {"critical", "high", "medium", "low", "info"}:
            fail("schema", "result finding severity is invalid", transfer_started=True)
        for field in ("title", "details", "suggested_action"):
            _expect_string(item[field], f"findings[{index}].{field}", max_text)
        validate_evidence_references(
            item["evidence"],
            label=f"findings[{index}].evidence",
            files=files,
            max_items=max_items,
            max_text=max_text,
        )
    object_arrays = {
        "tests": ({"command", "result", "notes"}, None),
        "proposed_changes": ({"path", "change_type", "rationale", "patch"}, None),
    }
    for field, (keys, severity_values) in object_arrays.items():
        values = _expect_array(packet[field], field, max_items)
        for index, item in enumerate(values):
            if not isinstance(item, dict) or set(item) != keys:
                fail("schema", f"result {field}[{index}] has invalid structure", transfer_started=True)
            for key, value in item.items():
                _expect_string(value, f"{field}[{index}].{key}", max_text)
            if severity_values is not None and item["severity"] not in severity_values:
                fail("schema", "result finding severity is invalid", transfer_started=True)
            if field == "proposed_changes" and item["change_type"] not in {
                "add",
                "modify",
                "delete",
                "none",
            }:
                fail("schema", "result proposal change type is invalid", transfer_started=True)
            if field == "proposed_changes":
                output_repo_path(item["path"], f"{field}[{index}].path", max_text)
    for field in ("risks", "next_actions"):
        for value in _expect_array(packet[field], field, max_items):
            _expect_string(value, field, max_text)
    if role not in {"test-proposal", "change-proposal"} and packet["proposed_changes"]:
        fail("schema", "this role cannot return proposed changes", transfer_started=True)
    return encoded


def invoke(prepared: Prepared, policy: dict[str, Any]) -> bytes:
    preview = prepared.preview
    version = executable_version(prepared.executable)
    base_event = audit_base(prepared, version)
    with invocation_lock(prepared, policy):
        if prepared.audit_enabled:
            append_audit(prepared.audit_path, {**base_event, "event": "started"})
        schema_text = canonical_json(result_schema(policy["result_schema_version"])).decode("utf-8")
        command = [
            *command_prefix(prepared.executable),
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--json-schema",
            schema_text,
            "--sandbox",
            "--mode",
            "plan",
            "--disable-slash-commands",
            "--model",
            preview["model"],
            "--effort",
            preview["effort"],
            "--print-timeout",
            f"{prepared.timeout}s",
            "--print",
            "",
        ]
        if any(flag in command for flag in FORBIDDEN_AGY_FLAGS):
            fail("adapter", "internal AGY command contains a forbidden flag")
        started = time.monotonic()
        try:
            with tempfile.TemporaryDirectory(prefix="external-model-delegation-") as temporary:
                working = Path(temporary).resolve()
                if prepared.repo is not None:
                    with contextlib.suppress(ValueError):
                        working.relative_to(prepared.repo)
                        fail("adapter", "temporary AGY working directory is inside the repository")
                result = run_bounded(
                    command,
                    cwd=working,
                    stdin=prepared.prompt,
                    timeout=prepared.timeout,
                    stdout_limit=prepared.max_output_bytes,
                    stderr_limit=prepared.max_stderr_bytes,
                    environment=safe_environment(),
                    transfer_started=True,
                )
            if result.returncode != 0:
                fail("process", f"AGY exited non-zero ({result.returncode})", transfer_started=True)
            packet, usage = extract_result(result.stdout)
            encoded = validate_packet(
                packet,
                role=preview["role"],
                evidence_paths=prepared.evidence_paths,
                policy=policy,
                max_output_bytes=prepared.max_output_bytes,
            )
            if prepared.audit_enabled:
                try:
                    append_audit(
                        prepared.audit_path,
                        {
                            **base_event,
                            "timestamp": now_utc(),
                            "event": "completed",
                            "completion_status": packet["status"],
                            "duration_ms": result.duration_ms,
                            "output_sha256": hashlib.sha256(encoded).hexdigest(),
                            "output_bytes": len(encoded),
                            "usage": usage,
                        },
                    )
                except DelegationError as audit_exc:
                    raise DelegationError(
                        "audit",
                        "completion audit failed; the model packet was withheld",
                        transfer_started=True,
                    ) from audit_exc
            return encoded
        except DelegationError as exc:
            if prepared.audit_enabled and exc.category != "audit":
                try:
                    append_audit(
                        prepared.audit_path,
                        {
                            **base_event,
                            "timestamp": now_utc(),
                            "event": "completed",
                            "completion_status": "failed",
                            "duration_ms": int((time.monotonic() - started) * 1000),
                            "error_category": exc.category,
                            "transfer_started": exc.transfer_started,
                        },
                    )
                except DelegationError as audit_exc:
                    raise DelegationError(
                        "audit",
                        "completion audit failed after an external invocation failure",
                        transfer_started=exc.transfer_started,
                    ) from audit_exc
            raise


def parser(policy: dict[str, Any]) -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Preview and run a bounded advisory delegation through AGY"
    )
    result.add_argument("role", choices=sorted(policy["roles"]))
    task = result.add_mutually_exclusive_group()
    task.add_argument("--task")
    task.add_argument("--task-file")
    result.add_argument("--repo", default=".")
    result.add_argument("--file", dest="files", action="append", default=[])
    result.add_argument("--input-file")
    result.add_argument("--base")
    result.add_argument("--model")
    result.add_argument("--effort", choices=("low", "medium", "high"))
    result.add_argument("--agy-executable")
    result.add_argument("--timeout", type=int)
    result.add_argument("--max-files", type=int)
    result.add_argument("--max-file-bytes", type=int)
    result.add_argument("--max-input-bytes", type=int)
    result.add_argument("--max-output-bytes", type=int)
    result.add_argument("--max-stderr-bytes", type=int)
    result.add_argument("--audit-path")
    result.add_argument("--no-audit", action="store_true")
    authorization = result.add_mutually_exclusive_group()
    authorization.add_argument("--preview", action="store_true")
    authorization.add_argument("--consent-id")
    return result


def main(argv: list[str] | None = None) -> int:
    try:
        policy = load_policy()
        args = parser(policy).parse_args(argv)
        prepared = prepare(args, policy)
        if args.preview:
            probe_executable(prepared.executable)
            sys.stdout.buffer.write(canonical_json(prepared.preview) + b"\n")
            return 0
        if not args.consent_id:
            fail("consent", "a matching --consent-id is required before external transfer")
        if not CONSENT_RE.fullmatch(args.consent_id):
            fail("consent", "consent ID is malformed")
        if args.consent_id != prepared.preview["consent_id"]:
            fail("consent", "consent ID does not match the freshly prepared payload")
        probe_executable(prepared.executable)
        sys.stdout.buffer.write(invoke(prepared, policy) + b"\n")
        return 0
    except DelegationError as exc:
        print(
            f"external-model-delegation [{exc.category}]: {exc}",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
