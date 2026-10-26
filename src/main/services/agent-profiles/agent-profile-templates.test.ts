import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { parseAgentCommand } from '@shared/agent-command'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentProfileTemplates } from './agent-profile-templates'

const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'nekode-template-test-'))
  roots.push(root)
  return root
}

describe('agent CLI command templates', () => {
  it.each(['linux', 'win32'])(
    'offers four canonical proposals without model, sandbox or approval flags on %s',
    (platform) => {
      vi.stubGlobal('process', { ...process, platform })
      vi.stubEnv('PATH', '')
      const proposals = agentProfileTemplates()
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
    },
  )

  it('proposes bare names on Windows even with native executables and shell shims on PATH', () => {
    const first = scratch()
    const second = scratch()
    writeFileSync(join(first, 'codex.cmd'), 'throw')
    writeFileSync(join(first, 'claude.ps1'), 'throw')
    writeFileSync(join(first, 'claude.exe'), '')
    writeFileSync(join(second, 'claude.exe'), '')
    writeFileSync(join(second, 'codex.exe'), '')
    writeFileSync(join(second, 'opencode.exe'), '')
    writeFileSync(join(second, 'gemini.exe'), '')
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    vi.stubEnv('PATH', `"${first}"${delimiter}${second}`)
    expect(agentProfileTemplates().map((p) => parseAgentCommand(p.command))).toEqual([
      { executable: 'codex', args: ['{prompt}'] },
      { executable: 'claude', args: ['{prompt}'] },
      { executable: 'opencode', args: ['--prompt', '{prompt}'] },
      { executable: 'gemini', args: ['{prompt}'] },
    ])
  })

  it('keeps portable proposals when Windows npm package layouts are present', () => {
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
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    vi.stubEnv('PATH', root)
    const templates = agentProfileTemplates()
    expect(parseAgentCommand(templates[2].command)).toEqual({
      executable: 'opencode',
      args: ['--prompt', '{prompt}'],
    })
    expect(parseAgentCommand(templates[3].command)).toEqual({
      executable: 'gemini',
      args: ['{prompt}'],
    })
  })
})
