import { spawn } from "node:child_process"
import { join } from "node:path"

const QUOTA_PROVIDER = "zai-coding-plan"

export const ProjectQuota = async ({ worktree, directory }) => {
  const root = worktree || directory
  const script = join(root, ".agents", "hooks", "dispatch.py")
  const pythonCmd = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3")
  const glmSessions = new Set()
  const registeredSessions = new Set()

  const isQuotaModel = (model) =>
    Boolean(model) &&
    String(model.providerID || "").toLowerCase() === QUOTA_PROVIDER

  const runDispatch = (event) => {
    try {
      const child = spawn(pythonCmd, [script, "--event", event, "--agent", "glm"], {
        cwd: root,
        stdio: "ignore",
        detached: true,
        windowsHide: true,
      })
      child.on("error", () => {})
      child.unref()
    } catch {
      // Ignore background registration errors to prevent blocking agent workflow
    }
  }

  return {
    "chat.message": async (input) => {
      if (!isQuotaModel(input.model)) return
      glmSessions.add(input.sessionID)
      if (!registeredSessions.has(input.sessionID)) {
        registeredSessions.add(input.sessionID)
        runDispatch("session")
      }
    },
    "tool.execute.before": async (input) => {
      // Throttled tool quota registration (dispatch.py enforces the 60s file-lock throttle)
      if (glmSessions.has(input.sessionID)) runDispatch("quota")
    },
    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      if (glmSessions.has(event.properties?.sessionID)) runDispatch("session-end")
    },
  }
}
