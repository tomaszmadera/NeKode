import { describe, expect, it } from 'vitest'
import {
  parseAgentArguments,
  parseAgentCommand,
  serializeAgentArguments,
  serializeAgentCommand,
} from './agent-command'

describe('interactive argv notation', () => {
  it('distinguishes no arguments from an explicit empty argument and round-trips exact values', () => {
    expect(parseAgentArguments('  ')).toEqual([])
    expect(parseAgentArguments('""')).toEqual([''])
    const args = [
      'C:\\Agent tools\\cli.js',
      '--model',
      'my model',
      '',
      '"q"',
      '\\',
      'a\r\nb',
      '`n',
      '|;&<>',
    ]
    const text = serializeAgentArguments(args)
    expect(text).not.toMatch(/[\r\n]/)
    expect(parseAgentArguments(text)).toEqual(args)
  })

  it.each(['--flag | echo', '"unclosed', '--flag\nvalue', '\u0000'])(
    'rejects unsafe or malformed input %j',
    (text) => expect(() => parseAgentArguments(text)).toThrow(),
  )
})

describe('agent command grammar', () => {
  it('groups quotes, keeps Windows backslashes, and preserves empty arguments', () => {
    expect(
      parseAgentCommand('"C:\\Agent tools\\agent.exe" --model \'my model\' "" "{prompt}"'),
    ).toEqual({
      executable: 'C:\\Agent tools\\agent.exe',
      args: ['--model', 'my model', '', '{prompt}'],
    })
  })

  it('round trips exact argv including both quotes, trailing backslashes, and shell data', () => {
    const input = {
      executable: 'C:\\agent tools\\agent.exe',
      args: [
        '',
        'a b',
        '"quote"',
        "it's",
        'C:\\folder\\',
        '\\',
        'a\\"b',
        '|;&<>',
        '$HOME',
        '$(echo)',
        'line\nbreak\r\nend\r',
        '`n literal `r and ``',
        '{prompt}',
      ],
    }
    expect(parseAgentCommand(serializeAgentCommand(input))).toEqual(input)
    expect(serializeAgentCommand(input)).not.toMatch(/[\r\n]/)
    expect(parseAgentCommand('agent "C:\\folder\\" "{prompt}"').args).toEqual([
      'C:\\folder\\',
      '{prompt}',
    ])
  })

  it.each([
    'agent | x',
    'agent && x',
    'agent ; x',
    'agent < x',
    'agent > x',
    'agent\nx',
    'agent\r x',
    'agent\u0000',
    'agent "open',
    '',
  ])('rejects %j rather than invoking a shell', (command) => {
    expect(() => parseAgentCommand(command)).toThrow()
  })

  it('decodes line-break escapes only inside quotes and keeps other backticks literal', () => {
    expect(parseAgentCommand('agent "`n" \'`r\' "``n" "`x" `n "{prompt}"').args).toEqual([
      '\n',
      '\r',
      '`n',
      '`x',
      '`n',
      '{prompt}',
    ])
  })
})
