import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { simpleGit } from 'simple-git'
import { formatBytes, scanFiles } from '../files.js'
import type { FileIssue, GitTargetConfig, SyncDecision, SyncPlan, SyncTarget, WorkspaceProfile } from '../types.js'

function remoteName(targetId: string): string {
  return `tc-${targetId.slice(0, 8)}`
}

async function hasHead(folder: string): Promise<boolean> {
  try {
    await simpleGit(folder).revparse(['--verify', 'HEAD'])
    return true
  } catch {
    return false
  }
}

async function remoteHead(config: GitTargetConfig): Promise<string | undefined> {
  const output = await simpleGit().listRemote(['--heads', config.remoteUrl, config.branch])
  return output.trim().split(/\s+/)[0] || undefined
}

async function countAheadBehind(folder: string, remoteSha: string): Promise<[number, number]> {
  const git = simpleGit(folder)
  const output = await git.raw(['rev-list', '--left-right', '--count', `HEAD...${remoteSha}`])
  const [ahead, behind] = output.trim().split(/\s+/).map(Number)
  return [ahead || 0, behind || 0]
}

export async function planGitSync(workspace: WorkspaceProfile, target: SyncTarget): Promise<SyncPlan> {
  const config = target.config as GitTargetConfig
  const files = await scanFiles(workspace.path)
  const limit = target.maxFileSizeMb * 1024 * 1024
  const issues: FileIssue[] = files
    .filter((file) => file.size > limit)
    .map((file) => ({ path: file.relativePath, size: file.size, limit, kind: 'too-large' }))
  const git = simpleGit(workspace.path)
  const isRepo = await git.checkIsRepo()
  const remoteSha = await remoteHead(config)

  if (issues.length > 0) {
    return {
      id: crypto.randomUUID(), workspaceId: workspace.id, targetId: target.id,
      targetName: target.name, provider: 'git', direction: 'blocked',
      summary: `${issues.length} 个文件超过 ${target.maxFileSizeMb} MB 限制`,
      actions: ['移除大文件，或为该目标提高限制后重试'], issues,
      requiresConfirmation: true, createdAt: new Date().toISOString(), metadata: {},
    }
  }

  if (!isRepo || !(await hasHead(workspace.path))) {
    const localOnly = files.map((file) => ({ path: file.relativePath, kind: 'local-only' as const }))
    return {
      id: crypto.randomUUID(), workspaceId: workspace.id, targetId: target.id,
      targetName: target.name, provider: 'git', direction: remoteSha ? 'bidirectional' : 'upload',
      summary: remoteSha ? '本地尚未建立版本历史，远端已有内容' : `准备首次上传 ${files.length} 个文件`,
      actions: remoteSha ? ['先保全本地文件', '获取远端历史', '合并后上传'] : ['初始化 Git', '创建首个版本', '上传到远端'],
      issues: remoteSha ? localOnly : [], requiresConfirmation: Boolean(remoteSha),
      createdAt: new Date().toISOString(), metadata: { remoteExists: Boolean(remoteSha), newRepository: true },
    }
  }

  const status = await git.status()
  const localOnly = status.not_added.map((file) => ({ path: file, kind: 'local-only' as const }))
  let ahead = 0
  let behind = 0
  let diverged = false
  if (remoteSha) {
    await git.fetch(config.remoteUrl, config.branch)
    const fetchedSha = (await git.revparse(['FETCH_HEAD'])).trim()
    ;[ahead, behind] = await countAheadBehind(workspace.path, fetchedSha)
    if (ahead > 0 && behind > 0) diverged = true
  }
  const dirty = !status.isClean()
  const direction = diverged ? 'blocked' : behind > 0 && (ahead > 0 || dirty) ? 'bidirectional' : behind > 0 ? 'download' : ahead > 0 || dirty ? 'upload' : 'none'
  const actions: string[] = []
  if (behind > 0) actions.push(`下载 ${behind} 个远端版本`)
  if (dirty) actions.push('保存本地改动为新版本')
  if (ahead > 0 || dirty) actions.push('上传本地版本')
  if (direction === 'none') actions.push('无需传输')

  return {
    id: crypto.randomUUID(), workspaceId: workspace.id, targetId: target.id,
    targetName: target.name, provider: 'git', direction,
    summary: diverged ? '本地与远端历史已经分叉，需要人工检查' : direction === 'none' ? '已是最新版本' : `本地领先 ${ahead}，远端领先 ${behind}`,
    actions, issues: diverged ? [{ path: config.branch, kind: 'conflict' }, ...localOnly] : localOnly,
    requiresConfirmation: diverged || (behind > 0 && localOnly.length > 0),
    createdAt: new Date().toISOString(), metadata: { ahead, behind, dirty, diverged, remoteExists: Boolean(remoteSha) },
  }
}

