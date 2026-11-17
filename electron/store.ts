import Store from 'electron-store'
import { app, safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import type { ActivityItem, AppSnapshot, DeviceProfile, DeviceSyncState, NotificationPreferences, StorageConnection, SyncTarget, TargetConfig, WarehouseSettings, WorkspaceProfile } from './types.js'
import { DEFAULT_NOTIFICATION_PREFERENCES } from './types.js'
import { propagateStorageConnection, referencedWebDavSecretIds, storageConnectionConfigTemplate, storageConnectionUsageCount } from './connection-lifecycle.js'
import { remoteKeyForWorkspace } from './repository-name.js'

interface StoreData {
  workspaces: WorkspaceProfile[]
  activity: ActivityItem[]
  secrets: Record<string, string>
  notifications?: NotificationPreferences
  warehouse?: WarehouseSettings
  connections?: StorageConnection[]
}

const store = new Store<StoreData>({
  name: 'tianchuang-cloud',
  defaults: { workspaces: [], activity: [], secrets: {} },
})

// Persist the derived key once so legacy workspaces keep the same remote
// identity even if their last target is later removed or the display name is
// changed. This migration never renames or moves an existing remote.
const storedWorkspaces = store.get('workspaces', [])
const workspacesWithRemoteKeys = storedWorkspaces.map((workspace) => ({
  ...workspace,
  remoteKey: remoteKeyForWorkspace(workspace),
}))
if (workspacesWithRemoteKeys.some((workspace, index) => workspace.remoteKey !== storedWorkspaces[index]?.remoteKey)) {
  store.set('workspaces', workspacesWithRemoteKeys)
}

function defaultDeviceProfile(): DeviceProfile {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    deviceId: randomBytes(16).toString('hex'),
    deviceName: os.hostname(),
    deviceModel: os.cpus()[0]?.model?.trim() || '未知设备',
    platform: `${os.type()} ${os.release()}`,
    appVersion: app.isReady() ? app.getVersion() : '0.2.0',
    registeredAt: now,
    lastSeenAt: now,
    syncState: 'idle',
  }
}

export function getWarehouseSettings(): WarehouseSettings {
  const current = store.get('warehouse')
  if (current?.device?.deviceId && /^[0-9a-f]{32}$/.test(current.device.deviceId)) return current
  const created: WarehouseSettings = { warehouseName: 'TC-cloud-Warehouse', device: defaultDeviceProfile() }
  store.set('warehouse', created)
  return created
}

export function updateWarehouseSettings(changes: { warehouseName?: string; deviceName?: string }): WarehouseSettings {
  const current = getWarehouseSettings()
  const warehouseName = (changes.warehouseName ?? current.warehouseName).trim()
  const deviceName = (changes.deviceName ?? current.device.deviceName).trim()
  if (!/^[\p{L}\p{N}._-]{1,100}$/u.test(warehouseName)) throw new Error('Warehouse 名称只能包含文字、数字、点、下划线或连字符，长度为 1-100')
  if (!deviceName || deviceName.length > 64 || /[\\/\0]/.test(deviceName)) throw new Error('设备名称长度应为 1-64，且不能包含路径分隔符')
  const updated: WarehouseSettings = {
    warehouseName,
    device: { ...current.device, deviceName, appVersion: app.getVersion(), lastSeenAt: new Date().toISOString() },
  }
  store.set('warehouse', updated)
  return updated
}

export function updateDeviceSyncState(syncState: DeviceSyncState, result?: 'success' | 'error'): WarehouseSettings {
  const current = getWarehouseSettings()
  const now = new Date().toISOString()
  const updated: WarehouseSettings = {
    ...current,
    device: {
      ...current.device,
      appVersion: app.getVersion(),
      lastSeenAt: now,
      syncState,
      ...(result ? { lastSyncAt: now, lastSyncResult: result } : {}),
    },
  }
  store.set('warehouse', updated)
  return updated
}

export function getNotificationPreferences(): NotificationPreferences {
  const stored = store.get('notifications')
  return {
    syncSuccess: stored?.syncSuccess ?? DEFAULT_NOTIFICATION_PREFERENCES.syncSuccess,
    syncFailure: stored?.syncFailure ?? DEFAULT_NOTIFICATION_PREFERENCES.syncFailure,
  }
}

export function saveNotificationPreferences(preferences: NotificationPreferences): NotificationPreferences {
  const normalized: NotificationPreferences = {
    syncSuccess: preferences.syncSuccess !== false,
    syncFailure: preferences.syncFailure !== false,
  }
  store.set('notifications', normalized)
  return normalized
}

