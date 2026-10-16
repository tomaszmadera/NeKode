/**
 * An argv notation, never a shell script. Either quote groups a token.
 * Inside a quote, doubling that same quote writes a literal quote. Backslashes
 * are always literal (including immediately before a closing quote).
 * Inside quotes, backtick-n/backtick-r encode LF/CR; a doubled backtick is literal.
 * Outside quotes, whitespace separates tokens and shell operators are errors.
 */
export const AGENT_COMMAND_HELP =
  'Use single or double quotes to group arguments. Double a matching quote inside quotes to write it literally. Backslashes stay literal. Inside quotes, `n and `r encode line breaks; `` writes a backtick. Include {prompt} as one whole argument exactly once. Shell operators and multiple lines are not supported.'

export function parseAgentCommand(command: string): { executable: string; args: string[] } {
  const tokens = parseAgentArguments(command)
  const executable = tokens.shift()
  if (executable === undefined || executable.trim().length === 0)
    throw new Error('Command is required.')
  return { executable, args: tokens }
}

/** The same argv notation, allowing an empty argument list without an executable. */
export function parseAgentArguments(command: string): string[] {
  if (typeof command !== 'string' || /[\r\n]/.test(command) || command.includes('\u0000')) {
    throw new Error('Command must be one line without NUL characters.')
  }
  const tokens: string[] = []
  let token = ''
  let started = false
  let quote: string | null = null
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (quote !== null) {
      if (char === '`' && ['n', 'r', '`'].includes(command[index + 1])) {
        const escaped = command[index + 1]
        token += escaped === 'n' ? '\n' : escaped === 'r' ? '\r' : '`'
        index += 1
      } else if (char === quote) {
        if (command[index + 1] === quote) {
          token += char
          index += 1
        } else {
          quote = null
        }
      } else {
        token += char
      }
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) tokens.push(token)
      token = ''
      started = false
    } else {
      if (/[|&;<>]/.test(char))
        throw new Error('Quote shell operators as data; shell scripts are not supported.')
      token += char
      started = true
    }
  }
  if (quote !== null) throw new Error('Command has an unclosed quote.')
  if (started) tokens.push(token)
  return tokens
}

export function serializeAgentCommand(input: {
  executable: string
  args: readonly string[]
}): string {
  return serializeAgentArguments([input.executable, ...input.args])
}

export function serializeAgentArguments(args: readonly string[]): string {
  return args
    .map(
      (token) =>
        `"${token.replaceAll('`', '``').replaceAll('\r', '`r').replaceAll('\n', '`n').replaceAll('"', '""')}"`,
    )
    .join(' ')
}
