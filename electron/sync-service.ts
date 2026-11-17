import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { simpleGit } from 'simple-git'
import { addActivity, addTarget, getSecret, getSnapshot, getStorageConnection, getStorageConnections, getWarehouseSettings, removeStorageConnectionRecord, saveStorageConnection, saveWorkspace, setSecret, storageConnectionUsage, updateDeviceSyncState, updateStorageConnectionRecord, updateWorkspace, removeWorkspace } from './store.js'
import { credentialScopedRemoteUrl, deleteGitRepository, planGitSync, runGitSync } from './providers/git.js'
import { checkWebDavConnection, webDavDestinationCapacity } from './providers/webdav.js'
import { localDestinationCapacity } from './providers/local.js'
import { deleteLocalBackup, planLocalSync, runLocalSync } from './providers/local.js'
import { deleteWebDavBackup, planWebDavSync, runWebDavSync } from './providers/webdav.js'
import type {
  ActivityItem,
  AppSnapshot,
  DestinationCapacity,
  MigrationPlan,
  SyncDecision,
  SyncPlan,
  SyncProgress,
  SyncTarget,
  StorageConnectionHealth,
  StorageConnectionSummary,
  StorageConnectionUpdate,
  TargetDraft,
  WorkspaceProfile,
  WorkspaceDeleteOptions,
} from './types.js'
import { publishDeviceStatus } from './config-service.js'
import { workspaceSourceAvailable } from './workspace-availability.js'
import { storageConnectionConfigTemplate } from './connection-lifecycle.js'
import { readLocalSyncState } from './sync-state.js'
import { executeTargetsIndependently, multiTargetFailureDetail } from './multi-target.js'
import { repositoryNameForDisplayName } from './repository-name.js'
import { deleteWorkspaceFolder, removeWorkspaceMetadata } from './workspace-deletion.js'

type ProgressListener = (progress: SyncProgress) => void

const pendingPlans = new Map<string, SyncPlan>()
const runningWorkspaces = new Set<string>()
const automaticWorkspaces = new Set<string>()
const activeSyncControllers = new Map<string, AbortController>()
const PLAN_MAX_AGE_MS = 2 * 60_000

function isStalePlanError(message: string): boolean {
  return message.includes('在确认期间') || message.includes('状态已经变化') || message.includes('文件在确认期间已经变化')
}

function formatTransferBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export function cancelSync(workspaceId: string): boolean {
  const controller = activeSyncControllers.get(workspaceId)
  if (!controller || controller.signal.aborted) return false
  controller.abort(new DOMException('用户已取消同步', 'AbortError'))
  return true
}

async function withTimeout<T>(operation: Promise<T>, milliseconds = 15_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('连接检查超过 15 秒，请检查网络或服务地址')), milliseconds) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function workspaceAndTarget(workspaceId: string, targetId: string): [WorkspaceProfile, SyncTarget] {
  const workspace = getSnapshot().workspaces.find((item) => item.id === workspaceId)
  if (!workspace) throw new Error('找不到资料库')
  const target = workspace.targets.find((item) => item.id === targetId)
  if (!target) throw new Error('找不到同步目标')
  return [workspace, target]
}

function activity(workspaceId: string, level: ActivityItem['level'], title: string, detail: string): void {
  addActivity({ id: randomUUID(), workspaceId, level, title, detail, createdAt: new Date().toISOString() })
}

export function snapshot(): AppSnapshot {
  return getSnapshot()
}

export function addWorkspace(folderPath: string): WorkspaceProfile {
  const existing = getSnapshot().workspaces.find((workspace) => workspace.path.toLowerCase() === folderPath.toLowerCase())
  if (existing) return existing
  const id = randomUUID()
  const name = basename(folderPath)
  const workspace: WorkspaceProfile = {
    id, name, remoteKey: repositoryNameForDisplayName(name, id), path: folderPath,
    autoSync: true, syncOnChange: true, syncOnFocus: true,
    autoSyncDelaySeconds: 3, errorNotifyCooldownMinutes: 10,
    state: 'idle', targets: [],
  }
  saveWorkspace(workspace)
  activity(workspace.id, 'info', '资料库已添加', folderPath)
  return workspace
}

