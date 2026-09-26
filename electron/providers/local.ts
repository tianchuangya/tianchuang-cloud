import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ensureParent, hashFile, scanFiles } from '../files.js'
import type { FileIssue, LocalTargetConfig, SyncDecision, SyncPlan, SyncTarget, WorkspaceProfile } from '../types.js'
import { deletedManagedFiles, isSafeManagedPath, MANIFEST_FILE, parseManagedManifest, serializeManagedManifest } from './managed-manifest.js'
import { largeFileActions, largeFileIssues, largeFileSummary, remoteOnlyIssues } from './diff-model.js'

function destinationRoot(workspace: WorkspaceProfile, target: SyncTarget): string {
  return path.join((target.config as LocalTargetConfig).destinationPath, workspace.name)
}

// 删除整个磁盘镜像目录。镜像始终位于“所选目录/资料库名”这一层，路径过浅时拒绝删除。
export async function deleteLocalBackup(workspace: WorkspaceProfile, target: SyncTarget): Promise<string> {
  const root = path.resolve(destinationRoot(workspace, target))
  if (root === path.parse(root).root || root.split(path.sep).filter(Boolean).length < 2) {
    throw new Error('镜像路径过浅，为避免误删磁盘内容，天创云端拒绝自动删除')
  }
  await rm(root, { recursive: true, force: true })
  return `已删除镜像目录 ${root}`
}

export async function planLocalSync(workspace: WorkspaceProfile, target: SyncTarget): Promise<SyncPlan> {
  const sourceFiles = await scanFiles(workspace.path)
  const root = destinationRoot(workspace, target)
  const limitMb = target.maxFileSizeMb
  const tooLarge = largeFileIssues(sourceFiles, limitMb)
  if (tooLarge.length > 0) {
    return {
      id: crypto.randomUUID(), workspaceId: workspace.id, targetId: target.id,
      targetName: target.name, provider: 'local', direction: 'blocked',
      summary: largeFileSummary(tooLarge, limitMb),
      actions: largeFileActions('local', tooLarge), issues: tooLarge,
      requiresConfirmation: true, createdAt: new Date().toISOString(), metadata: { changed: 0 },
    }
  }
  const issues: FileIssue[] = []
  const manifestPath = path.join(root, ...MANIFEST_FILE.split('/'))
  const previousFiles = parseManagedManifest(await readFile(manifestPath).catch(() => undefined))
  const currentFiles = sourceFiles.map((file) => file.relativePath)
  const remoteDeletes = deletedManagedFiles(previousFiles, currentFiles)
  issues.push(...remoteDeletes.map((file) => ({ path: file, kind: 'remote-delete' as const })))
  let changed = 0
  for (const source of sourceFiles) {
    const destination = path.join(root, source.relativePath)
    try {
      const destinationInfo = await stat(destination)
      const sizeChanged = destinationInfo.size !== source.size
      const timeChanged = Math.abs(destinationInfo.mtimeMs - source.modifiedAt) > 1000
      const contentChanged = sizeChanged || (timeChanged && await hashFile(destination) !== await hashFile(source.absolutePath))
      if (contentChanged) {
        changed++
        if (destinationInfo.mtimeMs > source.modifiedAt + 1000) issues.push({ path: source.relativePath, size: source.size, kind: 'conflict' })
      }
    } catch {
      changed++
    }
  }
  // 镜像目录里存在清单和本地都没有的文件时，视为远端独有内容（例如另一台设备或
  // 手动放入的文件），必须提示用户；合并时会下载回本机，不会被静默删除。
  const destinationFiles = await scanFiles(root).catch(() => [])
  const remoteOnly = remoteOnlyIssues(
    destinationFiles.map((file) => file.relativePath),
    new Set(currentFiles),
    new Set(previousFiles),
  )
  issues.push(...remoteOnly)
  const direction = changed + remoteOnly.length + remoteDeletes.length === 0 ? 'none'
    : remoteOnly.length || issues.some((issue) => issue.kind === 'conflict') ? 'bidirectional' : 'upload'
  const conflicts = issues.filter((issue) => issue.kind === 'conflict')
  const summaryParts = [
    ...(conflicts.length ? [`${conflicts.length} 个文件两端都有修改`] : []),
    ...(remoteOnly.length ? [`${remoteOnly.length} 个文件只在镜像中存在`] : []),
    ...(remoteDeletes.length ? [`${remoteDeletes.length} 个备份文件待删除`] : []),
    ...(changed ? [`${changed} 个文件需要备份`] : []),
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
      ]
      : ['无需传输'],
    issues, requiresConfirmation: issues.length > 0,
    createdAt: new Date().toISOString(),
    metadata: { changed, conflictCount: conflicts.length, remoteOnlyCount: remoteOnly.length, remoteDeleteCount: remoteDeletes.length },
  }
}

export async function runLocalSync(
  workspace: WorkspaceProfile,
  target: SyncTarget,
  plan: SyncPlan,
  decision: SyncDecision,
): Promise<string> {
  const root = destinationRoot(workspace, target)
  await mkdir(root, { recursive: true })
  const files = await scanFiles(workspace.path)
  const remoteDeletes = plan.issues.filter((issue) => issue.kind === 'remote-delete')
  if (remoteDeletes.length > 0 && !decision.deleteRemote) throw new Error('检测到云端删除操作，需要重新检查并明确确认')
  for (const issue of remoteDeletes) await rm(path.join(root, issue.path), { force: true })
  // 镜像独有文件无论选择哪个方向都恢复到本机（合并语义），避免每次检查重复提示。
  const restoredPaths: string[] = []
  for (const issue of plan.issues.filter((item) => item.kind === 'remote-only')) {
    if (!isSafeManagedPath(issue.path)) continue
    const source = path.join(root, ...issue.path.split('/'))
    const destination = path.join(workspace.path, ...issue.path.split('/'))
    await ensureParent(destination)
    try {
      await copyFile(source, destination)
      restoredPaths.push(issue.path)
    } catch { /* the mirror copy disappeared between plan and run */ }
  }
  let copied = 0
  for (const source of files) {
    const destination = path.join(root, source.relativePath)
    let shouldCopy = true
    try {
      const destinationInfo = await stat(destination)
      if (destinationInfo.size === source.size && await hashFile(destination) === await hashFile(source.absolutePath)) shouldCopy = false
      else if (destinationInfo.mtimeMs > source.modifiedAt + 1000 && !decision.preserveLocalOnly) shouldCopy = false
    } catch { /* destination does not exist */ }
    if (shouldCopy) {
      await ensureParent(destination)
      try {
        await copyFile(source.absolutePath, destination)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      copied++
    }
  }
  const manifestPath = path.join(root, ...MANIFEST_FILE.split('/'))
  await mkdir(path.dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, serializeManagedManifest([...files.map((file) => file.relativePath), ...restoredPaths]), 'utf8')
  const parts: string[] = []
  if (copied) parts.push(`已备份 ${copied} 个文件`)
  if (restoredPaths.length) parts.push(`已从镜像恢复 ${restoredPaths.length} 个文件到本机`)
  if (remoteDeletes.length > 0) parts.push(`并从镜像删除 ${remoteDeletes.length} 个文件`)
  if (parts.length === 0) return '镜像备份已是最新'
  return parts.join('，')
}
