import { describe, expect, it } from 'vitest'
import { propagateStorageConnection, referencedWebDavSecretIds, storageConnectionConfigTemplate, storageConnectionUsageCount } from '../electron/connection-lifecycle.js'
import type { StorageConnection, WorkspaceProfile } from '../electron/types.js'

const connection: StorageConnection = {
  id: 'connection', name: 'WebDAV', maxFileSizeMb: 100,
  config: { kind: 'webdav', endpoint: 'https://old.example', username: 'old', remotePath: '/old', secretId: 'shared-secret' },
  createdAt: '2026-11-03T00:00:00.000Z',
}

const workspaces: WorkspaceProfile[] = [{
  id: 'workspace', name: 'Notes', path: 'C:\\Notes', autoSync: true, syncOnFocus: true, state: 'idle',
  targets: [{ id: 'target', connectionId: 'connection', name: 'Old', enabled: true, maxFileSizeMb: 10, config: structuredClone(connection.config) }],
}]

describe('storage connection lifecycle', () => {
  it('counts usages and propagates an edited connection without mutating the input', () => {
    const updated: StorageConnection = { ...connection, name: 'Private Cloud', maxFileSizeMb: 2048, config: { ...connection.config, endpoint: 'https://new.example' } }
    const next = propagateStorageConnection(workspaces, updated)

    expect(storageConnectionUsageCount(workspaces, connection.id)).toBe(1)
    expect(next[0].targets[0]).toMatchObject({ name: 'Private Cloud', maxFileSizeMb: 2048, config: { endpoint: 'https://new.example' } })
    expect(workspaces[0].targets[0].name).toBe('Old')
  })

  it('keeps WebDAV secrets referenced by either a target or a saved connection', () => {
    expect(referencedWebDavSecretIds(workspaces, [connection])).toEqual(new Set(['shared-secret']))
    expect(referencedWebDavSecretIds([], [connection])).toEqual(new Set(['shared-secret']))
    expect(referencedWebDavSecretIds([], [])).toEqual(new Set())
  })

  it('keeps Warehouse library ids target-specific when a shared connection changes', () => {
    const warehouse: StorageConnection = {
      id: 'warehouse', name: 'Warehouse', maxFileSizeMb: 100, createdAt: '2026-11-03T00:00:00.000Z',
      config: { kind: 'git', provider: 'github', remoteUrl: 'https://github.com/me/TC-cloud-Warehouse.git', branch: 'main', warehouse: true },
    }
    const libraries: WorkspaceProfile[] = ['library-a', 'library-b'].map((id) => ({
      id, name: id, path: `C:\\${id}`, autoSync: true, syncOnFocus: true, state: 'idle',
      targets: [{ id: `target-${id}`, connectionId: 'warehouse', name: 'Warehouse', enabled: true, maxFileSizeMb: 100, config: { ...warehouse.config, libraryId: id } }],
    }))

    const next = propagateStorageConnection(libraries, { ...warehouse, config: { ...warehouse.config, branch: 'stable' } })
    expect(next.map((workspace) => (workspace.targets[0].config as { libraryId?: string }).libraryId)).toEqual(['library-a', 'library-b'])
    expect((storageConnectionConfigTemplate(next[0].targets[0].config) as { libraryId?: string }).libraryId).toBeUndefined()
  })
})
