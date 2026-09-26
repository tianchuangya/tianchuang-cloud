import type { FileIssue, ProviderKind } from '../types.js'

export interface LargeFileCandidate {
  relativePath: string
  size: number
}

export function largeFileIssues(files: LargeFileCandidate[], limitMb: number): FileIssue[] {
  const limit = Math.max(1, limitMb) * 1024 * 1024
  return files
    .filter((file) => file.size > limit)
    .map((file) => ({ path: file.relativePath, size: file.size, limit, kind: 'too-large' as const }))
}

export function largeFileSummary(issues: FileIssue[], limitMb: number): string {
  return `${issues.length} 个文件超过 ${limitMb} MB 限制`
}

// 统一的大文件预检结论：除列出文件本身，还要说明限制原因和更换目标的建议，
// 让用户能直接决定是提高限制、清理文件还是更换备份目标类型。
export function largeFileActions(provider: ProviderKind, issues: FileIssue[]): string[] {
  const actions = [`移除或压缩 ${issues.length} 个超大文件后重试`, '在目标设置中提高“单文件大小限制”']
  if (provider === 'git') actions.push('GitHub / Gitee 对单文件有硬性上限；可改用 Git LFS，或换用 WebDAV、磁盘目标')
  else if (provider === 'webdav') actions.push('WebDAV 服务可能另有配额或超时限制；可换用本地磁盘、移动硬盘目标')
  else actions.push('磁盘镜像没有服务端硬性上限；确认磁盘剩余空间充足后可以提高限制')
  return actions
}

export interface RemoteFileEntry {
  path: string
  size: number
  lastmodMs?: number
}

export interface RemoteFileDiff {
  uploads: string[]
  conflicts: FileIssue[]
  remoteOnly: FileIssue[]
}

// WebDAV 远端与本地清单的差异计算：
// - 大小相同视为未变化（远端哈希比较仍在路线图中）
// - 大小不同且远端修改时间较新视为两端冲突，不允许静默覆盖
// - 远端缺失或远端较旧视为待上传
// - lastmod 只有秒级精度，比较时保留 2 秒容差
export function diffRemoteFiles(
  localFiles: Array<{ relativePath: string; size: number; modifiedAt: number }>,
  remoteFiles: RemoteFileEntry[],
  managedPaths: string[],
): RemoteFileDiff {
  const remoteByPath = new Map(remoteFiles.map((file) => [file.path, file]))
  const managedSet = new Set(managedPaths)
  const uploads: string[] = []
  const conflicts: FileIssue[] = []
  for (const local of localFiles) {
    const remote = remoteByPath.get(local.relativePath)
    if (!remote) {
      uploads.push(local.relativePath)
      continue
    }
    if (remote.size === local.size) continue
    const remoteNewer = remote.lastmodMs !== undefined && remote.lastmodMs - local.modifiedAt > 2000
    if (remoteNewer) conflicts.push({ path: local.relativePath, size: local.size, kind: 'conflict' })
    else uploads.push(local.relativePath)
  }
  const localPaths = new Set(localFiles.map((file) => file.relativePath))
  const remoteOnly = remoteOnlyIssues(remoteFiles.map((file) => file.path), localPaths, managedSet)
  return { uploads, conflicts, remoteOnly }
}

export function remoteOnlyIssues(remotePaths: string[], localPaths: Set<string>, managedPaths: Set<string>): FileIssue[] {
  return remotePaths
    .filter((filePath) => !localPaths.has(filePath) && !managedPaths.has(filePath))
    .sort((left, right) => left.localeCompare(right))
    .map((filePath) => ({ path: filePath, kind: 'remote-only' as const }))
}
