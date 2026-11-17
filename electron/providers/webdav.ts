import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { createClient, type WebDAVClient } from 'webdav'
import { scanFiles, writeReadableAtomically } from '../files.js'
import type { DestinationCapacity, SyncDecision, SyncExecutionOptions, SyncPlan, SyncTarget, WebDavTargetConfig, WorkspaceProfile } from '../types.js'
import { deletedManagedFiles, isSafeManagedPath, LEGACY_MANIFEST_FILE, MANIFEST_DIRECTORY, MANIFEST_FILE, parseManagedManifest } from './managed-manifest.js'
import { diffRemoteFiles, largeFileActions, largeFileIssues, largeFileSummary, type RemoteFileEntry } from './diff-model.js'
import { buildWorkspaceSyncState, createRevisionId, parseSyncState, readLocalSyncState, serializeSyncState, syncStateContentFingerprint, writeLocalSyncState, writeTargetBaseState, type WorkspaceSyncState } from '../sync-state.js'

const ATOMIC_REMOTE_TEMPORARY_FILE = /\.tianchuang-[0-9a-f]{32}\.tmp$/
const STAGED_REMOTE_DELETE_FILE = /\.tianchuang-delete-[0-9a-f]{32}\.tmp$/

function normalizeRemotePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  const segments = normalized.split('/')
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new Error('WebDAV 远端路径无效，不能包含 .、.. 或空字符')
  }
  return normalized ? `/${normalized}` : '/'
}

function clientFor(config: WebDavTargetConfig, password: string): WebDAVClient {
  return createClient(config.endpoint, { username: config.username, password })
}

function isMissingWebDavResource(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { status?: number; statusCode?: number; response?: { status?: number }; message?: string }
  return candidate.status === 404 || candidate.statusCode === 404 || candidate.response?.status === 404
    || /(?:^|\D)404(?:\D|$)|not found/i.test(candidate.message ?? '')
}

async function optionalRemoteContents(client: WebDAVClient, remotePath: string, signal?: AbortSignal): Promise<Buffer | string | undefined> {
  try {
    return await client.getFileContents(remotePath, { signal }) as unknown as Buffer | string
  } catch (error) {
    if (isMissingWebDavResource(error)) return undefined
    throw error
  }
}

async function optionalRemoteStat(client: WebDAVClient, remotePath: string, signal?: AbortSignal): Promise<{ size?: number } | undefined> {
  try {
    return await client.stat(remotePath, { signal }) as { size?: number }
  } catch (error) {
    if (isMissingWebDavResource(error)) return undefined
    throw error
  }
}

export async function checkWebDavConnection(config: WebDavTargetConfig, password = ''): Promise<string> {
  const client = clientFor(config, password)
  const root = normalizeRemotePath(config.remotePath)
  const exists = await client.exists(root)
  return exists ? `WebDAV 连接正常，远端路径 ${root} 可访问` : `WebDAV 认证成功，远端路径 ${root} 尚未创建`
}

function remoteListingFingerprint(files: RemoteFileEntry[]): string {
  return createHash('sha256').update(files
    .map((file) => `${file.path}\0${file.size}\0${file.lastmodMs ?? ''}\0${file.sha256 ?? ''}`)
    .sort()
    .join('\n')).digest('hex')
}

// WebDAV 的 PROPFIND 大多只提供大小和修改时间，不能证明内容相同。
// ETag 和大小都与已提交状态一致时复用可信 SHA；ETag 变化或服务端不提供
// ETag 时才顺序读取内容。这样大文件不会在每次检查时被完整下载，同时保留
// 对服务端外部修改和同大小改写的检测。
async function hashRemoteFiles(client: WebDAVClient, root: string, files: RemoteFileEntry[], state?: WorkspaceSyncState, signal?: AbortSignal): Promise<RemoteFileEntry[]> {
  const result: RemoteFileEntry[] = []
  for (const file of files) {
    signal?.throwIfAborted()
    const cached = state?.files[file.path]
    if (!cached?.deleted && cached?.sha256 && cached.size === file.size && cached.remoteEtag && file.etag && cached.remoteEtag === file.etag) {
      result.push({ ...file, sha256: cached.sha256 })
      continue
    }
    const hash = createHash('sha256')
    const stream = client.createReadStream(path.posix.join(root, file.path), { signal }) as Readable
    for await (const chunk of stream) hash.update(chunk as Buffer)
    result.push({ ...file, sha256: hash.digest('hex') })
  }
  return result
}

