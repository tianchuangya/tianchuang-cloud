import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stat } from 'node:fs/promises'
import chokidar, { type FSWatcher } from 'chokidar'
import {
  addWorkspace,
  automaticSync,
  createTarget,
  planSync,
  removeTarget,
  runSync,
  snapshot,
  updateWorkspaceSettings,
} from './sync-service.js'
import { removeWorkspace, updateWorkspace } from './store.js'
import { createGitHubRepository, githubSession, inviteGitHubCollaborator, listGitHubCollaborators, loginGitHub } from './github.js'
import { coverDataUrl, coverFileFilters, findWorkspaceCover, saveWorkspaceCoverData } from './covers.js'
import { backgroundFileFilters, clearCustomBackground, copyCustomBackground, findCustomBackground, imageDataUrl } from './backgrounds.js'
import type { GitHubCollaboratorDraft, GitHubRepositoryDraft, SyncDecision, SyncPlan, SyncProgress, TargetDraft, WorkspaceProfile } from './types.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let quitting = false
const watchers = new Map<string, FSWatcher>()
const syncTimers = new Map<string, NodeJS.Timeout>()
const automaticErrorNoticeAt = new Map<string, number>()

function send(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function progress(item: SyncProgress): void {
  send('sync:progress', item)
  if (item.phase === 'complete' || item.phase === 'error') {
    new Notification({ title: item.title, body: item.detail }).show()
    send('app:snapshot-changed')
  }
}

function attention(plan: SyncPlan): void {
  send('sync:attention', plan)
  new Notification({ title: '天创云端需要确认', body: plan.summary }).show()
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
}

function automaticProgress(item: SyncProgress): void {
  if (item.phase === 'error') {
    const workspace = snapshot().workspaces.find((current) => current.id === item.workspaceId)
    const cooldown = Math.min(1440, Math.max(1, workspace?.errorNotifyCooldownMinutes ?? 10)) * 60_000
    const previous = automaticErrorNoticeAt.get(item.workspaceId) || 0
    if (Date.now() - previous < cooldown) {
      send('app:snapshot-changed')
      return
    }
    automaticErrorNoticeAt.set(item.workspaceId, Date.now())
  } else if (item.phase === 'complete') {
    automaticErrorNoticeAt.delete(item.workspaceId)
  }
  progress(item)
}

function queueAutomaticSync(workspaceId: string, delay?: number): void {
  const existing = syncTimers.get(workspaceId)
  if (existing) clearTimeout(existing)
  const workspace = snapshot().workspaces.find((item) => item.id === workspaceId)
  const configuredDelay = Math.min(300, Math.max(3, workspace?.autoSyncDelaySeconds ?? 3)) * 1000
  const effectiveDelay = delay ?? configuredDelay
  syncTimers.set(workspaceId, setTimeout(() => {
    syncTimers.delete(workspaceId)
    let reportedError = false
    void automaticSync(workspaceId, (item) => {
      if (item.phase === 'error') reportedError = true
      automaticProgress(item)
    }, attention).catch((error) => {
      if (!reportedError) automaticProgress({ workspaceId, phase: 'error', title: '自动同步失败', detail: error instanceof Error ? error.message : String(error), percent: 100 })
    })
  }, effectiveDelay))
}

async function refreshWatchers(): Promise<void> {
  const active = new Set(snapshot().workspaces.filter((item) => item.autoSync && item.syncOnChange !== false).map((item) => item.id))
  for (const [id, watcher] of watchers) {
    if (!active.has(id)) {
      await watcher.close()
      watchers.delete(id)
    }
  }
  for (const workspace of snapshot().workspaces.filter((item) => item.autoSync && item.syncOnChange !== false)) {
    if (watchers.has(workspace.id)) continue
    const watcher = chokidar.watch(workspace.path, {
      ignoreInitial: true,
      ignored: /(^|[/\\])(\.git|\.tianchuang-cloud|node_modules)([/\\]|$)/,
      awaitWriteFinish: { stabilityThreshold: 1800, pollInterval: 150 },
    })
    watcher.on('all', () => queueAutomaticSync(workspace.id))
    watchers.set(workspace.id, watcher)
  }
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const isWindows = process.platform === 'win32'
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), process.env.VITE_DEV_SERVER_URL ? 'public/assets/app-icon.png' : 'dist/assets/app-icon.png'))
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 790,
    minWidth: 980,
    minHeight: 650,
    show: false,
    title: '天创云端',
    icon,
    transparent: isWindows || isMac,
    hasShadow: true,
    backgroundColor: '#00000000',
    backgroundMaterial: isWindows ? 'acrylic' : undefined,
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac ? false : { color: '#00000000', symbolColor: '#dce9ed', height: 48 },
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('maximize', () => send('window:maximized-changed', true))
  mainWindow.on('unmaximize', () => send('window:maximized-changed', false))
  mainWindow.on('focus', () => {
    for (const workspace of snapshot().workspaces.filter((item) => item.autoSync && item.syncOnFocus)) queueAutomaticSync(workspace.id, 400)
  })
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  if (process.env.VITE_DEV_SERVER_URL) void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  else void mainWindow.loadFile(path.join(currentDirectory, '../dist/index.html'))
}

function createTray(): void {
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), process.env.VITE_DEV_SERVER_URL ? 'public/assets/app-icon.png' : 'dist/assets/app-icon.png')).resize({ width: 18, height: 18 })
  tray = new Tray(icon)
  tray.setToolTip('天创云端')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开天创云端', click: () => mainWindow?.show() },
    { label: '同步全部', click: () => snapshot().workspaces.forEach((item) => queueAutomaticSync(item.id, 0)) },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } },
  ]))
  tray.on('double-click', () => mainWindow?.show())
}

