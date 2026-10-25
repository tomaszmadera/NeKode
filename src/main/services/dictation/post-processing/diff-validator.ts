import type { DiffValidationResult } from './post-processing-types'

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const ENGLISH_CONTRACTIONS: Record<string, string> = {
  "can't": 'not',
  cant: 'not',
  cannot: 'not',
  "won't": 'not',
  wont: 'not',
  "don't": 'not',
  dont: 'not',
  "doesn't": 'not',
  doesnt: 'not',
  "didn't": 'not',
  didnt: 'not',
  "isn't": 'not',
  isnt: 'not',
  "aren't": 'not',
  arent: 'not',
  "wasn't": 'not',
  wasnt: 'not',
  "weren't": 'not',
  werent: 'not',
  "haven't": 'not',
  havent: 'not',
  "hasn't": 'not',
  hasnt: 'not',
  "hadn't": 'not',
  hadnt: 'not',
  "shouldn't": 'not',
  shouldnt: 'not',
  "wouldn't": 'not',
  wouldnt: 'not',
  "couldn't": 'not',
  couldnt: 'not',
}

const STANDALONE_NEGATIONS = new Set<string>([
  // English
  'not',
  'never',
  'none',
  'neither',
  'nor',
  'nobody',
  'nothing',
  'nowhere',
  'without',
  // Polish
  'nie',
  'nigdy',
  'ani',
  'wcale',
  'bynajmniej',
  'nigdzie',
])

const POLISH_CONVERSATIONAL_NO_FOLLOWERS = new Set<string>([
  'to',
  'tak',
  'dobra',
  'pewnie',
  'jasne',
  'właśnie',
  'ale',
  'więc',
  'i',
  'co',
  'tam',
  'nie',
])

function isPolishText(text: string): boolean {
  if (/[ąćęłńóśźż]/i.test(text)) {
    return true
  }
  return /\b(nie|jest|się|zrób|zróbmy|uruchom|sprawdź|plik|pliku|pliki|usuń|dodaj|błąd|błędy|znaczy|żaden|brak|nikt|nic|nigdy|wcale|dla|ze|oraz|albo|teraz|tutaj|zaraz|będzie|mamy|chcę|proszę|włącz|wyłącz|ten|tego|tym|tych)\b/i.test(
    text,
  )
}

const POLISH_INFLECTED_NEGATIONS: Record<string, string> = {
  // brak
  brak: 'brak',
  braku: 'brak',
  braków: 'brak',
  brakom: 'brak',
  brakiem: 'brak',
  brakach: 'brak',
  // żaden
  żaden: 'żaden',
  żadna: 'żaden',
  żadne: 'żaden',
  żadnego: 'żaden',
  żadnej: 'żaden',
  żadnemu: 'żaden',
  żadnym: 'żaden',
  żadnych: 'żaden',
  żadną: 'żaden',
  zaden: 'żaden',
  zadna: 'żaden',
  zadne: 'żaden',
  zadnego: 'żaden',
  zadnej: 'żaden',
  zadnemu: 'żaden',
  zadnym: 'żaden',
  zadnych: 'żaden',
  zadną: 'żaden',
  // nikt
  nikt: 'nikt',
  nikogo: 'nikt',
  nikomu: 'nikt',
  nikim: 'nikt',
  // nic
  nic: 'nic',
  niczego: 'nic',
  niczemu: 'nic',
  niczym: 'nic',
}

const POLISH_NON_NEGATION_PREFIXES = new Set<string>([
  'niebo',
  'nieba',
  'niebem',
  'niebios',
  'niebiosach',
  'niebieski',
  'niebieska',
  'niebieskie',
  'niebieskich',
  'niebieskim',
  'niedziela',
  'niedzieli',
  'niedzielę',
  'niedziela',
  'niedźwiedź',
  'niedźwiedzia',
  'niemowlę',
  'niemowlęcia',
  'nietoperz',
  'nietoperza',
  'niegdyś',
  'nieco',
])

function extractNumbers(text: string): string[] {
  const matches = text.match(/\b\d+(?:[.,_]\d+)*\b/g) || []
  return matches.map((m) => {
    // Normalize thousand separators e.g. 10,000 -> 10000, 10_000 -> 10000
    if (/^\d{1,3}(?:,\d{3})+$/.test(m) || /^\d+(?:_\d+)+$/.test(m)) {
      return m.replace(/[,_]/g, '')
    }
    return m
  })
}

