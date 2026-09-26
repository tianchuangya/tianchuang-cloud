import { describe, expect, it } from 'vitest'
import { diffRemoteFiles, largeFileActions, largeFileIssues } from '../electron/providers/diff-model.js'

describe('unified large-file pre-check', () => {
  const files = [
    { relativePath: 'notes.md', size: 1024 },
    { relativePath: 'video.mp4', size: 200 * 1024 * 1024 },
  ]

  it('lists files above the limit with their size and limit', () => {
    const issues = largeFileIssues(files, 100)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ path: 'video.mp4', kind: 'too-large', limit: 100 * 1024 * 1024 })
  })

  it('explains the limit and suggests alternative targets per provider', () => {
    const issues = largeFileIssues(files, 100)
    expect(largeFileActions('git', issues).some((action) => action.includes('WebDAV'))).toBe(true)
    expect(largeFileActions('webdav', issues).some((action) => action.includes('移动硬盘'))).toBe(true)
    expect(largeFileActions('local', issues).some((action) => action.includes('磁盘镜像没有服务端硬性上限'))).toBe(true)
  })
})

describe('remote file diff for WebDAV', () => {
  const localFiles = [
    { relativePath: 'same.md', size: 10, modifiedAt: 1000 },
    { relativePath: 'local-newer.md', size: 10, modifiedAt: 5000 },
    { relativePath: 'remote-newer.md', size: 10, modifiedAt: 1000 },
    { relativePath: 'missing-remotely.md', size: 10, modifiedAt: 1000 },
  ]
  const remoteFiles = [
    { path: 'same.md', size: 10, lastmodMs: 900 },
    { path: 'local-newer.md', size: 12, lastmodMs: 2000 },
    { path: 'remote-newer.md', size: 12, lastmodMs: 90000 },
    { path: 'foreign.md', size: 4, lastmodMs: 90000 },
    { path: 'shared-deleted.md', size: 4, lastmodMs: 90000 },
  ]

  it('uploads files missing remotely or locally newer', () => {
    const diff = diffRemoteFiles(localFiles, remoteFiles, ['shared-deleted.md'])
    expect(diff.uploads).toContain('missing-remotely.md')
    expect(diff.uploads).toContain('local-newer.md')
  })

  it('flags remote-newer size changes as conflicts instead of silently overwriting', () => {
    const diff = diffRemoteFiles(localFiles, remoteFiles, ['shared-deleted.md'])
    expect(diff.conflicts).toEqual([{ path: 'remote-newer.md', size: 10, kind: 'conflict' }])
    expect(diff.uploads).not.toContain('remote-newer.md')
  })

  it('treats equal size as unchanged regardless of timestamps', () => {
    const diff = diffRemoteFiles(localFiles, remoteFiles, ['shared-deleted.md'])
    expect(diff.uploads).not.toContain('same.md')
    expect(diff.conflicts).toHaveLength(1)
  })

  it('reports unmanaged remote-only files but leaves managed deletions to their own flow', () => {
    const diff = diffRemoteFiles(localFiles, remoteFiles, ['shared-deleted.md'])
    expect(diff.remoteOnly).toEqual([{ path: 'foreign.md', kind: 'remote-only' }])
  })
})
