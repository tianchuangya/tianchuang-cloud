import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient, type WebDAVClient } from 'webdav'
import { getSecret } from '../store.js'
import { ensureParent, scanFiles } from '../files.js'
import type { SyncDecision, SyncPlan, SyncTarget, WebDavTargetConfig, WorkspaceProfile } from '../types.js'
import { deletedManagedFiles, isSafeManagedPath, MANIFEST_DIRECTORY, MANIFEST_FILE, parseManagedManifest, serializeManagedManifest } from './managed-manifest.js'
import { diffRemoteFiles, largeFileActions, largeFileIssues, largeFileSummary, type RemoteFileEntry } from './diff-model.js'

function normalizeRemotePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  return normalized ? `/${normalized}` : '/'
}

function clientFor(config: WebDavTargetConfig): WebDAVClient {
  return createClient(config.endpoint, { username: config.username, password: getSecret(config.secretId) })
}

interface RemoteListingEntry {
  filename: string
  type: string
  size: number
  lastmod: string
}

async function listRemoteFiles(client: WebDAVClient, root: string): Promise<RemoteFileEntry[]> {
  let entries: RemoteListingEntry[]
  try {
    entries = await client.getDirectoryContents(root, { deep: true, details: true }) as unknown as RemoteListingEntry[]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('404')) throw new Error(`WebDAV 连接失败：${message}`)
    return []
  }
  const files: RemoteFileEntry[] = []
  for (const entry of entries) {
    if (entry.type !== 'file') continue
    const relativePath = entry.filename.startsWith(`${root}/`)
      ? entry.filename.slice(root.length + 1)
      : entry.filename.replace(/^\/+/, '')
    if (!isSafeManagedPath(relativePath)) continue
    files.push({ path: relativePath, size: entry.size, lastmodMs: Number.isNaN(Date.parse(entry.lastmod)) ? undefined : Date.parse(entry.lastmod) })
  }
  return files
}

export async function planWebDavSync(workspace: WorkspaceProfile, target: SyncTarget): Promise<SyncPlan> {
  const config = target.config as WebDavTargetConfig
  const files = await scanFiles(workspace.path)
  const limitMb = target.maxFileSizeMb
  const tooLarge = largeFileIssues(files, limitMb)
  if (tooLarge.length > 0) {
    return {
      id: crypto.randomUUID(), workspaceId: workspace.id, targetId: target.id,
      targetName: target.name, provider: 'webdav', direction: 'blocked',
      summary: largeFileSummary(tooLarge, limitMb),
      actions: largeFileActions('webdav', tooLarge), issues: tooLarge,
      requiresConfirmation: true, createdAt: new Date().toISOString(), metadata: { fileCount: files.length },
    }
  }
  const client = clientFor(config)
  const root = normalizeRemotePath(config.remotePath)
  const remoteFiles = await listRemoteFiles(client, root)
  const previousFiles = parseManagedManifest(await client.getFileContents(path.posix.join(root, MANIFEST_FILE)).catch(() => undefined) as Buffer | string | undefined)
  const localPaths = files.map((file) => file.relativePath)
  const diff = diffRemoteFiles(files, remoteFiles, previousFiles)
  const remoteDeletes = deletedManagedFiles(previousFiles, localPaths)
  const issues = [...diff.conflicts, ...diff.remoteOnly, ...remoteDeletes.map((file) => ({ path: file, kind: 'remote-delete' as const }))]
  const changed = diff.uploads.length + diff.conflicts.length + diff.remoteOnly.length + remoteDeletes.length
  const direction = changed === 0 ? 'none' : diff.conflicts.length + diff.remoteOnly.length > 0 ? 'bidirectional' : 'upload'
  const summaryParts = [
    ...(diff.conflicts.length ? [`${diff.conflicts.length} 个文件两端都有修改`] : []),
    ...(diff.remoteOnly.length ? [`${diff.remoteOnly.length} 个文件只在远端存在`] : []),
    ...(remoteDeletes.length ? [`${remoteDeletes.length} 个云端文件待删除`] : []),
    ...(diff.uploads.length ? [`${diff.uploads.length} 个文件待上传`] : []),
  ]
  const actions = [
    ...(diff.conflicts.length ? ['按确认结果保留本地或远端版本'] : []),
    ...(diff.remoteOnly.length ? [`下载 ${diff.remoteOnly.length} 个远端独有文件到本机`] : []),
    ...(diff.uploads.length ? [`上传 ${diff.uploads.length} 个新增或变化的文件`] : []),
    ...(remoteDeletes.length ? [`删除 ${remoteDeletes.length} 个受管云端文件`] : []),
  ]
  return {
    id: crypto.randomUUID(), workspaceId: workspace.id, targetId: target.id,
    targetName: target.name, provider: 'webdav', direction,
    summary: summaryParts.length ? summaryParts.join('，') : '远端备份已是最新',
    actions: actions.length ? ['创建远端目录', ...actions] : ['无需传输'],
    issues, requiresConfirmation: issues.length > 0,
    createdAt: new Date().toISOString(),
    metadata: {
      fileCount: files.length, uploadCount: diff.uploads.length,
      conflictCount: diff.conflicts.length, remoteOnlyCount: diff.remoteOnly.length, remoteDeleteCount: remoteDeletes.length,
    },
  }
}

