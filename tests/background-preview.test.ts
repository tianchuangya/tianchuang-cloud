import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBackgroundPreviewController } from '../src/components/background-preview.js'

function setup() {
  const onPreviewChange = vi.fn()
  const onCommit = vi.fn()
  const controller = createBackgroundPreviewController({ onPreviewChange, onCommit })
  return { controller, onPreviewChange, onCommit }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('immersive background preview controller', () => {
  it('does not enter immersive preview when the pointer leaves before one second', () => {
    const { controller, onPreviewChange } = setup()

    controller.start('aurora')
    vi.advanceTimersByTime(600)
    controller.cancel()
    vi.advanceTimersByTime(2000)

    expect(onPreviewChange).not.toHaveBeenCalled()
  })

  it('enters immersive preview only after a full second of dwell', () => {
    const { controller, onPreviewChange } = setup()

    controller.start('aurora')
    vi.advanceTimersByTime(999)
    expect(onPreviewChange).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onPreviewChange).toHaveBeenCalledTimes(1)
    expect(onPreviewChange).toHaveBeenCalledWith('aurora')
  })

  it('restores immediately on pointer movement without waiting', () => {
    const { controller, onPreviewChange } = setup()

    controller.start('topography')
    vi.advanceTimersByTime(1000)
    expect(onPreviewChange).toHaveBeenLastCalledWith('topography')

    controller.restore()
    expect(onPreviewChange).toHaveBeenLastCalledWith(undefined)

    controller.restore()
    expect(onPreviewChange).toHaveBeenCalledTimes(2)
  })

  it('persists the choice only through commit, never through previewing', () => {
    const { controller, onPreviewChange, onCommit } = setup()

    controller.start('threads')
    vi.advanceTimersByTime(1000)
    expect(onPreviewChange).toHaveBeenCalledWith('threads')
    expect(onCommit).not.toHaveBeenCalled()

    controller.cancel()
    expect(onPreviewChange).toHaveBeenLastCalledWith(undefined)
    expect(onCommit).not.toHaveBeenCalled()

    controller.commit('threads')
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('threads')
  })

  it('restarts the dwell timer when hovering a different option mid-dwell', () => {
    const { controller, onPreviewChange } = setup()

    controller.start('aurora')
    vi.advanceTimersByTime(800)
    controller.start('ripple')
    vi.advanceTimersByTime(800)
    expect(onPreviewChange).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)
    expect(onPreviewChange).toHaveBeenCalledTimes(1)
    expect(onPreviewChange).toHaveBeenCalledWith('ripple')
  })

  it('ignores preview requests for the static option but still commits it', () => {
    const { controller, onPreviewChange, onCommit } = setup()

    controller.start('none')
    vi.advanceTimersByTime(5000)
    expect(onPreviewChange).not.toHaveBeenCalled()

    controller.commit('none')
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('none')
    expect(onPreviewChange).not.toHaveBeenCalled()
  })

  it('dispose cancels a pending preview without persisting anything', () => {
    const { controller, onPreviewChange, onCommit } = setup()

    controller.start('iridescence')
    controller.dispose()
    vi.advanceTimersByTime(5000)

    expect(onPreviewChange).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('dispose exits an active preview and reports the change', () => {
    const { controller, onPreviewChange, onCommit } = setup()

    controller.start('iridescence')
    vi.advanceTimersByTime(1000)
    controller.dispose()

    expect(onPreviewChange).toHaveBeenLastCalledWith(undefined)
    expect(onCommit).not.toHaveBeenCalled()
  })
})
