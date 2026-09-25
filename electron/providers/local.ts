import { copyFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { ensureParent, hashFile, scanFiles } from '../files.js'
import type { FileIssue, LocalTargetConfig, SyncDecision, SyncPlan, SyncTarget, WorkspaceProfile } from '../types.js'

function destinationRoot(workspace: WorkspaceProfile, target: SyncTarget): string {
  return path.join((target.config as LocalTargetConfig).destinationPath, workspace.name)
}

export async function planLocalSync(workspace: WorkspaceProfile, target: SyncTarget): Promise<SyncPlan> {
  const sourceFiles = await scanFiles(workspace.path)
  const root = destinationRoot(workspace, target)
  const issues: FileIssue[] = []
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
    targetName: target.name, provider: 'local', direction: changed ? 'upload' : 'none',
    summary: changed ? `${changed} 个文件需要备份` : '镜像备份已是最新',
    actions: changed ? [`复制 ${changed} 个新增或变化的文件`, '保留目标中的历史文件'] : ['无需传输'],
    issues, requiresConfirmation: issues.length > 0, createdAt: new Date().toISOString(), metadata: { changed },
  }
}

export async function runLocalSync(
  workspace: WorkspaceProfile,
  target: SyncTarget,
  decision: SyncDecision,
): Promise<string> {
  const root = destinationRoot(workspace, target)
  await mkdir(root, { recursive: true })
  const files = await scanFiles(workspace.path)
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
  return copied ? `已备份 ${copied} 个文件` : '镜像备份已是最新'
}
