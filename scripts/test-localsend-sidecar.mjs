import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const executable = process.argv[2] || resolve('native', 'localsend-sidecar', 'target', 'debug', process.platform === 'win32' ? 'tc-localsend-sidecar.exe' : 'tc-localsend-sidecar')

class Sidecar {
  constructor(name, port, root) {
    this.name = name
    this.port = port
    this.events = []
    this.waiters = []
    this.stderr = ''
    this.process = spawn(executable, [
      '--data-dir', join(root, `${name}-state`),
      '--destination', join(root, `${name}-received`),
      '--alias', name,
      '--port', String(port),
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    let buffer = ''
    this.process.stdout.setEncoding('utf8')
    this.process.stdout.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const event = JSON.parse(line)
        this.events.push(event)
        for (const waiter of [...this.waiters]) waiter(event)
      }
    })
    this.process.stderr.setEncoding('utf8')
    this.process.stderr.on('data', (chunk) => { this.stderr += chunk })
  }

  send(command) {
    this.process.stdin.write(`${JSON.stringify(command)}\n`)
  }

  waitFor(predicate, timeoutMs = 20_000) {
    const existing = this.events.find(predicate)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== listener)
        reject(new Error(`${this.name} timed out; stderr=${this.stderr}; events=${JSON.stringify(this.events)}`))
      }, timeoutMs)
      const listener = (event) => {
        if (!predicate(event)) return
        clearTimeout(timer)
        this.waiters = this.waiters.filter((item) => item !== listener)
        resolve(event)
      }
      this.waiters.push(listener)
    })
  }

  async close() {
    if (this.process.exitCode !== null) return
    this.send({ type: 'shutdown' })
    await Promise.race([
      new Promise((resolve) => this.process.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ])
    if (this.process.exitCode === null) this.process.kill()
  }
}

const root = await mkdtemp(join(tmpdir(), 'tc-localsend-'))
await mkdir(join(root, 'sender'), { recursive: true })
const sample = join(root, 'sender', '你好 LocalSend.txt')
await writeFile(sample, 'Tianchuang Cloud LocalSend integration\n', 'utf8')

const a = new Sidecar('天创-A', 53417, root)
const b = new Sidecar('天创-B', 53418, root)

try {
  const [readyA, readyB] = await Promise.all([
    a.waitFor((event) => event.type === 'ready'),
    b.waitFor((event) => event.type === 'ready'),
  ])

  a.send({ type: 'probe', host: '127.0.0.1', port: 53418 })
  b.send({ type: 'probe', host: '127.0.0.1', port: 53417 })
  await Promise.all([
    a.waitFor((event) => event.type === 'devices' && event.devices.some((device) => device.fingerprint === readyB.fingerprint)),
    b.waitFor((event) => event.type === 'devices' && event.devices.some((device) => device.fingerprint === readyA.fingerprint)),
  ])

  a.send({ type: 'send_text', transfer_id: 'text-1', fingerprint: readyB.fingerprint, text: '你好，附近传送' })
  const [textReceived, textComplete] = await Promise.all([
    b.waitFor((event) => event.type === 'text_received' && event.text === '你好，附近传送'),
    a.waitFor((event) => event.type === 'transfer_complete' && event.transfer_id === 'text-1'),
  ])
  if (!textComplete.success) throw new Error(`Text transfer failed: ${textComplete.message}`)

  a.send({ type: 'send_files', transfer_id: 'file-1', fingerprint: readyB.fingerprint, paths: [sample] })
  const request = await b.waitFor((event) => event.type === 'receive_request' && event.files.some((file) => file.name === basename(sample)))
  b.send({ type: 'answer', session_id: request.session_id, accept: true })
  const [fileReceived, fileComplete] = await Promise.all([
    b.waitFor((event) => event.type === 'file_received' && event.session_id === request.session_id),
    a.waitFor((event) => event.type === 'transfer_complete' && event.transfer_id === 'file-1'),
  ])
  if (!fileReceived.success) throw new Error(`Receive failed: ${fileReceived.message}`)
  if (!fileComplete.success) throw new Error(`Send failed: ${fileComplete.message}`)
  const content = await readFile(fileReceived.path, 'utf8')
  if (content !== 'Tianchuang Cloud LocalSend integration\n') throw new Error('Received content mismatch')

  console.log(JSON.stringify({
    ok: true,
    devices: [readyA.alias, readyB.alias],
    text: textReceived.text,
    file: fileReceived.path,
  }))
} finally {
  await Promise.all([a.close(), b.close()])
  await rm(root, { recursive: true, force: true })
}
