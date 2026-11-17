import { stat } from 'node:fs/promises'
import { CLOUD_CONFIG_PATH, CLOUD_DEVICE_DIRECTORY, LEGACY_CLOUD_CONFIG_PATH, LEGACY_CLOUD_CONFIG_REPOSITORY, createCloudConfig, parseCloudConfig, restoreCloudWorkspaces } from './cloud-config.js'
import { githubRequest, primaryCredential } from './github.js'
import { isMissingGitHubResourceError } from './github-error.js'
import { getSnapshot, getWarehouseSettings, saveWorkspace, updateWarehouseSettings } from './store.js'
import type { CloudConfigDocument, CloudConfigStatus, CloudRestoreSelection, DeviceProfile } from './types.js'

interface GitHubRepositoryInfo {
  html_url: string
  private: boolean
  name?: string
  description?: string | null
  topics?: string[]
}

interface GitHubContent {
  content: string
  encoding: string
  sha: string
}

interface GitHubDirectoryEntry {
  name: string
  path: string
  type: string
}

async function optionalRequest<T>(path: string, token: string): Promise<T | undefined> {
  try {
    return await githubRequest<T>(path, token)
  } catch (error) {
    // GitHub uses a distinct 404 message for content requests against a newly
    // created repository. It is still an absent optional resource, not a
    // publishing failure; the first PUT below will initialize the branch.
    if (isMissingGitHubResourceError(error)) return undefined
    throw error
  }
}

async function repositoryState(username: string, token: string, repositoryName: string, configPath = CLOUD_CONFIG_PATH): Promise<{ repository?: GitHubRepositoryInfo; content?: GitHubContent }> {
  const repository = await optionalRequest<GitHubRepositoryInfo>(`/repos/${encodeURIComponent(username)}/${encodeURIComponent(repositoryName)}`, token)
  if (!repository) return {}
  const content = await optionalRequest<GitHubContent>(`/repos/${encodeURIComponent(username)}/${encodeURIComponent(repositoryName)}/contents/${configPath}`, token)
  return { repository, content }
}

async function discoverWarehouseRepository(token: string): Promise<GitHubRepositoryInfo | undefined> {
  for (let page = 1; page <= 5; page++) {
    const repositories = await githubRequest<GitHubRepositoryInfo[]>(`/user/repos?affiliation=owner&sort=updated&per_page=100&page=${page}`, token)
    const match = repositories.find((repository) => repository.topics?.includes('tianchuang-cloud-warehouse')
      || repository.description?.startsWith('天创云端 Warehouse：'))
    if (match) return match
    if (repositories.length < 100) break
  }
  return undefined
}

async function registeredDevices(username: string, token: string, repositoryName: string): Promise<DeviceProfile[]> {
  const base = `/repos/${encodeURIComponent(username)}/${encodeURIComponent(repositoryName)}/contents`
  const entries = await optionalRequest<GitHubDirectoryEntry[]>(`${base}/${CLOUD_DEVICE_DIRECTORY}`, token)
  if (!entries) return []
  const devices = await Promise.all(entries.filter((entry) => entry.type === 'file' && entry.name.endsWith('.json')).map(async (entry) => {
    const content = await optionalRequest<GitHubContent>(`${base}/${entry.path}`, token)
    if (!content || content.encoding !== 'base64') return undefined
    try {
      const parsed = JSON.parse(Buffer.from(content.content.replace(/\s/g, ''), 'base64').toString('utf8')) as DeviceProfile
      if (parsed.schemaVersion !== 1 || !/^[0-9a-f]{32}$/.test(parsed.deviceId) || !parsed.deviceName) return undefined
      return parsed
    } catch { return undefined }
  }))
  return devices.filter((device): device is DeviceProfile => Boolean(device))
}

