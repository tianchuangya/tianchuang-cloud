import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProgressOverlay } from '../src/components/SyncDialogs.js'
import type { SyncProgress } from '../electron/types.js'

function render(progress: SyncProgress): string {
  return renderToStaticMarkup(<ProgressOverlay progress={progress} onClose={() => undefined} onCancel={() => undefined} />)
}

describe('sync progress cancellation UI', () => {
  it('shows cancellation only for a running cancellable transfer', () => {
    const base: SyncProgress = {
      workspaceId: 'workspace', targetId: 'target', phase: 'uploading',
      title: '正在传输 large.bin', detail: '32.0 MB / 256.0 MB', percent: 29,
    }
    expect(render({ ...base, cancellable: true })).toContain('取消同步')
    expect(render({ ...base, cancellable: false })).not.toContain('取消同步')
    expect(render({ ...base, phase: 'cancelled', title: '同步已取消', cancellable: false })).toContain('同步已取消')
  })
})
