import type React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isSafeExternalUrl } from '../../../../shared/safe-url'
import { TEST_ID } from '../../lib/test-ids'

// Rendered Markdown for a read-only file tab (user decision 2026-10-06).
// react-markdown escapes raw HTML and does not load rehype-raw, so a script
// or an event-handler attribute in the file cannot run. Links leave the app
// only through the existing http/https allowlist (target=_blank hits the
// main-process window-open handler). Remote and relative images are not
// requested: the renderer CSP allows only self, data, and blob, so those
// sources are shown as their alt text. data:image sources render in place.

const components: Components = {
  a: ({ href, children }) => {
    if (typeof href === 'string' && isSafeExternalUrl(href)) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-info underline underline-offset-2"
        >
          {children}
        </a>
      )
    }
    return <span>{children}</span>
  },
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-edge pl-3 text-ink-secondary">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) =>
    className !== undefined ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-highlight px-1 py-0.5 font-mono text-xs">{children}</code>
    ),
  h1: ({ children }) => <h1 className="mb-3 text-xl font-semibold text-ink">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-6 mb-2 text-lg font-semibold text-ink">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-5 mb-2 text-base font-semibold text-ink">{children}</h3>,
  hr: () => <hr className="my-4 border-edge" />,
  img: ({ src, alt }) => {
    const label = alt !== undefined && alt.length > 0 ? alt : 'Image'
    if (typeof src === 'string' && src.startsWith('data:image/')) {
      return <img src={src} alt={label} className="my-3 max-w-full" />
    }
    return <span className="text-ink-secondary">{label}</span>
  },
  input: ({ type, checked }) => {
    if (type !== 'checkbox') {
      return null
    }
    return (
      <input
        type="checkbox"
        checked={Boolean(checked)}
        disabled
        onChange={() => undefined}
        className="mr-2 align-middle"
      />
    )
  },
  li: ({ children, className }) => <li className={className}>{children}</li>,
  ol: ({ children }) => <ol className="my-3 list-decimal pl-5">{children}</ol>,
  p: ({ children }) => <p className="my-3 text-ink">{children}</p>,
  pre: ({ children }) => (
    <pre className="my-3 overflow-auto rounded-md border border-edge bg-panel p-3 font-mono text-xs text-ink">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-auto">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  td: ({ children }) => <td className="border border-edge px-2 py-1 align-top">{children}</td>,
  th: ({ children }) => (
    <th className="border border-edge px-2 py-1 text-left font-semibold">{children}</th>
  ),
  ul: ({ children, className }) => (
    <ul
      className={
        className?.includes('contains-task-list') ? 'my-3 list-none pl-5' : 'my-3 list-disc pl-5'
      }
    >
      {children}
    </ul>
  ),
}

export function MarkdownPreview({ content }: { content: string }): React.JSX.Element {
  return (
    <div
      className="h-full overflow-auto px-6 py-4 text-sm leading-relaxed text-ink select-text [&_pre_code]:bg-transparent [&_pre_code]:p-0"
      data-testid={TEST_ID.fileMarkdownRender}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
