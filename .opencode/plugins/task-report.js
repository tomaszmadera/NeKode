import { spawn } from "node:child_process"
import { join } from "node:path"

const WRITE_TOOLS = new Set(["write", "edit", "apply_patch"])

export const ProjectTaskReport = async ({ worktree, directory }) => {
  const root = worktree || directory
  const script = join(root, ".agents", "hooks", "dispatch.py")
  const pythonCmd = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3")

  const runDispatch = (event, payload, extraArgs = []) => {
    try {
      const child = spawn(pythonCmd, [script, "--event", event, "--agent", "opencode", ...extraArgs], {
        cwd: root,
        stdio: ["pipe", "ignore", "ignore"],
        detached: true,
        windowsHide: true,
      })
      child.on("error", () => {})
      try {
        child.stdin.end(JSON.stringify(payload ?? {}))
      } catch {
        try {
          child.stdin.end()
        } catch {
          // Fail-open: a broken stdin pipe must not block the agent.
        }
      }
      child.unref()
    } catch {
      // Fail-open: reporting must not block the agent workflow.
    }
  }

  const payloadFromTool = (tool, args = {}) => {
    const tool_input = {}
    if (WRITE_TOOLS.has(tool)) {
      const path = args.filePath || args.file_path
      if (typeof path === "string" && path) tool_input.file_path = path
      const patch = args.patchText || args.patch
      if (typeof patch === "string" && patch) tool_input.command = patch
    }
    if (typeof args.command === "string" && args.command) tool_input.command = args.command
    if (typeof args.TargetFile === "string" && args.TargetFile) tool_input.TargetFile = args.TargetFile
    return { tool_input, toolCall: { name: tool, args } }
  }

  return {
    "tool.execute.after": async (input) => {
      runDispatch("task-report", payloadFromTool(input.tool, input.args || {}))
    },
    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      runDispatch("task-report", {}, ["--force"])
    },
  }
}
