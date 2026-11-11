import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

// ConPTY resolves a PATH name to the native `.exe` suffix only, so an
// extensionless profile name for an npm-installed CLI (`opencode`, installed as
// `opencode.cmd`) failed the spawn with "File not found" (spec
// global-agent-profiles Behaviour 4: the terminal resolves the name at launch).
// The terminal therefore resolves the way the shell does: directory by
// directory along PATH, native suffixes first and command shims last, so a real
// executable always wins over a shim in the same directory.

const WINDOWS_EXECUTABLE_SUFFIXES = ['.exe', '.com', '.cmd', '.bat'] as const

export type ExecutableProbe = (candidate: string) => boolean

/**
 * A Windows spawn target for a profile's executable name. A name with an
 * extension is returned untouched. An extensionless path resolves next to its
 * own directory; a bare name resolves along PATH, which turns an npm command
 * shim into its full path (`.cmd` files start through ConPTY, measured on this
 * host). Nothing found keeps the previous `.exe` outcome, so the spawn error
 * still names the expected native file.
 */
export function resolveWindowsExecutable(
  file: string,
  env: NodeJS.ProcessEnv,
  probe: ExecutableProbe = existsSync,
): string {
  if (win32.extname(file) !== '') {
    return file
  }
  const bases =
    win32.dirname(file) === '.'
      ? pathDirectories(env).map((entry) => win32.join(entry, file))
      : [file]
  for (const base of bases) {
    for (const suffix of WINDOWS_EXECUTABLE_SUFFIXES) {
      if (probe(`${base}${suffix}`)) {
        return `${base}${suffix}`
      }
    }
  }
  return `${file}${WINDOWS_EXECUTABLE_SUFFIXES[0]}`
}

/** PATH entries from a spawn environment, tolerant of empty and quoted values. */
function pathDirectories(env: NodeJS.ProcessEnv): string[] {
  const raw = env.PATH ?? env.Path ?? env.path ?? ''
  return raw
    .split(win32.delimiter)
    .map((entry) =>
      entry
        .trim()
        .replace(/^"(.*)"$/, '$1')
        .trim(),
    )
    .filter((entry) => entry.length > 0)
}
