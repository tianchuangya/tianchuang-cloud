import { describe, expect, it } from 'vitest'
import { shouldShowSystemNotification } from '../electron/notify.js'
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../electron/types.js'

describe('system notification gating', () => {
  it('notifies for completed and failed syncs by default', () => {
    expect(shouldShowSystemNotification(DEFAULT_NOTIFICATION_PREFERENCES, 'complete')).toBe(true)
    expect(shouldShowSystemNotification(DEFAULT_NOTIFICATION_PREFERENCES, 'error')).toBe(true)
  })

  it('never notifies for intermediate progress phases', () => {
    for (const phase of ['checking', 'downloading', 'uploading', 'finalizing'] as const) {
      expect(shouldShowSystemNotification(DEFAULT_NOTIFICATION_PREFERENCES, phase)).toBe(false)
    }
  })

  it('respects the individual success and failure toggles', () => {
    const muted: { syncSuccess: boolean; syncFailure: boolean } = { syncSuccess: false, syncFailure: true }
    expect(shouldShowSystemNotification(muted, 'complete')).toBe(false)
    expect(shouldShowSystemNotification(muted, 'error')).toBe(true)
  })
})
