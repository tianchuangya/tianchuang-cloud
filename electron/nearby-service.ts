import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import type { NearbyDevice, NearbyEvent, NearbyReceiveRequest, NearbyState, NearbyTransfer } from './types.js'

type SidecarEvent =
  | { type: 'ready'; alias: string; port: number; fingerprint: string }
  | { type: 'devices'; devices: NearbyDevice[] }
  | { type: 'receive_request'; session_id: string; alias: string; fingerprint: string; files: NearbyReceiveRequest['files']; total_bytes: number }
  | { type: 'text_received'; alias: string; fingerprint: string; text: string }
  | { type: 'transfer_started'; transfer_id: string; direction: 'send' | 'receive'; total_bytes: number }
  | { type: 'transfer_progress'; transfer_id: string; direction: 'send' | 'receive'; transferred_bytes: number; total_bytes: number }
  | { type: 'transfer_complete'; transfer_id: string; direction: 'send' | 'receive'; success: boolean; message: string }
  | { type: 'file_received'; session_id: string; path: string; success: boolean; message: string }
  | { type: 'error'; command: string; message: string }

type SidecarCommand =
  | { type: 'refresh' }
  | { type: 'probe'; host: string; port: number }
  | { type: 'send_text'; transfer_id: string; fingerprint: string; text: string }
  | { type: 'send_files'; transfer_id: string; fingerprint: string; paths: string[] }
  | { type: 'answer'; session_id: string; accept: boolean; destination?: string }
  | { type: 'cancel'; transfer_id: string }
  | { type: 'shutdown' }

const state: NearbyState = {
  status: 'stopped',
  devices: [],
  receiveRequests: [],
  transfers: [],
}

let child: ChildProcessWithoutNullStreams | undefined
let notify: ((event: NearbyEvent) => void) | undefined
let stopping = false
let restartTimer: NodeJS.Timeout | undefined
let restartAttempts = 0
let serviceAlias = '天创云端'

function binaryPath(): string {
  if (process.env.TC_LOCALSEND_SIDECAR) return process.env.TC_LOCALSEND_SIDECAR
  const executable = process.platform === 'win32' ? 'tc-localsend-sidecar.exe' : 'tc-localsend-sidecar'
  if (app.isPackaged) return path.join(process.resourcesPath, 'native', executable)
  return path.join(app.getAppPath(), 'native', 'localsend-sidecar', 'target', 'debug', executable)
}

async function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: '0.0.0.0', port, exclusive: true }, () => server.close(() => resolve(true)))
  })
}

async function availablePort(): Promise<number> {
  for (let port = 53317; port <= 53327; port += 1) {
    if (await canListen(port)) return port
  }
  throw new Error('LocalSend 端口 53317–53327 均被占用')
}

function publish(event: NearbyEvent): void {
  notify?.(event)
}

function updateTransfer(id: string, changes: Partial<NearbyTransfer> & Pick<NearbyTransfer, 'direction'>): NearbyTransfer {
  const current = state.transfers.find((item) => item.id === id)
  const transfer: NearbyTransfer = {
    id,
    direction: changes.direction,
    status: changes.status ?? current?.status ?? 'running',
    transferredBytes: changes.transferredBytes ?? current?.transferredBytes ?? 0,
    totalBytes: changes.totalBytes ?? current?.totalBytes ?? 0,
    message: changes.message ?? current?.message,
  }
  state.transfers = [transfer, ...state.transfers.filter((item) => item.id !== id)].slice(0, 30)
  return transfer
}

function handle(event: SidecarEvent): void {
  switch (event.type) {
    case 'ready':
      restartAttempts = 0
      state.status = 'ready'
      state.alias = event.alias
      state.fingerprint = event.fingerprint
      state.port = event.port
      state.error = undefined
      publish({ type: 'state', state: nearbyState() })
      return
    case 'devices':
      state.devices = event.devices
      publish({ type: 'devices', devices: event.devices })
      return
    case 'receive_request': {
      const request: NearbyReceiveRequest = {
        sessionId: event.session_id,
        alias: event.alias,
        fingerprint: event.fingerprint,
        files: event.files,
        totalBytes: event.total_bytes,
      }
      state.receiveRequests = [request, ...state.receiveRequests.filter((item) => item.sessionId !== request.sessionId)]
      publish({ type: 'receive-request', request })
      return
    }
    case 'text_received':
      publish({ type: 'text-received', alias: event.alias, fingerprint: event.fingerprint, text: event.text })
      return
    case 'transfer_started': {
      const transfer = updateTransfer(event.transfer_id, { direction: event.direction, status: 'running', totalBytes: event.total_bytes, transferredBytes: 0 })
      publish({ type: 'transfer', transfer })
      return
    }
    case 'transfer_progress': {
      const transfer = updateTransfer(event.transfer_id, { direction: event.direction, status: 'running', totalBytes: event.total_bytes, transferredBytes: event.transferred_bytes })
      publish({ type: 'transfer', transfer })
      return
    }
    case 'transfer_complete': {
      const current = state.transfers.find((item) => item.id === event.transfer_id)
      const transfer = updateTransfer(event.transfer_id, {
        direction: event.direction,
        status: event.success ? 'complete' : 'error',
        transferredBytes: event.success ? current?.totalBytes ?? 0 : current?.transferredBytes,
        message: event.message,
      })
      publish({ type: 'transfer', transfer })
      return
    }
    case 'file_received':
      publish({ type: 'file-received', sessionId: event.session_id, path: event.path, success: event.success, message: event.message })
      return
    case 'error':
      publish({ type: 'error', command: event.command, message: event.message })
  }
}

