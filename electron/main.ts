import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, Tray } from 'electron'
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
import { removeWorkspace } from './store.js'
import { createGitHubRepository, githubSession, loginGitHub } from './github.js'
import type { GitHubRepositoryDraft, SyncDecision, SyncPlan, SyncProgress, TargetDraft, WorkspaceProfile } from './types.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let quitting = false
const watchers = new Map<string, FSWatcher>()
const syncTimers = new Map<string, NodeJS.Timeout>()

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

function queueAutomaticSync(workspaceId: string, delay = 3500): void {
  const existing = syncTimers.get(workspaceId)
  if (existing) clearTimeout(existing)
  syncTimers.set(workspaceId, setTimeout(() => {
    syncTimers.delete(workspaceId)
    void automaticSync(workspaceId, progress, attention).catch((error) => {
      progress({ workspaceId, phase: 'error', title: '自动同步失败', detail: error instanceof Error ? error.message : String(error), percent: 100 })
    })
  }, delay))
}

async function refreshWatchers(): Promise<void> {
  const active = new Set(snapshot().workspaces.filter((item) => item.autoSync).map((item) => item.id))
  for (const [id, watcher] of watchers) {
    if (!active.has(id)) {
      await watcher.close()
      watchers.delete(id)
    }
  }
  for (const workspace of snapshot().workspaces.filter((item) => item.autoSync)) {
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
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 790,
    minWidth: 980,
    minHeight: 650,
    show: false,
    title: '天创云端',
    transparent: isWindows || isMac,
    backgroundColor: '#00000000',
    backgroundMaterial: isWindows ? 'acrylic' : undefined,
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac ? false : { color: '#00000000', symbolColor: '#24303b', height: 48 },
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('focus', () => {
    for (const workspace of snapshot().workspaces.filter((item) => item.syncOnFocus)) queueAutomaticSync(workspace.id, 400)
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="9" fill="#2979ff"/><path d="M9 19.5a5 5 0 0 1 1-9.9A7 7 0 0 1 23.4 12 4.2 4.2 0 0 1 23 20.4H10.2" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round"/></svg>`
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 18, height: 18 })
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
    const workspace = addWorkspace(folderPath)
    await refreshWatchers()
    send('app:snapshot-changed')
    return workspace
  })
  ipcMain.handle('workspace:update', async (_event, id: string, changes: Pick<WorkspaceProfile, 'autoSync' | 'syncOnFocus' | 'name'>) => {
    const updated = updateWorkspaceSettings(id, changes)
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