interface RemoteListingEntry {
  filename: string
  type: string
  size: number
  lastmod: string
  etag?: string | null
}

function detailedEntries(response: unknown): RemoteListingEntry[] {
  const entries = Array.isArray(response) ? response : (response as { data?: unknown })?.data
  if (!Array.isArray(entries)) throw new Error('WebDAV 目录列表返回格式无效')
  return entries as RemoteListingEntry[]
}

async function compatibleDirectoryListing(client: WebDAVClient, root: string, signal?: AbortSignal): Promise<RemoteListingEntry[]> {
  try {
    return detailedEntries(await client.getDirectoryContents(root, { deep: true, details: true, signal }))
  } catch (deepError) {
    // A number of real servers reject Depth: infinity while supporting normal
    // Depth: 1. Only fall back when the shallow request succeeds; otherwise
    // preserve the actual authorization/transport failure.
    let firstLevel: RemoteListingEntry[]
    try {
      firstLevel = detailedEntries(await client.getDirectoryContents(root, { deep: false, details: true, signal }))
    } catch {
      throw deepError
    }
    const result = [...firstLevel]
    const queue = firstLevel.filter((entry) => entry.type === 'directory').map((entry) => entry.filename)
    while (queue.length) {
      signal?.throwIfAborted()
      const directory = queue.shift()!
      const children = detailedEntries(await client.getDirectoryContents(directory, { deep: false, details: true, signal }))
      result.push(...children)
      queue.push(...children.filter((entry) => entry.type === 'directory').map((entry) => entry.filename))
      if (result.length > 250_000) throw new Error('WebDAV 远端文件数量超过安全上限 250000')
    }
    return result
  }
}

async function listRemoteFiles(client: WebDAVClient, root: string, signal?: AbortSignal, recoverInterruptedDeletes = true): Promise<RemoteFileEntry[]> {
  // Some compliant servers return 403 (not 404) when PROPFIND targets a
  // missing nested collection. HEAD/exists distinguishes that case without
  // weakening real authorization failures on an existing collection.
  if (!(await client.exists(root, { signal }))) return []
  let entries: RemoteListingEntry[]
  try {
    entries = await compatibleDirectoryListing(client, root, signal)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('404')) throw new Error(`WebDAV 连接失败：${message}`)
    return []
  }
  // A process can stop after moving a pending deletion aside but before the
  // state document is committed. Restore that file on the next inspection so
  // an interrupted sync cannot turn into silent remote data loss.
  let restoredInterruptedDelete = false
  for (const entry of recoverInterruptedDeletes ? entries : []) {
    if (entry.type !== 'file') continue
    const relativePath = entry.filename.startsWith(`${root}/`)
      ? entry.filename.slice(root.length + 1)
      : entry.filename.replace(/^\/+/, '')
    if (!STAGED_REMOTE_DELETE_FILE.test(relativePath)) continue
    const originalRelativePath = relativePath.replace(STAGED_REMOTE_DELETE_FILE, '')
    if (!isSafeManagedPath(originalRelativePath)) continue
    const stagedPath = path.posix.join(root, relativePath)
    const originalPath = path.posix.join(root, originalRelativePath)
    if (await client.exists(originalPath)) await client.deleteFile(stagedPath).catch(() => { /* stale quarantine is ignored below */ })
    else {
      await client.moveFile(stagedPath, originalPath, { overwrite: false })
      restoredInterruptedDelete = true
    }
  }
  if (restoredInterruptedDelete) {
    entries = await compatibleDirectoryListing(client, root, signal)
  }

  const files: RemoteFileEntry[] = []
  for (const entry of entries) {
    if (entry.type !== 'file') continue
    const relativePath = entry.filename.startsWith(`${root}/`)
      ? entry.filename.slice(root.length + 1)
      : entry.filename.replace(/^\/+/, '')
    if (!isSafeManagedPath(relativePath) || ATOMIC_REMOTE_TEMPORARY_FILE.test(relativePath) || STAGED_REMOTE_DELETE_FILE.test(relativePath)) continue
    files.push({ path: relativePath, size: entry.size, lastmodMs: Number.isNaN(Date.parse(entry.lastmod)) ? undefined : Date.parse(entry.lastmod), ...(entry.etag ? { etag: entry.etag } : {}) })
  }
  return files
}

