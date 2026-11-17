import { mkdir, opendir, realpath, rename, rm, stat, statfs } from 'node:fs/promises'
import path from 'node:path'
import { copyFileAtomically, hashFile, scanFiles } from '../files.js'
import type { DestinationCapacity, FileIssue, LocalTargetConfig, SyncDecision, SyncExecutionOptions, SyncPlan, SyncTarget, WorkspaceProfile } from '../types.js'
import { deletedManagedFiles, isSafeManagedPath, LEGACY_MANIFEST_FILE, MANIFEST_FILE, parseManagedManifest } from './managed-manifest.js'
import { largeFileActions, largeFileIssues, largeFileSummary, remoteOnlyIssues } from './diff-model.js'
import { buildWorkspaceSyncState, createRevisionId, parseSyncState, readLocalSyncState, readOptionalSyncFile, syncStateContentFingerprint, writeLocalSyncState, writeTargetBaseState } from '../sync-state.js'

const STAGED_LOCAL_DELETE_FILE = /\.tianchuang-delete-[0-9a-f]{32}\.tmp$/

async function recoverInterruptedLocalDeletes(root: string): Promise<void> {
  async function walk(directory: string): Promise<void> {
    const handle = await opendir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!handle) return
    for await (const entry of handle) {
      if (entry.isSymbolicLink()) continue
      const staged = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(staged)
      else if (entry.isFile() && STAGED_LOCAL_DELETE_FILE.test(entry.name)) {
        const original = staged.replace(STAGED_LOCAL_DELETE_FILE, '')
        if (await stat(original).then(() => true).catch(() => false)) await rm(staged, { force: true })
        else await rename(staged, original)
      }
    }
  }
  await walk(root)
}

interface StagedLocalDelete {
  original: string
  staged: string
}

async function restoreStagedLocalDeletes(items: StagedLocalDelete[]): Promise<void> {
  const failures: string[] = []
  for (const item of [...items].reverse()) {
    try { await rename(item.staged, item.original) } catch { failures.push(item.original) }
  }
  if (failures.length) throw new Error(`镜像状态提交失败，且 ${failures.length} 个待删除文件未能自动恢复；隔离临时副本仍保留`)
}

async function stageLocalDeletes(root: string, relativePaths: string[]): Promise<StagedLocalDelete[]> {
  const staged: StagedLocalDelete[] = []
  try {
    for (const relativePath of relativePaths) {
      if (!isSafeManagedPath(relativePath)) throw new Error(`拒绝删除不安全的镜像路径：${relativePath}`)
      const original = path.join(root, ...relativePath.split('/'))
      const temporary = `${original}.tianchuang-delete-${createRevisionId()}.tmp`
      await rename(original, temporary)
      staged.push({ original, staged: temporary })
    }
    return staged
  } catch (error) {
    await restoreStagedLocalDeletes(staged)
    throw error
  }
}

