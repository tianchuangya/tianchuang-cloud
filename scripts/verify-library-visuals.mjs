import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const endpoint = process.argv[2] || 'http://127.0.0.1:9333'
const output = resolve(process.argv[3] || 'docs/library-visual-preview.png')
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
  if (!payload.id || !pending.has(payload.id)) return
  const handler = pending.get(payload.id)
  pending.delete(payload.id)
  if (payload.error) handler.reject(new Error(payload.error.message))
  else handler.resolve(payload.result)
})
function call(method, params = {}) {
  const id = ++nextId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolveCall, reject) => pending.set(id, { resolve: resolveCall, reject }))
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

await evaluate(`document.querySelector('.startup-experience')?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`)
await new Promise((resolveWait) => setTimeout(resolveWait, 700))
await evaluate(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === '资料库')?.click()`)
await new Promise((resolveWait) => setTimeout(resolveWait, 600))
await evaluate(`document.querySelector('.workspace-nav')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 150, clientY: 140 }))`)
await new Promise((resolveWait) => setTimeout(resolveWait, 250))
const result = await evaluate(`(() => {
  const navItems = [...document.querySelectorAll('.workspace-nav')]
  const stageImage = document.querySelector('.library-focus-cover')
  return {
    navCount: navItems.length,
    numberLabels: navItems.filter((item) => /^\\d{2}$/.test(item.querySelector('.nav-icon')?.textContent?.trim() || '')).length,
    lightNodes: document.querySelectorAll('.nav-node-core').length,
    thumbnails: document.querySelectorAll('.nav-icon.has-cover img').length,
    uniqueThumbnails: new Set([...document.querySelectorAll('.nav-icon.has-cover img')].map((image) => image.getAttribute('src'))).size,
    orbitDecorations: document.querySelectorAll('.library-focus-orbit').length,
    rippleCanvases: document.querySelectorAll('.library-focus-ripple canvas').length,
    rippleCanvasSize: (() => { const canvas = document.querySelector('.library-focus-ripple canvas'); return canvas ? [canvas.width, canvas.height] : [0, 0] })(),
    stageImage: stageImage?.getAttribute('src'),
    menuLeft: document.querySelector('.workspace-context-menu')?.getBoundingClientRect().left,
    menuLabels: [...document.querySelectorAll('.workspace-context-menu button')].map((button) => button.textContent?.trim()),
    sidebarStatuses: navItems.map((item) => ({ tone: item.querySelector('.state-dot')?.className, date: item.querySelector('.nav-copy small')?.textContent?.trim() })),
  }
})()`)
if (result.numberLabels !== 0) throw new Error(`Found ${result.numberLabels} numbered sidebar nodes`)
if (result.thumbnails !== result.navCount) throw new Error('Not every workspace has a thumbnail')
if (result.orbitDecorations !== 0) throw new Error('The redundant orbit decoration is still rendered')
if (result.rippleCanvases !== 1 || result.rippleCanvasSize[0] < 2 || result.rippleCanvasSize[1] < 2) throw new Error('The GPU background ripple canvas is not active')
if (result.rippleCanvasSize[0] > 4000 || result.rippleCanvasSize[1] > 4000) throw new Error(`The ripple canvas is oversized: ${result.rippleCanvasSize.join('x')}`)
if ((result.menuLeft || 0) < 240) throw new Error(`Context menu still overlaps the sidebar at ${result.menuLeft}px`)
if (!result.stageImage) throw new Error('Workspace focus background is missing')
if (!result.menuLabels.includes('设置缩略图') || !result.menuLabels.includes('设置背景图')) throw new Error('Workspace visual actions are missing')
if (!result.menuLabels.includes('删除资料库…')) throw new Error('Unified workspace deletion entry is missing')
const rippleFrameA = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
await new Promise((resolveWait) => setTimeout(resolveWait, 700))
const rippleFrameB = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
if (!rippleFrameA.data || rippleFrameA.data === rippleFrameB.data) throw new Error('The full-image water distortion is not changing between frames')
const deleteEntryClicked = await evaluate(`(() => { const button = Array.from(document.querySelectorAll('.workspace-context-menu button')).find((item) => item.textContent?.includes('删除资料库')); button?.click(); return Boolean(button) })()`)
if (!deleteEntryClicked) throw new Error('Could not click the workspace deletion entry')
await new Promise((resolveWait) => setTimeout(resolveWait, 900))
const safeDeleteUi = await evaluate(`({ safe: Boolean(document.querySelector('.remove-workspace-modal .review-symbol.safe')), permanentToggle: Boolean(document.querySelector('.permanent-delete-toggle input')) })`)
if (!safeDeleteUi.safe || !safeDeleteUi.permanentToggle) throw new Error('Safe removal state is missing')
await evaluate(`document.querySelector('.permanent-delete-toggle input')?.click()`)
await new Promise((resolveWait) => setTimeout(resolveWait, 180))
const dangerousDeleteUi = await evaluate(`({ danger: Boolean(document.querySelector('.remove-workspace-modal.is-dangerous .review-symbol.danger')), choices: document.querySelectorAll('.permanent-delete-options label').length })`)
if (!dangerousDeleteUi.danger || dangerousDeleteUi.choices !== 2) throw new Error('Permanent deletion choices are missing')
await evaluate(`document.querySelector('.permanent-delete-options input')?.click()`)
await new Promise((resolveWait) => setTimeout(resolveWait, 160))
await evaluate(`Array.from(document.querySelectorAll('.remove-workspace-modal button')).find((button) => button.textContent?.trim() === '下一步')?.click()`)
await new Promise((resolveWait) => setTimeout(resolveWait, 900))
const finalWarning = await evaluate(`({ title: document.querySelector('.remove-workspace-modal h2')?.textContent?.trim(), confirm: Array.from(document.querySelectorAll('.remove-workspace-modal button')).find((button) => button.textContent?.includes('确认彻底删除'))?.textContent?.trim() })`)
if (!finalWarning.title?.startsWith('最后确认') || !finalWarning.confirm) throw new Error('Final destructive warning is missing')
const screenshot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
await writeFile(output, Buffer.from(screenshot.data, 'base64'))
socket.close()
console.log(JSON.stringify({ ok: true, output, ...result, safeDeleteUi, dangerousDeleteUi, finalWarning }))