interface StagedRemoteDelete {
  original: string
  staged: string
}

async function stageRemoteDeletes(client: WebDAVClient, root: string, relativePaths: string[]): Promise<StagedRemoteDelete[]> {
  const staged: StagedRemoteDelete[] = []
  try {
    for (const relativePath of relativePaths) {
      if (!isSafeManagedPath(relativePath)) throw new Error(`拒绝删除不安全的 WebDAV 路径：${relativePath}`)
      const original = path.posix.join(root, relativePath)
      const temporary = `${original}.tianchuang-delete-${createRevisionId()}.tmp`
      await client.moveFile(original, temporary, { overwrite: false })
      staged.push({ original, staged: temporary })
    }
    return staged
  } catch (error) {
    for (const item of staged.reverse()) await client.moveFile(item.staged, item.original, { overwrite: false }).catch(() => { /* preserve the first failure */ })
    throw error
  }
}

async function restoreStagedDeletes(client: WebDAVClient, staged: StagedRemoteDelete[]): Promise<void> {
  const failures: string[] = []
  for (const item of [...staged].reverse()) {
    try { await client.moveFile(item.staged, item.original, { overwrite: false }) } catch { failures.push(item.original) }
  }
  if (failures.length) throw new Error(`WebDAV 同步失败，且 ${failures.length} 个待删除文件未能自动恢复；远端临时副本仍保留，请勿清理 .tianchuang-delete 文件`)
}

export async function planWebDavSync(workspace: WorkspaceProfile, target: SyncTarget, deviceId = '00000000000000000000000000000001', password = ''): Promise<SyncPlan> {
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
      requiresConfirmation: true, createdAt: new Date().toISOString(), metadata: { fileCount: files.length, totalBytes: tooLarge.reduce((sum, issue) => sum + (issue.size || 0), 0) },
    }
  }
  const client = clientFor(config, password)
  const root = normalizeRemotePath(config.remotePath)
  // 新设备恢复的资料库忽略远端清单：本地还没有文件，云端内容应作为可下载项而不是待删除项
  const stateContents = await optionalRemoteContents(client, path.posix.join(root, MANIFEST_FILE))
    ?? await optionalRemoteContents(client, path.posix.join(root, LEGACY_MANIFEST_FILE))
  const remoteState = parseSyncState(stateContents)
  const remoteListing = await listRemoteFiles(client, root)
  const remoteFiles = await hashRemoteFiles(client, root, remoteListing, remoteState)
  const previousFiles = workspace.freshRestore ? [] : parseManagedManifest(stateContents)
  const localPaths = files.map((file) => file.relativePath)
  const localPrevious = await readLocalSyncState(workspace.path)
  const localState = await buildWorkspaceSyncState({ workspaceId: workspace.id, workspaceName: workspace.freshRestore ? undefined : workspace.name, deviceId, files, previous: localPrevious })
  const remoteIdentityDirty = remoteListing.some((file) => Boolean(file.etag) && remoteState?.files[file.path]?.remoteEtag !== file.etag)
  const stateMetadataDirty = !workspace.freshRestore && (remoteState?.workspaceName !== localState.workspaceName || remoteIdentityDirty)
  const diff = diffRemoteFiles(
    files.map((file) => ({ ...file, sha256: localState.files[file.relativePath]?.sha256 })),
    remoteFiles,
    previousFiles,
  )
  const remoteDeletes = deletedManagedFiles(previousFiles, localPaths)
  const issues = [...diff.conflicts, ...diff.remoteOnly, ...remoteDeletes.map((file) => ({ path: file, kind: 'remote-delete' as const }))]
  const changed = diff.uploads.length + diff.conflicts.length + diff.remoteOnly.length + remoteDeletes.length + Number(stateMetadataDirty)
  const direction = changed === 0 ? 'none' : diff.conflicts.length + diff.remoteOnly.length > 0 ? 'bidirectional' : 'upload'
  const summaryParts = [
    ...(diff.conflicts.length ? [`${diff.conflicts.length} 个文件两端都有修改`] : []),
    ...(diff.remoteOnly.length ? [`${diff.remoteOnly.length} 个文件只在远端存在`] : []),
    ...(remoteDeletes.length ? [`${remoteDeletes.length} 个云端文件待删除`] : []),
    ...(diff.uploads.length ? [`${diff.uploads.length} 个文件待上传`] : []),
    ...(stateMetadataDirty ? [remoteState?.workspaceName !== localState.workspaceName ? '资料库中文名称映射待更新' : '远端文件校验缓存待更新'] : []),
  ]
  const actions = [
    ...(diff.conflicts.length ? ['按确认结果保留本地或远端版本'] : []),
    ...(diff.remoteOnly.length ? [`下载 ${diff.remoteOnly.length} 个远端独有文件到本机`] : []),
    ...(diff.uploads.length ? [`上传 ${diff.uploads.length} 个新增或变化的文件`] : []),
    ...(remoteDeletes.length ? [`删除 ${remoteDeletes.length} 个受管云端文件`] : []),
    ...(stateMetadataDirty ? [remoteState?.workspaceName !== localState.workspaceName ? '更新远端资料库中文名称映射' : '更新远端 ETag 校验缓存'] : []),
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
      totalBytes: files.reduce((sum, file) => sum + file.size, 0), remoteRevisionId: remoteState?.revisionId ?? '',
      localContentFingerprint: syncStateContentFingerprint(localState),
      plannedWorkspaceName: localState.workspaceName ?? '',
      remoteContentFingerprint: remoteListingFingerprint(remoteFiles),
    },
  }
}

