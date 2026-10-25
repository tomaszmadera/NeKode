import { useState } from 'react'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
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
import {
  FieldRow,
  focusRing,
  GroupBox,
  GroupFooter,
  monoClass,
  PageIntro,
  primaryClass,
  SectionLabel,
  SettingsGroup,
  secondaryClass,
} from './settings-ui'

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
  const sizeIndex = TERMINAL_FONT_SIZES.indexOf(size as (typeof TERMINAL_FONT_SIZES)[number])
  const step = (direction: -1 | 1): void => {
    const next = TERMINAL_FONT_SIZES[sizeIndex + direction]
    if (isTerminalFontSize(next)) onSizeChange(next)
  }
  return (
    <form
      className="flex max-w-[660px] flex-col gap-7"
      onSubmit={(event) => {
        event.preventDefault()
        setValidation(true)
        if (textValid && iconsValid) onFamiliesChange({ text: text.trim(), icons: icons.trim() })
      }}
    >
      <PageIntro
        title="Fonts"
        description="Terminal typography. Bundled fonts are the default; custom fonts must be installed on this computer."
      />
      <p id="font-family-help" className="sr-only">
        Defaults are bundled. Custom fonts must be installed on your computer. Enter one family name
        per field (up to 100 characters). Missing fonts fall back to bundled symbols, Consolas,
        Courier New and monospace.
      </p>
      <SettingsGroup label="Terminal fonts">
        <SectionLabel title="Terminal" />
        <GroupBox>
          <FieldRow
            label="Text font"
            htmlFor="terminal-text-font"
            description="One family name, up to 100 characters."
          >
            <span className="block">
              <input
                id="terminal-text-font"
                value={text}
                spellCheck={false}
                onChange={(event) => setText(event.target.value)}
                aria-describedby="font-family-help text-font-error"
                aria-invalid={validation && !textValid}
                className={cn(monoClass, validation && !textValid && 'border-error')}
              />
              <p id="text-font-error" className="mt-1 text-xs text-error">
                {validation && !textValid ? 'Enter a valid single font family name.' : null}
              </p>
            </span>
          </FieldRow>
          <FieldRow
            label="Icon font"
            htmlFor="terminal-icon-font"
            description="Nerd Font family for prompt glyphs and icons."
            divided
          >
            <span className="block">
              <input
                id="terminal-icon-font"
                value={icons}
                spellCheck={false}
                onChange={(event) => setIcons(event.target.value)}
                aria-describedby="font-family-help icon-font-error"
                aria-invalid={validation && !iconsValid}
                className={cn(monoClass, validation && !iconsValid && 'border-error')}
              />
              <p id="icon-font-error" className="mt-1 text-xs text-error">
                {validation && !iconsValid ? 'Enter a valid single font family name.' : null}
              </p>
            </span>
          </FieldRow>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 border-t border-edge px-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span id="app-terminal-font-size" className="text-[13px] font-medium text-ink">
                Font size
              </span>
              <span className="text-xs text-ink-muted">
                {size === DEFAULT_TERMINAL_FONT_SIZE ? 'Default size.' : 'Default is 15 px.'}
              </span>
            </div>
            <fieldset
              aria-labelledby="app-terminal-font-size"
              className="m-0 inline-flex min-w-0 items-center gap-0.5 rounded-[9px] border border-edge bg-field p-[3px]"
            >
              <button
                type="button"
                aria-label="Smaller"
                disabled={sizeIndex <= 0}
                onClick={() => step(-1)}
                className={cn(
                  'inline-flex h-9 w-9 items-center justify-center rounded-[6px] text-ink-secondary disabled:opacity-40',
                  focusRing,
                )}
              >
                <Icon.minus size={16} aria-hidden />
              </button>
              <span
                data-testid={TEST_ID.settingsTerminalFontSize}
                data-value={String(size)}
                className="min-w-11 text-center font-mono text-[13px] text-project-title"
              >
                {size} px
              </span>
              <button
                type="button"
                aria-label="Larger"
                disabled={sizeIndex < 0 || sizeIndex >= TERMINAL_FONT_SIZES.length - 1}
                onClick={() => step(1)}
                className={cn(
                  'inline-flex h-9 w-9 items-center justify-center rounded-[6px] text-ink-secondary disabled:opacity-40',
                  focusRing,
                )}
              >
                <Icon.plus size={16} aria-hidden />
              </button>
            </fieldset>
          </div>
          <div className="flex flex-col gap-2 border-t border-edge px-4 py-3.5">
            <span className="text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
              Preview
            </span>
            <section
              className="overflow-x-auto rounded-[8px] border border-edge bg-terminal px-4 py-3.5 text-ink"
              aria-label="Terminal font preview"
              style={{ fontFamily: terminalFontStack(preview), fontSize: size, lineHeight: 1.5 }}
            >
              <p className="whitespace-pre">NeKode ~/project main 12:34</p>
              <p className="whitespace-pre">{TERMINAL_ICON_PREVIEW} AaBb 0123456789</p>
            </section>
            <span className="text-xs text-ink-muted">
              Missing fonts fall back to bundled symbols, Consolas, Courier New and monospace.
            </span>
          </div>
          <GroupFooter
            status={
              <span role="status">
                Applied: {families.text}; icons: {families.icons}
              </span>
            }
          >
            <button
              type="button"
              className={secondaryClass}
              onClick={() => {
                setText(DEFAULT_TERMINAL_FONT_FAMILIES.text)
                setIcons(DEFAULT_TERMINAL_FONT_FAMILIES.icons)
                setValidation(false)
                onFamiliesChange(DEFAULT_TERMINAL_FONT_FAMILIES)
                onSizeChange(DEFAULT_TERMINAL_FONT_SIZE)
              }}
            >
              Restore defaults
            </button>
            <button type="submit" className={primaryClass}>
              Apply
            </button>
          </GroupFooter>
        </GroupBox>
      </SettingsGroup>
    </form>
  )
}
