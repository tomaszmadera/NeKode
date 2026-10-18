// Project avatar and color utilities.
// Initials extraction, deterministic color assignment, and the 7-shade palette.

export const PROJECT_COLOR_PALETTE = [
  '#8B7CF6', // lawenda
  '#5AA9FF', // niebieski
  '#F59E8B', // łosoś
  '#4ADE80', // zielony
  '#F2C94C', // żółty
  '#F472B6', // róż
  '#2DD4BF', // morski
] as const

export type ProjectColor = (typeof PROJECT_COLOR_PALETTE)[number]

/**
 * Extracts initials for the project avatar.
 * Splits by whitespace and hyphens, takes first letter of up to two words, uppercase.
 * Examples:
 * NEKODE -> N
 * URUKI V2 -> UV
 * AGENT-HARNESS -> AH
 * GERDE.PL -> G
 * HERMES-VOICE-ASSISTANT -> HV
 * IMAGE-TO-UI -> IT
 * VRC-MEIDO -> VM
 */
export function getProjectInitials(name: string): string {
  const words = name
    .trim()
    .split(/[\s-]+/)
    .filter((word) => word.length > 0)
  if (words.length === 0) return ''
  const firstLetters = words.slice(0, 2).map((word) => {
    return Array.from(word)[0]?.toUpperCase() ?? ''
  })
  return firstLetters.join('')
}

/**
 * Stable 32-bit string hash (djb2).
 */
export function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0
  }
  return hash
}

/**
 * Deterministically computes a color from the 7-color palette for a given identifier.
 */
export function getDeterministicProjectColor(identifier: string): string {
  const hash = hashString(identifier)
  const index = hash % PROJECT_COLOR_PALETTE.length
  return PROJECT_COLOR_PALETTE[index] ?? PROJECT_COLOR_PALETTE[0]
}

/**
 * Resolves the project color:
 * 1. User manual color if provided and non-empty.
 * 2. Otherwise deterministic color from project id.
 */
export function getProjectColor(
  project: { id: string; path?: string },
  customColor?: string | null,
): string {
  if (customColor && customColor.trim().length > 0) {
    return customColor.trim()
  }
  return getDeterministicProjectColor(project.id)
}
