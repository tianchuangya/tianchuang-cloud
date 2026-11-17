import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'
import { copyFileAtomically, scanFiles } from '../files.js'
import {
  buildWorkspaceSyncState, isSafeSyncPath, parseSyncState, readLocalSyncState, readOptionalSyncFile, readTargetBaseState,
  serializeSyncState, syncStateContentFingerprint, writeLocalSyncState, writeTargetBaseState, type SyncStateFileEntry, type WorkspaceSyncState,
} from '../sync-state.js'
import type { FileIssue, GitTargetConfig, SyncDecision, SyncPlan, SyncTarget, WorkspaceProfile } from '../types.js'
import { largeFileActions, largeFileIssues, largeFileSummary } from './diff-model.js'

const repositoryQueues = new Map<string, Promise<void>>()

function scopedRemoteUrl(config: GitTargetConfig): string {
  if (config.provider === 'github' && config.accountUsername && /^https:\/\/github\.com\//i.test(config.remoteUrl) && !/@github\.com/i.test(config.remoteUrl)) {
    return config.remoteUrl.replace(/^https:\/\//i, `https://${config.accountUsername}@`)
  }
  return config.remoteUrl
}

function repositoryKey(config: GitTargetConfig): string {
  return `${scopedRemoteUrl(config)}#${config.branch}`.toLocaleLowerCase()
}

async function withRepositoryLock<T>(config: GitTargetConfig, operation: () => Promise<T>): Promise<T> {
  const key = repositoryKey(config)
  const previous = repositoryQueues.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const chain = previous.then(() => current)
  repositoryQueues.set(key, chain)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (repositoryQueues.get(key) === chain) repositoryQueues.delete(key)
  }
}

function cachePath(cacheRoot: string, config: GitTargetConfig): string {
  const digest = createHash('sha256').update(repositoryKey(config)).digest('hex').slice(0, 24)
  const resolvedRoot = path.resolve(cacheRoot)
  const resolved = path.resolve(resolvedRoot, digest)
  const relative = path.relative(resolvedRoot, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Warehouse 缓存路径无效')
  return resolved
}

async function remoteHead(config: GitTargetConfig): Promise<string | undefined> {
  const output = await simpleGit().listRemote(['--heads', scopedRemoteUrl(config), config.branch])
  return output.trim().split(/\s+/)[0] || undefined
}

async function configureIdentity(git: SimpleGit): Promise<void> {
  const name = await git.raw(['config', 'user.name']).catch(() => '')
  const email = await git.raw(['config', 'user.email']).catch(() => '')
  if (!name.trim()) await git.addConfig('user.name', 'Tianchuang Cloud', false, 'local')
  if (!email.trim()) await git.addConfig('user.email', 'sync@tianchuang.local', false, 'local')
}

async function prepareCheckout(cacheRoot: string, config: GitTargetConfig): Promise<{ git: SimpleGit; root: string; remoteSha?: string }> {
  const root = cachePath(cacheRoot, config)
  await mkdir(cacheRoot, { recursive: true })
  const sha = await remoteHead(config)
  const existing = await stat(path.join(root, '.git')).catch(() => undefined)
  if (!existing?.isDirectory()) {
    await rm(root, { recursive: true, force: true })
    if (sha) await simpleGit().clone(scopedRemoteUrl(config), root, ['--branch', config.branch])
    else {
      await mkdir(root, { recursive: true })
      const fresh = simpleGit(root)
      await fresh.raw(['init', '--initial-branch', config.branch])
      await fresh.addRemote('origin', scopedRemoteUrl(config))
    }
  }
  const git = simpleGit(root)
  await configureIdentity(git)
  const remotes = await git.getRemotes(true)
  const origin = remotes.find((remote) => remote.name === 'origin')
  if (!origin) await git.addRemote('origin', scopedRemoteUrl(config))
  else if (origin.refs.fetch !== scopedRemoteUrl(config)) await git.remote(['set-url', 'origin', scopedRemoteUrl(config)])
  await git.reset(['--hard'])
  await git.clean('f', ['-d'])
  if (sha) {
    await git.fetch('origin', config.branch)
    await git.reset(['--hard', 'FETCH_HEAD'])
  }
  return { git, root, remoteSha: sha }
}

function libraryPaths(root: string, workspaceId: string): { files: string; state: string } {
  return {
    files: path.join(root, 'libraries', workspaceId, 'files'),
    state: path.join(root, '.tc-cloud', 'libraries', `${workspaceId}.json`),
  }
}

function stableLibraryId(workspace: WorkspaceProfile, config: GitTargetConfig): string {
  const value = config.libraryId || workspace.id
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value)) throw new Error('Warehouse 资料库 ID 格式无效')
  return value
}

