import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { previewKindOf, resolveFileProtocolTarget, resolveWorkspacePath } from '../electron/explorer.js'
import type { WorkspaceProfile } from '../electron/types.js'

const workspace: WorkspaceProfile = { id: 'ws', name: 'Notes', path: 'C:\\Users\\Me\\Notes', autoSync: true, syncOnFocus: true, state: 'idle', targets: [] }

describe('workspace path safety', () => {
  it('resolves relative paths inside the workspace', () => {
    expect(resolveWorkspacePath(workspace, 'docs/a.md')).toBe(path.resolve('C:\\Users\\Me\\Notes', 'docs/a.md'))
    expect(resolveWorkspacePath(workspace, '')).toBe(path.resolve('C:\\Users\\Me\\Notes'))
  })

  it('rejects traversal, absolute paths and drive letters', () => {
    expect(() => resolveWorkspacePath(workspace, '../secret.txt')).toThrow('资料库之外')
    expect(() => resolveWorkspacePath(workspace, 'a/../../b')).toThrow('资料库之外')
    expect(() => resolveWorkspacePath(workspace, 'C:\\Windows\\system32')).toThrow('资料库之外')
    expect(() => resolveWorkspacePath(workspace, '/etc/passwd')).toThrow('资料库之外')
  })

  it('validates protocol targets against the workspace root', () => {
    expect(resolveFileProtocolTarget([workspace.path], '/docs/readme.md')).toBe(path.resolve('C:\\Users\\Me\\Notes', 'docs/readme.md'))
    expect(resolveFileProtocolTarget([workspace.path], '/docs/%E7%AC%94%E8%AE%B0.md')).toBe(path.resolve('C:\\Users\\Me\\Notes', 'docs/笔记.md'))
    expect(() => resolveFileProtocolTarget([workspace.path], '/../outside.txt')).toThrow('拒绝访问')
    expect(() => resolveFileProtocolTarget([workspace.path], '/%2e%2e/outside.txt')).toThrow('拒绝访问')
    expect(() => resolveFileProtocolTarget([workspace.path], '/C:/Windows/system32')).toThrow('拒绝访问')
    expect(() => resolveFileProtocolTarget([], 'anything.txt')).toThrow('拒绝访问')
  })
})

describe('preview kind detection', () => {
  it('maps common extensions to preview kinds', () => {
    expect(previewKindOf('notes.md', 100)).toBe('markdown')
    expect(previewKindOf('photo.PNG', 100)).toBe('image')
    expect(previewKindOf('song.FLAC', 100)).toBe('audio')
    expect(previewKindOf('clip.webm', 100)).toBe('video')
    expect(previewKindOf('paper.pdf', 100)).toBe('pdf')
    expect(previewKindOf('data.json', 100)).toBe('text')
  })

  it('hands oversized text to the system app and unknown formats always', () => {
    expect(previewKindOf('huge.md', 2 * 1024 * 1024)).toBe('unknown')
    expect(previewKindOf('archive.zip', 100)).toBe('unknown')
  })
})
