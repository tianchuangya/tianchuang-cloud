import { useEffect, useRef, useState } from 'react'
import type { BackgroundEffect } from './cursor-preferences'

export const BACKGROUND_PREVIEW_DWELL_MS = 1000

export type BackgroundPreviewPhase = 'idle' | 'pending' | 'active'

export interface BackgroundPreviewCallbacks {
  onPreviewChange: (effect: BackgroundEffect | undefined) => void
  onCommit: (effect: BackgroundEffect) => void
}

export interface BackgroundPreviewController {
  start(effect: BackgroundEffect): void
  cancel(): void
  restore(): void
  commit(effect: BackgroundEffect): void
  dispose(): void
}

// 沉浸背景预览状态机：指针停留满 1 秒才进入预览（pending -> active），
// 预览期间任何指针移动立即退出；只有 commit（点击选项）会触发 onCommit 持久化。
export function createBackgroundPreviewController(callbacks: BackgroundPreviewCallbacks): BackgroundPreviewController {
  let phase: BackgroundPreviewPhase = 'idle'
  let timer: ReturnType<typeof setTimeout> | undefined

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const exit = () => {
    clearTimer()
    const wasActive = phase === 'active'
    phase = 'idle'
    if (wasActive) callbacks.onPreviewChange(undefined)
  }

  return {
    start(effect) {
      if (effect === 'none') return
      exit()
      phase = 'pending'
      timer = setTimeout(() => {
        timer = undefined
        phase = 'active'
        callbacks.onPreviewChange(effect)
      }, BACKGROUND_PREVIEW_DWELL_MS)
    },
    cancel: exit,
    restore: exit,
    commit(effect) {
      exit()
      callbacks.onCommit(effect)
    },
    dispose: exit,
  }
}

export function useBackgroundPreview(callbacks: BackgroundPreviewCallbacks) {
  const [immersivePreview, setImmersivePreview] = useState<BackgroundEffect>()
  const callbacksRef = useRef(callbacks)
  useEffect(() => {
    callbacksRef.current = callbacks
  })
  const controllerRef = useRef<BackgroundPreviewController | undefined>(undefined)
  useEffect(() => {
    controllerRef.current = createBackgroundPreviewController({
      onPreviewChange: (effect) => {
        setImmersivePreview(effect)
        callbacksRef.current.onPreviewChange(effect)
      },
      onCommit: (effect) => callbacksRef.current.onCommit(effect),
    })
    return () => {
      controllerRef.current?.dispose()
      controllerRef.current = undefined
    }
  }, [])
  useEffect(() => {
    if (!immersivePreview) return
    const restore = () => controllerRef.current?.restore()
    window.addEventListener('pointermove', restore, { once: true })
    return () => window.removeEventListener('pointermove', restore)
  }, [immersivePreview])
  return {
    immersivePreview,
    startPreview: (effect: BackgroundEffect) => controllerRef.current?.start(effect),
    cancelPreview: () => controllerRef.current?.cancel(),
    commitPreview: (effect: BackgroundEffect) => controllerRef.current?.commit(effect),
  }
}
