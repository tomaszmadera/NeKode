import type React from 'react'
import { useCallback, useEffect, useRef } from 'react'

/** Returns all tab-focusable elements within container in DOM order. */
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const elements = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
    ),
  )
  return elements.filter((el) => {
    return (
      el.tabIndex >= 0 && !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true'
    )
  })
}

/**
 * Traps Tab and Shift+Tab navigation within a container.
 * Returns true if Tab key event was handled and prevented, false otherwise.
 */
function trapDialogFocus(
  event: KeyboardEvent | React.KeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
): boolean {
  if (event.key !== 'Tab' || !container) {
    return false
  }
  const controls = getFocusableElements(container)
  if (controls.length === 0) {
    event.preventDefault()
    return true
  }
  const active = document.activeElement as HTMLElement | null
  const index = active ? controls.indexOf(active) : -1
  const next =
    index < 0
      ? event.shiftKey
        ? controls.length - 1
        : 0
      : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
  event.preventDefault()
  controls[next]?.focus()
  return true
}

export interface UseDialogFocusTrapOptions {
  containerRef: React.RefObject<HTMLElement | null>
  active?: boolean
  initialFocusRef?: React.RefObject<HTMLElement | null>
  onEscape?: () => void
  returnFocus?: boolean
  autoFocus?: boolean
}

export interface DialogFocusTrapResult {
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
}

/**
 * Modal focus trap hook:
 * - Traps Tab / Shift+Tab cycling within containerRef.
 * - Handles Escape dismissing via onEscape.
 * - Sets initial focus on mount (initialFocusRef or first focusable control).
 * - Restores previous focus on unmount.
 */
export function useDialogFocusTrap({
  containerRef,
  active = true,
  initialFocusRef,
  onEscape,
  returnFocus = true,
  autoFocus = true,
}: UseDialogFocusTrapOptions): DialogFocusTrapResult {
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active) return

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    if (autoFocus) {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus()
      } else if (containerRef.current) {
        const controls = getFocusableElements(containerRef.current)
        controls[0]?.focus()
      }
    }

    return () => {
      if (returnFocus && previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus()
      }
    }
  }, [active, autoFocus, containerRef, initialFocusRef, returnFocus])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement> | KeyboardEvent) => {
      if (!active || event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        event.preventDefault()
        onEscape?.()
        return
      }
      if (event.key === 'Tab' && containerRef.current) {
        trapDialogFocus(event, containerRef.current)
      }
    },
    [active, containerRef, onEscape],
  )

  useEffect(() => {
    if (!active) return

    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        handleKeyDown(event)
        return
      }
      if (event.key === 'Tab') {
        const isInside =
          event.target instanceof Node && (containerRef.current?.contains(event.target) ?? false)
        if (
          isInside ||
          !document.activeElement ||
          document.activeElement === document.body ||
          document.activeElement === document.documentElement
        ) {
          handleKeyDown(event)
        }
      }
    }

    window.addEventListener('keydown', listener)
    return () => {
      window.removeEventListener('keydown', listener)
    }
  }, [active, containerRef, handleKeyDown])

  return {
    onKeyDown: handleKeyDown as (event: React.KeyboardEvent<HTMLElement>) => void,
  }
}
