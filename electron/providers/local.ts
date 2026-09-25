import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ensureParent, hashFile, scanFiles } from '../files.js'
import type { FileIssue, LocalTargetConfig, SyncDecision, SyncPlan, SyncTarget, WorkspaceProfile } from '../types.js'
import { deletedManagedFiles, MANIFEST_FILE, parseManagedManifest, serializeManagedManifest } from './managed-manifest.js'

function destinationRoot(workspace: WorkspaceProfile, target: SyncTarget): string {
  return path.join((target.config as LocalTargetConfig).destinationPath, workspace.name)
}

export async function planLocalSync(workspace: WorkspaceProfile, target: SyncTarget): Promise<SyncPlan> {
  const sourceFiles = await scanFiles(workspace.path)
  const root = destinationRoot(workspace, target)
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
        if (destinationInfo.mtimeMs > source.modifiedAt + 1000) issues.push({ path: source.relativePath, kind: 'conflict' })
      }
    } catch {
      changed++
    }
  }
  return {
    id: crypto.randomUUID(), workspaceId: workspace.id, targetId: target.id,
    targetName: target.name, provider: 'local', direction: changed || remoteDeletes.length ? 'upload' : 'none',
    summary: remoteDeletes.length ? `${changed} 个文件待更新，${remoteDeletes.length} 个云端文件待删除` : changed ? `${changed} 个文件需要备份` : '镜像备份已是最新',
    actions: changed || remoteDeletes.length
      ? [...(changed ? [`复制 ${changed} 个新增或变化的文件`] : []), ...(remoteDeletes.length ? [`删除 ${remoteDeletes.length} 个受管备份文件`] : [])]
      : ['无需传输'],
    issues, requiresConfirmation: issues.length > 0, createdAt: new Date().toISOString(), metadata: { changed, remoteDeleteCount: remoteDeletes.length },
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
  await writeFile(manifestPath, serializeManagedManifest(files.map((file) => file.relativePath)), 'utf8')
  if (remoteDeletes.length > 0) return `已备份 ${copied} 个文件，并从镜像删除 ${remoteDeletes.length} 个文件`
  return copied ? `已备份 ${copied} 个文件` : '镜像备份已是最新'
}
