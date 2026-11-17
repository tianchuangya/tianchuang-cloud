const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')

app.whenReady().then(async () => {
  ipcMain.handle('app:snapshot', () => ({ workspaces: [], activity: [] }))
  ipcMain.handle('window:maximized', () => false)
  ipcMain.handle('appearance:background:get', () => undefined)
  ipcMain.handle('cloud-config:status', () => ({ authenticated: false, repositoryExists: false, hasRemoteConfig: false, workspaceCount: 0 }))
  ipcMain.handle('nearby:state', () => ({ status: 'stopped', devices: [], receiveRequests: [], transfers: [] }))
  ipcMain.handle('toolbox:state', () => ({ tools: [] }))
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'dist-electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  const result = await window.webContents.executeJavaScript(`({
    bridge: typeof window.tianchuang,
    nearbyState: typeof window.tianchuang?.getNearbyState,
    nearbyEvents: typeof window.tianchuang?.onNearbyEvent,
    toolboxState: typeof window.tianchuang?.getToolboxState,
  })`)
  console.log(`desktop bridge: ${result.bridge}; nearby: ${result.nearbyState}/${result.nearbyEvents}; toolbox: ${result.toolboxState}`)
  app.exit(result.bridge === 'object' && result.nearbyState === 'function' && result.nearbyEvents === 'function' && result.toolboxState === 'function' ? 0 : 1)
})