export function getSnapshot(): AppSnapshot {
  const targetName = (config: TargetConfig): string => {
    if (config.kind === 'git') return config.warehouse ? 'GitHub Warehouse' : config.provider === 'github' ? 'GitHub' : config.provider === 'gitee' ? 'Gitee' : 'Git'
    if (config.kind === 'webdav') return 'WebDAV'
    if (config.locationType === 'removable') return '移动硬盘'
    if (config.locationType === 'network') return '网络磁盘 / NAS'
    return '本机文件夹'
  }
  return {
    workspaces: store.get('workspaces', []).map((workspace) => ({
      ...workspace,
      remoteKey: remoteKeyForWorkspace(workspace),
      targets: workspace.targets.map((target) => ({ ...target, name: targetName(target.config) })),
    })),
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
  const workspaces = store.get('workspaces', [])
  const removed = workspaces.find((item) => item.id === workspaceId)
  store.set('workspaces', workspaces.filter((item) => item.id !== workspaceId))
  store.set('activity', store.get('activity', []).filter((item) => item.workspaceId !== workspaceId))
  if (removed) {
    const removedSecretIds = new Set(removed.targets.flatMap((target) => target.config.kind === 'webdav' && target.config.secretId ? [target.config.secretId] : []))
    const retainedSecretIds = new Set([
      ...workspaces.filter((item) => item.id !== workspaceId).flatMap((item) => item.targets.flatMap((target) => target.config.kind === 'webdav' && target.config.secretId ? [target.config.secretId] : [])),
      ...store.get('connections', []).flatMap((connection) => connection.config.kind === 'webdav' && connection.config.secretId ? [connection.config.secretId] : []),
    ])
    if (removedSecretIds.size > 0) {
      store.set('secrets', Object.fromEntries(Object.entries(store.get('secrets', {})).filter(([id]) => !removedSecretIds.has(id) || retainedSecretIds.has(id))))
    }
  }
}

export function addTarget(target: SyncTarget, workspaceId: string): WorkspaceProfile {
  return updateWorkspace(workspaceId, (workspace) => ({
    ...workspace,
    targets: [...workspace.targets, target],
  }))
}

export function saveStorageConnection(connection: StorageConnection): StorageConnection {
  const connections = store.get('connections', [])
  const index = connections.findIndex((item) => item.id === connection.id)
  if (index >= 0) connections[index] = connection
  else connections.push(connection)
  store.set('connections', connections)
  return connection
}

export function updateStorageConnectionRecord(connection: StorageConnection): StorageConnection {
  const connections = store.get('connections', [])
  const index = connections.findIndex((item) => item.id === connection.id)
  if (index < 0) throw new Error('找不到存储连接')
  connections[index] = connection
  store.set('connections', connections)
  store.set('workspaces', propagateStorageConnection(store.get('workspaces', []), connection))
  return connection
}

export function storageConnectionUsage(connectionId: string): number {
  return storageConnectionUsageCount(store.get('workspaces', []), connectionId)
}

export function removeStorageConnectionRecord(connectionId: string): StorageConnection {
  const connections = store.get('connections', [])
  const connection = connections.find((item) => item.id === connectionId)
  if (!connection) throw new Error('找不到存储连接')
  const usage = storageConnectionUsage(connectionId)
  if (usage > 0) throw new Error(`该连接仍被 ${usage} 个同步目标使用，请先解除这些目标的绑定`)
  const remaining = connections.filter((item) => item.id !== connectionId)
  store.set('connections', remaining)
  if (connection.config.kind === 'webdav' && connection.config.secretId) {
    const referenced = referencedWebDavSecretIds(store.get('workspaces', []), remaining)
    if (!referenced.has(connection.config.secretId)) deleteSecret(connection.config.secretId)
  }
  return connection
}

export function getStorageConnections(): StorageConnection[] {
  const existing = store.get('connections', [])
  const workspaces = store.get('workspaces', [])
  let changed = false
  for (const connection of existing) {
    if (connection.config.kind === 'git' && connection.config.warehouse && connection.config.libraryId) {
      connection.config = storageConnectionConfigTemplate(connection.config)
      changed = true
    }
  }
  for (const workspace of workspaces) {
    for (const target of workspace.targets) {
      if (target.connectionId && existing.some((connection) => connection.id === target.connectionId)) continue
      const id = target.connectionId || `connection-${target.id}`
      target.connectionId = id
      if (!existing.some((connection) => connection.id === id)) {
        existing.push({ id, name: target.name, maxFileSizeMb: target.maxFileSizeMb, config: storageConnectionConfigTemplate(target.config), createdAt: new Date().toISOString() })
      }
      changed = true
    }
  }
  if (changed) {
    store.set('workspaces', workspaces)
    store.set('connections', existing)
  }
  return existing
}

export function getStorageConnection(connectionId: string): StorageConnection | undefined {
  return getStorageConnections().find((connection) => connection.id === connectionId)
}

export function addActivity(item: ActivityItem): void {
  store.set('activity', [item, ...store.get('activity', [])].slice(0, 80))
}

export function setSecret(secretId: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统安全存储不可用，已拒绝以明文或可逆 Base64 保存密码')
  const secrets = store.get('secrets', {})
  const encrypted = safeStorage.encryptString(value).toString('base64')
  store.set('secrets', { ...secrets, [secretId]: encrypted })
}

export function getSecret(secretId?: string): string {
  if (!secretId) return ''
  const encrypted = store.get('secrets', {})[secretId]
  if (!encrypted) return ''
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用，无法读取同步凭据')
  const data = Buffer.from(encrypted, 'base64')
  return safeStorage.decryptString(data)
}

export function deleteSecret(secretId: string): void {
  const secrets = store.get('secrets', {})
  if (!(secretId in secrets)) return
  const { [secretId]: _removed, ...remaining } = secrets
  store.set('secrets', remaining)
}
