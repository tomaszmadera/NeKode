import { serializeAgentCommand } from '@shared/agent-command'
import type { AgentProfileTemplate } from '@shared/ipc-contract'

interface Preset {
  id: string
  name: string
  args: string[]
  interactiveArgs?: string[]
}

// OpenCode requires a value for --prompt, so New Chat starts it without arguments.
const PRESETS: Preset[] = [
  { id: 'codex', name: 'Codex CLI', args: ['{prompt}'] },
  { id: 'claude', name: 'Claude Code', args: ['{prompt}'] },
  { id: 'opencode', name: 'OpenCode', args: ['--prompt', '{prompt}'], interactiveArgs: [] },
  { id: 'gemini', name: 'Gemini CLI', args: ['{prompt}'] },
]

/** Editable, portable proposals. The terminal resolves executable names at launch. */
export function agentProfileTemplates(): AgentProfileTemplate[] {
  return PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    command: serializeAgentCommand({ executable: preset.id, args: preset.args }),
    ...(preset.interactiveArgs === undefined
      ? {}
      : { interactiveArgs: [...preset.interactiveArgs] }),
  }))
}