async function putDeviceDocument(username: string, token: string, repositoryName: string, device: DeviceProfile): Promise<void> {
  const base = `/repos/${encodeURIComponent(username)}/${encodeURIComponent(repositoryName)}/contents`
  const devicePath = `${CLOUD_DEVICE_DIRECTORY}/${device.deviceId}.json`
  const existingDevice = await optionalRequest<GitHubContent>(`${base}/${devicePath}`, token)
  await githubRequest(`${base}/${devicePath}`, token, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Update device ${device.deviceName}`,
      content: Buffer.from(JSON.stringify(device, null, 2), 'utf8').toString('base64'),
      ...(existingDevice ? { sha: existingDevice.sha } : {}),
    }),
  })
}

export async function publishDeviceStatus(): Promise<void> {
  const auth = await primaryCredential()
  const settings = getWarehouseSettings()
  const state = await repositoryState(auth.username, auth.token, settings.warehouseName)
  if (!state.repository) return
  await putDeviceDocument(auth.username, auth.token, settings.warehouseName, settings.device)
}

function decodeDocument(content: GitHubContent): CloudConfigDocument {
  if (content.encoding !== 'base64') throw new Error('GitHub 返回了不受支持的配置编码')
  const json = Buffer.from(content.content.replace(/\s/g, ''), 'base64').toString('utf8')
  return parseCloudConfig(JSON.parse(json) as unknown)
}

export async function cloudConfigStatus(): Promise<CloudConfigStatus> {
  try {
    const auth = await primaryCredential()
    const settings = getWarehouseSettings()
    let repositoryName = settings.warehouseName
    let state = await repositoryState(auth.username, auth.token, repositoryName)
    if (!state.repository) {
      const discovered = await discoverWarehouseRepository(auth.token)
      if (discovered?.name) {
        repositoryName = discovered.name
        state = await repositoryState(auth.username, auth.token, repositoryName)
        updateWarehouseSettings({ warehouseName: repositoryName })
      }
    }
    if (!state.repository) {
      const legacy = await repositoryState(auth.username, auth.token, LEGACY_CLOUD_CONFIG_REPOSITORY, LEGACY_CLOUD_CONFIG_PATH)
      if (legacy.repository) {
        state = legacy
        repositoryName = LEGACY_CLOUD_CONFIG_REPOSITORY
      }
    }
    const config = state.content ? decodeDocument(state.content) : undefined
    const devices = state.repository ? await registeredDevices(auth.username, auth.token, repositoryName) : []
    const currentDevice = devices.find((device) => device.deviceId === settings.device.deviceId)
    if (currentDevice && currentDevice.deviceName !== settings.device.deviceName) updateWarehouseSettings({ warehouseName: repositoryName, deviceName: currentDevice.deviceName })
    return {
      authenticated: true,
      username: auth.username,
      repositoryExists: Boolean(state.repository),
      repositoryUrl: state.repository?.html_url,
      hasRemoteConfig: Boolean(config),
      updatedAt: config?.updatedAt,
      workspaceCount: config?.workspaces.length ?? 0,
      config,
      repositoryName,
      devices,
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
  const settings = updateWarehouseSettings({})
  const repositoryName = settings.warehouseName
  let state = await repositoryState(auth.username, auth.token, repositoryName)
  if (!state.repository) {
    await githubRequest('/user/repos', auth.token, {
      method: 'POST',
      body: JSON.stringify({
        name: repositoryName,
        description: '天创云端 Warehouse：资料库索引与跨设备配置（不包含密码或访问令牌）',
        private: true,
        auto_init: false,
      }),
    })
    state = await repositoryState(auth.username, auth.token, repositoryName)
  }
  await githubRequest(`/repos/${encodeURIComponent(auth.username)}/${encodeURIComponent(repositoryName)}/topics`, auth.token, {
    method: 'PUT',
    body: JSON.stringify({ names: ['tianchuang-cloud-warehouse'] }),
  }).catch(() => { /* 旧版 GitHub Enterprise 或权限不足时仍可依赖仓库描述发现 */ })
  if (state.repository && !state.repository.private) throw new Error('主配置仓库必须是私有仓库，请先在 GitHub 将其改为 Private')

  const devices = await registeredDevices(auth.username, auth.token, repositoryName)
  const duplicateName = devices.find((device) => device.deviceId !== settings.device.deviceId && device.deviceName.toLocaleLowerCase() === settings.device.deviceName.toLocaleLowerCase())
  if (duplicateName) throw new Error(`设备名称“${settings.device.deviceName}”已被另一台设备使用，请先修改设备名称`)

  const base = `/repos/${encodeURIComponent(auth.username)}/${encodeURIComponent(repositoryName)}/contents`
  await putDeviceDocument(auth.username, auth.token, repositoryName, settings.device)

  const config = createCloudConfig(getSnapshot().workspaces, new Date().toISOString(), settings.device.deviceName)
  await githubRequest(`${base}/${CLOUD_CONFIG_PATH}`, auth.token, {
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
