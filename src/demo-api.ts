import type { AppSnapshot, CloudConfigDocument, MigrationPlan, NearbyState, StorageConnectionSummary, SyncPlan, SyncProgress, TargetDraft, ToolboxState, WorkspaceFileEntry } from '../electron/types'

const now = new Date().toISOString()
let demoSnapshot: AppSnapshot = {
  workspaces: [{
    id: 'demo-workspace',
    name: '大学学习计划',
    path: 'C:\\Users\\Tianchuang\\Documents\\大学学习计划',
    autoSync: true,
    syncOnFocus: true,
    state: 'idle',
    lastSyncAt: now,
    targets: [
      { id: 'github', name: 'GitHub 主备份', enabled: true, maxFileSizeMb: 100, lastSyncAt: now, config: { kind: 'git', remoteUrl: 'https://github.com/tianchuangya/StudyNotes.git', branch: 'main', provider: 'github' } },
      { id: 'webdav', name: '私人云盘', enabled: true, maxFileSizeMb: 2048, config: { kind: 'webdav', endpoint: 'https://cloud.example.com', username: 'tianchuang', remotePath: '/StudyNotes' } },
      { id: 'disk', name: '移动硬盘镜像', enabled: true, maxFileSizeMb: 4096, lastSyncAt: now, config: { kind: 'local', destinationPath: 'D:\\Backup', locationType: 'removable' } },
    ],
  }],
  activity: [
    { id: 'activity-1', workspaceId: 'demo-workspace', level: 'success', title: 'GitHub 主备份同步完成', detail: '已经是最新版本，没有重复上传', createdAt: now },
  ],
}

const demoCloudConfig: CloudConfigDocument = {
  schemaVersion: 1,
  updatedAt: now,
  deviceName: 'Tianchuang Laptop',
  workspaces: [{
    id: 'remote-workspace',
    name: '课程笔记',
    folderName: '课程笔记',
    pathHint: 'D:\\Documents\\课程笔记',
    autoSync: true,
    syncOnChange: true,
    syncOnFocus: true,
    autoSyncDelaySeconds: 8,
    errorNotifyCooldownMinutes: 15,
    targets: [{ id: 'remote-git', name: 'GitHub', enabled: true, maxFileSizeMb: 100, config: { kind: 'git', remoteUrl: 'https://github.com/tianchuangya/course-notes.git', branch: 'main', provider: 'github' } }],
  }],
}