function active(entry: SyncStateFileEntry | undefined): boolean {
  return Boolean(entry && !entry.deleted)
}

function sameContent(left: SyncStateFileEntry | undefined, right: SyncStateFileEntry | undefined): boolean {
  return active(left) && active(right) && left?.sha256 === right?.sha256
}

function changedFromBase(entry: SyncStateFileEntry | undefined, base: SyncStateFileEntry | undefined): boolean {
  if (active(entry) !== active(base)) return true
  if (!active(entry)) return false
  return entry?.sha256 !== base?.sha256
}

async function remoteStateOrSnapshot(root: string, workspace: WorkspaceProfile, config: GitTargetConfig, deviceId: string): Promise<WorkspaceSyncState | undefined> {
  const libraryId = stableLibraryId(workspace, config)
  const locations = libraryPaths(root, libraryId)
  const parsed = parseSyncState(await readOptionalSyncFile(locations.state))
  if (parsed) return parsed
  const files = await scanFiles(locations.files).catch(() => [])
  if (!files.length) return undefined
  return buildWorkspaceSyncState({ workspaceId: libraryId, workspaceName: workspace.name, deviceId, files })
}

function planDifferences(local: WorkspaceSyncState, remote: WorkspaceSyncState | undefined, base: WorkspaceSyncState | undefined, targetId: string): {
  issues: FileIssue[]; uploadPaths: string[]; downloadPaths: string[]; deleteRemotePaths: string[]
} {
  const paths = new Set([...Object.keys(local.files), ...Object.keys(remote?.files ?? {}), ...Object.keys(base?.files ?? {})])
  const issues: FileIssue[] = []
  const uploadPaths: string[] = []
  const downloadPaths: string[] = []
  const deleteRemotePaths: string[] = []
  const remoteIsConfirmedBase = remote?.revisionId === base?.targetHeads[targetId]

  for (const filePath of [...paths].sort()) {
    const localEntry = local.files[filePath]
    const remoteEntry = remote?.files[filePath]
    const baseEntry = base?.files[filePath]
    if (sameContent(localEntry, remoteEntry) || (!active(localEntry) && !active(remoteEntry))) continue
    const localChanged = changedFromBase(localEntry, baseEntry)
    const remoteChanged = remoteIsConfirmedBase ? false : changedFromBase(remoteEntry, baseEntry)
    if (localChanged && remoteChanged) {
      issues.push({ path: filePath, size: localEntry?.size, kind: 'conflict' })
    } else if (active(localEntry) && !active(remoteEntry)) {
      uploadPaths.push(filePath)
    } else if (!active(localEntry) && active(remoteEntry)) {
      if (baseEntry && active(baseEntry) && localChanged) {
        issues.push({ path: filePath, kind: 'remote-delete' })
        deleteRemotePaths.push(filePath)
      } else {
        issues.push({ path: filePath, kind: 'remote-only' })
        downloadPaths.push(filePath)
      }
    } else if (localChanged && !remoteChanged) uploadPaths.push(filePath)
    else if (!localChanged && remoteChanged) downloadPaths.push(filePath)
    else issues.push({ path: filePath, size: localEntry?.size, kind: 'conflict' })
  }
  return { issues, uploadPaths, downloadPaths, deleteRemotePaths }
}

