import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { hashFile, type ScannedFile } from './files.js'

export const SYNC_STATE_DIRECTORY = '.tianchuang-cloud'
export const SYNC_STATE_FILE = `${SYNC_STATE_DIRECTORY}/state.tc`
export const LEGACY_MANIFEST_FILE = `${SYNC_STATE_DIRECTORY}/manifest.json`
export const SYNC_BASE_DIRECTORY = `${SYNC_STATE_DIRECTORY}/bases`

const HEX_32 = /^[0-9a-f]{32}$/
const MAX_STATE_FILES = 250_000

export async function readOptionalSyncFile(filePath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export interface SyncStateFileEntry {
  fileId: string
  size?: number
  mtimeMs?: number
  sha256?: string
  remoteEtag?: string
  deleted: boolean
}

export interface WorkspaceSyncState {
  schemaVersion: 2
  workspaceId: string
  /** Original local display name. Remote paths/repository keys must not replace it. */
  workspaceName?: string
  revisionId: string
  parentRevisionId?: string
  generation: number
  deviceId: string
  createdAt: string
  files: Record<string, SyncStateFileEntry>
  targetHeads: Record<string, string>
}

interface LegacyManifest {
  version: 1
  files: string[]
  updatedAt?: string
}

export function createRevisionId(): string {
  return randomBytes(16).toString('hex')
}

export function isRevisionId(value: unknown): value is string {
  return typeof value === 'string' && HEX_32.test(value)
}

export function isSafeSyncPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.startsWith('\\')) return false
  const segments = value.replaceAll('\\', '/').split('/')
  return !segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    && segments[0] !== SYNC_STATE_DIRECTORY
}

function validFileEntry(value: unknown): value is SyncStateFileEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<SyncStateFileEntry>
  if (!isRevisionId(entry.fileId) || typeof entry.deleted !== 'boolean') return false
  if (entry.deleted) return true
  return Number.isFinite(entry.size) && Number(entry.size) >= 0
    && Number.isFinite(entry.mtimeMs) && Number(entry.mtimeMs) >= 0
    && typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/.test(entry.sha256)
    && (entry.remoteEtag === undefined || (typeof entry.remoteEtag === 'string' && entry.remoteEtag.length > 0 && entry.remoteEtag.length <= 512))
}

export function parseSyncState(value: string | Buffer | undefined): WorkspaceSyncState | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value.toString()) as Partial<WorkspaceSyncState>
    if (parsed.schemaVersion !== 2 || typeof parsed.workspaceId !== 'string' || !parsed.workspaceId) return undefined
    if (parsed.workspaceName !== undefined && (typeof parsed.workspaceName !== 'string' || !parsed.workspaceName.trim() || parsed.workspaceName.length > 200)) return undefined
    if (!isRevisionId(parsed.revisionId) || (parsed.parentRevisionId !== undefined && !isRevisionId(parsed.parentRevisionId))) return undefined
    if (!Number.isSafeInteger(parsed.generation) || Number(parsed.generation) < 1 || !isRevisionId(parsed.deviceId)) return undefined
    if (typeof parsed.createdAt !== 'string' || !parsed.files || typeof parsed.files !== 'object' || Array.isArray(parsed.files)) return undefined
    const entries = Object.entries(parsed.files)
    if (entries.length > MAX_STATE_FILES || entries.some(([filePath, entry]) => !isSafeSyncPath(filePath) || !validFileEntry(entry))) return undefined
    const targetHeads = parsed.targetHeads && typeof parsed.targetHeads === 'object' && !Array.isArray(parsed.targetHeads)
      ? Object.fromEntries(Object.entries(parsed.targetHeads).filter(([targetId, revision]) => Boolean(targetId) && isRevisionId(revision)))
      : {}
    return { ...parsed, files: Object.fromEntries(entries), targetHeads } as WorkspaceSyncState
  } catch {
    return undefined
  }
}

export function parseLegacyPaths(value: string | Buffer | undefined): string[] {
  if (!value) return []
  const state = parseSyncState(value)
  if (state) return Object.entries(state.files).filter(([, entry]) => !entry.deleted).map(([filePath]) => filePath).sort()
  try {
    const parsed = JSON.parse(value.toString()) as Partial<LegacyManifest>
    if (parsed.version !== 1 || !Array.isArray(parsed.files)) return []
    return parsed.files.filter(isSafeSyncPath)
  } catch {
    return []
  }
}

function activeSignature(files: Record<string, SyncStateFileEntry>): string {
  return Object.entries(files)
    .filter(([, entry]) => !entry.deleted)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, entry]) => `${filePath}\0${entry.size}\0${entry.sha256}`)
    .join('\n')
}

