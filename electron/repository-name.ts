import { pinyin } from 'pinyin-pro'
import type { SyncTarget, WorkspaceProfile } from './types.js'

const REPOSITORY_NAME_LIMIT = 100

function stableSuffix(value: string): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0').slice(0, 12)
}

/**
 * Produces an ASCII-only, readable and collision-resistant remote repository key.
 * The original display name remains local and is also persisted in state.tc.
 */
export function repositoryNameForDisplayName(displayName: string, stableKey = displayName): string {
  const normalized = displayName.normalize('NFKC').trim()
  const transliterated = pinyin(normalized, { toneType: 'none', type: 'array' }).join('-')
  const readable = transliterated
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/[-_.]{2,}/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '') || 'tianchuang-data'
  const suffix = stableSuffix(`${normalized}\0${stableKey}`)
  return `${readable.slice(0, REPOSITORY_NAME_LIMIT - suffix.length - 1).replace(/[-_.]+$/g, '')}-${suffix}`
}

function targetRemoteKey(target: SyncTarget): string | undefined {
  if (target.config.kind === 'git' && !target.config.warehouse) {
    const match = target.config.remoteUrl.trim().replace(/\.git$/i, '').match(/(?:[:/])([^/:]+)$/)
    return match?.[1]
  }
  if (target.config.kind === 'local') return target.config.remoteDirectory
  if (target.config.kind === 'webdav') return target.config.remotePath.split('/').filter(Boolean).at(-1)
  return undefined
}

function isManagedRemoteKey(value: string | undefined): value is string {
  return Boolean(value && /^[a-z0-9](?:[a-z0-9._-]{0,86}[a-z0-9])?-[0-9a-f]{12}$/.test(value) && value.length <= REPOSITORY_NAME_LIMIT)
}

/**
 * Keeps the first generated remote key stable across display-name changes and
 * upgrades. Legacy profiles can recover it from an existing generated target.
 */
export function remoteKeyForWorkspace(workspace: Pick<WorkspaceProfile, 'id' | 'name' | 'remoteKey' | 'targets'>): string {
  if (isManagedRemoteKey(workspace.remoteKey)) return workspace.remoteKey
  const existing = workspace.targets.map(targetRemoteKey).find(isManagedRemoteKey)
  return existing ?? repositoryNameForDisplayName(workspace.name, workspace.id)
}

export function validateAsciiRepositoryName(name: string): string {
  const normalized = name.trim()
  if (!normalized) throw new Error('请输入仓库名称')
  if (normalized.length > REPOSITORY_NAME_LIMIT) throw new Error('仓库名称不能超过 100 个字符')
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) throw new Error('GitHub 仓库名称只能包含 ASCII 字母、数字、点、短横线和下划线')
  if (normalized === '.' || normalized === '..') throw new Error('仓库名称无效')
  return normalized
}
