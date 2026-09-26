import { randomUUID } from 'node:crypto'
import os from 'node:os'
import type { CloudConfigDocument, CloudRestoreSelection, SyncTarget, WorkspaceProfile } from './types.js'

export const CLOUD_CONFIG_REPOSITORY = 'tianchuang-cloud-config'
export const CLOUD_CONFIG_PATH = 'tianchuang-cloud.json'

function folderName(filePath: string): string {
  return filePath.split(/[\\/]+/).filter(Boolean).at(-1) || filePath
}

function portableTarget(target: SyncTarget): SyncTarget {
  if (target.config.kind !== 'webdav') return structuredClone(target)
  const { secretId: _secretId, ...config } = target.config
  return { ...structuredClone(target), config }
}

export function createCloudConfig(workspaces: WorkspaceProfile[], now = new Date().toISOString(), deviceName = os.hostname()): CloudConfigDocument {
  return {
    schemaVersion: 1,
    updatedAt: now,
    deviceName,
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      folderName: folderName(workspace.path),
      pathHint: workspace.path,
      autoSync: workspace.autoSync,
      syncOnChange: workspace.syncOnChange !== false,
      syncOnFocus: workspace.syncOnFocus,
      autoSyncDelaySeconds: workspace.autoSyncDelaySeconds ?? 3,
      errorNotifyCooldownMinutes: workspace.errorNotifyCooldownMinutes ?? 10,
      targets: workspace.targets.map(portableTarget),
    })),
  }
}

export function parseCloudConfig(value: unknown): CloudConfigDocument {
  if (!value || typeof value !== 'object') throw new Error('远端配置格式无效')
  const candidate = value as Partial<CloudConfigDocument>
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.workspaces) || typeof candidate.updatedAt !== 'string') {
    throw new Error('远端配置版本不受支持')
  }
  return candidate as CloudConfigDocument
}

export function restoreCloudWorkspaces(config: CloudConfigDocument, selections: CloudRestoreSelection[], existing: WorkspaceProfile[]): WorkspaceProfile[] {
  const existingPaths = new Set(existing.map((workspace) => workspace.path.toLocaleLowerCase()))
  const existingIds = new Set(existing.map((workspace) => workspace.id))
  const selectedPaths = new Set<string>()
  const restored: WorkspaceProfile[] = []

  for (const selection of selections) {
    const source = config.workspaces.find((workspace) => workspace.id === selection.workspaceId)
    if (!source) throw new Error('远端配置中找不到所选资料库')
    const normalizedPath = selection.localPath.trim()
    const comparablePath = normalizedPath.toLocaleLowerCase()
    if (!normalizedPath) throw new Error(`请为“${source.name}”选择本地文件夹`)
    if (existingPaths.has(comparablePath) || selectedPaths.has(comparablePath)) throw new Error(`文件夹“${normalizedPath}”已经在资料库中`)
    selectedPaths.add(comparablePath)
    restored.push({
      id: existingIds.has(source.id) ? randomUUID() : source.id,
      name: source.name,
      path: normalizedPath,
      autoSync: false,
      syncOnChange: source.syncOnChange,
      syncOnFocus: source.syncOnFocus,
      autoSyncDelaySeconds: source.autoSyncDelaySeconds,
      errorNotifyCooldownMinutes: source.errorNotifyCooldownMinutes,
      state: 'idle',
      targets: source.targets.map((target) => ({
        ...structuredClone(target),
        enabled: target.config.kind === 'git' ? target.enabled : false,
        lastSyncAt: undefined,
        lastError: target.config.kind === 'git' ? undefined : '来自其他设备，请检查路径或重新填写凭据后启用',
      })),
    })
  }
  return restored
}
