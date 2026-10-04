import { useState } from 'react'
import {
  DEFAULT_TERMINAL_FONT_FAMILIES,
  DEFAULT_TERMINAL_FONT_SIZE,
  isTerminalFontFamily,
  isTerminalFontSize,
  TERMINAL_FONT_SIZES,
  TERMINAL_ICON_PREVIEW,
  type TerminalFontFamilies,
  terminalFontStack,
} from '../../lib/terminal-font'
import { TEST_ID } from '../../lib/test-ids'

interface FontsSettingsProps {
  families: TerminalFontFamilies
  size: number
  onFamiliesChange: (families: TerminalFontFamilies) => void
  onSizeChange: (size: number) => void
}

export function FontsSettings({
  families,
  size,
  onFamiliesChange,
  onSizeChange,
}: FontsSettingsProps): React.JSX.Element {
  const [text, setText] = useState(families.text)
  const [icons, setIcons] = useState(families.icons)
  const [validation, setValidation] = useState(false)
  const textValid = isTerminalFontFamily(text.trim())
  const iconsValid = isTerminalFontFamily(icons.trim())
  const preview = textValid && iconsValid ? { text: text.trim(), icons: icons.trim() } : families
  const inputClass =
    'mt-2 h-control w-full rounded-md border border-edge bg-app px-3 text-sm text-ink focus-visible:outline focus-visible:outline-info'
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        setValidation(true)
        if (textValid && iconsValid) onFamiliesChange({ text: text.trim(), icons: icons.trim() })
      }}
    >
      <h3 className="text-sm font-semibold">Terminal fonts</h3>
      <p id="font-family-help" className="mt-2 text-xs text-ink-muted">
        Defaults are bundled. Custom fonts must be installed on your computer. Enter one family name
        per field (up to 100 characters). Missing fonts fall back to bundled symbols, Consolas,
        Courier New and monospace.
      </p>
      <label htmlFor="terminal-text-font" className="mt-4 block text-sm text-ink-secondary">
        Terminal text font
      </label>
      <input
        id="terminal-text-font"
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-describedby="font-family-help text-font-error"
        aria-invalid={validation && !textValid}
        className={inputClass}
      />
      <p id="text-font-error" className="text-xs text-error">
        {validation && !textValid ? 'Enter a valid single font family name.' : null}
      </p>
      <label htmlFor="terminal-icon-font" className="mt-4 block text-sm text-ink-secondary">
        Terminal icon font
      </label>
      <input
        id="terminal-icon-font"
        value={icons}
        onChange={(event) => setIcons(event.target.value)}
        aria-describedby="font-family-help icon-font-error"
        aria-invalid={validation && !iconsValid}
        className={inputClass}
      />
      <p id="icon-font-error" className="text-xs text-error">
        {validation && !iconsValid ? 'Enter a valid single font family name.' : null}
      </p>
      <label htmlFor="app-terminal-font-size" className="mt-4 block text-sm text-ink-secondary">
        Terminal font size
      </label>
      <select
        id="app-terminal-font-size"
        value={String(size)}
        data-testid={TEST_ID.settingsTerminalFontSize}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (isTerminalFontSize(next)) onSizeChange(next)
        }}
        className={inputClass}
      >
        {TERMINAL_FONT_SIZES.map((option) => (
          <option key={option} value={String(option)}>
            {option === DEFAULT_TERMINAL_FONT_SIZE ? `${option} (default)` : option}
          </option>
        ))}
      </select>
      <section
        className="mt-4 overflow-x-auto rounded-md border border-edge bg-terminal p-3 text-ink"
        aria-label="Terminal font preview"
        style={{ fontFamily: terminalFontStack(preview), fontSize: size }}
      >
        <p className="whitespace-pre">NeKode ~/project main 12:34</p>
        <p className="whitespace-pre">{TERMINAL_ICON_PREVIEW} AaBb 0123456789</p>
      </section>
      <p className="mt-2 break-all text-xs text-ink-muted">
        Applied: {families.text}; icons: {families.icons}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          className="rounded-md bg-button px-3 py-2 text-sm focus-visible:outline focus-visible:outline-info"
        >
          Apply font families
        </button>
        <button
          type="button"
          className="rounded-md border border-edge px-3 py-2 text-sm focus-visible:outline focus-visible:outline-info"
          onClick={() => {
            setText(DEFAULT_TERMINAL_FONT_FAMILIES.text)
            setIcons(DEFAULT_TERMINAL_FONT_FAMILIES.icons)
            setValidation(false)
            onFamiliesChange(DEFAULT_TERMINAL_FONT_FAMILIES)
            onSizeChange(DEFAULT_TERMINAL_FONT_SIZE)
          }}
        >
          Restore font defaults
        </button>
      </div>
    </form>
  )
}
