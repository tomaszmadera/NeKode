import { APP_STATE_KEY } from '@shared/ipc-contract'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../../lib/app-error-message'
import { isLeftPanelChord, isRightPanelChord } from '../../lib/panel-chords'
import {
  BOTTOM_REGION_SIZE,
  clampRegionSize,
  LEFT_REGION_SIZE,
  type RegionSizeLimits,
  RIGHT_REGION_SIZE,
  useResizableRegion,
} from '../useResizableRegion'
import type { AppApi, SetNotice } from './useWorkspaceRuntime'

export type WorkspaceLayoutMode = 'two' | 'three'

export function parsePersistedSize(value: string | null, limits: RegionSizeLimits): number {
  if (value === null || value.trim().length === 0) {
    return limits.default
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? clampRegionSize(parsed, limits) : limits.default
}

export function parseWorkspaceLayout(value: string | null): WorkspaceLayoutMode {
  return value === 'three' ? 'three' : 'two'
}

/** Missing or any value other than `0` means shown (workspace-layout spec Behaviour 10). */
export function parsePanelOpen(value: string | null): boolean {
  return value !== '0'
}

/** Left and right panel width, layout mode, open flags, and bottom panel height. */
export function useLayoutRegions(app: AppApi, setNotice: SetNotice) {
  const [leftWidth, setLeftWidth] = useState(LEFT_REGION_SIZE.default)
  const [rightWidth, setRightWidth] = useState(RIGHT_REGION_SIZE.default)
  const [bottomHeight, setBottomHeight] = useState(BOTTOM_REGION_SIZE.default)
  const [mode, setModeState] = useState<WorkspaceLayoutMode>('two')
  const [leftOpen, setLeftOpenState] = useState(true)
  const [rightOpen, setRightOpenState] = useState(true)
  const layoutTouchedRef = useRef(false)
  const leftOpenTouchedRef = useRef(false)
  const rightOpenTouchedRef = useRef(false)

  const persist = useCallback(
    (key: string, value: string, failure: string): void => {
      void app.state.set(key, value).catch((error: unknown) => {
        setNotice(errorMessage(error, failure))
      })
    },
    [app, setNotice],
  )

  const handleLeftResizeEnd = useCallback(
    (size: number): void => {
      persist(APP_STATE_KEY.leftRegionWidth, String(size), 'Failed to save the panel width.')
    },
    [persist],
  )

  const handleRightResizeEnd = useCallback(
    (size: number): void => {
      persist(APP_STATE_KEY.rightRegionWidth, String(size), 'Failed to save the panel width.')
    },
    [persist],
  )

  const handleBottomResizeEnd = useCallback(
    (size: number): void => {
      persist(APP_STATE_KEY.bottomRegionHeight, String(size), 'Failed to save the panel height.')
    },
    [persist],
  )

  const restoreRegionSizes = useCallback(
    (savedLeftWidth: string | null, savedBottomHeight: string | null): void => {
      setLeftWidth(parsePersistedSize(savedLeftWidth, LEFT_REGION_SIZE))
      setBottomHeight(parsePersistedSize(savedBottomHeight, BOTTOM_REGION_SIZE))
    },
    [],
  )

  const restoreWorkspaceLayout = useCallback(
    (
      savedLayout: string | null,
      savedRightWidth: string | null,
      savedLeftOpen: string | null,
      savedRightOpen: string | null,
    ): void => {
      if (!layoutTouchedRef.current) {
        setModeState(parseWorkspaceLayout(savedLayout))
      }
      setRightWidth(parsePersistedSize(savedRightWidth, RIGHT_REGION_SIZE))
      if (!leftOpenTouchedRef.current) {
        setLeftOpenState(parsePanelOpen(savedLeftOpen))
      }
      if (!rightOpenTouchedRef.current) {
        setRightOpenState(parsePanelOpen(savedRightOpen))
      }
    },
    [],
  )

  const setLeftOpen = useCallback(
    (open: boolean): void => {
      leftOpenTouchedRef.current = true
      setLeftOpenState((current) => {
        if (current === open) {
          return current
        }
        persist(APP_STATE_KEY.leftRegionOpen, open ? '1' : '0', 'Failed to save the left panel.')
        return open
      })
    },
    [persist],
  )

  const toggleLeft = useCallback((): void => {
    leftOpenTouchedRef.current = true
    setLeftOpenState((current) => {
      const next = !current
      persist(APP_STATE_KEY.leftRegionOpen, next ? '1' : '0', 'Failed to save the left panel.')
      return next
    })
  }, [persist])

  const toggleRight = useCallback((): void => {
    const next = !(mode === 'three' && rightOpen)
    const nextMode = next ? 'three' : 'two'
    layoutTouchedRef.current = true
    rightOpenTouchedRef.current = true
    setModeState(nextMode)
    setRightOpenState(next)
    persist(APP_STATE_KEY.workspaceLayout, nextMode, 'Failed to save the layout.')
    persist(APP_STATE_KEY.rightRegionOpen, next ? '1' : '0', 'Failed to save the right panel.')
  }, [mode, rightOpen, persist])

  const toggleLeftRef = useRef(toggleLeft)
  toggleLeftRef.current = toggleLeft
  const toggleRightRef = useRef(toggleRight)
  toggleRightRef.current = toggleRight

  // Ctrl+B toggles the left panel, Ctrl+Alt+B toggles the right panel,
  // capture phase so it wins over a focused terminal or editor;
  // an open modal dialog swallows the chord.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) {
        return
      }
      const isLeft = isLeftPanelChord(event)
      const isRight = isRightPanelChord(event)
      if (!isLeft && !isRight) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (document.querySelector('[aria-modal="true"]') !== null) {
        return
      }
      if (isLeft) {
        toggleLeftRef.current()
      } else {
        toggleRightRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])

  const leftRegion = useResizableRegion({
    axis: 'x',
    minSize: LEFT_REGION_SIZE.min,
    maxSize: LEFT_REGION_SIZE.max,
    size: leftWidth,
    onSizeChange: setLeftWidth,
    onResizeEnd: handleLeftResizeEnd,
  })
  const rightRegion = useResizableRegion({
    axis: 'x',
    edge: 'end',
    minSize: RIGHT_REGION_SIZE.min,
    maxSize: RIGHT_REGION_SIZE.max,
    size: rightWidth,
    onSizeChange: setRightWidth,
    onResizeEnd: handleRightResizeEnd,
  })
  const bottomRegion = useResizableRegion({
    axis: 'y',
    minSize: BOTTOM_REGION_SIZE.min,
    maxSize: BOTTOM_REGION_SIZE.max,
    size: bottomHeight,
    onSizeChange: setBottomHeight,
    onResizeEnd: handleBottomResizeEnd,
  })

  return {
    mode,
    leftOpen,
    rightOpen,
    leftWidth,
    rightWidth,
    bottomHeight,
    leftRegion,
    rightRegion,
    bottomRegion,
    setLeftOpen,
    toggleLeft,
    toggleRight,
    restoreRegionSizes,
    restoreWorkspaceLayout,
  }
}
