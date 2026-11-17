import { homedir } from 'node:os'
import { lstat, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

const GENERATED_IMAGE_PREFIXES = ['.tianchuang-cover', '.tianchuang-background']

export async function removeWorkspaceMetadata(folderPath: string): Promise<void> {
  const root = path.resolve(folderPath)
  await rm(path.join(root, '.tianchuang-cloud'), { recursive: true, force: true })
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  await Promise.all(entries
    .filter((entry) => entry.isFile() && GENERATED_IMAGE_PREFIXES.includes(path.parse(entry.name).name.toLowerCase()))
    .map((entry) => rm(path.join(root, entry.name), { force: true })))
}

export function assertSafeWorkspaceDelete(folderPath: string, applicationPath: string): string {
  const target = path.resolve(folderPath)
  const root = path.parse(target).root
  const userHome = path.resolve(homedir())
  const appPath = path.resolve(applicationPath)
  if (target === root || target === userHome) throw new Error('安全保护：不能删除磁盘根目录或用户主目录')
  const relativeApp = path.relative(target, appPath)
  if (relativeApp === '' || (!relativeApp.startsWith('..') && !path.isAbsolute(relativeApp))) {
    throw new Error('安全保护：当前应用位于这个资料库中，不能在运行时删除它')
  }
  return target
}

export async function deleteWorkspaceFolder(folderPath: string, applicationPath: string): Promise<void> {
  const target = assertSafeWorkspaceDelete(folderPath, applicationPath)
  const info = await lstat(target).catch(() => undefined)
  if (!info) return
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('安全保护：资料库路径不是普通文件夹')
  await rm(target, { recursive: true, force: false, maxRetries: 2, retryDelay: 120 })
}
