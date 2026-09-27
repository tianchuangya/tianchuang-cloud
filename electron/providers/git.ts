import { cp, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { app } from 'electron'
import { simpleGit } from 'simple-git'
import { formatBytes, scanFiles } from '../files.js'
import type { FileIssue, GitTargetConfig, SyncDecision, SyncPlan, SyncTarget, WorkspaceProfile } from '../types.js'
import { largeFileActions, largeFileIssues, largeFileSummary } from './diff-model.js'

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
  const limitMb = target.maxFileSizeMb
  const tooLarge = largeFileIssues(files, limitMb)
  const git = simpleGit(workspace.path)
  const isRepo = await git.checkIsRepo()
  const remoteSha = await remoteHead(config)

  if (tooLarge.length > 0) {
    return {
      id: crypto.randomUUID(), workspaceId: workspace.id, targetId: target.id,
      targetName: target.name, provider: 'git', direction: 'blocked',
      summary: largeFileSummary(tooLarge, limitMb),
      actions: largeFileActions('git', tooLarge), issues: tooLarge,
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
  const remoteDeletes = status.deleted.map((file) => ({ path: file, kind: 'remote-delete' as const }))
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
  const direction = !remoteSha ? 'upload' : diverged ? 'blocked' : behind > 0 && (ahead > 0 || dirty) ? 'bidirectional' : behind > 0 ? 'download' : ahead > 0 || dirty ? 'upload' : 'none'
  const actions: string[] = []
  if (behind > 0) actions.push(`下载 ${behind} 个远端版本`)
  if (dirty) actions.push('保存本地改动为新版本')
  if (remoteDeletes.length > 0) actions.push(`从远端版本删除 ${remoteDeletes.length} 个文件`)
  if (!remoteSha || ahead > 0 || dirty) actions.push('上传本地版本')
  if (direction === 'none') actions.push('无需传输')

  return {
    id: crypto.randomUUID(), workspaceId: workspace.id, targetId: target.id,
    targetName: target.name, provider: 'git', direction,
    summary: !remoteSha ? '远端分支为空，准备上传本地版本' : diverged ? '本地与远端历史已经分叉，需要人工检查' : direction === 'none' ? '已是最新版本' : `本地领先 ${ahead}，远端领先 ${behind}`,
    actions, issues: diverged ? [{ path: config.branch, kind: 'conflict' }, ...localOnly, ...remoteDeletes] : [...localOnly, ...remoteDeletes],
    requiresConfirmation: diverged || remoteDeletes.length > 0 || (behind > 0 && localOnly.length > 0),
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
  if (plan.issues.some((issue) => issue.kind === 'remote-delete') && !decision.deleteRemote) {
    throw new Error('检测到云端删除操作，需要重新检查并明确确认')
  }
  const config = target.config as GitTargetConfig
  const git = simpleGit(workspace.path)
  // 新设备场景：本地还不是仓库而远端有历史时，直接把远端克隆进目标文件夹
  if (!(await git.checkIsRepo()) && await remoteHead(config)) {
    try {
      await simpleGit().clone(config.remoteUrl, workspace.path, ['--branch', config.branch])
    } catch {
      throw new Error('远端已有历史，但本地文件夹不是空目录或克隆失败。请先手动克隆远端到该文件夹，再把本地文件拖入资料库。')
    }
  }
  if (!(await git.checkIsRepo())) await git.raw(['init', '--initial-branch', config.branch])
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

  if (!remoteSha) {
    const currentBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()
    if (currentBranch !== config.branch) await git.raw(['branch', '-M', config.branch])
  }

  const finalStatus = await git.status()
  const shouldPush = !remoteSha || finalStatus.ahead > 0 || plan.direction === 'upload' || plan.direction === 'bidirectional'
  if (shouldPush) await git.push(remote, config.branch, ['--set-upstream'])
  return shouldPush ? '同步并上传完成' : '已经是最新版本，没有重复上传'
}

export function describeGitLimit(issue: FileIssue): string {
  return issue.size && issue.limit ? `${issue.path}（${formatBytes(issue.size)}，限制 ${formatBytes(issue.limit)}）` : issue.path
}

// 通过系统 Git Credential Manager 读取已保存的 GitHub 凭据（只在内存中使用）。
// 禁用终端交互，凭据缺失时快速失败，避免删除流程里弹出登录窗口。
async function githubTokenFromCredentialHelper(): Promise<string | undefined> {
  const child = spawn('git', ['credential', 'fill'], {
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    signal: AbortSignal.timeout(12_000),
  })
  child.stdin?.write('protocol=https\nhost=github.com\n\n')
  child.stdin?.end()
  const output = await new Promise<string>((resolve, reject) => {
    let data = ''
    child.stdout?.on('data', (chunk) => { data += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(data) : reject(new Error('credential helper 未返回')))
  })
  return output.split('\n').find((line) => line.startsWith('password='))?.slice('password='.length) || undefined
}

// 删除 GitHub 远端仓库。删除通过用户明示确认后进行；凭据没有 delete_repo 权限或
// 平台不是 GitHub 时，明确告知需要网页端手动删除，不做静默失败。
export async function deleteGitRepository(workspace: WorkspaceProfile, target: SyncTarget): Promise<string> {
  const config = target.config as GitTargetConfig
  void workspace
  const match = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i.exec(config.remoteUrl)
    ?? /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(config.remoteUrl)
  if (!match) {
    return `仓库托管在 ${config.provider === 'gitee' ? 'Gitee' : '第三方 Git 服务'}，天创云端不会自动删除；请到对应平台网页端手动删除`
  }
  const [, owner, repository] = match
  const token = await githubTokenFromCredentialHelper()
  if (!token) throw new Error('未找到可用的 GitHub 凭据；请先对该目标完成一次同步，或到 GitHub 网页端删除仓库')
  const response = await fetch(`https://api.github.com/repos/${owner}/${repository}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Tianchuang-Cloud',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 204) return `已删除 GitHub 仓库 ${owner}/${repository}`
  if (response.status === 403) throw new Error('当前凭据没有删除仓库的权限（缺少 delete_repo 授权），请在 GitHub 网页端删除该仓库')
  if (response.status === 404) throw new Error(`GitHub 返回 404：仓库 ${owner}/${repository} 不存在，或凭据无权删除`)
  throw new Error(`GitHub 删除失败（HTTP ${response.status}），请到网页端确认仓库状态`)
}
