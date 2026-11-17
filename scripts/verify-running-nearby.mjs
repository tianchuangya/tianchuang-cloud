const endpoint = process.argv[2] || 'http://127.0.0.1:9222'
const targets = await fetch(`${endpoint}/json`).then((response) => response.json())
const target = targets.find((item) => item.type === 'page' && !item.url.startsWith('devtools://'))
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

const state = await evaluate('window.tianchuang.getNearbyState()')
if (state.status !== 'ready') throw new Error(state.error || `Nearby service is ${state.status}`)
const device = state.devices[0]
if (!device) throw new Error('No LocalSend-compatible device discovered')
const transferId = await evaluate(`window.tianchuang.sendNearbyText(${JSON.stringify(device.fingerprint)}, ${JSON.stringify('天创云端 LocalSend 官方客户端兼容测试')})`)
let transfer
for (let index = 0; index < 240; index += 1) {
  await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  const next = await evaluate('window.tianchuang.getNearbyState()')
  transfer = next.transfers.find((item) => item.id === transferId)
  if (transfer?.status !== 'running') break
}
socket.close()
if (!transfer || transfer.status !== 'complete') throw new Error(transfer?.message || 'Official client transfer did not complete')
console.log(JSON.stringify({ ok: true, alias: device.alias, host: device.host, port: device.port, transferId }))