export function updateWorkspaceSettings(
  workspaceId: string,
  changes: Pick<WorkspaceProfile, 'autoSync' | 'syncOnChange' | 'syncOnFocus' | 'autoSyncDelaySeconds' | 'errorNotifyCooldownMinutes' | 'name'>,
): WorkspaceProfile {
  return updateWorkspace(workspaceId, (workspace) => ({
    ...workspace,
    ...changes,
    autoSyncDelaySeconds: Math.min(300, Math.max(3, changes.autoSyncDelaySeconds ?? workspace.autoSyncDelaySeconds ?? 3)),
    errorNotifyCooldownMinutes: Math.min(120, Math.max(1, changes.errorNotifyCooldownMinutes ?? workspace.errorNotifyCooldownMinutes ?? 10)),
  }))
}

export function createTarget(draft: TargetDraft): WorkspaceProfile {
  const id = randomUUID()
  const config = { ...draft.config }
  if (config.kind === 'webdav' && draft.password) {
    const secretId = randomUUID()
    setSecret(secretId, draft.password)
    config.secretId = secretId
  }
  const target: SyncTarget = {
    id,
    name: config.kind === 'git' ? (config.warehouse ? 'GitHub Warehouse' : config.provider === 'github' ? 'GitHub' : config.provider === 'gitee' ? 'Gitee' : 'Git')
      : config.kind === 'webdav' ? 'WebDAV'
        : config.locationType === 'removable' ? '移动硬盘'
          : config.locationType === 'network' ? '网络磁盘 / NAS' : '本机文件夹',
    enabled: true, connectionId: id,
    maxFileSizeMb: Math.max(1, draft.maxFileSizeMb), config,
  }
  saveStorageConnection({ id, name: target.name, maxFileSizeMb: target.maxFileSizeMb, config: storageConnectionConfigTemplate(target.config), createdAt: new Date().toISOString() })
  const updated = addTarget(target, draft.workspaceId)
  activity(draft.workspaceId, 'info', '已添加备份目标', target.name)
  return updated
}

export function storageConnections() {
  return getStorageConnections().map((connection): StorageConnectionSummary => ({
    ...connection,
    usageCount: storageConnectionUsage(connection.id),
  }))
}

export function updateStorageConnection(connectionId: string, draft: StorageConnectionUpdate): StorageConnectionSummary {
  const current = getStorageConnection(connectionId)
  if (!current) throw new Error('找不到存储连接')
  if (draft.config.kind !== current.config.kind) throw new Error('不能直接改变连接类型，请新建连接后迁移目标')
  const name = draft.name.trim()
  if (!name || name.length > 80) throw new Error('连接名称长度应为 1-80')
  const maxFileSizeMb = Math.min(1024 * 1024, Math.max(1, Math.round(draft.maxFileSizeMb)))
  const config = storageConnectionConfigTemplate(draft.config)
  if (config.kind === 'git') {
    config.remoteUrl = config.remoteUrl.trim()
    config.branch = config.branch.trim() || 'main'
    if (!config.remoteUrl) throw new Error('Git 仓库地址不能为空')
    if (!/^[A-Za-z0-9._/-]{1,200}$/.test(config.branch) || config.branch.includes('..')) throw new Error('Git 分支名称格式无效')
  } else if (config.kind === 'local') {
    config.destinationPath = config.destinationPath.trim()
    if (!config.destinationPath) throw new Error('磁盘或网络目录不能为空')
  } else {
    config.endpoint = config.endpoint.trim().replace(/\/+$/, '')
    config.username = config.username.trim()
    config.remotePath = config.remotePath.trim()
    let endpoint: URL
    try { endpoint = new URL(config.endpoint) } catch { throw new Error('WebDAV 服务器地址格式无效') }
    if (!['https:', 'http:'].includes(endpoint.protocol)) throw new Error('WebDAV 服务器仅支持 HTTP 或 HTTPS')
    if (!config.username || !config.remotePath) throw new Error('WebDAV 用户名和远端路径不能为空')
    config.secretId = current.config.kind === 'webdav' ? current.config.secretId : undefined
    if (draft.password) {
      config.secretId ||= randomUUID()
      setSecret(config.secretId, draft.password)
    }
  }
  const updated = updateStorageConnectionRecord({ ...current, name, maxFileSizeMb, config, updatedAt: new Date().toISOString() })
  return { ...updated, usageCount: storageConnectionUsage(updated.id) }
}

