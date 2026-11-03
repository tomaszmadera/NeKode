import { APP_STATE_KEY } from '@shared/ipc-contract'
import { useCallback, useRef, useState } from 'react'
import { errorMessage } from '../../lib/app-error-message'
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

  const setMode = useCallback(
    (next: WorkspaceLayoutMode): void => {
      setModeState((current) => {
        if (current === next) {
          return current
        }
        layoutTouchedRef.current = true
        persist(APP_STATE_KEY.workspaceLayout, next, 'Failed to save the layout.')
        return next
      })
    },
    [persist],
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
    rightOpenTouchedRef.current = true
    setRightOpenState((current) => {
      const next = !current
      persist(APP_STATE_KEY.rightRegionOpen, next ? '1' : '0', 'Failed to save the right panel.')
      return next
    })
  }, [persist])

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
    setMode,
    setLeftOpen,
    toggleLeft,
    toggleRight,
    restoreRegionSizes,
    restoreWorkspaceLayout,
  }
}
