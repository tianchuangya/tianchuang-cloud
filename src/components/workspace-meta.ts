import type { ProviderKind } from '../../electron/types'

export function relativeTime(value?: string): string {
  if (!value) return '尚未同步'
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  return `${Math.floor(seconds / 86400)} 天前`
}

export function providerLabel(kind: ProviderKind, locationType?: 'local' | 'removable' | 'network'): string {
  if (kind === 'git') return 'Git 仓库'
  if (kind === 'webdav') return 'WebDAV'
  if (locationType === 'removable') return '移动硬盘'
  if (locationType === 'network') return '网络磁盘 / NAS'
  return '本机文件夹'
}

export function repositoryNameFor(value: string): string {
  return value.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'tianchuang-data'
}
