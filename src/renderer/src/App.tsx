import type React from 'react'

export default function App(): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-950 text-neutral-100 antialiased">
      <header className="flex h-10 items-center justify-between border-b border-neutral-800 px-4 text-xs font-medium text-neutral-400">
        <div>NeKode</div>
        <div>MVP Bootstrap</div>
      </header>
      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-neutral-400">Agent-First Coding Environment</p>
      </main>
    </div>
  )
}
