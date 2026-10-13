import { isValidElement, type ReactElement, type ReactNode } from 'react'

// Detection of Mermaid diagrams in a rendered Markdown document (spec
// Behaviour 2). remark turns a fence's info string into the class
// `language-<first-token>` on the code element, optionally beside other
// classes, so a case-insensitive match on that whole token is the rule. Every
// other fence keeps the plain code block the preview already renders.

const MERMAID_CLASS = /^language-mermaid$/i

export function isMermaidLanguage(className: string | undefined): boolean {
  if (className === undefined) {
    return false
  }
  return className.split(/\s+/).some((token) => MERMAID_CLASS.test(token))
}

type CodeElement = ReactElement<{ className?: string; children?: ReactNode }>

function singleElement(node: ReactNode): CodeElement | null {
  const items = Array.isArray(node) ? node : [node]
  const elements = items.filter((item) => isValidElement(item))
  if (elements.length !== 1) {
    return null
  }
  return elements[0] as CodeElement
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string') {
    return node
  }
  if (typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join('')
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textOf(node.props.children)
  }
  return ''
}

/**
 * The diagram source of a rendered `pre` node, or `null` when that node is not
 * a `mermaid` fence or holds no source (spec Behaviour 8).
 */
export function mermaidSourceFromPre(children: ReactNode): string | null {
  const code = singleElement(children)
  if (code === null || !isMermaidLanguage(code.props.className)) {
    return null
  }
  const source = textOf(code.props.children)
  return source.trim().length === 0 ? null : source
}
