import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const endpoint = process.argv[2] || 'http://127.0.0.1:9222'
const output = resolve(process.argv[3] || 'docs/nearby-ui-preview.png')
const view = process.argv[4] || 'nearby'
const deadline = Date.now() + 15_000
let targets
while (Date.now() < deadline) {
  try {
    targets = await fetch(`${endpoint}/json`).then((response) => response.json())
    if (targets.some((target) => target.type === 'page')) break
  } catch {}
  await new Promise((resolveWait) => setTimeout(resolveWait, 250))
}
const target = targets?.find((item) => item.type === 'page' && !item.url.startsWith('devtools://'))
if (!target) throw new Error('Could not find Electron renderer target')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolveOpen, reject) => {
  socket.addEventListener('open', resolveOpen, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let nextId = 0
const pending = new Map()
socket.addEventListener('message', (message) => {
  const payload = JSON.parse(message.data)
  if (!payload.id) return
  const handler = pending.get(payload.id)
  if (!handler) return
  pending.delete(payload.id)
  if (payload.error) handler.reject(new Error(payload.error.message))
  else handler.resolve(payload.result)
})
function call(method, params = {}) {
  const id = ++nextId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolveCall, reject) => pending.set(id, { resolve: resolveCall, reject }))
}

await call('Runtime.evaluate', {
  expression: `document.querySelector('.startup-experience')?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`,
  awaitPromise: true,
})
await new Promise((resolveWait) => setTimeout(resolveWait, 500))
const expressions = {
  overview: `Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === '资料库')?.click()`,
  glass: `document.querySelector('.view-switch button')?.click()`,
  motion: `document.querySelector('button[title="动态网格"]')?.click()`,
  sidebar2: `document.querySelectorAll('.workspace-nav')[1]?.click()`,
  sidebar2dbl: `document.querySelectorAll('.workspace-nav')[1]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`,
  nearby: `(async () => { Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === '工具箱')?.click(); await new Promise((resolve) => setTimeout(resolve, 350)); document.querySelector('.tool-localsend .tool-primary')?.click() })()`,
  toolbox: `Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === '工具箱')?.click()`,
  'toolbox-lower': `(async () => { Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === '工具箱')?.click(); await new Promise((resolve) => setTimeout(resolve, 350)); document.querySelector('main.content')?.scrollTo({ top: 380 }) })()`,
  'pavise-install': `window.tianchuang.installTool('pavise')`,
  'rufus-install': `window.tianchuang.installTool('rufus')`,
  'kazumi-install': `window.tianchuang.installTool('kazumi')`,
  'kazumi-launch': `window.tianchuang.launchTool('kazumi')`,
  'clash-launch': `window.tianchuang.launchTool('clash-verge')`,
  workspace: `document.querySelector('.workspace-nav')?.click()`,
  settings: `Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === '设置')?.click()`,
}
await call('Runtime.evaluate', { expression: expressions[view] || expressions.nearby, awaitPromise: true })
await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
const screenshot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
await writeFile(output, Buffer.from(screenshot.data, 'base64'))
socket.close()
console.log(output)