// 远端文件写回本机前必须再次通过安全路径校验，且只下载、永不因此删除远端内容。
async function downloadRemoteFile(client: WebDAVClient, root: string, workspacePath: string, relativePath: string, execution: SyncExecutionOptions): Promise<boolean> {
  if (!isSafeManagedPath(relativePath)) return false
  execution.signal?.throwIfAborted()
  const remotePath = path.posix.join(root, relativePath)
  const remoteStat = await optionalRemoteStat(client, remotePath, execution.signal)
  if (!remoteStat) throw new Error(`WebDAV 下载失败：${relativePath} 已不存在`)
  const destination = path.join(workspacePath, ...relativePath.split('/'))
  const source = client.createReadStream(remotePath, { signal: execution.signal }) as Readable
  await writeReadableAtomically(source, destination, {
    signal: execution.signal,
    onProgress: (transferredBytes) => execution.onTransferProgress?.({ path: relativePath, direction: 'download', transferredBytes, totalBytes: Number(remoteStat.size ?? 0) }),
  })
  return true
}

async function publishRemoteFile(client: WebDAVClient, destination: string, contents: Buffer | string, signal?: AbortSignal): Promise<void> {
  const temporary = `${destination}.tianchuang-${createRevisionId()}.tmp`
  await client.putFileContents(temporary, contents, { overwrite: true, signal })
  try {
    await client.moveFile(temporary, destination, { overwrite: true, signal })
  } catch (error) {
    await client.deleteFile(temporary).catch(() => { /* preserve the MOVE failure */ })
    throw error
  }
}

async function publishRemotePath(client: WebDAVClient, destination: string, sourcePath: string, size: number, execution: SyncExecutionOptions, relativePath: string): Promise<void> {
  const temporary = `${destination}.tianchuang-${createRevisionId()}.tmp`
  const source = createReadStream(sourcePath)
  let transferredBytes = 0
  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      transferredBytes += chunk.length
      execution.onTransferProgress?.({ path: relativePath, direction: 'upload', transferredBytes, totalBytes: size })
      if (execution.signal?.aborted) callback(execution.signal.reason instanceof Error ? execution.signal.reason : new DOMException('同步已取消', 'AbortError'))
      else callback(null, chunk)
    },
  })
  const abortStreams = () => {
    // The Transform callback below carries the AbortError into the request
    // promise. Destroying with the same error here would emit a second,
    // potentially unhandled stream error in Node.
    source.destroy()
  }
  execution.signal?.addEventListener('abort', abortStreams, { once: true })
  try {
    await client.putFileContents(temporary, source.pipe(progress), {
      overwrite: true,
      contentLength: size,
      signal: execution.signal,
    })
    await client.moveFile(temporary, destination, { overwrite: true, signal: execution.signal })
  } catch (error) {
    source.destroy()
    progress.destroy()
    await client.deleteFile(temporary).catch(() => { /* preserve transfer or MOVE failure */ })
    throw error
  } finally {
    execution.signal?.removeEventListener('abort', abortStreams)
  }
}