export async function planWarehouseGitSync(workspace: WorkspaceProfile, target: SyncTarget, cacheRoot: string, deviceId: string): Promise<SyncPlan> {
  const config = target.config as GitTargetConfig
  return withRepositoryLock(config, async (): Promise<SyncPlan> => {
    const sourceFiles = await scanFiles(workspace.path)
    const tooLarge = largeFileIssues(sourceFiles, target.maxFileSizeMb)
    if (tooLarge.length) return {
      id: crypto.randomUUID(), workspaceId: workspace.id, targetId: target.id, targetName: target.name,
      provider: 'git', direction: 'blocked', summary: largeFileSummary(tooLarge, target.maxFileSizeMb),
      actions: largeFileActions('git', tooLarge), issues: tooLarge, requiresConfirmation: true,
      createdAt: new Date().toISOString(), metadata: { warehouse: true, totalBytes: tooLarge.reduce((sum, issue) => sum + (issue.size ?? 0), 0) },
    }
    const checkout = await prepareCheckout(cacheRoot, config)
    const libraryId = stableLibraryId(workspace, config)
    const currentLocal = await readLocalSyncState(workspace.path)
    const storedBase = await readTargetBaseState(workspace.path, target.id)
    const base = storedBase ?? (currentLocal?.targetHeads[target.id] ? currentLocal : undefined)
    const local = await buildWorkspaceSyncState({ workspaceId: libraryId, workspaceName: workspace.freshRestore ? undefined : workspace.name, deviceId, files: sourceFiles, previous: currentLocal })
    const remote = await remoteStateOrSnapshot(checkout.root, workspace, config, deviceId)
    const stateMetadataDirty = !workspace.freshRestore && remote?.workspaceName !== local.workspaceName
    const difference = planDifferences(local, remote, base, target.id)
    const conflicts = difference.issues.filter((issue) => issue.kind === 'conflict')
    const deletes = difference.issues.filter((issue) => issue.kind === 'remote-delete')
    const changed = difference.uploadPaths.length + difference.downloadPaths.length + conflicts.length + deletes.length + Number(stateMetadataDirty)
    const direction = changed === 0 ? 'none' : difference.downloadPaths.length || conflicts.length ? 'bidirectional' : 'upload'
    return {
      id: crypto.randomUUID(), workspaceId: workspace.id, targetId: target.id, targetName: target.name,
      provider: 'git', direction,
      summary: changed === 0 ? 'Warehouse 中的资料库已是最新' : `${difference.uploadPaths.length} 个待上传，${difference.downloadPaths.length} 个待下载，${conflicts.length} 个冲突，${deletes.length} 个待删除`,
      actions: changed === 0 ? ['无需传输'] : [
        ...(difference.downloadPaths.length ? [`从 Warehouse 下载 ${difference.downloadPaths.length} 个文件`] : []),
        ...(difference.uploadPaths.length ? [`上传 ${difference.uploadPaths.length} 个文件到资料库独立目录`] : []),
        ...(conflicts.length ? ['按确认结果处理同文件并发修改'] : []),
        ...(deletes.length ? [`删除 ${deletes.length} 个受管 Warehouse 文件`] : []),
        ...(stateMetadataDirty ? ['更新 Warehouse 中的资料库中文名称映射'] : []),
        '提交并推送 Warehouse 的单次原子版本',
      ],
      issues: difference.issues,
      requiresConfirmation: difference.issues.length > 0,
      createdAt: new Date().toISOString(),
      metadata: {
        warehouse: true, remoteSha: checkout.remoteSha ?? '', remoteRevisionId: remote?.revisionId ?? '',
        remoteContentFingerprint: syncStateContentFingerprint(remote), localContentFingerprint: syncStateContentFingerprint(local),
        remoteWorkspaceName: remote?.workspaceName ?? '', plannedWorkspaceName: local.workspaceName ?? '', stateMetadataDirty,
        localRevisionId: local.revisionId, uploadPaths: difference.uploadPaths,
        downloadPaths: difference.downloadPaths, deleteRemotePaths: difference.deleteRemotePaths,
        fileCount: sourceFiles.length, totalBytes: sourceFiles.reduce((sum, file) => sum + file.size, 0),
      },
    }
  })
}

async function copyRelative(sourceRoot: string, destinationRoot: string, relativePath: string): Promise<void> {
  if (!isSafeSyncPath(relativePath)) throw new Error(`Warehouse 返回了不安全路径：${relativePath}`)
  const source = path.join(sourceRoot, ...relativePath.split('/'))
  const destination = path.join(destinationRoot, ...relativePath.split('/'))
  await copyFileAtomically(source, destination)
}

