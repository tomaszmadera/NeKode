// Shell selection (spec project-shell-selection): the stored per-project
// setting value is one opaque choice id — `default`, a detected shell
// (`powershell`, `pwsh`, `cmd`, `gitbash`, `wsl:<distro>`) or a user-added
// executable path (`custom:<absolute path>`). The renderer only ever sends
// ids; main resolves every id to an executable at spawn/label time and falls
// back to the platform default when the id no longer resolves.
export type ShellChoice =
  | 'default'
  | 'powershell'
  | 'pwsh'
  | 'cmd'
  | 'gitbash'
  | `wsl:${string}`
  | `custom:${string}`

/** One selectable shell as shown in the Shell settings tab. */
export interface ShellInfo {
  id: ShellChoice
  /** Display label (e.g. "PowerShell", "WSL: Ubuntu-24.04", "bash"). */
  label: string
}
