import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join, normalize } from "node:path"

export const ProjectSafety = async ({ worktree, directory }) => {
  const root = worktree || directory
  const policy = JSON.parse(readFileSync(join(root, ".agents", "hooks", "policy.json"), "utf8"))
  const blockedFiles = policy.blocked_file_patterns.map((pattern) => new RegExp(pattern, "i"))
  const safeFiles = policy.safe_file_patterns.map((pattern) => new RegExp(pattern, "i"))

  const unwrapQuotedPath = (value) => String(value || "").replace(/'([^']*)'|"([^"]*)"/g, "$1$2")

  const containsProtectedPath = (value) => {
    let text = normalize(unwrapQuotedPath(value)).replaceAll("\\", "/")
    for (const pattern of safeFiles) text = text.replace(new RegExp(pattern.source, "ig"), "")
    return blockedFiles.some((pattern) => pattern.test(text))
  }

  // The bash-command decision has exactly one canonical owner: .agents/hooks/dispatch.py.
  // This plugin only maps the runtime event onto that decision and fails closed when the
  // Python interpreter or the dispatch script is unusable. The interpreter resolution
  // mirrors quota.js: PYTHON wins, then a platform default.
  const pythonCmd = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3")
  const dispatchScript = join(root, ".agents", "hooks", "dispatch.py")

  const decideBashCommand = (command) => {
    if (!existsSync(dispatchScript)) {
      throw new Error("Safety policy dispatch is unavailable (dispatch.py is missing); command blocked (fail-closed).")
    }
    let result
    try {
      result = spawnSync(pythonCmd, [dispatchScript, "--event", "command", "--agent", "opencode"], {
        cwd: root,
        input: JSON.stringify({ tool_input: { command } }),
        encoding: "utf8",
        timeout: 15000,
      })
    } catch (error) {
      throw new Error(`Safety policy dispatch is unavailable (${error}); command blocked (fail-closed).`)
    }
    if (result.error) {
      throw new Error(`Safety policy dispatch is unavailable (${result.error}); command blocked (fail-closed).`)
    }
    if (result.status === 2) {
      const reason = String(result.stderr || "").trim()
      throw new Error(reason || "Blocked by repository safety policy. Use AGENT_GUARD_ALLOW=1 only after explicit user authorization.")
    }
    if (result.status !== 0) {
      throw new Error(`Safety policy dispatch failed (exit ${result.status ?? "signal"}); command blocked (fail-closed).`)
    }
  }

  return {
    "tool.execute.before": async (input, output) => {
      if (process.env[policy.allow_environment_variable] === "1") return

      if (input.tool === "bash") {
        decideBashCommand(String(output.args.command || ""))
      }

      if (["read", "write", "edit", "apply_patch"].includes(input.tool)) {
        const path = output.args.filePath || output.args.path || output.args.patch
        if (containsProtectedPath(path)) throw new Error(`Blocked access to a protected file. Use an example file or request a narrowly scoped override.`)
      }
    },
  }
}
