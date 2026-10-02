// Lazy monaco bootstrap (dynamically imported by MonacoPreview). Only the
// editor core and the main-thread basic-languages grammars are loaded: the
// worker-backed language services (json/css/html/ts) are deliberately left
// out, so the read-only preview needs no MonacoEnvironment/worker wiring —
// syntax highlighting runs on the main thread via monarch grammars.
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'

export { monaco }