export async function buildWorkspaceSyncState(options: {
  workspaceId: string
  workspaceName?: string
  deviceId: string
  files: ScannedFile[]
  previous?: WorkspaceSyncState
  targetId?: string
  now?: string
}): Promise<WorkspaceSyncState> {
  const { workspaceId, deviceId, files, previous, targetId } = options
  if (!workspaceId) throw new Error('资料库 ID 不能为空')
  if (!isRevisionId(deviceId)) throw new Error('设备 ID 格式无效')
  const nextFiles: Record<string, SyncStateFileEntry> = {}
  const currentPaths = new Set(files.map((file) => file.relativePath))

  for (const file of files) {
    if (!isSafeSyncPath(file.relativePath)) continue
    const old = previous?.files[file.relativePath]
    const sha256 = await hashFile(file.absolutePath)
    nextFiles[file.relativePath] = {
      fileId: old?.fileId ?? createRevisionId(),
      size: file.size,
      mtimeMs: file.modifiedAt,
      // mtime 和大小只能做性能提示，不能证明内容相同；状态快照始终以内容哈希为准。
      sha256,
      ...(old?.sha256 === sha256 && old.remoteEtag ? { remoteEtag: old.remoteEtag } : {}),
      deleted: false,
    }
  }

  for (const [filePath, old] of Object.entries(previous?.files ?? {})) {
    if (!currentPaths.has(filePath) && !old.deleted) nextFiles[filePath] = { fileId: old.fileId, deleted: true }
    else if (!currentPaths.has(filePath) && old.deleted) nextFiles[filePath] = old
  }

  const workspaceName = options.workspaceName?.trim() || previous?.workspaceName
  const changed = !previous || activeSignature(previous.files) !== activeSignature(nextFiles)
    || Object.keys(nextFiles).some((filePath) => nextFiles[filePath].deleted !== previous?.files[filePath]?.deleted)
    || previous.workspaceName !== workspaceName
  const revisionId = changed ? createRevisionId() : previous.revisionId
  const targetHeads = { ...(previous?.targetHeads ?? {}) }
  if (targetId) targetHeads[targetId] = revisionId

  return {
    schemaVersion: 2,
    workspaceId,
    ...(workspaceName ? { workspaceName } : {}),
    revisionId,
    ...(changed && previous ? { parentRevisionId: previous.revisionId } : previous?.parentRevisionId ? { parentRevisionId: previous.parentRevisionId } : {}),
    generation: changed ? (previous?.generation ?? 0) + 1 : previous.generation,
    deviceId,
    createdAt: changed ? (options.now ?? new Date().toISOString()) : previous.createdAt,
    files: nextFiles,
    targetHeads,
  }
}

export async function readLocalSyncState(workspacePath: string): Promise<WorkspaceSyncState | undefined> {
  return parseSyncState(await readOptionalSyncFile(path.join(workspacePath, ...SYNC_STATE_FILE.split('/'))))
}

export interface AtomicWriteOperations {
  createParent(directory: string): Promise<unknown>
  writeTemporary(filePath: string, contents: string): Promise<unknown>
  replace(temporaryPath: string, destinationPath: string): Promise<unknown>
  removeTemporary(filePath: string): Promise<unknown>
}

const fileSystemAtomicWrite: AtomicWriteOperations = {
  createParent: (directory) => mkdir(directory, { recursive: true }),
  writeTemporary: (filePath, contents) => writeFile(filePath, contents, 'utf8'),
  replace: (temporaryPath, destinationPath) => rename(temporaryPath, destinationPath),
  removeTemporary: (filePath) => rm(filePath, { force: true }),
}

// 状态永远先写随机临时文件，再原子替换正式文件。写满磁盘或替换失败时，
// 正式文件保持原值，并尽力清理本次临时文件。
export async function writeTextAtomically(
  destination: string,
  contents: string,
  operations: AtomicWriteOperations = fileSystemAtomicWrite,
): Promise<void> {
  await operations.createParent(path.dirname(destination))
  const temporary = `${destination}.${createRevisionId()}.tmp`
  try {
    await operations.writeTemporary(temporary, contents)
    await operations.replace(temporary, destination)
  } catch (error) {
    await operations.removeTemporary(temporary).catch(() => { /* preserve the original failure */ })
    throw error
  }
}

export async function writeLocalSyncState(workspacePath: string, state: WorkspaceSyncState): Promise<void> {
  const destination = path.join(workspacePath, ...SYNC_STATE_FILE.split('/'))
  await writeTextAtomically(destination, serializeSyncState(state))
}

function targetBasePath(workspacePath: string, targetId: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(targetId)) throw new Error('同步目标 ID 格式无效')
  return path.join(workspacePath, ...SYNC_BASE_DIRECTORY.split('/'), `${targetId}.tc`)
}

export async function readTargetBaseState(workspacePath: string, targetId: string): Promise<WorkspaceSyncState | undefined> {
  return parseSyncState(await readOptionalSyncFile(targetBasePath(workspacePath, targetId)))
}

export async function writeTargetBaseState(workspacePath: string, targetId: string, state: WorkspaceSyncState): Promise<void> {
  const destination = targetBasePath(workspacePath, targetId)
  await writeTextAtomically(destination, serializeSyncState(state))
}

export async function removeTargetBaseState(workspacePath: string, targetId: string): Promise<void> {
  await rm(targetBasePath(workspacePath, targetId), { force: true })
}

export function serializeSyncState(state: WorkspaceSyncState): string {
  return `${JSON.stringify(state, null, 2)}\n`
}

/** Deterministic content identity used to invalidate a plan when local files change before execution. */
export function syncStateContentFingerprint(state: WorkspaceSyncState | undefined): string {
  const payload = Object.entries(state?.files ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, entry]) => `${filePath}\0${entry.deleted ? 'deleted' : `${entry.size ?? ''}\0${entry.sha256 ?? ''}`}`)
    .join('\n')
  return createHash('sha256').update(payload).digest('hex')
}

