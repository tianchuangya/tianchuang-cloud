import { describe, expect, it } from 'vitest'
import { executeTargetsIndependently, multiTargetFailureDetail } from '../electron/multi-target.js'

describe('multi-target execution', () => {
  it('continues to later targets after one target fails', async () => {
    const visited: string[] = []
    const result = await executeTargetsIndependently([
      { id: 'github', name: 'GitHub' },
      { id: 'webdav', name: 'WebDAV' },
      { id: 'disk', name: '移动硬盘' },
    ], async (target) => {
      visited.push(target.id)
      if (target.id === 'webdav') throw new Error('服务器超时')
    })

    expect(visited).toEqual(['github', 'webdav', 'disk'])
    expect(result.succeededTargetIds).toEqual(['github', 'disk'])
    expect(result.failures).toEqual([{ targetId: 'webdav', targetName: 'WebDAV', message: '服务器超时' }])
    expect(multiTargetFailureDetail(result.failures)).toBe('WebDAV：服务器超时')
  })

  it('collects every failure without hiding non-Error reasons', async () => {
    const result = await executeTargetsIndependently([
      { id: 'a', name: '目标 A' },
      { id: 'b', name: '目标 B' },
    ], async (target) => {
      if (target.id === 'a') throw '离线'
      throw new Error('磁盘已满')
    })

    expect(result.succeededTargetIds).toEqual([])
    expect(multiTargetFailureDetail(result.failures)).toBe('目标 A：离线；目标 B：磁盘已满')
  })
})
