import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { NearbyEvent, NearbyState, StorageConnectionHealth, StorageConnectionSummary, StorageConnectionUpdate, SyncDecision, SyncPlan, SyncProgress, TargetDraft, ToolboxEvent, ToolboxState, ToolboxToolId, WarehouseSettings, WorkspaceDeleteOptions, WorkspaceProfile } from './types.js'

contextBridge.exposeInMainWorld('tianchuang', {
  getSnapshot: () => ipcRenderer.invoke('app:snapshot'),
  suggestRepositoryName: (displayName: string, stableKey?: string) => ipcRenderer.invoke('repository:name:suggest', displayName, stableKey) as Promise<string>,
  openThemeFile: () => ipcRenderer.invoke('dialog:open-theme'),
  saveThemeFile: (name: string, document: unknown) => ipcRenderer.invoke('theme:save', name, document),
  getNotificationPreferences: () => ipcRenderer.invoke('notifications:get'),
  saveNotificationPreferences: (preferences: import('./types.js').NotificationPreferences) => ipcRenderer.invoke('notifications:set', preferences),
  getWarehouseSettings: () => ipcRenderer.invoke('warehouse:get') as Promise<WarehouseSettings>,
  updateWarehouseSettings: (changes: { warehouseName?: string; deviceName?: string }) => ipcRenderer.invoke('warehouse:update', changes) as Promise<WarehouseSettings>,
  getWindowMaximized: () => ipcRenderer.invoke('window:maximized'),
  getCustomBackground: () => ipcRenderer.invoke('appearance:background:get'),
  selectCustomBackground: () => ipcRenderer.invoke('appearance:background:select'),
  resetCustomBackground: () => ipcRenderer.invoke('appearance:background:reset'),
  selectFolder: () => ipcRenderer.invoke('folder:select'),
  folderFromFile: (file: File) => webUtils.getPathForFile(file),
  addWorkspace: (folderPath: string) => ipcRenderer.invoke('workspace:add', folderPath),
  getWorkspaceCover: (workspaceId: string) => ipcRenderer.invoke('workspace:cover:data', workspaceId),
  pickWorkspaceCover: (workspaceId: string) => ipcRenderer.invoke('workspace:cover:pick', workspaceId),
  saveWorkspaceCover: (workspaceId: string, dataUrl: string) => ipcRenderer.invoke('workspace:cover:save', workspaceId, dataUrl),
  getWorkspaceBackground: (workspaceId: string) => ipcRenderer.invoke('workspace:background:data', workspaceId),
  pickWorkspaceBackground: (workspaceId: string) => ipcRenderer.invoke('workspace:background:pick', workspaceId),
  updateWorkspace: (workspaceId: string, changes: Pick<WorkspaceProfile, 'autoSync' | 'syncOnChange' | 'syncOnFocus' | 'autoSyncDelaySeconds' | 'errorNotifyCooldownMinutes' | 'name'>) => ipcRenderer.invoke('workspace:update', workspaceId, changes),
  removeWorkspace: (workspaceId: string) => ipcRenderer.invoke('workspace:remove', workspaceId),
  deleteWorkspace: (workspaceId: string, options: WorkspaceDeleteOptions) => ipcRenderer.invoke('workspace:delete', workspaceId, options),
  addTarget: (draft: TargetDraft) => ipcRenderer.invoke('target:add', draft),
  listStorageConnections: () => ipcRenderer.invoke('connections:list') as Promise<StorageConnectionSummary[]>,
  attachStorageConnection: (workspaceId: string, connectionId: string) => ipcRenderer.invoke('connections:attach', workspaceId, connectionId) as Promise<WorkspaceProfile>,
  updateStorageConnection: (connectionId: string, draft: StorageConnectionUpdate) => ipcRenderer.invoke('connections:update', connectionId, draft) as Promise<StorageConnectionSummary>,
  deleteStorageConnection: (connectionId: string) => ipcRenderer.invoke('connections:delete', connectionId) as Promise<string>,
  checkStorageConnection: (connectionId: string) => ipcRenderer.invoke('connections:check', connectionId) as Promise<StorageConnectionHealth>,
  getGitHubSession: () => ipcRenderer.invoke('github:session'),
  listGithubAccounts: () => ipcRenderer.invoke('github:accounts:list'),
  planMigration: (workspaceId: string, sourceTargetId: string, destinationTargetId: string) => ipcRenderer.invoke('sync:plan-migration', workspaceId, sourceTargetId, destinationTargetId),
  loginGitHub: () => ipcRenderer.invoke('github:login'),
  createGitHubRepository: (draft: import('./types.js').GitHubRepositoryDraft) => ipcRenderer.invoke('github:repository:create', draft),
  listGitHubCollaborators: (remoteUrl: string) => ipcRenderer.invoke('github:collaborators:list', remoteUrl),
  inviteGitHubCollaborator: (draft: import('./types.js').GitHubCollaboratorDraft) => ipcRenderer.invoke('github:collaborators:invite', draft),
  getCloudConfigStatus: () => ipcRenderer.invoke('cloud-config:status'),
  publishCloudConfig: () => ipcRenderer.invoke('cloud-config:publish'),
  restoreCloudConfig: (config: import('./types.js').CloudConfigDocument, selections: import('./types.js').CloudRestoreSelection[]) => ipcRenderer.invoke('cloud-config:restore', config, selections),
  removeTarget: (workspaceId: string, targetId: string, options?: { deleteBackup?: boolean }) => ipcRenderer.invoke('target:remove', workspaceId, targetId, options),
  listWorkspaceFiles: (workspaceId: string, relativeDir: string) => ipcRenderer.invoke('workspace:files:list', workspaceId, relativeDir),
  openWorkspaceFileInSystem: (workspaceId: string, relativePath: string) => ipcRenderer.invoke('workspace:file:open', workspaceId, relativePath),
  revealWorkspaceFileInFolder: (workspaceId: string, relativePath: string) => ipcRenderer.invoke('workspace:file:reveal', workspaceId, relativePath),
  deleteWorkspaceBackups: (workspaceId: string) => ipcRenderer.invoke('workspace:delete-backups', workspaceId),
  selectMirrorFolder: () => ipcRenderer.invoke('folder:select'),
  planSync: (workspaceId: string, targetId: string) => ipcRenderer.invoke('sync:plan', workspaceId, targetId) as Promise<SyncPlan>,
  runSync: (planId: string, decision: SyncDecision) => ipcRenderer.invoke('sync:run', planId, decision),
  cancelSync: (workspaceId: string) => ipcRenderer.invoke('sync:cancel', workspaceId) as Promise<boolean>,
  syncWorkspace: (workspaceId: string) => ipcRenderer.invoke('sync:workspace', workspaceId),
  getNearbyState: () => ipcRenderer.invoke('nearby:state') as Promise<NearbyState>,
  refreshNearby: () => ipcRenderer.invoke('nearby:refresh') as Promise<void>,
  probeNearby: (host: string, port?: number) => ipcRenderer.invoke('nearby:probe', host, port) as Promise<void>,
  sendNearbyText: (fingerprint: string, text: string) => ipcRenderer.invoke('nearby:send-text', fingerprint, text) as Promise<string>,
  selectAndSendNearbyFiles: (fingerprint: string, mode: 'files' | 'folder' = 'files') => ipcRenderer.invoke('nearby:send-files', fingerprint, mode) as Promise<string | undefined>,
  answerNearbyRequest: (sessionId: string, accept: boolean) => ipcRenderer.invoke('nearby:answer', sessionId, accept) as Promise<void>,
  cancelNearbyTransfer: (transferId: string) => ipcRenderer.invoke('nearby:cancel', transferId) as Promise<void>,
  getToolboxState: () => ipcRenderer.invoke('toolbox:state') as Promise<ToolboxState>,
  installTool: (id: ToolboxToolId) => ipcRenderer.invoke('toolbox:install', id) as Promise<ToolboxState>,
  launchTool: (id: ToolboxToolId) => ipcRenderer.invoke('toolbox:launch', id) as Promise<ToolboxState>,
  openToolLocation: (id: ToolboxToolId) => ipcRenderer.invoke('toolbox:location', id) as Promise<void>,
  onToolboxEvent: (listener: (event: ToolboxEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, event: ToolboxEvent) => listener(event)
    ipcRenderer.on('toolbox:event', wrapped)
    return () => ipcRenderer.removeListener('toolbox:event', wrapped)
  },
  onNearbyEvent: (listener: (event: NearbyEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, event: NearbyEvent) => listener(event)
    ipcRenderer.on('nearby:event', wrapped)
    return () => ipcRenderer.removeListener('nearby:event', wrapped)
  },
  onProgress: (listener: (progress: SyncProgress) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: SyncProgress) => listener(progress)
    ipcRenderer.on('sync:progress', wrapped)
    return () => ipcRenderer.removeListener('sync:progress', wrapped)
  },
  onAttention: (listener: (plan: SyncPlan) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, plan: SyncPlan) => listener(plan)
    ipcRenderer.on('sync:attention', wrapped)
    return () => ipcRenderer.removeListener('sync:attention', wrapped)
  },
  onSnapshot: (listener: () => void) => {
    const wrapped = () => listener()
    ipcRenderer.on('app:snapshot-changed', wrapped)
    return () => ipcRenderer.removeListener('app:snapshot-changed', wrapped)
  },
  onWindowMaximized: (listener: (maximized: boolean) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized)
    ipcRenderer.on('window:maximized-changed', wrapped)
    return () => ipcRenderer.removeListener('window:maximized-changed', wrapped)
  },
})