function extractNegations(text: string): string[] {
  const tokens = text.toLowerCase().match(/[\p{L}\p{M}'-]+/gu) || []
  const result: string[] = []
  const textIsPolish = isPolishText(text)

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (ENGLISH_CONTRACTIONS[token]) {
      result.push(ENGLISH_CONTRACTIONS[token])
      continue
    }

    if (token === 'no') {
      const nextToken = tokens[i + 1]
      // Qualify 'no' as an English negation only:
      // If followed by Polish conversational particles or used in Polish text context, it is conversational filler, not a negation.
      const isPolishParticle =
        (nextToken && POLISH_CONVERSATIONAL_NO_FOLLOWERS.has(nextToken)) || textIsPolish
      if (!isPolishParticle) {
        result.push('no')
      }
      continue
    }

    if (STANDALONE_NEGATIONS.has(token)) {
      result.push(token)
      continue
    }

    if (POLISH_INFLECTED_NEGATIONS[token]) {
      result.push(POLISH_INFLECTED_NEGATIONS[token])
      continue
    }

    if (token.startsWith('nie') && token.length >= 5 && !POLISH_NON_NEGATION_PREFIXES.has(token)) {
      result.push(`nie:${token.slice(3)}`)
    }
  }

  return result
}

function extractUrls(text: string): string[] {
  const matches = text.match(/\bhttps?:\/\/[^\s<>"'`)]+|\bftp:\/\/[^\s<>"'`)]+/gi) || []
  return matches.map((u) => u.replace(/[.,;!?]+$/, ''))
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase()
}

function extractFilePaths(text: string): string[] {
  const paths: string[] = []

  // Strip URLs so URL path segments are not falsely captured as file paths
  const textWithoutUrls = text.replace(/\bhttps?:\/\/[^\s<>"'`)]+|\bftp:\/\/[^\s<>"'`)]+/gi, '')

  // 1. Windows absolute paths: C:\Users\foo\bar.txt or UNC \\server\share\file
  const winMatches = textWithoutUrls.match(/\b[a-zA-Z]:\\[^\s<>"'`)]+|\b\\\\[^\s<>"'`)]+/g) || []
  for (const p of winMatches) {
    paths.push(p.replace(/[.,;!?]+$/, ''))
  }

  // 2. Unix absolute paths: /usr/local/bin, /etc/nginx/nginx.conf, /var/log
  const unixMatches =
    textWithoutUrls.match(/(?:^|[\s"'`])(\/(?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.-]*)/g) || []
  for (const match of unixMatches) {
    const trimmed = match
      .trim()
      .replace(/^["'`]|["'`]$/g, '')
      .replace(/[.,;!?]+$/, '')
    if (trimmed.length > 1) {
      paths.push(trimmed)
    }
  }

  // 3. Relative paths with explicit ./ or .\ or ../ or ..\
  const explicitRelMatches =
    textWithoutUrls.match(/(?:^|[\s"'`])(\.\.?[/\\][a-zA-Z0-9_.-]+(?:[/\\][a-zA-Z0-9_.-]+)*)/g) ||
    []
  for (const match of explicitRelMatches) {
    const trimmed = match
      .trim()
      .replace(/^["'`]|["'`]$/g, '')
      .replace(/[.,;!?]+$/, '')
    paths.push(trimmed)
  }

  // 4. Relative paths with 2+ segments using / or \ (e.g. src/main/index.ts, src\main\index.ts, src/main/services, src\main\services)
  const relMatches =
    textWithoutUrls.match(
      /(?:^|[\s"'`])([a-zA-Z0-9_.-]+(?:[/\\][a-zA-Z0-9_.-]+)+)(?=[\s.,;!?"'`]|$)/g,
    ) || []
  const NON_PATH_TOKENS = new Set(['and/or', 'either/or', 'w/o', 'w/', 's/he'])
  for (const match of relMatches) {
    const trimmed = match
      .trim()
      .replace(/^["'`]|["'`]$/g, '')
      .replace(/[.,;!?]+$/, '')
    if (!NON_PATH_TOKENS.has(trimmed.toLowerCase())) {
      paths.push(trimmed)
    }
  }

  return Array.from(new Set(paths))
}

function extractCliFlags(text: string): string[] {
  const matches =
    text.match(
      /(?:^|[\s"'`])((?:--[a-zA-Z0-9][a-zA-Z0-9-_]*(?:=[^\s"'`]*)?)|(?:-[a-zA-Z0-9]+))(?=[\s.,;!?"'`]|$)/g,
    ) || []
  return matches.map((m) => m.trim().replace(/^["'`]|["'`]$/g, ''))
}

function extractCodeTokens(text: string): string[] {
  const tokens = new Set<string>()

  // Backtick blocks: `git status`
  const backtickMatches = text.match(/`([^`]+)`/g) || []
  for (const match of backtickMatches) {
    const inner = match.slice(1, -1).trim()
    if (inner) {
      tokens.add(inner)
    }
  }

  // snake_case identifiers: foo_bar, MAX_RETRIES, max_retry_count
  const snakeMatches = text.match(/\b[a-zA-Z0-9]+_[a-zA-Z0-9_]+\b/g) || []
  for (const match of snakeMatches) {
    tokens.add(match)
  }

  // camelCase / PascalCase identifiers: getUserById, DiffValidator
  const camelMatches = text.match(/\b[a-z]+[A-Z][a-zA-Z0-9]*\b/g) || []
  for (const match of camelMatches) {
    tokens.add(match)
  }
  const pascalMatches = text.match(/\b[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*\b/g) || []
  for (const match of pascalMatches) {
    tokens.add(match)
  }

  // Function calls: myFunc()
  const funcMatches = text.match(/\b[a-zA-Z0-9_]+\(\)/g) || []
  for (const match of funcMatches) {
    tokens.add(match)
  }

  return Array.from(tokens)
}

function countFrequencies(items: string[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const item of items) {
    map.set(item, (map.get(item) ?? 0) + 1)
  }
  return map
}

export class DiffValidator {
  validate(rawText: string, candidateText: string): DiffValidationResult {
    const trimmedRaw = rawText.trim()
    const trimmedCandidate = candidateText.trim()

    if (trimmedRaw.length === 0 && trimmedCandidate.length === 0) {
      return { valid: true }
    }

    if (trimmedRaw.length > 0 && trimmedCandidate.length === 0) {
      return { valid: false, reason: 'Preservation violation: candidate text is empty.' }
    }

    // 1. Numbers, ports, versions validation
    const rawNumbers = extractNumbers(trimmedRaw)
    const candidateNumbers = extractNumbers(trimmedCandidate)
    const rawNumFreq = countFrequencies(rawNumbers)
    const candNumFreq = countFrequencies(candidateNumbers)

    for (const [num, count] of rawNumFreq.entries()) {
      const candCount = candNumFreq.get(num) ?? 0
      if (candCount === 0) {
        return {
          valid: false,
          reason: `Preservation violation: number '${num}' was modified or omitted.`,
        }
      }
      if (candCount !== count) {
        return {
          valid: false,
          reason: `Preservation violation: numbers mismatch for '${num}' (raw count: ${count}, candidate count: ${candCount}).`,
        }
      }
    }

    for (const [num] of candNumFreq.entries()) {
      if (!rawNumFreq.has(num)) {
        return {
          valid: false,
          reason: `Preservation violation: unprompted number '${num}' was introduced.`,
        }
      }
    }

    // 2. Negation words validation (English and Polish)
    const rawNegations = extractNegations(trimmedRaw)
    const candidateNegations = extractNegations(trimmedCandidate)
    const rawNegFreq = countFrequencies(rawNegations)
    const candNegFreq = countFrequencies(candidateNegations)

    // Reconcile Polish compound negations e.g. 'nie:lubiane' <-> standalone 'nie' + base word
    for (const [rawNeg, rawCount] of Array.from(rawNegFreq.entries())) {
      if (rawNeg.startsWith('nie:')) {
        const base = rawNeg.slice(4)
        const candDirectCount = candNegFreq.get(rawNeg) ?? 0
        if (candDirectCount < rawCount) {
          const needed = rawCount - candDirectCount
          const candNieCount = candNegFreq.get('nie') ?? 0
          if (candNieCount >= needed && trimmedCandidate.toLowerCase().includes(base)) {
            candNegFreq.set('nie', candNieCount - needed)
            if (candNegFreq.get('nie') === 0) candNegFreq.delete('nie')
            candNegFreq.set(rawNeg, (candNegFreq.get(rawNeg) ?? 0) + needed)
          }
        }
      }
    }
    for (const [candNeg, candCount] of Array.from(candNegFreq.entries())) {
      if (candNeg.startsWith('nie:')) {
        const base = candNeg.slice(4)
        const rawDirectCount = rawNegFreq.get(candNeg) ?? 0
        if (rawDirectCount < candCount) {
          const needed = candCount - rawDirectCount
          const rawNieCount = rawNegFreq.get('nie') ?? 0
          if (rawNieCount >= needed && trimmedRaw.toLowerCase().includes(base)) {
            rawNegFreq.set('nie', rawNieCount - needed)
            if (rawNegFreq.get('nie') === 0) rawNegFreq.delete('nie')
            rawNegFreq.set(candNeg, (rawNegFreq.get(candNeg) ?? 0) + needed)
          }
        }
      }
    }

    for (const [neg, count] of rawNegFreq.entries()) {
      const candCount = candNegFreq.get(neg) ?? 0
      if (candCount === 0) {
        if (neg === 'nie') {
          return {
            valid: false,
            reason: "Preservation violation: Polish negation 'nie' was removed.",
          }
        }
        return {
          valid: false,
          reason: `Preservation violation: negation word '${neg}' was removed.`,
        }
      }
      if (candCount !== count) {
        return {
          valid: false,
          reason: `Preservation violation: negation word '${neg}' count mismatch (raw count: ${count}, candidate count: ${candCount}).`,
        }
      }
    }

    for (const [neg, count] of candNegFreq.entries()) {
      const rawCount = rawNegFreq.get(neg) ?? 0
      if (rawCount === 0) {
        if (neg === 'nie') {
          return {
            valid: false,
            reason: "Preservation violation: unprompted Polish negation 'nie' was introduced.",
          }
        }
        return {
          valid: false,
          reason: `Preservation violation: unprompted negation word '${neg}' was introduced.`,
        }
      }
      if (count !== rawCount) {
        return {
          valid: false,
          reason: `Preservation violation: negation word '${neg}' count mismatch (raw count: ${rawCount}, candidate count: ${count}).`,
        }
      }
    }

    // 3. URLs validation
    const rawUrls = extractUrls(trimmedRaw)
    const candidateUrls = extractUrls(trimmedCandidate)

    for (const url of rawUrls) {
      if (!trimmedCandidate.includes(url)) {
        return {
          valid: false,
          reason: `Preservation violation: URL '${url}' was modified or removed.`,
        }
      }
    }

    for (const url of candidateUrls) {
      if (!rawUrls.includes(url)) {
        return {
          valid: false,
          reason: `Preservation violation: unprompted URL '${url}' was added.`,
        }
      }
    }

    // 4. File paths validation
    const rawPaths = extractFilePaths(trimmedRaw)
    const candidatePaths = extractFilePaths(trimmedCandidate)

    for (const rawPath of rawPaths) {
      const normalizedRaw = normalizePath(rawPath)
      const existsInCandidate =
        candidatePaths.some((cp) => normalizePath(cp) === normalizedRaw) ||
        trimmedCandidate.includes(rawPath) ||
        trimmedCandidate.includes(rawPath.replace(/\\/g, '/')) ||
        trimmedCandidate.includes(rawPath.replace(/\//g, '\\'))
      if (!existsInCandidate) {
        return {
          valid: false,
          reason: `Preservation violation: file path '${rawPath}' was modified or removed.`,
        }
      }
    }

    for (const candPath of candidatePaths) {
      const normalizedCand = normalizePath(candPath)
      const existsInRaw =
        rawPaths.some((rp) => normalizePath(rp) === normalizedCand) ||
        trimmedRaw.includes(candPath) ||
        trimmedRaw.includes(candPath.replace(/\\/g, '/')) ||
        trimmedRaw.includes(candPath.replace(/\//g, '\\'))
      if (!existsInRaw) {
        return {
          valid: false,
          reason: `Preservation violation: unprompted file path '${candPath}' was introduced.`,
        }
      }
    }

    // 5. CLI flags validation
    const rawFlags = extractCliFlags(trimmedRaw)
    const candidateFlags = extractCliFlags(trimmedCandidate)
    const rawFlagFreq = countFrequencies(rawFlags)
    const candFlagFreq = countFrequencies(candidateFlags)

    for (const [flag, count] of rawFlagFreq.entries()) {
      const candCount = candFlagFreq.get(flag) ?? 0
      if (candCount === 0) {
        return {
          valid: false,
          reason: `Preservation violation: CLI flag '${flag}' was removed or altered.`,
        }
      }
      if (candCount !== count) {
        return {
          valid: false,
          reason: `Preservation violation: CLI flag '${flag}' count mismatch.`,
        }
      }
    }

    for (const [flag] of candFlagFreq.entries()) {
      if (!rawFlagFreq.has(flag)) {
        return {
          valid: false,
          reason: `Preservation violation: unprompted CLI flag '${flag}' was introduced.`,
        }
      }
    }

    // 6. Code tokens and backtick blocks validation
    const rawCodeTokens = extractCodeTokens(trimmedRaw)
    for (const token of rawCodeTokens) {
      const pattern = new RegExp(`(?:^|[^a-zA-Z0-9_])${escapeRegex(token)}(?:$|[^a-zA-Z0-9_])`)
      if (!pattern.test(trimmedCandidate)) {
        return {
          valid: false,
          reason: `Preservation violation: code token '${token}' was modified or removed.`,
        }
      }
    }

    return { valid: true }
  }
}
