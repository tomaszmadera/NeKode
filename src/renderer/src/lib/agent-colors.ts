// Launch identity colors are independent of session status and project colors.
export const AGENT_COLORS: Readonly<Record<string, string>> = {
  claude: '#d97757',
  'claude code': '#d97757',
  codex: '#94a2ff',
  openai: '#94a2ff',
  gemini: '#6ea8fe',
  agy: '#6ea8fe',
  antigravity: '#6ea8fe',
  grok: '#9aa7c7',
}

const FALLBACK_COLORS = ['#a78bfa', '#60a5fa', '#f472b6', '#22d3ee', '#c084fc'] as const

export function getAgentColor(name: string): string {
  const key = name.toLowerCase()
  if (AGENT_COLORS[key]) return AGENT_COLORS[key]
  let hash = 0
  for (let index = 0; index < key.length; index++) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]
}
