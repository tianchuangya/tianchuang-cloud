import { spawn } from 'node:child_process'
import type { GitHubCollaborator, GitHubCollaboratorDraft, GitHubRepositoryDraft, GitHubRepositoryResult, GitHubSession } from './types.js'

interface CommandResult {
  stdout: string
  stderr: string
}

const LOGIN_CONFIRMATION_ATTEMPTS = 12
const LOGIN_CONFIRMATION_DELAY_MS = 1_000

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function runGit(args: string[], input?: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(stderr.trim() || `Git 命令执行失败（${code ?? 'unknown'}）`))
    })
    if (input) child.stdin.end(input)
    else child.stdin.end()
  })
}

function parseCredential(output: string): { username: string; token: string } {
  const values = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator > 0) values.set(line.slice(0, separator), line.slice(separator + 1))
  }
  const username = values.get('username') || ''
  const token = values.get('password') || ''
  if (!username || !token) throw new Error('未找到 GitHub 登录凭据，请重新登录')
  return { username, token }
}

async function accountNames(): Promise<string[]> {
  const result = await runGit(['credential-manager', 'github', 'list'])
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

async function credential(username?: string): Promise<{ username: string; token: string }> {
  const input = [`protocol=https`, `host=github.com`, username ? `username=${username}` : ''].filter(Boolean).join('\n') + '\n\n'
  return parseCredential((await runGit(['credential', 'fill'], input)).stdout)
}

export async function githubRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; errors?: Array<{ message?: string }> }
    const detail = body.errors?.map((item) => item.message).filter(Boolean).join('；')
    if (response.status === 422) throw new Error(detail || '仓库名称已存在或不符合 GitHub 规则')
    if (response.status === 401 || response.status === 403) throw new Error('GitHub 登录已失效，请重新登录')
    throw new Error(body.message || `GitHub 请求失败（${response.status}）`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function parseGitHubRepository(remoteUrl: string): { owner: string; repository: string } {
  const match = remoteUrl.trim().match(/^(?:https?:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i)
  if (!match) throw new Error('这不是有效的 GitHub 仓库地址')
  return { owner: match[1], repository: match[2] }
}

export async function primaryCredential(): Promise<{ username: string; token: string }> {
  const accounts = await accountNames()
  if (!accounts.length) throw new Error('请先登录 GitHub')
  return credential(accounts[0])
}

export function validateRepositoryName(name: string): string {
  const normalized = name.trim()
  if (!normalized) throw new Error('请输入仓库名称')
  if (normalized.length > 100) throw new Error('仓库名称不能超过 100 个字符')
  if (!/^[\p{L}\p{N}._-]+$/u.test(normalized)) throw new Error('仓库名称只能包含文字、数字、点、短横线和下划线')
  if (normalized === '.' || normalized === '..') throw new Error('仓库名称无效')
  return normalized
}

export async function githubSession(): Promise<GitHubSession> {
  let account: string | undefined
  try {
    const accounts = await accountNames()
    if (!accounts.length) return { available: true, authenticated: false }
    account = accounts[0]
    const auth = await credential(account)
    const user = await githubRequest<{ login: string; name?: string; avatar_url?: string }>('/user', auth.token)
    return { available: true, authenticated: true, username: user.login, displayName: user.name, avatarUrl: user.avatar_url }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const unavailable = /credential-manager|not recognized|not found|ENOENT/i.test(message)
    return { available: !unavailable, authenticated: false, username: account, message }
  }
}

export async function loginGitHub(): Promise<GitHubSession> {
  try {
    await runGit(['credential-manager', 'github', 'login', '--browser'])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/credential-manager|not recognized|not found|ENOENT/i.test(message)) {
      throw new Error('没有找到 Git Credential Manager，请安装包含凭据管理器的 Git')
    }
    throw error
  }
  let session: GitHubSession = { available: true, authenticated: false }
  for (let attempt = 0; attempt < LOGIN_CONFIRMATION_ATTEMPTS; attempt++) {
    session = await githubSession()
    if (session.authenticated) return session
    if (attempt < LOGIN_CONFIRMATION_ATTEMPTS - 1) await wait(LOGIN_CONFIRMATION_DELAY_MS)
  }
  throw new Error(session.message || 'GitHub 登录尚未写入系统凭据，请返回应用后重新检查')
}

export async function createGitHubRepository(draft: GitHubRepositoryDraft): Promise<GitHubRepositoryResult> {
  const name = validateRepositoryName(draft.name)
  const accounts = await accountNames()
  if (!accounts.length) throw new Error('请先登录 GitHub')
  const auth = await credential(accounts[0])
  const repository = await githubRequest<{
    name: string
    full_name: string
    clone_url: string
    html_url: string
    private: boolean
  }>('/user/repos', auth.token, {
    method: 'POST',
    body: JSON.stringify({
      name,
      description: draft.description?.trim() || '由天创云端管理的资料同步仓库',
      private: draft.private,
      auto_init: false,
    }),
  })
  return {
    name: repository.name,
    fullName: repository.full_name,
    cloneUrl: repository.clone_url,
    htmlUrl: repository.html_url,
    private: repository.private,
  }
}

export async function listGitHubCollaborators(remoteUrl: string): Promise<GitHubCollaborator[]> {
  const { owner, repository } = parseGitHubRepository(remoteUrl)
  const auth = await primaryCredential()
  const [members, invitations] = await Promise.all([
    githubRequest<Array<{ login: string; avatar_url?: string; role_name?: string }>>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/collaborators`, auth.token),
    githubRequest<Array<{ invitee?: { login?: string; avatar_url?: string }; permissions?: string }>>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/invitations`, auth.token),
  ])
  return [
    ...members.filter((member) => member.login !== owner).map((member) => ({ username: member.login, avatarUrl: member.avatar_url, permission: member.role_name || 'pull', pending: false })),
    ...invitations.flatMap((invitation) => invitation.invitee?.login ? [{ username: invitation.invitee.login, avatarUrl: invitation.invitee.avatar_url, permission: invitation.permissions || 'pull', pending: true }] : []),
  ]
}

export async function inviteGitHubCollaborator(draft: GitHubCollaboratorDraft): Promise<void> {
  const { owner, repository } = parseGitHubRepository(draft.remoteUrl)
  const username = draft.username.trim().replace(/^@/, '')
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) throw new Error('请输入有效的 GitHub 用户名')
  const auth = await primaryCredential()
  await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/collaborators/${encodeURIComponent(username)}`, auth.token, {
    method: 'PUT',
    body: JSON.stringify({ permission: draft.permission }),
  })
}
