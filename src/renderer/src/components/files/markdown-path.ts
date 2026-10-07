// Markdown files in the file preview (user decision 2026-10-06). The extension
// set matches files-service EXTENSION_LANGUAGE (md, markdown), including case.
// A leading-dot name such as ".md" has no extension, same as Node extname.

export type MarkdownViewMode = 'code' | 'preview'

/** A markdown file opens rendered (user decision 2026-10-06). */
export const DEFAULT_MARKDOWN_VIEW: MarkdownViewMode = 'preview'

export function markdownViewKey(projectId: string, relativePath: string): string {
  return `${projectId}\0${relativePath}`
}

export function isMarkdownPath(relativePath: string): boolean {
  const slash = Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\'))
  const name = relativePath.slice(slash + 1).toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot <= 0) {
    return false
  }
  const extension = name.slice(dot + 1)
  return extension === 'md' || extension === 'markdown'
}
