/// <reference types="vite/client" />

import type { AppApi } from '../../shared/ipc-contract'

declare global {
  interface Window {
    app: AppApi
  }
}