async function publishRemoteSyncState(client: WebDAVClient, destination: string, contents: string, signal?: AbortSignal): Promise<void> {
  await publishRemoteFile(client, destination, contents, signal)
}

// 目标容量：服务端配额（不支持配额的服务器返回 undefined）
export async function webDavDestinationCapacity(target: SyncTarget, password = ''): Promise<DestinationCapacity | undefined> {
  const config = target.config as WebDavTargetConfig
  const client = clientFor(config, password)
  const quota = await client.getQuota().catch(() => undefined) as { used?: number; available?: number } | undefined
  if (!quota || (quota.used === undefined && quota.available === undefined)) return undefined
  return { quotaUsed: quota.used, quotaTotal: quota.used !== undefined && quota.available !== undefined ? quota.used + quota.available : undefined }
}

// 删除整个 WebDAV 备份目录。只允许删除至少两级深度的路径，避免误删服务器根目录。
export async function deleteWebDavBackup(workspace: WorkspaceProfile, target: SyncTarget, password = ''): Promise<string> {
  void workspace
  const config = target.config as WebDavTargetConfig
  const root = normalizeRemotePath(config.remotePath)
  if (root === '/' || !root.slice(1).includes('/')) {
    throw new Error('WebDAV 远端路径过浅，为避免误删服务器上的其他目录，天创云端拒绝自动删除')
  }
  const client = clientFor(config, password)
  if (!(await client.exists(root))) return '远端目录不存在，无需删除'
  await client.deleteFile(root)
  return `已删除 WebDAV 目录 ${root}`
}

