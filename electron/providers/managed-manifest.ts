import { LEGACY_MANIFEST_FILE, parseLegacyPaths, SYNC_STATE_DIRECTORY, SYNC_STATE_FILE } from '../sync-state.js'

export const MANIFEST_DIRECTORY = SYNC_STATE_DIRECTORY
export const MANIFEST_FILE = SYNC_STATE_FILE
export { LEGACY_MANIFEST_FILE }

interface ManagedManifest {
  version: 1
  files: string[]
  updatedAt: string
}

// 清单中的路径必须是相对路径，且不能指向清单目录本身；远端返回的路径在
// 下载回本地前也必须经过同一个校验，避免路径穿越写出资料库。
export function isSafeManagedPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.startsWith('\\')) return false
  const segments = value.replaceAll('\\', '/').split('/')
  return !segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    && segments[0] !== MANIFEST_DIRECTORY
}

export function parseManagedManifest(value: string | Buffer | undefined): string[] {
  return parseLegacyPaths(value)
}

export function deletedManagedFiles(previous: string[], current: string[]): string[] {
  const currentPaths = new Set(current)
  return previous.filter((file) => !currentPaths.has(file)).sort((left, right) => left.localeCompare(right))
}

export function serializeManagedManifest(files: string[]): string {
  const manifest: ManagedManifest = {
    version: 1,
    files: [...new Set(files)].sort((left, right) => left.localeCompare(right)),
    updatedAt: new Date().toISOString(),
  }
  return `${JSON.stringify(manifest, null, 2)}\n`
}
