// Line diff for the `Teach agents` preview (project-home spec Behaviour 13).
// A plain LCS over lines after trimming the common prefix and suffix. Inputs
// are bounded by main (32 KiB adapter body, 256 KiB shown current file), so
// the table stays small in practice. When the changed middle would still need
// a table above MAX_CELLS, the middle is shown as all removed then all added:
// a correct but not minimal diff.

export type DiffLineKind = 'same' | 'remove' | 'add'

export interface DiffLine {
  kind: DiffLineKind
  text: string
}

const MAX_CELLS = 4_000_000

/** Diff from `before` to `after`, one entry per line split on `\n`. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const head = a.slice(0, start).map((text): DiffLine => ({ kind: 'same', text }))
  const tail = a.slice(endA).map((text): DiffLine => ({ kind: 'same', text }))
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  return [...head, ...diffMiddle(midA, midB), ...tail]
}

function diffMiddle(a: string[], b: string[]): DiffLine[] {
  const removed = a.map((text): DiffLine => ({ kind: 'remove', text }))
  const added = b.map((text): DiffLine => ({ kind: 'add', text }))
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_CELLS) {
    return [...removed, ...added]
  }
  // lengths[i * width + j]: LCS length of a[i..] and b[j..].
  const width = b.length + 1
  const lengths = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * width + j] =
        a[i] === b[j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1])
    }
  }
  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ kind: 'same', text: a[i] })
      i++
      j++
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) {
      result.push({ kind: 'remove', text: a[i] })
      i++
    } else {
      result.push({ kind: 'add', text: b[j] })
      j++
    }
  }
  for (; i < a.length; i++) result.push({ kind: 'remove', text: a[i] })
  for (; j < b.length; j++) result.push({ kind: 'add', text: b[j] })
  return result
}
