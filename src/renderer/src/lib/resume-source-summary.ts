import type { ResumeSource } from '@shared/contracts/resume-sources-contract'

/** Plain-language source summary for the Resume settings screens. */
export function summarizeResumeSource(source: ResumeSource): string {
  if (source.kind === 'files') {
    const identity =
      source.identity === 'parent' ? 'immediate parent directory' : 'file name without extension'
    const recursion = source.recursive ? 'including subdirectories' : 'in this directory only'
    return `Files: ${source.directory} / ${source.pattern}, ${recursion}, identity: ${identity}`
  }
  if (source.protocol === 'agent-harness') {
    return 'Agent Harness: python .agents/scripts/taskctl list --json'
  }
  return `Custom command: ${[source.executable, ...source.args].join(' ')}`
}