export function deleteStorageConnection(connectionId: string): string {
  const removed = removeStorageConnectionRecord(connectionId)
  return `已删除未使用的存储连接 ${removed.name}`
}

export async function checkStorageConnection(connectionId: string): Promise<StorageConnectionHealth> {
  const connection = getStorageConnection(connectionId)
  if (!connection) throw new Error('找不到存储连接')
  const checkedAt = new Date().toISOString()
  try {
    let detail: string
    if (connection.config.kind === 'git') {
      const git = simpleGit({ timeout: { block: 15_000 } })
        .env('GIT_TERMINAL_PROMPT', '0')
        .env('GCM_INTERACTIVE', 'never')
      await withTimeout(git.listRemote(['--heads', credentialScopedRemoteUrl(connection.config), connection.config.branch]))
      detail = `Git 远端可访问，分支 ${connection.config.branch}`
    } else if (connection.config.kind === 'webdav') {
      detail = await withTimeout(checkWebDavConnection(connection.config, getSecret(connection.config.secretId)))
    } else {
      const info = await stat(connection.config.destinationPath)
      if (!info.isDirectory()) throw new Error('目标路径不是文件夹')
      detail = `目标目录可访问：${connection.config.destinationPath}`
    }
    return { connectionId, ok: true, checkedAt, detail }
  } catch (error) {
    return { connectionId, ok: false, checkedAt, detail: error instanceof Error ? error.message : String(error) }
  }
}

export function attachStorageConnection(workspaceId: string, connectionId: string): WorkspaceProfile {
  const connection = getStorageConnection(connectionId)
  if (!connection) throw new Error('找不到存储连接')
  const workspace = getSnapshot().workspaces.find((item) => item.id === workspaceId)
  if (!workspace) throw new Error('找不到资料库')
  if (workspace.targets.some((target) => target.connectionId === connectionId)) throw new Error('这个资料库已经绑定该存储连接')
  const config = storageConnectionConfigTemplate(connection.config)
  if (config.kind === 'git' && config.warehouse) config.libraryId = workspace.id
  const target: SyncTarget = {
    id: randomUUID(), connectionId, name: connection.name, enabled: true,
    maxFileSizeMb: connection.maxFileSizeMb, config,
  }
  const updated = addTarget(target, workspaceId)
  activity(workspaceId, 'info', '已复用存储连接', connection.name)
  return updated
}

// 移除目标前可选删除其备份：删除失败时抛错并保留目标配置，用户可以重试；
// 只有备份处理完毕（或明确无需删除）才移除目标配置。
export async function removeTargetFromWorkspace(
  workspaceId: string,
  targetId: string,
  options?: { deleteBackup?: boolean },
): Promise<string> {
  const [workspace, target] = workspaceAndTarget(workspaceId, targetId)
  if (!options?.deleteBackup) {
    removeTargetFromConfig(workspaceId, targetId)
    activity(workspaceId, 'info', '已移除同步目标', `${target.name} 的配置已解除，备份文件全部保留`)
    return '已移除同步目标，备份文件全部保留'
  }
  const result = await deleteTargetBackup(workspace, target)
  removeTargetFromConfig(workspaceId, targetId)
  activity(workspaceId, 'warning', '已移除目标并删除备份', `${target.name}：${result}`)
  return result
}

async function deleteTargetBackup(workspace: WorkspaceProfile, target: SyncTarget): Promise<string> {
  if (target.config.kind === 'webdav') return deleteWebDavBackup(workspace, target, getSecret(target.config.secretId))
  if (target.config.kind === 'local') return deleteLocalBackup(workspace, target)
  return deleteGitRepository(workspace, target)
}