export async function runWebDavSync(
  workspace: WorkspaceProfile,
  target: SyncTarget,
  plan: SyncPlan,
  decision: SyncDecision,
  deviceId = '00000000000000000000000000000001',
  password = '',
  execution: SyncExecutionOptions = {},
): Promise<string> {
  execution.signal?.throwIfAborted()
  const config = target.config as WebDavTargetConfig
  const client = clientFor(config, password)
  const root = normalizeRemotePath(config.remotePath)
  if (!(await client.exists(root, { signal: execution.signal }))) await client.createDirectory(root, { recursive: true, signal: execution.signal })
  const currentRemoteState = parseSyncState(await optionalRemoteContents(client, path.posix.join(root, MANIFEST_FILE), execution.signal))
  if (String(plan.metadata.remoteRevisionId ?? '') !== (currentRemoteState?.revisionId ?? '')) throw new Error('WebDAV 状态在确认期间已经变化，请重新检查后再同步')
  if (remoteListingFingerprint(await hashRemoteFiles(client, root, await listRemoteFiles(client, root, execution.signal), currentRemoteState, execution.signal)) !== String(plan.metadata.remoteContentFingerprint ?? '')) throw new Error('WebDAV 文件在确认期间已经变化，请重新检查后再同步')
  const files = await scanFiles(workspace.path)
  const localPrevious = await readLocalSyncState(workspace.path)
  const currentLocal = await buildWorkspaceSyncState({ workspaceId: workspace.id, workspaceName: workspace.freshRestore ? undefined : workspace.name, deviceId, files, previous: localPrevious })
  if (syncStateContentFingerprint(currentLocal) !== String(plan.metadata.localContentFingerprint ?? '')) throw new Error('本机资料库在确认期间发生变化，请重新检查')
  if ((currentLocal.workspaceName ?? '') !== String(plan.metadata.plannedWorkspaceName ?? currentLocal.workspaceName ?? '')) throw new Error('资料库名称在确认期间发生变化，请重新检查')
  const remoteDeletes = plan.issues.filter((issue) => issue.kind === 'remote-delete')
  if (remoteDeletes.length > 0 && !decision.deleteRemote) throw new Error('检测到云端删除操作，需要重新检查并明确确认')
  // 合并语义：远端独有文件无论选择哪个方向都下载回本机，避免每次检查重复提示；
  // 两端都修改的文件只有在“以远端为准”时才改用远端版本，否则保留本地版本上传。
  const conflicts = new Set(plan.issues.filter((issue) => issue.kind === 'conflict').map((issue) => issue.path))
  const downloadedPaths: string[] = []
  if (!decision.preserveLocalOnly) {
    for (const conflict of conflicts) {
      if (await downloadRemoteFile(client, root, workspace.path, conflict, execution)) downloadedPaths.push(conflict)
    }
  }
  for (const issue of plan.issues.filter((item) => item.kind === 'remote-only')) {
    if (await downloadRemoteFile(client, root, workspace.path, issue.path, execution)) downloadedPaths.push(issue.path)
  }

  let uploaded = 0
  for (const file of files) {
    execution.signal?.throwIfAborted()
    if (!decision.preserveLocalOnly && conflicts.has(file.relativePath)) continue
    const remoteFile = path.posix.join(root, file.relativePath)
    const remoteDirectory = path.posix.dirname(remoteFile)
    if (!(await client.exists(remoteDirectory, { signal: execution.signal }))) await client.createDirectory(remoteDirectory, { recursive: true, signal: execution.signal })
    const remoteStat = await optionalRemoteStat(client, remoteFile, execution.signal)
    const forceUpload = decision.preserveLocalOnly && conflicts.has(file.relativePath)
    if (forceUpload || !remoteStat || remoteStat.size !== file.size) {
      await publishRemotePath(client, remoteFile, file.absolutePath, file.size, execution, file.relativePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') throw new Error(`本机文件在同步期间消失：${file.relativePath}，请重新检查`)
        throw error
      })
      uploaded++
    }
  }
  const manifestDirectory = path.posix.join(root, MANIFEST_DIRECTORY)
  if (!(await client.exists(manifestDirectory, { signal: execution.signal }))) await client.createDirectory(manifestDirectory, { recursive: true, signal: execution.signal })
  const finalFiles = await scanFiles(workspace.path)
  const nextState = await buildWorkspaceSyncState({ workspaceId: workspace.id, workspaceName: workspace.freshRestore ? undefined : workspace.name, deviceId, files: finalFiles, previous: localPrevious })
  nextState.targetHeads[target.id] = nextState.revisionId
  const stagedDeletes = await stageRemoteDeletes(client, root, remoteDeletes.map((issue) => issue.path))
  try {
    const committedFiles = await listRemoteFiles(client, root, execution.signal, false)
    for (const remoteFile of committedFiles) {
      const entry = nextState.files[remoteFile.path]
      if (!entry?.deleted && entry.size === remoteFile.size) {
        if (remoteFile.etag) entry.remoteEtag = remoteFile.etag
        else delete entry.remoteEtag
      }
    }
    await publishRemoteSyncState(client, path.posix.join(root, MANIFEST_FILE), serializeSyncState(nextState), execution.signal)
  } catch (error) {
    await restoreStagedDeletes(client, stagedDeletes)
    throw error
  }
  for (const item of stagedDeletes) await client.deleteFile(item.staged).catch(() => { /* committed state ignores orphaned quarantine files */ })
  await writeLocalSyncState(workspace.path, nextState)
  await writeTargetBaseState(workspace.path, target.id, nextState)
  const parts: string[] = []
  if (uploaded) parts.push(`已上传 ${uploaded} 个文件`)
  if (downloadedPaths.length) parts.push(`已下载 ${downloadedPaths.length} 个文件到本机`)
  if (remoteDeletes.length > 0) parts.push(`并从 WebDAV 删除 ${remoteDeletes.length} 个文件`)
  if (parts.length === 0) return 'WebDAV 备份已是最新'
  return parts.join('，')
}
