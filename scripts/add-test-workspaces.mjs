const endpoint = process.argv[2] || 'http://127.0.0.1:9333'
const folders = process.argv.slice(3)
if (!folders.length) throw new Error('Pass at least one test workspace folder')
const deadline = Date.now() + 15_000
let targets
while (Date.now() < deadline) {
  try { targets = await fetch(`${endpoint}/json`).then((response) => response.json()); if (targets.some((target) => target.type === 'page')) break } catch {}
  await new Promise((resolveWait) => setTimeout(resolveWait, 250))
}
const target = targets?.find((item) => item.type === 'page' && !item.url.startsWith('devtools://'))
if (!target) throw new Error('Could not find Electron renderer target')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }) })
let nextId = 0
const pending = new Map()
socket.addEventListener('message', (message) => {
  const payload = JSON.parse(message.data); if (!payload.id || !pending.has(payload.id)) return
  const handler = pending.get(payload.id); pending.delete(payload.id)
  if (payload.error) handler.reject(new Error(payload.error.message)); else handler.resolve(payload.result)
})
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolveCall, reject) => pending.set(id, { resolve: resolveCall, reject })) }
const expression = `(async () => {
  const folders = ${JSON.stringify(folders)}
  const existing = new Set((await window.tianchuang.getSnapshot()).workspaces.map((workspace) => workspace.path.toLowerCase()))
  const added = []
  for (const folder of folders) { if (!existing.has(folder.toLowerCase())) { const workspace = await window.tianchuang.addWorkspace(folder); added.push(workspace.name) } }
  return { added, total: (await window.tianchuang.getSnapshot()).workspaces.length }
})()`
const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
socket.close()
if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
console.log(JSON.stringify(result.result.value))
