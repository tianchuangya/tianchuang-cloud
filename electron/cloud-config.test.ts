import { describe, expect, it } from 'vitest'
import { createCloudConfig, parseCloudConfig, restoreCloudWorkspaces } from './cloud-config.js'
import type { WorkspaceProfile } from './types.js'

const workspace: WorkspaceProfile = {
  id: 'workspace-1', name: 'Notes', path: 'C:\\Users\\Me\\Notes', autoSync: true, syncOnFocus: true, state: 'idle',
  targets: [
    { id: 'git', name: 'GitHub', enabled: true, maxFileSizeMb: 100, config: { kind: 'git', provider: 'github', branch: 'main', remoteUrl: 'https://github.com/me/notes.git' } },
    { id: 'dav', name: 'WebDAV', enabled: true, maxFileSizeMb: 2000, config: { kind: 'webdav', endpoint: 'https://cloud.example.com', username: 'me', remotePath: '/notes', secretId: 'secret-value' } },
  ],
}

describe('cloud configuration', () => {
  it('removes secret references while preserving portable targets', () => {
    const document = createCloudConfig([workspace], '2026-01-01T00:00:00.000Z', 'PC')
    expect(document.workspaces[0].folderName).toBe('Notes')
    expect(document.workspaces[0].targets[1].config).toEqual({ kind: 'webdav', endpoint: 'https://cloud.example.com', username: 'me', remotePath: '/notes' })
    expect(JSON.stringify(document)).not.toContain('secret-value')
  })

  it('rejects unsupported documents', () => {
    expect(() => parseCloudConfig({ schemaVersion: 2, updatedAt: '', workspaces: [] })).toThrow('版本不受支持')
  })

  it('restores only selected workspaces and keeps machine-specific targets disabled', () => {
    const document = createCloudConfig([workspace], '2026-01-01T00:00:00.000Z', 'PC')
    const [restored] = restoreCloudWorkspaces(document, [{ workspaceId: 'workspace-1', localPath: 'D:\\Restored\\Notes' }], [])
    expect(restored.path).toBe('D:\\Restored\\Notes')
    expect(restored.autoSync).toBe(false)
    expect(restored.targets[0].enabled).toBe(true)
    expect(restored.targets[1].enabled).toBe(false)
  })
})
