const endpoint = process.argv[2] || 'http://127.0.0.1:9333'
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
await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }) })
let nextId = 0
const pending = new Map()
socket.addEventListener('message', (message) => {
  const payload = JSON.parse(message.data)
  if (!payload.id || !pending.has(payload.id)) return
  const handler = pending.get(payload.id); pending.delete(payload.id)
  if (payload.error) handler.reject(new Error(payload.error.message)); else handler.resolve(payload.result)
})
function call(method, params = {}) {
  const id = ++nextId; socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolveCall, reject) => pending.set(id, { resolve: resolveCall, reject }))
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

await evaluate(`document.querySelector('.startup-experience')?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`)
await new Promise((resolveWait) => setTimeout(resolveWait, 600))
const setup = await evaluate(`(() => {
  const list = document.querySelector('.workspace-list')
  const template = list?.querySelector('.workspace-nav')
  if (!list || !template) return null
  for (let index = 0; index < 18; index += 1) { const clone = template.cloneNode(true); clone.dataset.scrollTest = 'true'; list.appendChild(clone) }
  const style = getComputedStyle(list)
  return { overflowY: style.overflowY, overscrollBehavior: style.overscrollBehavior, touchAction: style.touchAction, clientHeight: list.clientHeight, scrollHeight: list.scrollHeight, contentTop: document.querySelector('.content')?.scrollTop || 0 }
})()`)
if (!setup || setup.overflowY !== 'auto' || setup.scrollHeight <= setup.clientHeight) throw new Error('Sidebar list is not an independent scroll container')
await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 110, y: 330, deltaX: 0, deltaY: 420 })
await new Promise((resolveWait) => setTimeout(resolveWait, 700))
const scroll = await evaluate(`({ sidebarTop: document.querySelector('.workspace-list')?.scrollTop || 0, contentTop: document.querySelector('.content')?.scrollTop || 0 })`)
if (scroll.sidebarTop < 40 || scroll.contentTop !== setup.contentTop) throw new Error(`Mouse wheel escaped the sidebar: ${JSON.stringify(scroll)}`)
await evaluate(`document.querySelectorAll('[data-scroll-test="true"]').forEach((item) => item.remove()); document.querySelector('.workspace-list').scrollTop = 0; (() => { const input = document.querySelector('.workspace-search'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 't'); input.dispatchEvent(new Event('input', { bubbles: true })) })()`)
await new Promise((resolveWait) => setTimeout(resolveWait, 40))
const motionState = await evaluate(`(() => { const items = [...document.querySelectorAll('.workspace-nav')]; return { count: items.length, animated: items.filter((item) => Number(getComputedStyle(item).opacity) < .999 || getComputedStyle(item).transform !== 'none').length } })()`)
await evaluate(`(() => { const input = document.querySelector('.workspace-search'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })) })()`)
if (motionState.count > 0 && motionState.animated === 0) throw new Error('Bubble-load animation did not start after a structural refresh')
socket.close()
console.log(JSON.stringify({ ok: true, setup, scroll, motionState }))
