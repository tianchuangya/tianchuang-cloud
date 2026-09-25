import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient, type WebDAVClient } from 'webdav'
import { getSecret } from '../store.js'
import { scanFiles } from '../files.js'
import type { SyncDecision, SyncPlan, SyncTarget, WebDavTargetConfig, WorkspaceProfile } from '../types.js'
import { deletedManagedFiles, MANIFEST_DIRECTORY, MANIFEST_FILE, parseManagedManifest, serializeManagedManifest } from './managed-manifest.js'

function normalizeRemotePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  return normalized ? `/${normalized}` : '/'
}

function clientFor(config: WebDavTargetConfig): WebDAVClient {
  return createClient(config.endpoint, { username: config.username, password: getSecret(config.secretId) })
}

export async function planWebDavSync(workspace: WorkspaceProfile, target: SyncTarget): Promise<SyncPlan> {
  const config = target.config as WebDavTargetConfig
  const files = await scanFiles(workspace.path)
  const limit = target.maxFileSizeMb * 1024 * 1024
  const tooLarge = files.filter((file) => file.size > limit).map((file) => ({
    path: file.relativePath, size: file.size, limit, kind: 'too-large' as const,
  }))
  const client = clientFor(config)
  const root = normalizeRemotePath(config.remotePath)
  try { await client.getDirectoryContents(normalizeRemotePath(config.remotePath)) } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('404')) throw new Error(`WebDAV 连接失败：${message}`)
  }
  const manifestPath = path.posix.join(root, MANIFEST_FILE)
  const previousFiles = parseManagedManifest(await client.getFileContents(manifestPath).catch(() => undefined) as Buffer | string | undefined)
  const remoteDeletes = deletedManagedFiles(previousFiles, files.map((file) => file.relativePath))
  const issues = [...tooLarge, ...remoteDeletes.map((file) => ({ path: file, kind: 'remote-delete' as const }))]
  return {
    id: crypto.randomUUID(), workspaceId: workspace.id, targetId: target.id,
    targetName: target.name, provider: 'webdav', direction: tooLarge.length ? 'blocked' : 'upload',
    summary: tooLarge.length ? `${tooLarge.length} 个文件超过目标限制` : remoteDeletes.length ? `${remoteDeletes.length} 个云端文件待删除` : `准备检查并备份 ${files.length} 个文件`,
    actions: tooLarge.length ? ['调整文件或目标大小限制'] : ['创建远端目录', '上传变化文件', ...(remoteDeletes.length ? [`删除 ${remoteDeletes.length} 个受管云端文件`] : [])],
    issues, requiresConfirmation: issues.length > 0,
    createdAt: new Date().toISOString(), metadata: { fileCount: files.length, remoteDeleteCount: remoteDeletes.length },
  }
}

export async function runWebDavSync(
  workspace: WorkspaceProfile,
  target: SyncTarget,
  plan: SyncPlan,
  decision: SyncDecision,
): Promise<string> {
  const config = target.config as WebDavTargetConfig
  const client = clientFor(config)
  const root = normalizeRemotePath(config.remotePath)
  if (!(await client.exists(root))) await client.createDirectory(root, { recursive: true })
  const files = await scanFiles(workspace.path)
  const remoteDeletes = plan.issues.filter((issue) => issue.kind === 'remote-delete')
  if (remoteDeletes.length > 0 && !decision.deleteRemote) throw new Error('检测到云端删除操作，需要重新检查并明确确认')
  for (const issue of remoteDeletes) await client.deleteFile(path.posix.join(root, issue.path))
  let uploaded = 0
  for (const file of files) {
    const remoteFile = path.posix.join(root, file.relativePath)
    const remoteDirectory = path.posix.dirname(remoteFile)
    if (!(await client.exists(remoteDirectory))) await client.createDirectory(remoteDirectory, { recursive: true })
    const remoteStat = await client.stat(remoteFile).catch(() => undefined) as { size?: number } | undefined
    if (!remoteStat || remoteStat.size !== file.size) {
      const contents = await readFile(file.absolutePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (!contents) continue
      await client.putFileContents(remoteFile, contents, { overwrite: true })
      uploaded++
    }
  }
  const manifestDirectory = path.posix.join(root, MANIFEST_DIRECTORY)
  if (!(await client.exists(manifestDirectory))) await client.createDirectory(manifestDirectory, { recursive: true })
  await client.putFileContents(path.posix.join(root, MANIFEST_FILE), serializeManagedManifest(files.map((file) => file.relativePath)), { overwrite: true })
  if (remoteDeletes.length > 0) return `已上传 ${uploaded} 个文件，并从 WebDAV 删除 ${remoteDeletes.length} 个文件`
  return uploaded ? `已上传 ${uploaded} 个文件到 WebDAV` : 'WebDAV 备份已是最新'
}
