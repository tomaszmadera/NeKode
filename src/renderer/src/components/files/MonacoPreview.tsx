import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { TEST_ID } from '../../lib/test-ids'

// Read-only Monaco preview host (spec Behaviour 7–8). Monaco is loaded lazily
// via a dynamic import so the main bundle stays light (plan Stage 1 boundary);
// the editor is mounted read-only — no cursor editing, no save controls, no
// editing affordances of any kind. Line numbers and extension-driven syntax
// highlighting are on (the language id is resolved in main); the editor
// re-lays out automatically on resize.
//
// Worker-dependent features (link detection, word suggestions) are disabled:
// the preview needs none of them and no MonacoEnvironment wiring.

interface MonacoPreviewProps {
  content: string
  /** Monaco language id from the extension mapping (null = plain text). */
  language: string | null
}

export function MonacoPreview({ content, language }: MonacoPreviewProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) {
      return
    }
    let disposed = false
    let editor: MonacoApi.editor.IStandaloneCodeEditor | null = null
    let model: MonacoApi.editor.ITextModel | null = null

    void import('./monaco-setup')
      .then(({ monaco }) => {
        if (disposed) {
          return
        }
        model = monaco.editor.createModel(content, language ?? 'plaintext')
        editor = monaco.editor.create(host, {
          model,
          theme: 'vs-dark',
          readOnly: true,
          domReadOnly: true,
          lineNumbers: 'on',
          minimap: { enabled: false },
          automaticLayout: true,
          scrollBeyondLastLine: false,
          wordBasedSuggestions: 'off',
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          parameterHints: { enabled: false },
          links: false,
        })
      })
      .catch(() => {
        // Monaco failing to load must not take the app down: the preview
        // falls back to a plain read-only rendering of the same content.
        if (!disposed) {
          setLoadFailed(true)
        }
      })

    return () => {
      disposed = true
      editor?.dispose()
      model?.dispose()
    }
  }, [content, language])

  return (
    <div ref={hostRef} className="h-full w-full" data-testid={TEST_ID.filePreviewMonaco}>
      {loadFailed ? (
        <pre className="h-full w-full overflow-auto p-4 text-xs whitespace-pre-wrap text-neutral-300">
          {content}
        </pre>
      ) : null}
    </div>
  )
}