function destinationRoot(workspace: WorkspaceProfile, target: SyncTarget): string {
  const config = target.config as LocalTargetConfig
  const directory = config.remoteDirectory || workspace.name
  if (!directory || path.isAbsolute(directory) || directory === '.' || directory === '..' || /[/\\\0]/.test(directory)) {
    throw new Error('镜像子目录名称无效，不能包含路径分隔符或跳出目标目录')
  }
  const base = path.resolve(config.destinationPath)
  const resolved = path.resolve(base, directory)
  const relative = path.relative(base, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('镜像目标路径超出所选目录')
  return resolved
}

function sameOrInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function safeDestinationRoot(workspace: WorkspaceProfile, target: SyncTarget): Promise<string> {
  const configured = destinationRoot(workspace, target)
  const config = target.config as LocalTargetConfig
  const configuredBase = path.resolve(config.destinationPath)
  const relativeDirectory = path.relative(configuredBase, configured)
  const base = await realpath(config.destinationPath).catch(() => path.resolve(config.destinationPath))
  // macOS commonly exposes /var through the /private/var symlink. If the child
  // directory does not exist yet, derive it from the canonical base so both
  // sides of the containment check use the same filesystem spelling.
  const root = await realpath(configured).catch(() => path.resolve(base, relativeDirectory))
  if (!sameOrInside(base, root) || root === base) throw new Error('镜像目标路径超出所选目录')
  const source = await realpath(workspace.path).catch(() => path.resolve(workspace.path))
  if (sameOrInside(source, root) || sameOrInside(root, source)) {
    throw new Error('镜像目录不能与资料库相同、位于资料库内部，或包含资料库；否则会造成递归备份')
  }
  return root
}

// 目标容量：镜像所在磁盘的剩余空间
export async function localDestinationCapacity(target: SyncTarget): Promise<DestinationCapacity | undefined> {
  const config = target.config as LocalTargetConfig
  const info = await statfs(config.destinationPath).catch(() => undefined)
  if (!info) return undefined
  return { freeBytes: info.bavail * info.bsize }
}

// 删除整个磁盘镜像目录。镜像始终位于“所选目录/资料库名”这一层，路径过浅时拒绝删除。
export async function deleteLocalBackup(workspace: WorkspaceProfile, target: SyncTarget): Promise<string> {
  const root = await safeDestinationRoot(workspace, target)
  if (root === path.parse(root).root || root.split(path.sep).filter(Boolean).length < 2) {
    throw new Error('镜像路径过浅，为避免误删磁盘内容，天创云端拒绝自动删除')
  }
  await rm(root, { recursive: true, force: true })
  return `已删除镜像目录 ${root}`
}

export async function planLocalSync(workspace: WorkspaceProfile, target: SyncTarget, deviceId = '00000000000000000000000000000001'): Promise<SyncPlan> {
  const root = await safeDestinationRoot(workspace, target)
  await recoverInterruptedLocalDeletes(root)
  const sourceFiles = await scanFiles(workspace.path)
  const limitMb = target.maxFileSizeMb
  const tooLarge = largeFileIssues(sourceFiles, limitMb)
  if (tooLarge.length > 0) {
    return {
      id: crypto.randomUUID(), workspaceId: workspace.id, targetId: target.id,
      targetName: target.name, provider: 'local', direction: 'blocked',
      summary: largeFileSummary(tooLarge, limitMb),
      actions: largeFileActions('local', tooLarge), issues: tooLarge,
      requiresConfirmation: true, createdAt: new Date().toISOString(), metadata: { changed: 0, totalBytes: tooLarge.reduce((sum, issue) => sum + (issue.size || 0), 0) },
    }
  }
  const issues: FileIssue[] = []
  const manifestPath = path.join(root, ...MANIFEST_FILE.split('/'))
  // 新设备恢复的资料库忽略清单：镜像内容应作为可恢复项而不是待删除项
  const stateContents = await readOptionalSyncFile(manifestPath)
    ?? await readOptionalSyncFile(path.join(root, ...LEGACY_MANIFEST_FILE.split('/')))
  const remoteState = parseSyncState(stateContents)
  const previousFiles = workspace.freshRestore ? [] : parseManagedManifest(stateContents)
  const currentFiles = sourceFiles.map((file) => file.relativePath)
  const localPrevious = await readLocalSyncState(workspace.path)
  const localState = await buildWorkspaceSyncState({ workspaceId: workspace.id, workspaceName: workspace.freshRestore ? undefined : workspace.name, deviceId, files: sourceFiles, previous: localPrevious })
  const stateMetadataDirty = !workspace.freshRestore && remoteState?.workspaceName !== localState.workspaceName
  const remoteDeletes = deletedManagedFiles(previousFiles, currentFiles)
  issues.push(...remoteDeletes.map((file) => ({ path: file, kind: 'remote-delete' as const })))
  let changed = 0
  for (const source of sourceFiles) {
    const destination = path.join(root, source.relativePath)
    try {
      const destinationInfo = await stat(destination)
      const sizeChanged = destinationInfo.size !== source.size
      const timeChanged = Math.abs(destinationInfo.mtimeMs - source.modifiedAt) > 1000
      const stateHashChanged = Boolean(remoteState?.files[source.relativePath]?.sha256
        && remoteState.files[source.relativePath].sha256 !== localState.files[source.relativePath]?.sha256)
      const contentChanged = sizeChanged || stateHashChanged || (timeChanged && await hashFile(destination) !== await hashFile(source.absolutePath))
      if (contentChanged) {
        changed++
        if (stateHashChanged || destinationInfo.mtimeMs > source.modifiedAt + 1000) issues.push({ path: source.relativePath, size: source.size, kind: 'conflict' })
      }
    } catch {
      changed++
    }
  }
  // 镜像目录里存在清单和本地都没有的文件时，视为远端独有内容（例如另一台设备或
  // 手动放入的文件），必须提示用户；合并时会下载回本机，不会被静默删除。
  const destinationFiles = await scanFiles(root).catch(() => [])
  const remoteContentState = await buildWorkspaceSyncState({ workspaceId: workspace.id, workspaceName: workspace.freshRestore ? undefined : workspace.name, deviceId, files: destinationFiles, previous: remoteState })
  const remoteOnly = remoteOnlyIssues(
    destinationFiles.map((file) => file.relativePath),
    new Set(currentFiles),
    new Set(previousFiles),
  )
  issues.push(...remoteOnly)
  const direction = changed + remoteOnly.length + remoteDeletes.length + Number(stateMetadataDirty) === 0 ? 'none'
    : remoteOnly.length || issues.some((issue) => issue.kind === 'conflict') ? 'bidirectional' : 'upload'
  const conflicts = issues.filter((issue) => issue.kind === 'conflict')
  const summaryParts = [
    ...(conflicts.length ? [`${conflicts.length} 个文件两端都有修改`] : []),
    ...(remoteOnly.length ? [`${remoteOnly.length} 个文件只在镜像中存在`] : []),
    ...(remoteDeletes.length ? [`${remoteDeletes.length} 个备份文件待删除`] : []),
    ...(changed ? [`${changed} 个文件需要备份`] : []),
    ...(stateMetadataDirty ? ['资料库中文名称映射待更新'] : []),
  ]
  return {
    id: crypto.randomUUID(), workspaceId: workspace.id, targetId: target.id,
    targetName: target.name, provider: 'local', direction,
    summary: summaryParts.length ? summaryParts.join('，') : '镜像备份已是最新',
    actions: summaryParts.length
      ? [
        ...(conflicts.length ? ['按确认结果保留本地或镜像版本'] : []),
        ...(remoteOnly.length ? [`恢复 ${remoteOnly.length} 个镜像独有文件到本机`] : []),
        ...(changed ? [`复制 ${changed} 个新增或变化的文件`] : []),
        ...(remoteDeletes.length ? [`删除 ${remoteDeletes.length} 个受管备份文件`] : []),
        ...(stateMetadataDirty ? ['更新镜像中的资料库中文名称映射'] : []),
      ]
      : ['无需传输'],
    issues, requiresConfirmation: issues.length > 0,
    createdAt: new Date().toISOString(),
    metadata: { changed, stateMetadataDirty, plannedWorkspaceName: localState.workspaceName ?? '', conflictCount: conflicts.length, remoteOnlyCount: remoteOnly.length, remoteDeleteCount: remoteDeletes.length, totalBytes: sourceFiles.reduce((sum, file) => sum + file.size, 0), remoteRevisionId: remoteState?.revisionId ?? '', localContentFingerprint: syncStateContentFingerprint(localState), remoteContentFingerprint: syncStateContentFingerprint(remoteContentState) },
  }
}

export async function runLocalSync(
  workspace: WorkspaceProfile,
  target: SyncTarget,
  plan: SyncPlan,
  decision: SyncDecision,
  deviceId = '00000000000000000000000000000001',
  execution: SyncExecutionOptions = {},
): Promise<string> {
  execution.signal?.throwIfAborted()
  const root = await safeDestinationRoot(workspace, target)
  await mkdir(root, { recursive: true })
  await recoverInterruptedLocalDeletes(root)
  const currentRemoteState = parseSyncState(await readOptionalSyncFile(path.join(root, ...MANIFEST_FILE.split('/'))))
  if (String(plan.metadata.remoteRevisionId ?? '') !== (currentRemoteState?.revisionId ?? '')) throw new Error('镜像状态在确认期间已经变化，请重新检查后再同步')
  const currentRemoteFiles = await scanFiles(root).catch(() => [])
  const currentRemoteContent = await buildWorkspaceSyncState({ workspaceId: workspace.id, workspaceName: workspace.freshRestore ? undefined : workspace.name, deviceId, files: currentRemoteFiles, previous: currentRemoteState })
  if (syncStateContentFingerprint(currentRemoteContent) !== String(plan.metadata.remoteContentFingerprint ?? '')) throw new Error('镜像文件在确认期间已经变化，请重新检查后再同步')
  const files = await scanFiles(workspace.path)
  const localPrevious = await readLocalSyncState(workspace.path)
  const currentLocal = await buildWorkspaceSyncState({ workspaceId: workspace.id, workspaceName: workspace.freshRestore ? undefined : workspace.name, deviceId, files, previous: localPrevious })
  if (syncStateContentFingerprint(currentLocal) !== String(plan.metadata.localContentFingerprint ?? '')) throw new Error('本机资料库在确认期间发生变化，请重新检查')
  if ((currentLocal.workspaceName ?? '') !== String(plan.metadata.plannedWorkspaceName ?? currentLocal.workspaceName ?? '')) throw new Error('资料库名称在确认期间发生变化，请重新检查')
  const remoteDeletes = plan.issues.filter((issue) => issue.kind === 'remote-delete')
  if (remoteDeletes.length > 0 && !decision.deleteRemote) throw new Error('检测到云端删除操作，需要重新检查并明确确认')
  // 镜像独有文件无论选择哪个方向都恢复到本机（合并语义），避免每次检查重复提示。
  const restoredPaths: string[] = []
  for (const issue of plan.issues.filter((item) => item.kind === 'remote-only')) {
    execution.signal?.throwIfAborted()
    if (!isSafeManagedPath(issue.path)) continue
    const source = path.join(root, ...issue.path.split('/'))
    const destination = path.join(workspace.path, ...issue.path.split('/'))
    try {
      const totalBytes = (await stat(source)).size
      await copyFileAtomically(source, destination, {
        signal: execution.signal,
        onProgress: (transferredBytes) => execution.onTransferProgress?.({ path: issue.path, direction: 'download', transferredBytes, totalBytes }),
      })
      restoredPaths.push(issue.path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`镜像文件在同步期间消失：${issue.path}，请重新检查`)
      throw error
    }
  }
  if (!decision.preserveLocalOnly) {
    for (const issue of plan.issues.filter((item) => item.kind === 'conflict')) {
      execution.signal?.throwIfAborted()
      if (!isSafeManagedPath(issue.path)) continue
      const source = path.join(root, ...issue.path.split('/'))
      const destination = path.join(workspace.path, ...issue.path.split('/'))
      const totalBytes = (await stat(source)).size
      await copyFileAtomically(source, destination, {
        signal: execution.signal,
        onProgress: (transferredBytes) => execution.onTransferProgress?.({ path: issue.path, direction: 'download', transferredBytes, totalBytes }),
      })
      restoredPaths.push(issue.path)
    }
  }
  let copied = 0
  for (const source of files) {
    execution.signal?.throwIfAborted()
    const destination = path.join(root, source.relativePath)
    let shouldCopy = true
    try {
      const destinationInfo = await stat(destination)
      if (destinationInfo.size === source.size && await hashFile(destination) === await hashFile(source.absolutePath)) shouldCopy = false
      else if (destinationInfo.mtimeMs > source.modifiedAt + 1000 && !decision.preserveLocalOnly) shouldCopy = false
    } catch { /* destination does not exist */ }
    if (shouldCopy) {
      try {
        await copyFileAtomically(source.absolutePath, destination, {
          signal: execution.signal,
          onProgress: (transferredBytes) => execution.onTransferProgress?.({ path: source.relativePath, direction: 'copy', transferredBytes, totalBytes: source.size }),
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`本机文件在同步期间消失：${source.relativePath}，请重新检查`)
        throw error
      }
      copied++
    }
  }
  const finalFiles = await scanFiles(workspace.path)
  execution.signal?.throwIfAborted()
  const nextState = await buildWorkspaceSyncState({
    workspaceId: workspace.id,
    workspaceName: workspace.freshRestore ? undefined : workspace.name,
    deviceId,
    files: finalFiles,
    previous: localPrevious,
  })
  nextState.targetHeads[target.id] = nextState.revisionId
  const stagedDeletes = await stageLocalDeletes(root, remoteDeletes.map((issue) => issue.path))
  try {
    await writeLocalSyncState(root, nextState)
  } catch (error) {
    await restoreStagedLocalDeletes(stagedDeletes)
    throw error
  }
  for (const item of stagedDeletes) await rm(item.staged, { force: true }).catch(() => { /* committed state ignores orphaned quarantine files */ })
  await writeLocalSyncState(workspace.path, nextState)
  await writeTargetBaseState(workspace.path, target.id, nextState)
  const parts: string[] = []
  if (copied) parts.push(`已备份 ${copied} 个文件`)
  if (restoredPaths.length) parts.push(`已从镜像恢复 ${restoredPaths.length} 个文件到本机`)
  if (remoteDeletes.length > 0) parts.push(`并从镜像删除 ${remoteDeletes.length} 个文件`)
  if (parts.length === 0) return '镜像备份已是最新'
  return parts.join('，')
}
