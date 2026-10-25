import { cn } from '../../lib/cn'
import type { LucideIcon } from '../../lib/icons'
import { Icon } from '../../lib/icons'

/** Visible focus ring. The settings reference omits it; the product requires it. */
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export const selectClass = cn(
  'h-9 w-full appearance-none rounded-[8px] border border-edge bg-button px-3 pr-9 text-[13px] text-ink',
  focusRing,
)

export const textClass = cn(
  'h-9 w-full rounded-[8px] border border-edge bg-field px-3 text-[13px] text-ink',
  focusRing,
)

export const monoClass = cn(textClass, 'font-mono text-xs')

export const primaryClass = cn(
  'inline-flex h-9 items-center justify-center rounded-[8px] border border-accent bg-accent px-[18px] text-[13px] font-semibold text-on-accent disabled:opacity-50',
  focusRing,
)

export const secondaryClass = cn(
  'inline-flex h-9 items-center justify-center rounded-[8px] border border-edge bg-button px-3.5 text-[13px] font-medium text-ink disabled:opacity-50',
  focusRing,
)

export const quietClass = cn(
  'inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2 text-xs font-medium text-ink-secondary hover:bg-highlight hover:text-ink disabled:opacity-50',
  focusRing,
)

const rowGrid = 'grid items-center gap-6 px-4 py-3'
const divided = 'border-t border-edge'

export function PageIntro({
  title,
  description,
}: {
  title: string
  description: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold text-project-title">{title}</h2>
      <p className="text-[13px] text-ink-muted">{description}</p>
    </div>
  )
}

export function SectionLabel({
  title,
  action,
}: {
  title: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <h3 className="m-0 flex-1 text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
        {title}
      </h3>
      {action}
    </div>
  )
}

export function SettingsGroup({
  children,
  label,
}: {
  children: React.ReactNode
  label: string
}): React.JSX.Element {
  return (
    <section aria-label={label} className="flex flex-col gap-2.5">
      {children}
    </section>
  )
}

export function GroupBox({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-[10px] border border-edge bg-group">{children}</div>
  )
}

export function FieldRow({
  label,
  htmlFor,
  description,
  divided: split = false,
  children,
}: {
  label: React.ReactNode
  htmlFor?: string
  description?: string
  divided?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const text = <span className="text-[13px] font-medium text-ink">{label}</span>
  return (
    <div className={cn(rowGrid, 'grid-cols-[minmax(0,1fr)_280px]', split && divided)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        {htmlFor ? <label htmlFor={htmlFor}>{text}</label> : text}
        {description ? <span className="text-xs text-ink-muted">{description}</span> : null}
      </div>
      {children}
    </div>
  )
}

/** 38×22 track inside a 36 px hit target. Off uses the border token; on uses accent. */
export function SwitchControl({
  checked,
  disabled = false,
  labelledBy,
  label,
  describedBy,
  testId,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  labelledBy?: string
  label?: string
  describedBy?: string
  testId?: string
  onChange: (next: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      aria-describedby={describedBy}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex h-9 w-12 shrink-0 items-center justify-center rounded-full',
        disabled ? 'cursor-default opacity-40' : 'cursor-pointer',
        focusRing,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'relative h-[22px] w-[38px] rounded-full transition-colors duration-fast',
          checked ? 'bg-accent' : 'bg-edge',
        )}
      >
        <span
          className={cn(
            'absolute top-[3px] h-4 w-4 rounded-full bg-switch-knob shadow-sm transition-[left] duration-fast',
            checked ? 'left-[19px]' : 'left-[3px]',
          )}
        />
      </span>
    </button>
  )
}

export function SettingsSwitch({
  id,
  label,
  description,
  checked,
  disabled = false,
  divided: split = false,
  testId,
  onChange,
}: {
  id: string
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  divided?: boolean
  testId?: string
  onChange: (next: boolean) => void
}): React.JSX.Element {
  const descId = description ? `${id}-desc` : undefined
  return (
    <div className={cn(rowGrid, 'grid-cols-[minmax(0,1fr)_auto]', split && divided)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span id={id} className="text-[13px] font-medium text-ink">
          {label}
        </span>
        {description ? (
          <span id={descId} className="text-xs text-ink-muted">
            {description}
          </span>
        ) : null}
      </div>
      <SwitchControl
        checked={checked}
        disabled={disabled}
        labelledBy={id}
        describedBy={descId}
        testId={testId}
        onChange={onChange}
      />
    </div>
  )
}

/** Muted "· required" after a field label. Replaces a red asterisk. */
export function RequiredMark(): React.JSX.Element {
  return <span className="font-normal text-ink-muted"> · required</span>
}

export function InfoStrip({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2.5 border-t border-edge px-4 py-2.5 text-xs leading-normal text-ink-muted">
      <Icon.info size={13} aria-hidden className="mt-0.5 shrink-0 text-ink-secondary" />
      <span>{children}</span>
    </div>
  )
}

export function StackedRow({
  label,
  htmlFor,
  help,
  divided: split = false,
  dimmed = false,
  children,
}: {
  label: React.ReactNode
  htmlFor: string
  help?: React.ReactNode
  divided?: boolean
  dimmed?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={cn('flex flex-col gap-2 px-4 py-3', split && divided, dimmed && 'opacity-50')}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {help ? <div className="text-xs leading-normal text-ink-muted">{help}</div> : null}
    </div>
  )
}

export function GroupFooter({
  status,
  children,
}: {
  status?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2.5 border-t border-edge bg-dialog px-4 py-3',
        'rounded-b-[10px]',
      )}
    >
      {status ? (
        <div className="min-w-0 flex-1 text-xs text-ink-muted">{status}</div>
      ) : (
        <span className="flex-1" />
      )}
      {children}
    </div>
  )
}