export function installDemoApi(): void {
  if (window.tianchuang) return
  const noEvent = () => () => undefined
  const demoToolbox = (): ToolboxState => ({ tools: [
    { id: 'localsend', name: 'LocalSend', summary: '局域网文件与文本传送，已内置。', status: 'built-in', installed: true, canInstall: false, canLaunch: true, sourceUrl: 'https://github.com/localsend/localsend', license: 'Apache-2.0' },
    { id: 'sunshine', name: 'Sunshine', summary: '低延迟设备串流主机。', status: 'not-installed', installed: false, canInstall: true, canLaunch: false, sourceUrl: 'https://github.com/SunshineStream/Sunshine', license: 'GPL-3.0' },
    { id: 'pavise', name: 'Pavise Game', summary: '游戏调度优化工具。', status: 'not-installed', version: '3.3.1.1', installed: false, canInstall: true, canLaunch: false, sourceUrl: 'https://github.com/dulaiduwang003/Pavise-Game', license: 'GPL-3.0' },
    { id: 'winisland', name: 'WinIsland', summary: 'Windows 灵动岛。', status: 'installed', installed: true, canInstall: true, canLaunch: true, sourceUrl: 'https://github.com/luolangaga/WinLand', license: 'Upstream license', defaultsAvailable: true },
    { id: 'pecofence', name: 'PecoFence', summary: '桌面围栏与图标整理。', status: 'installed', version: '0.4.0', installed: true, canInstall: true, canLaunch: true, sourceUrl: 'https://github.com/DayuanJiang/PecoFence', license: 'Apache-2.0' },
    { id: 'filee', name: 'Filee', summary: '文件格式转换与自动化。', status: 'installed', installed: true, canInstall: true, canLaunch: true, sourceUrl: 'https://github.com/KnifeLemon/Filee', license: 'MIT', defaultsAvailable: true },
    { id: 'rufus', name: 'Rufus', summary: '制作启动 U 盘。', status: 'not-installed', version: '4.15', installed: false, canInstall: true, canLaunch: false, sourceUrl: 'https://github.com/pbatard/rufus', license: 'GPL-3.0' },
    { id: 'windhawk', name: 'Windhawk', summary: 'Windows Mod 管理器。', status: 'installed', installed: true, canInstall: true, canLaunch: true, sourceUrl: 'https://github.com/ramensoftware/windhawk', license: 'GPL-3.0' },
    { id: 'folia', name: 'Folia', summary: '动态壁纸与音频体验。', status: 'installed', installed: true, canInstall: true, canLaunch: true, sourceUrl: 'https://github.com/chthollyphile/folia-major', license: 'AGPL-3.0', defaultsAvailable: true },
    { id: 'kazumi', name: 'Kazumi', summary: '番剧聚合与在线播放。', status: 'not-installed', installed: false, canInstall: true, canLaunch: false, sourceUrl: 'https://github.com/Predidit/Kazumi', license: 'GPL-3.0' },
    { id: 'clash-verge', name: 'Clash Verge Rev', summary: 'Mihomo 图形客户端。', status: 'installed', installed: true, canInstall: true, canLaunch: true, sourceUrl: 'https://github.com/clash-verge-rev/clash-verge-rev', license: 'GPL-3.0', defaultsAvailable: true },
  ] })
  window.tianchuang = {
    getSnapshot: async () => structuredClone(demoSnapshot),
    suggestRepositoryName: async (_displayName, stableKey = 'demo-workspace') => `tianchuang-data-${stableKey.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase() || 'demo'}`,
    openThemeFile: async () => undefined,
    saveThemeFile: async () => '演示模式不支持导出',
    getNotificationPreferences: async () => ({ syncSuccess: true, syncFailure: true }),
    saveNotificationPreferences: async (preferences) => preferences,
    getWarehouseSettings: async () => ({ warehouseName: 'TC-cloud-Warehouse', device: { schemaVersion: 1, deviceId: '0123456789abcdef0123456789abcdef', deviceName: 'Tianchuang Laptop', deviceModel: 'Demo Device', platform: 'Windows 11', appVersion: '0.2.0', registeredAt: now, lastSeenAt: now, syncState: 'idle' } }),
    updateWarehouseSettings: async (changes) => ({ warehouseName: changes.warehouseName || 'TC-cloud-Warehouse', device: { schemaVersion: 1, deviceId: '0123456789abcdef0123456789abcdef', deviceName: changes.deviceName || 'Tianchuang Laptop', deviceModel: 'Demo Device', platform: 'Windows 11', appVersion: '0.2.0', registeredAt: now, lastSeenAt: now, syncState: 'idle' } }),
    getWindowMaximized: async () => false,
    getCustomBackground: async () => undefined,
    selectCustomBackground: async () => undefined,
    resetCustomBackground: async () => undefined,
    selectFolder: async () => undefined,
    selectMirrorFolder: async () => undefined,
    folderFromFile: () => '',
    addWorkspace: async () => demoSnapshot.workspaces[0],
    getWorkspaceCover: async () => undefined,
    pickWorkspaceCover: async () => undefined,
    saveWorkspaceCover: async () => demoSnapshot.workspaces[0],
    getWorkspaceBackground: async () => undefined,
    pickWorkspaceBackground: async () => undefined,
    updateWorkspace: async (id, changes) => {
      const item = demoSnapshot.workspaces.find((workspace) => workspace.id === id)!
      Object.assign(item, changes)
      return item
    },
    removeWorkspace: async () => undefined,
    deleteWorkspace: async (_workspaceId, options) => options.deleteLocal ? '本地资料库已删除（演示模式）' : '资料库已移除（演示模式）',
    addTarget: async (_draft: TargetDraft) => demoSnapshot.workspaces[0],
    listStorageConnections: async (): Promise<StorageConnectionSummary[]> => [],
    attachStorageConnection: async () => demoSnapshot.workspaces[0],
    updateStorageConnection: async (_connectionId, draft) => ({ id: 'demo-connection', name: draft.name, maxFileSizeMb: draft.maxFileSizeMb, config: draft.config, createdAt: now, updatedAt: now, usageCount: 0 }),
    deleteStorageConnection: async () => '已删除演示连接',
    checkStorageConnection: async (connectionId) => ({ connectionId, ok: true, checkedAt: now, detail: '演示连接正常' }),
    getGitHubSession: async () => ({ available: true, authenticated: true, username: 'tianchuangya', displayName: '是天创呀' }),
    listGithubAccounts: async () => [{ username: 'tianchuangya', displayName: '是天创呀', primary: true }],
    planMigration: async (workspaceId, sourceTargetId, destinationTargetId): Promise<MigrationPlan> => ({
      sourceTargetId, destinationTargetId, sourceName: 'GitHub 主备份', destinationName: '私人云盘',
      plan: { id: 'demo-migration', workspaceId, targetId: destinationTargetId, targetName: '私人云盘', provider: 'webdav', direction: 'upload', summary: '准备迁移 3 个文件', actions: ['上传 3 个文件'], issues: [], requiresConfirmation: false, createdAt: now, metadata: { totalBytes: 4096 } },
      capacity: { quotaUsed: 1024, quotaTotal: 102400 },
    }),
    loginGitHub: async () => ({ available: true, authenticated: true, username: 'tianchuangya', displayName: '是天创呀' }),
    createGitHubRepository: async (draft) => ({
      name: draft.name,
      fullName: `tianchuangya/${draft.name}`,
      cloneUrl: `https://github.com/tianchuangya/${draft.name}.git`,
      htmlUrl: `https://github.com/tianchuangya/${draft.name}`,
      private: draft.private,
    }),
    listGitHubCollaborators: async () => [{ username: 'teammate', permission: 'push', pending: false }],
    inviteGitHubCollaborator: async () => undefined,
    getCloudConfigStatus: async () => ({ authenticated: true, username: 'tianchuangya', repositoryExists: true, repositoryUrl: 'https://github.com/tianchuangya/tianchuang-cloud-config', hasRemoteConfig: true, updatedAt: now, workspaceCount: demoCloudConfig.workspaces.length, config: demoCloudConfig }),
    publishCloudConfig: async () => ({ authenticated: true, username: 'tianchuangya', repositoryExists: true, repositoryUrl: 'https://github.com/tianchuangya/tianchuang-cloud-config', hasRemoteConfig: true, updatedAt: now, workspaceCount: demoSnapshot.workspaces.length, config: demoCloudConfig }),
    restoreCloudConfig: async (_config: CloudConfigDocument) => undefined,
    removeTarget: async () => '已移除同步目标，备份文件全部保留',
    listWorkspaceFiles: async (_workspaceId: string, relativeDir: string): Promise<WorkspaceFileEntry[]> => {
      const now = Date.now()
      if (!relativeDir) {
        return [
          { name: '课程笔记', path: '课程笔记', kind: 'dir', size: 0, modifiedAt: now },
          { name: '参考资料', path: '参考资料', kind: 'dir', size: 0, modifiedAt: now },
          { name: '学习计划.md', path: '学习计划.md', kind: 'file', size: 620, modifiedAt: now },
          { name: '课表.pdf', path: '课表.pdf', kind: 'file', size: 128_000, modifiedAt: now },
          { name: '封面图.png', path: '封面图.png', kind: 'file', size: 86_000, modifiedAt: now },
        ]
      }
      return [
        { name: `${relativeDir.split('/').at(-1)}-第一章.md`, path: `${relativeDir}/第一章.md`, kind: 'file', size: 540, modifiedAt: now },
        { name: `${relativeDir.split('/').at(-1)}-摘要.txt`, path: `${relativeDir}/摘要.txt`, kind: 'file', size: 120, modifiedAt: now },
      ]
    },
    openWorkspaceFileInSystem: async () => '演示模式不支持系统打开',
    revealWorkspaceFileInFolder: async () => undefined,
    deleteWorkspaceBackups: async () => '所有云端备份已删除（演示模式），本地文件保留',
    planSync: async (workspaceId, targetId): Promise<SyncPlan> => ({
      id: 'demo-plan', workspaceId, targetId, targetName: 'GitHub 主备份', provider: 'git',
      direction: 'none', summary: '已经是最新版本', actions: ['无需传输'], issues: [],
      requiresConfirmation: false, createdAt: now, metadata: {},
    }),
    runSync: async () => demoSnapshot,
    cancelSync: async () => true,
    syncWorkspace: async () => demoSnapshot,
    getNearbyState: async (): Promise<NearbyState> => ({
      status: 'ready', alias: 'Tianchuang Laptop', fingerprint: 'demo-local-fingerprint', port: 53317,
      devices: [{ alias: '演示手机', fingerprint: 'demo-phone-fingerprint', deviceType: 'mobile', host: '192.168.1.8', port: 53317, protocol: 'https' }],
      receiveRequests: [], transfers: [],
    }),
    refreshNearby: async () => undefined,
    probeNearby: async () => undefined,
    sendNearbyText: async () => 'demo-text-transfer',
    selectAndSendNearbyFiles: async () => 'demo-file-transfer',
    answerNearbyRequest: async () => undefined,
    cancelNearbyTransfer: async () => undefined,
    getToolboxState: async () => demoToolbox(),
    installTool: async () => demoToolbox(),
    launchTool: async () => demoToolbox(),
    openToolLocation: async () => undefined,
    onToolboxEvent: noEvent,
    onNearbyEvent: noEvent,
    onProgress: noEvent as (listener: (progress: SyncProgress) => void) => () => void,
    onAttention: noEvent,
    onSnapshot: noEvent,
    onWindowMaximized: noEvent,
  }
}
