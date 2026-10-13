import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { TEST_ID } from '../../lib/test-ids'
import { EditorContextMenu } from './EditorContextMenu'

// Read-only Monaco preview host (spec Behaviour 7–8). Monaco is loaded lazily
// via a dynamic import so the main bundle stays light (plan Stage 1 boundary);
// the editor is mounted read-only — no cursor editing, no save controls, no
// editing affordances of any kind. Line numbers and extension-driven syntax
// highlighting are on (the language id is resolved in main); the editor
// re-lays out automatically on resize.
//
// Worker-dependent features (link detection, word suggestions) are disabled:
// the preview needs none of them and no MonacoEnvironment wiring.
//
// Right-click opens the app context menu (Copy / Select All, user request
// 2026-10-01) instead of Monaco's own: `contextmenu: false` silences the
// editor's built-in menu and the host div handles the gesture. Copy and
// Select All run through the live editor commands (editor.getSelection /
// clipboard, editor.setSelection to the full model range), so they operate
// on the mounted instance exactly like keyboard shortcuts.

interface MonacoPreviewProps {
  content: string
  /** Monaco language id from the extension mapping (null = plain text). */
  language: string | null
}

const COPY_FAILED = 'Could not copy to the clipboard.'

interface MenuState {
  x: number
  y: number
}

/** Renderer clipboard (typed locally so tests can stub navigator.clipboard). */
function navigatorClipboard(): { writeText(text: string): Promise<void> } | null {
  return typeof navigator !== 'undefined' && navigator.clipboard !== null
    ? navigator.clipboard
    : null
}

export function MonacoPreview({ content, language }: MonacoPreviewProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<MenuState | null>(null)
  // Live copy/select-all entry points of the mounted editor, for the
  // right-click menu rendered outside the load effect. Null while unloaded.
  const editorCommandsRef = useRef<{
    hasSelection: () => boolean
    copy: () => Promise<boolean>
    selectAll: () => void
  } | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) {
      return
    }
    let disposed = false
    let editor: MonacoApi.editor.IStandaloneCodeEditor | null = null
    let model: MonacoApi.editor.ITextModel | null = null

    setLoadFailed(false)

    void import('./monaco-setup')
      .then(({ monaco }) => {
        if (disposed) {
          return
        }
        setLoadFailed(false)
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
          contextmenu: false,
        })
        editorCommandsRef.current = {
          hasSelection: (): boolean => {
            const selection = editor?.getSelection()
            return selection !== null && selection !== undefined && !selection.isEmpty()
          },
          copy: async (): Promise<boolean> => {
            const selection = editor?.getSelection()
            if (selection === null || selection === undefined) {
              return false
            }
            const text = model?.getValueInRange(selection) ?? ''
            if (text.length === 0) {
              return false
            }
            const clipboard = navigatorClipboard()
            if (clipboard === null) {
              return false
            }
            try {
              await clipboard.writeText(text)
              return true
            } catch {
              return false
            }
          },
          selectAll: (): void => {
            editor?.setSelection(
              model?.getFullModelRange() ?? {
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
              },
            )
          },
        }
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
      editorCommandsRef.current = null
      editor?.dispose()
      model?.dispose()
    }
  }, [content, language])

  // Escape closes the menu (window listener, same pattern as the project
  // context menu in LeftNavigation; tests fire Escape on window).
  useEffect(() => {
    if (contextMenu === null) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setContextMenu(null)
        setCopyError(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [contextMenu])

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the host carries the context-menu gesture (right click); the menu items are real buttons and the menu closes on Escape. */}
      <div
        className="relative h-full w-full"
        data-testid={TEST_ID.filePreviewMonaco}
        onContextMenu={(event) => {
          event.preventDefault()
          setCopyError(null)
          setContextMenu({ x: event.clientX, y: event.clientY })
        }}
      >
        <div ref={hostRef} className={loadFailed ? 'hidden' : 'h-full w-full'} />
        {loadFailed ? (
          <pre className="h-full w-full overflow-auto p-4 text-xs whitespace-pre-wrap text-ink-secondary">
            {content}
          </pre>
        ) : null}
      </div>
      {contextMenu !== null ? (
        <EditorContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          hasSelection={editorCommandsRef.current?.hasSelection() ?? false}
          copyError={copyError}
          onCopy={async () => {
            const success = (await editorCommandsRef.current?.copy()) ?? false
            if (success) {
              setContextMenu(null)
              setCopyError(null)
            } else {
              setCopyError(COPY_FAILED)
            }
          }}
          onSelectAll={() => {
            editorCommandsRef.current?.selectAll()
            setContextMenu(null)
            setCopyError(null)
          }}
          onClose={() => {
            setContextMenu(null)
            setCopyError(null)
          }}
        />
      ) : null}
    </>
  )
}