export function SettingsSelect({
  id,
  value,
  disabled = false,
  testId,
  invalid = false,
  required = false,
  selectRef,
  onChange,
  children,
}: {
  id: string
  value: string
  disabled?: boolean
  testId?: string
  invalid?: boolean
  required?: boolean
  selectRef?: React.Ref<HTMLSelectElement>
  onChange: (value: string) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span className="relative block">
      <select
        ref={selectRef}
        id={id}
        value={value}
        disabled={disabled}
        required={required}
        data-testid={testId}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        className={cn(selectClass, 'disabled:opacity-50', invalid && 'border-error')}
      >
        {children}
      </select>
      <Icon.chevronDown
        size={14}
        aria-hidden
        className="pointer-events-none absolute top-[11px] right-3 text-ink-secondary"
      />
    </span>
  )
}

export function NavIcon({ icon: Glyph }: { icon: LucideIcon }): React.JSX.Element {
  return <Glyph size={16} aria-hidden className="shrink-0" />
}

/**
 * Saved-secret control. `masked` set shows the mask with Change and Clear.
 * `masked` null shows the password field, and Cancel when `onCancel` is set.
 */
export function MaskedKeyControl({
  masked,
  value,
  inputId,
  placeholder,
  invalid = false,
  onValueChange,
  onEdit,
  onClear,
  onCancel,
  previewTestId,
  inputTestId,
  editTestId,
  clearTestId,
  cancelTestId,
  tone = 'mask',
}: {
  masked: string | null
  value: string
  inputId?: string
  placeholder?: string
  invalid?: boolean
  onValueChange: (value: string) => void
  onEdit: () => void
  onClear?: () => void
  onCancel?: () => void
  previewTestId?: string
  inputTestId?: string
  editTestId?: string
  clearTestId?: string
  cancelTestId?: string
  tone?: 'mask' | 'stored'
}): React.JSX.Element {
  if (masked !== null) {
    return (
      <span className="flex items-center gap-1.5">
        <span
          data-testid={previewTestId}
          className={cn(
            'mr-1.5 inline-flex items-center gap-1.5 text-[13px]',
            tone === 'stored'
              ? 'font-medium text-success'
              : 'font-mono tracking-wide text-ink-secondary',
            invalid && 'rounded-[8px] border border-error px-2 py-1',
          )}
        >
          {tone === 'stored' ? <Icon.checkSmall size={13} aria-hidden /> : null}
          {masked}
        </span>
        <button type="button" data-testid={editTestId} onClick={onEdit} className={secondaryClass}>
          Change
        </button>
        {onClear ? (
          <button
            type="button"
            data-testid={clearTestId}
            onClick={onClear}
            className={cn(secondaryClass, 'text-error')}
          >
            Clear
          </button>
        ) : null}
      </span>
    )
  }
  return (
    <span className="flex w-[280px] items-center gap-1.5">
      <input
        id={inputId}
        type="password"
        data-testid={inputTestId}
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(monoClass, invalid && 'border-error')}
      />
      {onCancel ? (
        <button
          type="button"
          data-testid={cancelTestId}
          onClick={onCancel}
          className={secondaryClass}
        >
          Cancel
        </button>
      ) : null}
    </span>
  )
}

/** Renders a chord such as `Ctrl+V / Ctrl+Shift+V` as key chips joined by "or". */
export function ShortcutKeys({ chord }: { chord: string }): React.JSX.Element {
  const combos = chord.split(' / ')
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      <span className="sr-only">{chord}</span>
      {combos.map((combo, index) => (
        <span key={combo} className="inline-flex items-center gap-1.5">
          {index > 0 ? <span className="text-xs text-ink-muted">or</span> : null}
          <span className="inline-flex gap-1">
            {combo.split('+').map((key) => (
              <kbd
                key={`${combo}-${key}`}
                className="inline-flex h-6 min-w-6 items-center justify-center rounded-[5px] border border-edge border-b-2 bg-button px-[7px] font-mono text-xs font-medium text-ink"
              >
                {key}
              </kbd>
            ))}
          </span>
        </span>
      ))}
    </span>
  )
}
