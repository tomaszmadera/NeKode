// Structural subset of Electron's IpcRenderer so the bridge can be unit-tested
// without importing electron (SDD §6: the bridge is the only renderer access path).

export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (...args: unknown[]) => void): void
  off(channel: string, listener: (...args: unknown[]) => void): void
}
