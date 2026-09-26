import { stat } from 'node:fs/promises'
import { CLOUD_CONFIG_PATH, CLOUD_CONFIG_REPOSITORY, createCloudConfig, parseCloudConfig, restoreCloudWorkspaces } from './cloud-config.js'
import { githubRequest, primaryCredential } from './github.js'
import { getSnapshot, saveWorkspace } from './store.js'
import type { CloudConfigDocument, CloudConfigStatus, CloudRestoreSelection } from './types.js'

interface GitHubRepositoryInfo {
  html_url: string
  private: boolean
}

interface GitHubContent {
  content: string
  encoding: string
  sha: string
}

async function optionalRequest<T>(path: string, token: string): Promise<T | undefined> {
  try {
    return await githubRequest<T>(path, token)
  } catch (error) {
    if (error instanceof Error && error.message === 'Not Found') return undefined
    throw error
  }
}

async function repositoryState(username: string, token: string): Promise<{ repository?: GitHubRepositoryInfo; content?: GitHubContent }> {
  const repository = await optionalRequest<GitHubRepositoryInfo>(`/repos/${encodeURIComponent(username)}/${CLOUD_CONFIG_REPOSITORY}`, token)
  if (!repository) return {}
  const content = await optionalRequest<GitHubContent>(`/repos/${encodeURIComponent(username)}/${CLOUD_CONFIG_REPOSITORY}/contents/${CLOUD_CONFIG_PATH}`, token)
  return { repository, content }
}

function decodeDocument(content: GitHubContent): CloudConfigDocument {
  if (content.encoding !== 'base64') throw new Error('GitHub 返回了不受支持的配置编码')
  const json = Buffer.from(content.content.replace(/\s/g, ''), 'base64').toString('utf8')
  return parseCloudConfig(JSON.parse(json) as unknown)
}

export async function cloudConfigStatus(): Promise<CloudConfigStatus> {
  try {
    const auth = await primaryCredential()
    const state = await repositoryState(auth.username, auth.token)
    const config = state.content ? decodeDocument(state.content) : undefined
    return {
      authenticated: true,
      username: auth.username,
      repositoryExists: Boolean(state.repository),
      repositoryUrl: state.repository?.html_url,
      hasRemoteConfig: Boolean(config),
      updatedAt: config?.updatedAt,
      workspaceCount: config?.workspaces.length ?? 0,
      config,
    }
  } catch (error) {
    return {
      authenticated: false,
      repositoryExists: false,
      hasRemoteConfig: false,
      workspaceCount: 0,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function publishCloudConfig(): Promise<CloudConfigStatus> {
  const auth = await primaryCredential()
  let state = await repositoryState(auth.username, auth.token)
  if (!state.repository) {
    await githubRequest('/user/repos', auth.token, {
      method: 'POST',
      body: JSON.stringify({
        name: CLOUD_CONFIG_REPOSITORY,
        description: '天创云端的跨设备资料库配置（不包含密码或访问令牌）',
        private: true,
        auto_init: false,
      }),
    })
    state = await repositoryState(auth.username, auth.token)
  }
  if (state.repository && !state.repository.private) throw new Error('主配置仓库必须是私有仓库，请先在 GitHub 将其改为 Private')

  const config = createCloudConfig(getSnapshot().workspaces)
  await githubRequest(`/repos/${encodeURIComponent(auth.username)}/${CLOUD_CONFIG_REPOSITORY}/contents/${CLOUD_CONFIG_PATH}`, auth.token, {
    method: 'PUT',
    body: JSON.stringify({
      message: state.content ? 'Update Tianchuang Cloud device configuration' : 'Initialize Tianchuang Cloud device configuration',
      content: Buffer.from(JSON.stringify(config, null, 2), 'utf8').toString('base64'),
      ...(state.content ? { sha: state.content.sha } : {}),
    }),
  })
  return cloudConfigStatus()
}

export async function restoreCloudConfig(config: CloudConfigDocument, selections: CloudRestoreSelection[]): Promise<void> {
  for (const selection of selections) {
    const info = await stat(selection.localPath).catch(() => undefined)
    if (!info?.isDirectory()) throw new Error(`无法访问本地文件夹：${selection.localPath}`)
  }
  const current = getSnapshot().workspaces
  for (const workspace of restoreCloudWorkspaces(parseCloudConfig(config), selections, current)) saveWorkspace(workspace)
}
