import type { AppSnapshot, CloudConfigDocument, SyncPlan, SyncProgress, TargetDraft } from '../electron/types'

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
  window.tianchuang = {
    getSnapshot: async () => structuredClone(demoSnapshot),
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
    updateWorkspace: async (id, changes) => {
      const item = demoSnapshot.workspaces.find((workspace) => workspace.id === id)!
      Object.assign(item, changes)
      return item
    },
    removeWorkspace: async () => undefined,
    addTarget: async (_draft: TargetDraft) => demoSnapshot.workspaces[0],
    getGitHubSession: async () => ({ available: true, authenticated: true, username: 'tianchuangya', displayName: '是天创呀' }),
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
    removeTarget: async () => demoSnapshot.workspaces[0],
    planSync: async (workspaceId, targetId): Promise<SyncPlan> => ({
      id: 'demo-plan', workspaceId, targetId, targetName: 'GitHub 主备份', provider: 'git',
      direction: 'none', summary: '已经是最新版本', actions: ['无需传输'], issues: [],
      requiresConfirmation: false, createdAt: now, metadata: {},
    }),
    runSync: async () => demoSnapshot,
    syncWorkspace: async () => demoSnapshot,
    onProgress: noEvent as (listener: (progress: SyncProgress) => void) => () => void,
    onAttention: noEvent,
    onSnapshot: noEvent,
    onWindowMaximized: noEvent,
  }
}
