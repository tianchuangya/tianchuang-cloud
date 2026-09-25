import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { addActivity, addTarget, getSnapshot, saveWorkspace, setSecret, updateWorkspace } from './store.js'
import { planGitSync, runGitSync } from './providers/git.js'
import { planLocalSync, runLocalSync } from './providers/local.js'
import { planWebDavSync, runWebDavSync } from './providers/webdav.js'
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
    autoSync: true, syncOnChange: true, syncOnFocus: true, state: 'idle', targets: [],
  }
  saveWorkspace(workspace)
  activity(workspace.id, 'info', '资料库已添加', folderPath)
  return workspace
}

export function updateWorkspaceSettings(
  workspaceId: string,
  changes: Pick<WorkspaceProfile, 'autoSync' | 'syncOnChange' | 'syncOnFocus' | 'name'>,
): WorkspaceProfile {
  return updateWorkspace(workspaceId, (workspace) => ({ ...workspace, ...changes }))
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

export function removeTarget(workspaceId: string, targetId: string): WorkspaceProfile {
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
    else if (target.config.kind === 'local') result = await runLocalSync(workspace, target, decision)
    else result = await runWebDavSync(workspace, target, decision)

    const completedAt = new Date().toISOString()
    updateWorkspace(workspace.id, (item) => ({
      ...item, state: 'idle', lastSyncAt: completedAt,
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
    if (plan.direction !== 'none') await runSync(plan.id, { preserveLocalOnly: true }, onProgress)
  }
}