export async function runWarehouseGitSync(
  workspace: WorkspaceProfile,
  target: SyncTarget,
  plan: SyncPlan,
  decision: SyncDecision,
  cacheRoot: string,
  deviceId: string,
): Promise<string> {
  const config = target.config as GitTargetConfig
  return withRepositoryLock(config, async () => {
    const latestSha = await remoteHead(config)
    if ((latestSha ?? '') !== String(plan.metadata.remoteSha ?? '')) throw new Error('Warehouse 在确认期间已被其他设备更新，请重新检查')
    const checkout = await prepareCheckout(cacheRoot, config)
    const libraryId = stableLibraryId(workspace, config)
    const locations = libraryPaths(checkout.root, libraryId)
    await mkdir(locations.files, { recursive: true })
    const remoteState = await remoteStateOrSnapshot(checkout.root, workspace, config, deviceId)
    if (syncStateContentFingerprint(remoteState) !== String(plan.metadata.remoteContentFingerprint ?? '')) throw new Error('Warehouse 资料库状态已经变化，请重新检查')
    if ((remoteState?.workspaceName ?? '') !== String(plan.metadata.remoteWorkspaceName ?? remoteState?.workspaceName ?? '')) throw new Error('Warehouse 资料库名称已经变化，请重新检查')

    const previous = await readLocalSyncState(workspace.path)
    const currentLocalFiles = await scanFiles(workspace.path)
    const currentLocal = await buildWorkspaceSyncState({ workspaceId: libraryId, workspaceName: workspace.freshRestore ? undefined : workspace.name, deviceId, files: currentLocalFiles, previous })
    if (syncStateContentFingerprint(currentLocal) !== String(plan.metadata.localContentFingerprint ?? '')) throw new Error('本机资料库在确认期间发生变化，请重新检查')
    if ((currentLocal.workspaceName ?? '') !== String(plan.metadata.plannedWorkspaceName ?? currentLocal.workspaceName ?? '')) throw new Error('资料库名称在确认期间发生变化，请重新检查')

    const conflicts = plan.issues.filter((issue) => issue.kind === 'conflict').map((issue) => issue.path)
    const remoteOnly = plan.issues.filter((issue) => issue.kind === 'remote-only').map((issue) => issue.path)
    const remoteDeletes = plan.issues.filter((issue) => issue.kind === 'remote-delete').map((issue) => issue.path)
    if (remoteDeletes.length && !decision.deleteRemote) throw new Error('检测到 Warehouse 删除操作，需要重新检查并明确确认')

    let downloaded = 0
    for (const filePath of [...remoteOnly, ...(!decision.preserveLocalOnly ? conflicts : [])]) {
      await copyRelative(locations.files, workspace.path, filePath)
      downloaded++
    }
    for (const filePath of remoteDeletes) {
      if (!isSafeSyncPath(filePath)) continue
      await rm(path.join(locations.files, ...filePath.split('/')), { force: true })
    }

    const localFiles = await scanFiles(workspace.path)
    let uploaded = 0
    for (const file of localFiles) {
      if (!decision.preserveLocalOnly && conflicts.includes(file.relativePath)) continue
      const destination = path.join(locations.files, ...file.relativePath.split('/'))
      const destinationInfo = await stat(destination).catch(() => undefined)
      if (!destinationInfo?.isFile() || destinationInfo.size !== file.size) {
        await copyFileAtomically(file.absolutePath, destination)
        uploaded++
      } else {
        const sourceContents = await readFile(file.absolutePath)
        const destinationContents = await readFile(destination)
        if (!sourceContents.equals(destinationContents)) {
          await copyFileAtomically(file.absolutePath, destination)
          uploaded++
        }
      }
    }

    const finalFiles = await scanFiles(workspace.path)
    const state = await buildWorkspaceSyncState({ workspaceId: libraryId, workspaceName: workspace.freshRestore ? undefined : workspace.name, deviceId, files: finalFiles, previous: remoteState ?? previous, targetId: target.id })
    state.targetHeads = { ...(previous?.targetHeads ?? {}), ...state.targetHeads, [target.id]: state.revisionId }
    await mkdir(path.dirname(locations.state), { recursive: true })
    await writeFile(locations.state, serializeSyncState(state), 'utf8')

    await checkout.git.add(['-A'])
    const status = await checkout.git.status()
    if (!status.isClean()) await checkout.git.commit(`同步资料库 ${workspace.name} ${new Date().toLocaleString('zh-CN', { hour12: false })}`)
    const hasHead = await checkout.git.revparse(['--verify', 'HEAD']).then(() => true).catch(() => false)
    if (!hasHead) throw new Error('Warehouse 没有可推送的版本')
    await checkout.git.push('origin', config.branch, ['--set-upstream'])
    // 远端确认成功后才能推进本机基线；push 失败时下次规划仍会依据旧基线重新比较。
    await writeLocalSyncState(workspace.path, state)
    await writeTargetBaseState(workspace.path, target.id, state)
    return `Warehouse 同步完成：上传 ${uploaded}，下载 ${downloaded}，删除 ${remoteDeletes.length}`
  })
}

export async function deleteWarehouseLibraryBackup(
  workspace: WorkspaceProfile,
  target: SyncTarget,
  cacheRoot: string,
): Promise<string> {
  const config = target.config as GitTargetConfig
  return withRepositoryLock(config, async () => {
    const checkout = await prepareCheckout(cacheRoot, config)
    if (!checkout.remoteSha) return 'Warehouse 远端尚无文件，无需删除'
    const libraryId = stableLibraryId(workspace, config)
    const locations = libraryPaths(checkout.root, libraryId)
    await rm(path.join(checkout.root, 'libraries', libraryId), { recursive: true, force: true })
    await rm(locations.state, { force: true })
    await checkout.git.add(['-A'])
    const status = await checkout.git.status()
    if (status.isClean()) return `Warehouse 中不存在资料库 ${workspace.name} 的备份`
    await checkout.git.commit(`删除资料库备份 ${workspace.name}`)
    await checkout.git.push('origin', config.branch)
    return `已从 Warehouse 删除资料库 ${workspace.name} 的独立目录；其他资料库未受影响`
  })
}