function command(value: SidecarCommand): void {
  if (!child || child.killed || state.status !== 'ready') throw new Error(state.error || '附近传送服务尚未就绪')
  child.stdin.write(`${JSON.stringify(value)}\n`)
}

export function nearbyState(): NearbyState {
  return structuredClone(state)
}

export async function startNearbyService(alias: string, onEvent: (event: NearbyEvent) => void): Promise<void> {
  notify = onEvent
  serviceAlias = alias
  if (child && !child.killed) return
  const executable = binaryPath()
  state.status = 'starting'
  state.error = undefined
  publish({ type: 'state', state: nearbyState() })
  if (!existsSync(executable)) {
    state.status = 'unavailable'
    state.error = `找不到附近传送服务：${executable}`
    publish({ type: 'state', state: nearbyState() })
    return
  }
  stopping = false
  const destination = app.getPath('downloads')
  let port: number
  try {
    port = await availablePort()
  } catch (error) {
    state.status = 'unavailable'
    state.error = error instanceof Error ? error.message : String(error)
    publish({ type: 'state', state: nearbyState() })
    return
  }
  child = spawn(executable, [
    '--data-dir', path.join(app.getPath('userData'), 'nearby'),
    '--destination', destination,
    '--alias', alias,
    '--port', String(port),
  ], { windowsHide: true })

  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    if (!line.trim()) return
    try {
      handle(JSON.parse(line) as SidecarEvent)
    } catch (error) {
      publish({ type: 'error', command: 'parse', message: error instanceof Error ? error.message : String(error) })
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    const message = chunk.trim()
    if (message) publish({ type: 'diagnostic', message })
  })
  child.on('error', (error) => {
    state.status = 'unavailable'
    state.error = error.message
    publish({ type: 'state', state: nearbyState() })
  })
  child.on('exit', (code) => {
    child = undefined
    state.status = stopping ? 'stopped' : 'unavailable'
    if (!stopping) state.error = `附近传送服务已退出（${code ?? 'unknown'}）`
    publish({ type: 'state', state: nearbyState() })
    if (!stopping) {
      restartAttempts += 1
      const delay = Math.min(30_000, 1_500 * (2 ** Math.min(restartAttempts - 1, 4)))
      restartTimer = setTimeout(() => {
        restartTimer = undefined
        void startNearbyService(serviceAlias, notify ?? (() => undefined))
      }, delay)
      restartTimer.unref()
    }
  })
}

export function refreshNearby(): void {
  command({ type: 'refresh' })
}

export function probeNearby(host: string, port = 53317): void {
  const normalized = host.trim()
  if (!normalized || normalized.length > 255 || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('设备地址或端口无效')
  command({ type: 'probe', host: normalized, port })
}

export function sendNearbyText(fingerprint: string, text: string): string {
  const value = text.trim()
  if (!value) throw new Error('发送内容不能为空')
  if (Buffer.byteLength(value, 'utf8') > 16_000_000) throw new Error('文本不能超过 16 MB')
  const transferId = randomUUID()
  command({ type: 'send_text', transfer_id: transferId, fingerprint, text: value })
  return transferId
}

export function sendNearbyFiles(fingerprint: string, paths: string[]): string {
  if (!paths.length) throw new Error('没有选择文件')
  const transferId = randomUUID()
  command({ type: 'send_files', transfer_id: transferId, fingerprint, paths })
  return transferId
}

export function answerNearbyRequest(sessionId: string, accept: boolean, destination?: string): void {
  state.receiveRequests = state.receiveRequests.filter((item) => item.sessionId !== sessionId)
  command({ type: 'answer', session_id: sessionId, accept, destination })
}

export function cancelNearbyTransfer(transferId: string): void {
  command({ type: 'cancel', transfer_id: transferId })
}

export async function stopNearbyService(): Promise<void> {
  stopping = true
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = undefined
  }
  restartAttempts = 0
  if (!child || child.killed) {
    state.status = 'stopped'
    return
  }
  try {
    child.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`)
  } catch {
    child.kill()
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child?.kill()
      resolve()
    }, 2_000)
    child?.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

