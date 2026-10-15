import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseAgentCommand } from '../../../shared/agent-command'
import { agentProfileTemplates } from './agent-profile-templates'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'nekode-template-test-'))
  roots.push(root)
  return root
}

describe('agent CLI command templates', () => {
  it('offers the four editable proposals without imposing models, sandbox or approval flags', () => {
    const proposals = agentProfileTemplates('', 'linux')
    expect(proposals.map((p) => p.name)).toEqual([
      'Codex CLI',
      'Claude Code',
      'OpenCode',
      'Gemini CLI',
    ])
    expect(proposals.map((p) => parseAgentCommand(p.command))).toEqual([
      { executable: 'codex', args: ['{prompt}'] },
      { executable: 'claude', args: ['{prompt}'] },
      { executable: 'opencode', args: ['--prompt', '{prompt}'] },
      { executable: 'gemini', args: ['{prompt}'] },
    ])
  })

  it('resolves Windows native executables in PATH order without running shell shims', () => {
    const first = scratch()
    const second = scratch()
    writeFileSync(join(first, 'codex.cmd'), 'throw')
    writeFileSync(join(first, 'claude.ps1'), 'throw')
    writeFileSync(join(first, 'claude.exe'), '')
    writeFileSync(join(second, 'claude.exe'), '')
    writeFileSync(join(second, 'codex.exe'), '')
    const commands = agentProfileTemplates(`"${first}"${delimiter}${second}`, 'win32').map((p) =>
      parseAgentCommand(p.command),
    )
    expect(commands[0].executable).toBe(join(second, 'codex.exe'))
    expect(commands[1].executable).toBe(join(first, 'claude.exe'))
    expect(commands[2].executable).toBe('opencode')
  })

  it('resolves the installed OpenCode native layout and Gemini declared script through native Node', () => {
    const root = scratch()
    const openCode = join(root, 'node_modules', 'opencode-ai', 'bin')
    const gemini = join(root, 'node_modules', '@google', 'gemini-cli')
    mkdirSync(openCode, { recursive: true })
    mkdirSync(join(gemini, 'bundle'), { recursive: true })
    writeFileSync(join(openCode, 'opencode.exe'), '')
    writeFileSync(join(root, 'node.exe'), '')
    writeFileSync(join(gemini, 'bundle', 'gemini.js'), '')
    writeFileSync(
      join(gemini, 'package.json'),
      JSON.stringify({ bin: { gemini: 'bundle/gemini.js' } }),
    )
    const templates = agentProfileTemplates(root, 'win32')
    expect(parseAgentCommand(templates[2].command)).toEqual({
      executable: join(openCode, 'opencode.exe'),
      args: ['--prompt', '{prompt}'],
    })
    expect(parseAgentCommand(templates[3].command)).toEqual({
      executable: join(root, 'node.exe'),
      args: [join(gemini, 'bundle', 'gemini.js'), '{prompt}'],
    })
  })

  it.each(['{', 'null', '{}', '{"bin":{"gemini":"missing.js"}}'])(
    'keeps an editable Gemini proposal when installed metadata is unusable: %s',
    (manifest) => {
      const root = scratch()
      const gemini = join(root, 'node_modules', '@google', 'gemini-cli')
      mkdirSync(gemini, { recursive: true })
      writeFileSync(join(root, 'node.exe'), '')
      writeFileSync(join(gemini, 'package.json'), manifest)
      expect(parseAgentCommand(agentProfileTemplates(root, 'win32')[3].command)).toEqual({
        executable: 'gemini',
        args: ['{prompt}'],
      })
    },
  )
})
