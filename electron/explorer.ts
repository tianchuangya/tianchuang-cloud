import { opendir, stat } from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'
import { previewKindOf } from './preview-kind.js'
import type { WorkspaceProfile, WorkspaceFileEntry } from './types.js'

export type { WorkspaceFileEntry }

// 资料库内文件浏览：所有路径操作都必须先通过 resolveWorkspacePath 校验——
// 相对路径禁止 ..、绝对路径与盘符，解析结果必须仍位于资料库目录内。
export function resolveWorkspacePath(workspace: WorkspaceProfile, relativePath: string): string {
  const root = path.resolve(workspace.path)
  const normalized = relativePath.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) throw new Error('不允许访问资料库之外的路径')
  const target = path.resolve(root, normalized)
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('不允许访问资料库之外的路径')
  return target
}

const IGNORED_NAMES = new Set(['.git', '.tianchuang-cloud', 'node_modules', 'Desktop.ini', 'Thumbs.db'])

export async function listWorkspaceFiles(workspace: WorkspaceProfile, relativeDir: string): Promise<WorkspaceFileEntry[]> {
  const absoluteDir = resolveWorkspacePath(workspace, relativeDir)
  const handle = await opendir(absoluteDir).catch(() => {
    throw new Error('文件夹无法读取，可能已被移动或删除')
  })
  const entries: WorkspaceFileEntry[] = []
  for await (const entry of handle) {
    if (IGNORED_NAMES.has(entry.name)) continue
    const entryPath = relativeDir ? `${relativeDir.replaceAll('\\', '/').replace(/\/+$/, '')}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) continue
    const info = await stat(path.join(absoluteDir, entry.name)).catch(() => undefined)
    if (!info) continue
    entries.push({
      name: entry.name,
      path: entryPath,
      kind: entry.isDirectory() ? 'dir' : 'file',
      size: info.isFile() ? info.size : 0,
      modifiedAt: info.mtimeMs,
    })
  }
  return entries.sort((left, right) => left.kind !== right.kind
    ? (left.kind === 'dir' ? -1 : 1)
    : left.name.localeCompare(right.name, 'zh-Hans-CN'))
}

export async function openWorkspaceFileInSystem(workspace: WorkspaceProfile, relativePath: string): Promise<string> {
  const absolutePath = resolveWorkspacePath(workspace, relativePath)
  const result = await shell.openPath(absolutePath)
  return result || ''
}

export function revealWorkspaceFileInFolder(workspace: WorkspaceProfile, relativePath: string): void {
  shell.showItemInFolder(resolveWorkspacePath(workspace, relativePath))
}

// tianchuang-file:// 协议的处理器入参：校验文件位于某个资料库内后返回本地文件 URL，
// 由 Electron 的协议流实现支持 Range 请求（音视频拖动进度）。
export { previewKindOf }

export function resolveFileProtocolTarget(workspaceRoots: string[], rawUrlPath: string): string {
  // 协议 URL 的 pathname 必然以 / 开头（根相对），先剥离再做穿越校验
  const relative = decodeURIComponent(rawUrlPath).replaceAll('\\', '/').replace(/^\/+/, '')
  if (/^[a-zA-Z]:/.test(relative)) throw new Error('拒绝访问')
  if (relative.split('/').some((segment) => segment === '..')) throw new Error('拒绝访问')
  for (const root of workspaceRoots) {
    const resolvedRoot = path.resolve(root)
    const candidate = path.resolve(resolvedRoot, relative)
    if (candidate === resolvedRoot || candidate.startsWith(resolvedRoot + path.sep)) return candidate
  }
  throw new Error('拒绝访问')
}
