/** Chat prompt under the session. Absent or unknown values use `buttons`. */
export const PROMPT_CHROME_STORAGE_KEY = 'nekode.prompt-chrome.v1'

export const PROMPT_CHROMES = ['buttons', 'input', 'hidden'] as const

export type PromptChrome = (typeof PROMPT_CHROMES)[number]

export const DEFAULT_PROMPT_CHROME: PromptChrome = 'buttons'

export function isPromptChrome(value: string): value is PromptChrome {
  return value === 'buttons' || value === 'input' || value === 'hidden'
}

export function parsePromptChrome(value: string | null): PromptChrome {
  return value !== null && isPromptChrome(value) ? value : DEFAULT_PROMPT_CHROME
}