// 删除资料库的全部云端备份并把资料库移出列表。本地文件永远保留；
// 任一目标删除失败则整体中止并保留资料库，避免自动同步立刻把备份重新上传。
export async function deleteWorkspaceBackups(workspaceId: string, removeFromList = true): Promise<string> {
  const workspace = getSnapshot().workspaces.find((item) => item.id === workspaceId)
  if (!workspace) throw new Error('找不到资料库')
  const results: string[] = []
  for (const target of workspace.targets) {
    try {
      results.push(`${target.name}：${await deleteTargetBackup(workspace, target)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push(`${target.name}：删除失败（${message}）`)
      activity(workspaceId, 'error', '删除云端备份中止', results.join('；'))
      throw new Error(`部分备份删除失败，资料库已保留以便重试。${results.join('；')}`)
    }
  }
  if (removeFromList) removeWorkspace(workspaceId)
  activity(workspaceId, 'warning', '已删除云端备份', `${workspace.name} 的所有备份已删除，本地文件保留`)
  return `${workspace.name} 的所有云端备份已删除，本地文件保留。${results.join('；')}`
}

export async function deleteWorkspaceData(workspaceId: string, options: WorkspaceDeleteOptions, applicationPath: string): Promise<string> {
  const workspace = getSnapshot().workspaces.find((item) => item.id === workspaceId)
  if (!workspace) throw new Error('找不到资料库')
  const results: string[] = []
  if (options.deleteCloud) results.push(await deleteWorkspaceBackups(workspaceId, false))
  if (options.deleteLocal) {
    await deleteWorkspaceFolder(workspace.path, applicationPath)
    results.push('本地资料库文件夹已永久删除')
  } else {
    await removeWorkspaceMetadata(workspace.path)
    results.push('本地文档已保留，天创云端状态与视觉配置已清理')
  }
  removeWorkspace(workspaceId)
  activity(workspaceId, options.deleteCloud || options.deleteLocal ? 'warning' : 'info', '资料库已移除', results.join('；'))
  return results.join('；')
}

function removeTargetFromConfig(workspaceId: string, targetId: string): WorkspaceProfile {
  return updateWorkspace(workspaceId, (workspace) => ({
    ...workspace,
    targets: workspace.targets.filter((target) => target.id !== targetId),
  }))
}

export async function planSync(workspaceId: string, targetId: string): Promise<SyncPlan> {
  const [workspace, target] = workspaceAndTarget(workspaceId, targetId)
  updateWorkspace(workspaceId, (item) => ({ ...item, state: 'checking' }))
  updateDeviceSyncState('checking')
  try {
    let plan: SyncPlan
    if (target.config.kind === 'git') plan = await planGitSync(workspace, target, getWarehouseSettings().device.deviceId)
    else if (target.config.kind === 'local') plan = await planLocalSync(workspace, target, getWarehouseSettings().device.deviceId)
    else plan = await planWebDavSync(workspace, target, getWarehouseSettings().device.deviceId, getSecret(target.config.secretId))
    pendingPlans.set(plan.id, plan)
    const checkedAt = new Date().toISOString()
    updateWorkspace(workspaceId, (item) => ({
      ...item,
      state: plan.requiresConfirmation ? 'attention' : 'idle',
      ...(plan.direction === 'none' ? { lastSyncAt: checkedAt } : {}),
      targets: item.targets.map((current) => current.id === targetId && plan.direction === 'none'
        ? { ...current, lastError: undefined, lastSyncAt: checkedAt }
        : current),
    }))
    updateDeviceSyncState(plan.requiresConfirmation || plan.direction === 'blocked' ? 'attention' : 'idle')
    return plan
  } catch (error) {
    updateWorkspace(workspaceId, (item) => ({ ...item, state: 'error' }))
    updateDeviceSyncState('error', 'error')
    throw error
  }
}

export async function runSync(
  planId: string,
  decision: SyncDecision,
  onProgress: ProgressListener,
): Promise<AppSnapshot> {
  const plan = pendingPlans.get(planId)
  if (!plan) throw new Error('同步计划已经过期，请重新检查')
  if (Date.now() - Date.parse(plan.createdAt) > PLAN_MAX_AGE_MS) {
    pendingPlans.delete(planId)
    throw new Error('同步计划已超过 2 分钟，请重新检查，避免按过期状态执行')
  }
  const [workspace, target] = workspaceAndTarget(plan.workspaceId, plan.targetId)
  if (plan.direction === 'blocked') throw new Error(plan.summary)
  if (runningWorkspaces.has(workspace.id)) throw new Error('该资料库已有同步任务正在执行，请稍后重试')
  runningWorkspaces.add(workspace.id)
  const controller = target.config.kind === 'git' ? undefined : new AbortController()
  if (controller) activeSyncControllers.set(workspace.id, controller)
  updateDeviceSyncState('syncing')
  updateWorkspace(workspace.id, (item) => ({ ...item, state: 'syncing' }))
  onProgress({ workspaceId: workspace.id, targetId: target.id, phase: 'checking', title: `正在同步到 ${target.name}`, detail: plan.actions[0] || '准备文件', percent: 16, cancellable: Boolean(controller) })

  try {
    let result: string
    onProgress({ workspaceId: workspace.id, targetId: target.id, phase: plan.direction === 'download' ? 'downloading' : 'uploading', title: `正在同步到 ${target.name}`, detail: plan.summary, percent: 20, cancellable: Boolean(controller) })
    const deviceId = getWarehouseSettings().device.deviceId
    const execution = controller ? {
      signal: controller.signal,
      onTransferProgress: (transfer: { path: string; direction: 'upload' | 'download' | 'copy'; transferredBytes: number; totalBytes: number }) => {
        const ratio = transfer.totalBytes > 0 ? transfer.transferredBytes / transfer.totalBytes : 0
        onProgress({
          workspaceId: workspace.id,
          targetId: target.id,
          phase: transfer.direction === 'download' ? 'downloading' : 'uploading',
          title: transfer.direction === 'download' ? `正在下载 ${transfer.path}` : `正在传输 ${transfer.path}`,
          detail: `${formatTransferBytes(transfer.transferredBytes)} / ${formatTransferBytes(transfer.totalBytes)}`,
          percent: Math.min(90, 20 + Math.round(ratio * 70)),
          cancellable: true,
          transferredBytes: transfer.transferredBytes,
          totalBytes: transfer.totalBytes,
        })
      },
    } : undefined
    if (target.config.kind === 'git') result = await runGitSync(workspace, target, plan, decision, deviceId)
    else if (target.config.kind === 'local') result = await runLocalSync(workspace, target, plan, decision, deviceId, execution)
    else result = await runWebDavSync(workspace, target, plan, decision, deviceId, getSecret(target.config.secretId), execution)

    const completedAt = new Date().toISOString()
    const restoredDisplayName = workspace.freshRestore ? (await readLocalSyncState(workspace.path))?.workspaceName : undefined
    updateWorkspace(workspace.id, (item) => ({
      ...item, state: 'idle', lastSyncAt: completedAt,
      ...(restoredDisplayName ? { name: restoredDisplayName } : {}),
      ...(item.freshRestore ? { freshRestore: false } : {}),
      targets: item.targets.map((current) => current.id === target.id
        ? { ...current, lastSyncAt: completedAt, lastError: undefined }
        : current),
    }))
    pendingPlans.delete(plan.id)
    updateDeviceSyncState('idle', 'success')
    void publishDeviceStatus().catch(() => { /* 设备状态上报失败不反向破坏已完成的文件同步 */ })
    activity(workspace.id, 'success', `${target.name} 同步完成`, result)
    onProgress({ workspaceId: workspace.id, targetId: target.id, phase: 'complete', title: '同步完成', detail: result, percent: 100, cancellable: false })
    return getSnapshot()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (controller?.signal.aborted) {
      pendingPlans.delete(plan.id)
      updateWorkspace(workspace.id, (item) => ({ ...item, state: 'idle' }))
      updateDeviceSyncState('idle')
      activity(workspace.id, 'warning', `${target.name} 同步已取消`, '传输已停止，未完成的临时文件已清理；重新同步会从已确认状态检查')
      onProgress({ workspaceId: workspace.id, targetId: target.id, phase: 'cancelled', title: '同步已取消', detail: '未完成的临时传输已停止并清理', percent: 100, cancellable: false })
      throw error
    }
    if (isStalePlanError(message)) {
      // 这是乐观并发校验的正常结果，不应记成一次同步故障；调用方会重新规划。
      pendingPlans.delete(plan.id)
      updateWorkspace(workspace.id, (item) => ({ ...item, state: 'idle' }))
      updateDeviceSyncState('idle')
      throw error
    }
    updateWorkspace(workspace.id, (item) => ({
      ...item, state: 'error',
      targets: item.targets.map((current) => current.id === target.id ? { ...current, lastError: message } : current),
    }))
    activity(workspace.id, 'error', `${target.name} 同步失败`, message)
    updateDeviceSyncState('error', 'error')
    void publishDeviceStatus().catch(() => { /* 离线时保留本地状态，下次发布配置时补传 */ })
    onProgress({ workspaceId: workspace.id, targetId: target.id, phase: 'error', title: '同步失败', detail: message, percent: 100 })
    throw error
  } finally {
    if (activeSyncControllers.get(workspace.id) === controller) activeSyncControllers.delete(workspace.id)
    runningWorkspaces.delete(workspace.id)
  }
}

// 多云迁移计划：对目标目标跑一次常规计划（复用确认与冲突管线），
// 附加数据总量与目标容量信息，供迁移弹窗展示。
export async function planMigration(workspaceId: string, sourceTargetId: string, destinationTargetId: string): Promise<MigrationPlan> {
  const [workspace] = workspaceAndTarget(workspaceId, sourceTargetId)
  const destination = workspace.targets.find((item) => item.id === destinationTargetId)
  if (!destination) throw new Error('找不到迁移目标')
  if (destination.id === sourceTargetId) throw new Error('迁移目标不能与当前目标相同')
  const sourcePlan = await planSync(workspaceId, sourceTargetId)
  if (sourcePlan.direction !== 'none') {
    return {
      sourceTargetId, destinationTargetId,
      sourceName: workspace.targets.find((item) => item.id === sourceTargetId)?.name ?? '原目标',
      destinationName: destination.name,
      plan: {
        ...sourcePlan,
        id: randomUUID(),
        direction: 'blocked',
        summary: `原目标尚未与本机形成一致基线：${sourcePlan.summary}。请先完成原目标同步，再重新生成迁移计划。`,
        actions: ['先检查并同步原目标', '确认本机内容完整', '重新打开迁移计划'],
        requiresConfirmation: true,
      },
    }
  }
  const plan = await planSync(workspaceId, destinationTargetId)
  let capacity: DestinationCapacity | undefined
  try {
    capacity = destination.config.kind === 'webdav' ? await webDavDestinationCapacity(destination, getSecret(destination.config.secretId))
      : destination.config.kind === 'local' ? await localDestinationCapacity(destination)
      : undefined
  } catch { /* 容量信息缺失不阻塞迁移 */ }
  return {
    sourceTargetId, destinationTargetId,
    sourceName: workspace.targets.find((item) => item.id === sourceTargetId)?.name ?? '原目标',
    destinationName: destination.name,
    plan, capacity,
  }
}

export async function automaticSync(
  workspaceId: string,
  onProgress: ProgressListener,
  onAttention: (plan: SyncPlan) => void,
): Promise<void> {
  const workspace = getSnapshot().workspaces.find((item) => item.id === workspaceId)
  if (!workspace || workspace.state === 'syncing' || automaticWorkspaces.has(workspaceId)) return
  // Removable disks, NAS mounts and renamed folders can be temporarily absent.
  // Automatic checks should wait quietly; an explicit manual sync still reports the real error.
  if (!(await workspaceSourceAvailable(workspace.path))) return
  automaticWorkspaces.add(workspaceId)
  try {
    const attentionPlans: SyncPlan[] = []
    const result = await executeTargetsIndependently(workspace.targets.filter((item) => item.enabled), async (target) => {
      let plan = await planSync(workspace.id, target.id)
      if (plan.requiresConfirmation || plan.direction === 'blocked') {
        attentionPlans.push(plan)
        onAttention(plan)
        return
      }
      if (plan.direction !== 'none') {
        try {
          await runSync(plan.id, { preserveLocalOnly: true, deleteRemote: false }, onProgress)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (!isStalePlanError(message)) throw error
          plan = await planSync(workspace.id, target.id)
          if (plan.requiresConfirmation || plan.direction === 'blocked') onAttention(plan)
          else if (plan.direction !== 'none') await runSync(plan.id, { preserveLocalOnly: true, deleteRemote: false }, onProgress)
        }
      }
    })
    if (result.failures.length > 0) {
      const detail = multiTargetFailureDetail(result.failures)
      updateWorkspace(workspaceId, (item) => ({ ...item, state: 'error' }))
      updateDeviceSyncState('error', 'error')
      activity(workspaceId, 'error', '部分同步目标失败', detail)
      onProgress({ workspaceId, phase: 'error', title: '部分同步目标失败', detail, percent: 100 })
      throw new Error(detail)
    }
    if (attentionPlans.length > 0) {
      updateWorkspace(workspaceId, (item) => ({ ...item, state: 'attention' }))
      updateDeviceSyncState('attention')
    }
  } finally {
    automaticWorkspaces.delete(workspaceId)
  }
}
