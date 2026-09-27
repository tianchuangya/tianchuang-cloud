import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { addActivity, addTarget, getSnapshot, saveWorkspace, setSecret, updateWorkspace, removeWorkspace } from './store.js'
import { deleteGitRepository, planGitSync, runGitSync } from './providers/git.js'
import { deleteLocalBackup, planLocalSync, runLocalSync } from './providers/local.js'
import { deleteWebDavBackup, planWebDavSync, runWebDavSync } from './providers/webdav.js'
import type {
  ActivityItem,
  AppSnapshot,
  SyncDecision,
  SyncPlan,
  SyncProgress,
  SyncTarget,
  TargetDraft,
  WorkspaceProfile,
} from './types.js'

type ProgressListener = (progress: SyncProgress) => void

const pendingPlans = new Map<string, SyncPlan>()

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
  const workspace: WorkspaceProfile = {
    id: randomUUID(), name: basename(folderPath), path: folderPath,
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
    name: config.kind === 'git' ? (config.provider === 'github' ? 'GitHub' : config.provider === 'gitee' ? 'Gitee' : 'Git')
      : config.kind === 'webdav' ? 'WebDAV'
        : config.locationType === 'removable' ? '移动硬盘'
          : config.locationType === 'network' ? '网络磁盘 / NAS' : '本机文件夹',
    enabled: true,
    maxFileSizeMb: Math.max(1, draft.maxFileSizeMb), config,
  }
  const updated = addTarget(target, draft.workspaceId)
  activity(draft.workspaceId, 'info', '已添加备份目标', target.name)
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
  if (target.config.kind === 'webdav') return deleteWebDavBackup(workspace, target)
  if (target.config.kind === 'local') return deleteLocalBackup(workspace, target)
  return deleteGitRepository(workspace, target)
}

// 删除资料库的全部云端备份并把资料库移出列表。本地文件永远保留；
// 任一目标删除失败则整体中止并保留资料库，避免自动同步立刻把备份重新上传。
export async function deleteWorkspaceBackups(workspaceId: string): Promise<string> {
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
  removeWorkspace(workspaceId)
  activity(workspaceId, 'warning', '已删除云端备份', `${workspace.name} 的所有备份已删除，本地文件保留`)
  return `${workspace.name} 的所有云端备份已删除，本地文件保留。${results.join('；')}`
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
  try {
    let plan: SyncPlan
    if (target.config.kind === 'git') plan = await planGitSync(workspace, target)
    else if (target.config.kind === 'local') plan = await planLocalSync(workspace, target)
    else plan = await planWebDavSync(workspace, target)
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
    return plan
  } catch (error) {
    updateWorkspace(workspaceId, (item) => ({ ...item, state: 'error' }))
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
  const [workspace, target] = workspaceAndTarget(plan.workspaceId, plan.targetId)
  if (plan.direction === 'blocked') throw new Error(plan.summary)
  updateWorkspace(workspace.id, (item) => ({ ...item, state: 'syncing' }))
  onProgress({ workspaceId: workspace.id, targetId: target.id, phase: 'checking', title: `正在同步到 ${target.name}`, detail: plan.actions[0] || '准备文件', percent: 16 })

  try {
    let result: string
    onProgress({ workspaceId: workspace.id, targetId: target.id, phase: plan.direction === 'download' ? 'downloading' : 'uploading', title: `正在同步到 ${target.name}`, detail: plan.summary, percent: 48 })
    if (target.config.kind === 'git') result = await runGitSync(workspace, target, plan, decision)
    else if (target.config.kind === 'local') result = await runLocalSync(workspace, target, plan, decision)
    else result = await runWebDavSync(workspace, target, plan, decision)

    const completedAt = new Date().toISOString()
    updateWorkspace(workspace.id, (item) => ({
      ...item, state: 'idle', lastSyncAt: completedAt, ...(item.freshRestore ? { freshRestore: false } : {}),
      targets: item.targets.map((current) => current.id === target.id
        ? { ...current, lastSyncAt: completedAt, lastError: undefined }
        : current),
    }))
    pendingPlans.delete(plan.id)
    activity(workspace.id, 'success', `${target.name} 同步完成`, result)
    onProgress({ workspaceId: workspace.id, targetId: target.id, phase: 'complete', title: '同步完成', detail: result, percent: 100 })
    return getSnapshot()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateWorkspace(workspace.id, (item) => ({
      ...item, state: 'error',
      targets: item.targets.map((current) => current.id === target.id ? { ...current, lastError: message } : current),
    }))
    activity(workspace.id, 'error', `${target.name} 同步失败`, message)
    onProgress({ workspaceId: workspace.id, targetId: target.id, phase: 'error', title: '同步失败', detail: message, percent: 100 })
    throw error
  }
}

export async function automaticSync(
  workspaceId: string,
  onProgress: ProgressListener,
  onAttention: (plan: SyncPlan) => void,
): Promise<void> {
  const workspace = getSnapshot().workspaces.find((item) => item.id === workspaceId)
  if (!workspace || workspace.state === 'syncing') return
  for (const target of workspace.targets.filter((item) => item.enabled)) {
    const plan = await planSync(workspace.id, target.id)
    if (plan.requiresConfirmation || plan.direction === 'blocked') {
      onAttention(plan)
      continue
    }
    if (plan.direction !== 'none') await runSync(plan.id, { preserveLocalOnly: true, deleteRemote: false }, onProgress)
  }
}