async function configureIdentity(folder: string): Promise<void> {
  const git = simpleGit(folder)
  try { await git.raw(['config', 'user.name']) } catch { await git.addConfig('user.name', 'Tianchuang Cloud', false, 'local') }
  try { await git.raw(['config', 'user.email']) } catch { await git.addConfig('user.email', 'sync@tianchuang.local', false, 'local') }
}

async function ensureRemote(folder: string, target: SyncTarget): Promise<string> {
  const git = simpleGit(folder)
  const name = remoteName(target.id)
  const url = (target.config as GitTargetConfig).remoteUrl
  const remotes = await git.getRemotes(true)
  const existing = remotes.find((remote) => remote.name === name)
  if (!existing) await git.addRemote(name, url)
  else if (existing.refs.fetch !== url) await git.remote(['set-url', name, url])
  return name
}

async function recoveryCopy(workspace: WorkspaceProfile, changedFiles: string[]): Promise<string> {
  const recoveryRoot = path.join(app.getPath('userData'), 'recovery', workspace.id, Date.now().toString())
  for (const relativePath of changedFiles) {
    const source = path.join(workspace.path, relativePath)
    const destination = path.join(recoveryRoot, relativePath)
    await mkdir(path.dirname(destination), { recursive: true })
    try { await cp(source, destination, { recursive: true }) } catch { /* deleted files have no source */ }
  }
  return recoveryRoot
}

export async function runGitSync(
  workspace: WorkspaceProfile,
  target: SyncTarget,
  plan: SyncPlan,
  decision: SyncDecision,
): Promise<string> {
  if (plan.metadata.diverged) throw new Error('分支已经分叉，请先在 Git 工具中解决冲突')
  const config = target.config as GitTargetConfig
  const git = simpleGit(workspace.path)
  if (!(await git.checkIsRepo())) await git.init()
  await configureIdentity(workspace.path)
  const remote = await ensureRemote(workspace.path, target)
  const remoteSha = await remoteHead(config)

  if (remoteSha && !(await hasHead(workspace.path))) {
    throw new Error('远端已有历史，而本地文件夹尚未建立版本。请先克隆远端，再把本地文件拖入资料库。')
  }

  if (remoteSha) {
    await git.fetch(remote, config.branch)
    const status = await git.status()
    const changedFiles = [...new Set([...status.files.map((file) => file.path), ...status.not_added])]
    if (changedFiles.length > 0) await recoveryCopy(workspace, changedFiles)
    if (Number(plan.metadata.behind || 0) > 0) {
      if (changedFiles.length > 0 && decision.preserveLocalOnly) {
        await git.stash(['push', '--include-untracked', '--message', `Tianchuang Cloud ${new Date().toISOString()}`])
        await git.pull(remote, config.branch, { '--rebase': 'true' })
        try { await git.stash(['pop']) } catch { throw new Error('远端更新完成，但恢复本地文件时发生冲突；恢复副本已保存在应用数据目录。') }
      } else if (changedFiles.length > 0) {
        await git.reset(['--hard'])
        await git.clean('f', ['-d'])
        await git.pull(remote, config.branch, { '--ff-only': 'true' })
      } else {
        await git.pull(remote, config.branch, { '--ff-only': 'true' })
      }
    }
  }

  const status = await git.status()
  if (!status.isClean()) {
    await git.add(['-A'])
    await git.commit(`同步资料 ${new Date().toLocaleString('zh-CN', { hour12: false })}`)
  } else if (!(await hasHead(workspace.path))) {
    await git.add(['-A'])
    await git.commit('初始化天创云端资料库')
  }

  const finalStatus = await git.status()
  const shouldPush = !remoteSha || finalStatus.ahead > 0 || plan.direction === 'upload' || plan.direction === 'bidirectional'
  if (shouldPush) await git.push(remote, config.branch, ['--set-upstream'])
  return shouldPush ? '同步并上传完成' : '已经是最新版本，没有重复上传'
}

export function describeGitLimit(issue: FileIssue): string {
  return issue.size && issue.limit ? `${issue.path}（${formatBytes(issue.size)}，限制 ${formatBytes(issue.limit)}）` : issue.path
}
