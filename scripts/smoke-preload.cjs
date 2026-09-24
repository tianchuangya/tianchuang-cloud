const { app, BrowserWindow } = require('electron')
const path = require('node:path')

app.whenReady().then(async () => {
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
  const bridgeType = await window.webContents.executeJavaScript('typeof window.tianchuang')
  console.log(`desktop bridge: ${bridgeType}`)
  app.exit(bridgeType === 'object' ? 0 : 1)
})
