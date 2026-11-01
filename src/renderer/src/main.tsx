import { PREVIEW_VIEW_QUERY } from '@shared/contracts/preview-contract'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { PreviewApp } from './preview/PreviewApp'

// A file preview window loads the same document with ?view=file-preview and
// receives window.preview instead of window.app (file-preview-window spec).
function root(): React.JSX.Element {
  if (new URLSearchParams(window.location.search).get('view') !== PREVIEW_VIEW_QUERY) {
    return <App />
  }
  if (!window.preview) {
    throw new Error('The file preview bridge is missing.')
  }
  return <PreviewApp preview={window.preview} />
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>{root()}</React.StrictMode>,
)