function registerIpc(): void {
  ipcMain.handle('app:snapshot', () => snapshot())
  ipcMain.handle('window:maximized', () => mainWindow?.isMaximized() ?? false)
  ipcMain.handle('appearance:background:get', async () => imageDataUrl(await findCustomBackground(path.join(app.getPath('userData'), 'appearance'))))
  ipcMain.handle('appearance:background:select', async () => {
    const result = await dialog.showOpenDialog({ title: '选择应用背景图', buttonLabel: '使用此背景', properties: ['openFile'], filters: backgroundFileFilters })
    if (result.canceled || !result.filePaths[0]) return undefined
    const filePath = await copyCustomBackground(path.join(app.getPath('userData'), 'appearance'), result.filePaths[0])
    return imageDataUrl(filePath)
  })
  ipcMain.handle('appearance:background:reset', async () => {
    await clearCustomBackground(path.join(app.getPath('userData'), 'appearance'))
  })
  ipcMain.handle('folder:select', async () => {
    const result = await dialog.showOpenDialog({
      title: '添加资料库',
      buttonLabel: '添加此文件夹',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? undefined : result.filePaths[0]
  })
  ipcMain.handle('workspace:add', async (_event, folderPath: string) => {
    const info = await stat(folderPath).catch(() => undefined)
    if (!info?.isDirectory()) throw new Error('所选路径不是可访问的文件夹')
    let workspace = addWorkspace(folderPath)
    const coverPath = await findWorkspaceCover(folderPath)
    if (coverPath && coverPath !== workspace.coverPath) workspace = updateWorkspace(workspace.id, (item) => ({ ...item, coverPath }))
    await refreshWatchers()
    send('app:snapshot-changed')
    return workspace
  })
  ipcMain.handle('workspace:cover:data', async (_event, workspaceId: string) => {
    const workspace = snapshot().workspaces.find((item) => item.id === workspaceId)
    if (!workspace) return undefined
    const coverPath = await findWorkspaceCover(workspace.path)
    if (coverPath !== workspace.coverPath) {
      updateWorkspace(workspace.id, (item) => ({ ...item, coverPath }))
    }
    return coverDataUrl(coverPath)
  })
  ipcMain.handle('workspace:cover:pick', async (_event, workspaceId: string) => {
    const workspace = snapshot().workspaces.find((item) => item.id === workspaceId)
    if (!workspace) throw new Error('找不到资料库')
    const result = await dialog.showOpenDialog({ title: `为“${workspace.name}”选择封面`, buttonLabel: '使用此封面', properties: ['openFile'], filters: coverFileFilters })
    if (result.canceled || !result.filePaths[0]) return undefined
    return coverDataUrl(result.filePaths[0])
  })
  ipcMain.handle('workspace:cover:save', async (_event, workspaceId: string, dataUrl: string) => {
    const workspace = snapshot().workspaces.find((item) => item.id === workspaceId)
    if (!workspace) throw new Error('找不到资料库')
    const coverPath = await saveWorkspaceCoverData(workspace.path, dataUrl)
    const updated = updateWorkspace(workspaceId, (item) => ({ ...item, coverPath }))
    send('app:snapshot-changed')
    return updated
  })
  ipcMain.handle('workspace:update', async (_event, id: string, changes: Pick<WorkspaceProfile, 'autoSync' | 'syncOnChange' | 'syncOnFocus' | 'autoSyncDelaySeconds' | 'errorNotifyCooldownMinutes' | 'name'>) => {
    const updated = updateWorkspaceSettings(id, changes)
    const queued = syncTimers.get(id)
    if (queued) {
      clearTimeout(queued)
      syncTimers.delete(id)
    }
    await refreshWatchers()
    send('app:snapshot-changed')
    return updated
  })
  ipcMain.handle('workspace:remove', async (_event, id: string) => {
    removeWorkspace(id)
    await refreshWatchers()
    send('app:snapshot-changed')
  })
  ipcMain.handle('target:add', async (_event, draft: TargetDraft) => {
    const updated = createTarget(draft)
    send('app:snapshot-changed')
    return updated
  })
  ipcMain.handle('github:session', () => githubSession())
  ipcMain.handle('github:login', () => loginGitHub())
  ipcMain.handle('github:repository:create', (_event, draft: GitHubRepositoryDraft) => createGitHubRepository(draft))
  ipcMain.handle('github:collaborators:list', (_event, remoteUrl: string) => listGitHubCollaborators(remoteUrl))
  ipcMain.handle('github:collaborators:invite', (_event, draft: GitHubCollaboratorDraft) => inviteGitHubCollaborator(draft))
  ipcMain.handle('target:remove', (_event, workspaceId: string, targetId: string) => {
    const updated = removeTarget(workspaceId, targetId)
    send('app:snapshot-changed')
    return updated
  })
  ipcMain.handle('sync:plan', (_event, workspaceId: string, targetId: string) => planSync(workspaceId, targetId))
  ipcMain.handle('sync:run', (_event, planId: string, decision: SyncDecision) => runSync(planId, decision, progress))
  ipcMain.handle('sync:workspace', async (_event, workspaceId: string) => {
    await automaticSync(workspaceId, progress, attention)
    return snapshot()
  })
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.tianchuang.cloud')
  registerIpc()
  createWindow()
  createTray()
  await refreshWatchers()
})

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  else mainWindow.show()
})

app.on('before-quit', () => { quitting = true })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') mainWindow = undefined })
