import Store from 'electron-store'
import { safeStorage } from 'electron'
import type { ActivityItem, AppSnapshot, SyncTarget, WorkspaceProfile } from './types.js'

interface StoreData {
  workspaces: WorkspaceProfile[]
  activity: ActivityItem[]
  secrets: Record<string, string>
}

const store = new Store<StoreData>({
  name: 'tianchuang-cloud',
  defaults: { workspaces: [], activity: [], secrets: {} },
})

export function getSnapshot(): AppSnapshot {
  return {
    workspaces: store.get('workspaces', []),
    activity: store.get('activity', []).slice(0, 80),
  }
}

export function saveWorkspace(workspace: WorkspaceProfile): WorkspaceProfile {
  const workspaces = store.get('workspaces', [])
  const index = workspaces.findIndex((item) => item.id === workspace.id)
  if (index >= 0) workspaces[index] = workspace
  else workspaces.unshift(workspace)
  store.set('workspaces', workspaces)
  return workspace
}

export function updateWorkspace(
  workspaceId: string,
  updater: (workspace: WorkspaceProfile) => WorkspaceProfile,
): WorkspaceProfile {
  const workspaces = store.get('workspaces', [])
  const index = workspaces.findIndex((item) => item.id === workspaceId)
  if (index < 0) throw new Error('找不到资料库')
  const updated = updater(workspaces[index])
  workspaces[index] = updated
  store.set('workspaces', workspaces)
  return updated
}

export function removeWorkspace(workspaceId: string): void {
  store.set(
    'workspaces',
    store.get('workspaces', []).filter((item) => item.id !== workspaceId),
  )
}

export function addTarget(target: SyncTarget, workspaceId: string): WorkspaceProfile {
  return updateWorkspace(workspaceId, (workspace) => ({
    ...workspace,
    targets: [...workspace.targets, target],
  }))
}

export function addActivity(item: ActivityItem): void {
  store.set('activity', [item, ...store.get('activity', [])].slice(0, 80))
}

export function setSecret(secretId: string, value: string): void {
  const secrets = store.get('secrets', {})
  const encrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value).toString('base64')
    : Buffer.from(value, 'utf8').toString('base64')
  store.set('secrets', { ...secrets, [secretId]: encrypted })
}

export function getSecret(secretId?: string): string {
  if (!secretId) return ''
  const encrypted = store.get('secrets', {})[secretId]
  if (!encrypted) return ''
  const data = Buffer.from(encrypted, 'base64')
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(data)
    : data.toString('utf8')
}