// 远端文件写回本机前必须再次通过安全路径校验，且只下载、永不因此删除远端内容。
async function downloadRemoteFile(client: WebDAVClient, root: string, workspacePath: string, relativePath: string): Promise<boolean> {
  if (!isSafeManagedPath(relativePath)) return false
  const contents = await client.getFileContents(path.posix.join(root, relativePath)).catch(() => undefined) as unknown as Buffer | undefined
  if (!contents) return false
  const destination = path.join(workspacePath, ...relativePath.split('/'))
  await ensureParent(destination)
  await writeFile(destination, contents)
  return true
}

// 删除整个 WebDAV 备份目录。只允许删除至少两级深度的路径，避免误删服务器根目录。
export async function deleteWebDavBackup(workspace: WorkspaceProfile, target: SyncTarget): Promise<string> {
  void workspace
  const config = target.config as WebDavTargetConfig
  const root = normalizeRemotePath(config.remotePath)
  if (root === '/' || !root.slice(1).includes('/')) {
    throw new Error('WebDAV 远端路径过浅，为避免误删服务器上的其他目录，天创云端拒绝自动删除')
  }
  const client = clientFor(config)
  if (!(await client.exists(root))) return '远端目录不存在，无需删除'
  await client.deleteFile(root)
  return `已删除 WebDAV 目录 ${root}`
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

  // 合并语义：远端独有文件无论选择哪个方向都下载回本机，避免每次检查重复提示；
  // 两端都修改的文件只有在“以远端为准”时才改用远端版本，否则保留本地版本上传。
  const conflicts = new Set(plan.issues.filter((issue) => issue.kind === 'conflict').map((issue) => issue.path))
  const downloadedPaths: string[] = []
  if (!decision.preserveLocalOnly) {
    for (const conflict of conflicts) {
      if (await downloadRemoteFile(client, root, workspace.path, conflict)) downloadedPaths.push(conflict)
    }
  }
  for (const issue of plan.issues.filter((item) => item.kind === 'remote-only')) {
    if (await downloadRemoteFile(client, root, workspace.path, issue.path)) downloadedPaths.push(issue.path)
  }

  let uploaded = 0
  for (const file of files) {
    if (!decision.preserveLocalOnly && conflicts.has(file.relativePath)) continue
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
  await client.putFileContents(path.posix.join(root, MANIFEST_FILE), serializeManagedManifest([...files.map((file) => file.relativePath), ...downloadedPaths]), { overwrite: true })
  const parts: string[] = []
  if (uploaded) parts.push(`已上传 ${uploaded} 个文件`)
  if (downloadedPaths.length) parts.push(`已下载 ${downloadedPaths.length} 个文件到本机`)
  if (remoteDeletes.length > 0) parts.push(`并从 WebDAV 删除 ${remoteDeletes.length} 个文件`)
  if (parts.length === 0) return 'WebDAV 备份已是最新'
  return parts.join('，')
}
