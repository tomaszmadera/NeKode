import { existsSync, readFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { serializeAgentCommand } from '../../../shared/agent-command'
import type { AgentProfileTemplate } from '../../../shared/ipc-contract'

const PRESETS = [
  { id: 'codex', name: 'Codex CLI', args: ['{prompt}'] },
  { id: 'claude', name: 'Claude Code', args: ['{prompt}'] },
  { id: 'opencode', name: 'OpenCode', args: ['--prompt', '{prompt}'] },
  { id: 'gemini', name: 'Gemini CLI', args: ['{prompt}'] },
]

/** Never executes or interprets npm .cmd/.ps1 shims. Resolve only known native
 * OpenCode layout and Gemini's declared package entrypoint, as direct argv.
 * Missing installations keep an editable canonical command proposal.
 */
export function agentProfileTemplates(
  envPath = process.env.PATH ?? '',
  platform = process.platform,
): AgentProfileTemplate[] {
  const directories = envPath
    .split(delimiter)
    .filter(Boolean)
    .map((entry) => entry.replace(/^"|"$/g, ''))
  const native = (name: string): string | undefined =>
    directories.map((directory) => join(directory, `${name}.exe`)).find(existsSync)
  const packageRoots = directories.flatMap((directory) => [
    join(directory, 'node_modules'),
    resolve(directory, '..'),
  ])
  return PRESETS.map((preset) => {
    let executable = preset.id
    let args = [...preset.args]
    if (platform === 'win32') {
      executable = native(preset.id) ?? executable
      if (preset.id === 'opencode' && executable === preset.id) {
        executable =
          packageRoots
            .map((root) => join(root, 'opencode-ai', 'bin', 'opencode.exe'))
            .find(existsSync) ?? executable
      }
      if (preset.id === 'gemini' && executable === preset.id) {
        const node = native('node')
        if (node !== undefined) {
          for (const root of packageRoots) {
            const manifestPath = join(root, '@google', 'gemini-cli', 'package.json')
            if (!existsSync(manifestPath)) continue
            // A malformed installed package is left for the user to configure;
            // it does not mutate the library or block other template proposals.
            let manifest: { bin?: string | { gemini?: string } } | null
            try {
              manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
            } catch {
              continue
            }
            const entry = typeof manifest?.bin === 'string' ? manifest.bin : manifest?.bin?.gemini
            if (typeof entry !== 'string') continue
            const script = resolve(dirname(manifestPath), entry)
            if (!existsSync(script)) continue
            executable = node
            args = [script, ...args]
            break
          }
        }
      }
    }
    return {
      id: preset.id,
      name: preset.name,
      command: serializeAgentCommand({ executable, args }),
    }
  })
}
