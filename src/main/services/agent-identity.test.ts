import { describe, expect, it } from 'vitest'
import { agentDisplayName } from './agent-identity'

describe('agentDisplayName', () => {
  it.each([
    ['C:\\Agent tools\\codex.EXE', [], 'Codex'],
    ['/usr/local/bin/claude', [], 'Claude'],
    ['grok.cmd', [], 'Grok'],
    ['gemini.bat', [], 'Gemini'],
    ['hermes', [], 'Hermes'],
    ['agy', [], 'AntiGravity'],
    ['opencode', [], 'OpenCode'],
    ['constructor', [], 'constructor'],
    ['C:\\Tools\\CustomAgent.ps1', [], 'CustomAgent'],
    ['node.exe', ['C:\\Agent tools\\codex.js', '--model', 'local'], 'Codex'],
    ['node', ['--env-file', '.env', '/tools/codex.js'], 'Codex'],
    ['node', ['--env-file-if-exists', '.env.local', '/tools/codex.js'], 'Codex'],
    ['node', ['--require', '/tmp/preload.js', '--no-warnings', '/tools/agent.mjs'], 'agent'],
    ['node', ['/opt/node_modules/@anthropic-ai/claude-code/cli.js'], 'Claude'],
    ['node', ['/opt/node_modules/@google/gemini-cli/dist/index.js'], 'Gemini'],
    ['node', ['--', '/tools/grok.cjs'], 'Grok'],
    ['node', ['--eval', 'console.log("codex.js")'], 'node'],
  ])('identifies %s with %j as %s', (executable, args, expected) => {
    expect(agentDisplayName(executable, args)).toBe(expected)
  })
})
