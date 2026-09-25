import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { SyncDecision, SyncPlan, SyncProgress, TargetDraft, WorkspaceProfile } from './types.js'

contextBridge.exposeInMainWorld('tianchuang', {
  getSnapshot: () => ipcRenderer.invoke('app:snapshot'),
  getCustomBackground: () => ipcRenderer.invoke('appearance:background:get'),
  selectCustomBackground: () => ipcRenderer.invoke('appearance:background:select'),
  resetCustomBackground: () => ipcRenderer.invoke('appearance:background:reset'),
  selectFolder: () => ipcRenderer.invoke('folder:select'),
  folderFromFile: (file: File) => webUtils.getPathForFile(file),
  addWorkspace: (folderPath: string) => ipcRenderer.invoke('workspace:add', folderPath),
  getWorkspaceCover: (workspaceId: string) => ipcRenderer.invoke('workspace:cover:data', workspaceId),
  selectWorkspaceCover: (workspaceId: string) => ipcRenderer.invoke('workspace:cover:select', workspaceId),
  updateWorkspace: (workspaceId: string, changes: Pick<WorkspaceProfile, 'autoSync' | 'syncOnFocus' | 'name'>) => ipcRenderer.invoke('workspace:update', workspaceId, changes),
  removeWorkspace: (workspaceId: string) => ipcRenderer.invoke('workspace:remove', workspaceId),
  addTarget: (draft: TargetDraft) => ipcRenderer.invoke('target:add', draft),
  getGitHubSession: () => ipcRenderer.invoke('github:session'),
  loginGitHub: () => ipcRenderer.invoke('github:login'),
  createGitHubRepository: (draft: import('./types.js').GitHubRepositoryDraft) => ipcRenderer.invoke('github:repository:create', draft),
  removeTarget: (workspaceId: string, targetId: string) => ipcRenderer.invoke('target:remove', workspaceId, targetId),
  selectMirrorFolder: () => ipcRenderer.invoke('folder:select'),
  planSync: (workspaceId: string, targetId: string) => ipcRenderer.invoke('sync:plan', workspaceId, targetId) as Promise<SyncPlan>,
  runSync: (planId: string, decision: SyncDecision) => ipcRenderer.invoke('sync:run', planId, decision),
  syncWorkspace: (workspaceId: string) => ipcRenderer.invoke('sync:workspace', workspaceId),
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
})
