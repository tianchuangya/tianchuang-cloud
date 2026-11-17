import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createClient } from 'webdav'
import { afterAll, describe, expect, it } from 'vitest'
import { planLocalSync, runLocalSync } from '../electron/providers/local.js'
import { planWebDavSync, runWebDavSync } from '../electron/providers/webdav.js'
import type { SyncTarget, WorkspaceProfile } from '../electron/types.js'

const deviceId = 'dddddddddddddddddddddddddddddddd'
const temporaryRoots: string[] = []

async function temporaryWorkspace(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

afterAll(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const liveWebDavUrl = process.env.TC_WEBDAV_LIVE_URL
const largeWebDavMb = Number(process.env.TC_WEBDAV_LARGE_MB || 0)
const webDavDescribe = liveWebDavUrl ? describe : describe.skip

webDavDescribe('live WebDAV compatibility', () => {
  const runId = randomUUID().replaceAll('-', '')
  const remoteBase = `/tc-cloud-integration/${runId}`
  const username = process.env.TC_WEBDAV_LIVE_USERNAME ?? ''
  const password = process.env.TC_WEBDAV_LIVE_PASSWORD ?? ''
  const client = createClient(liveWebDavUrl ?? 'http://127.0.0.1:1', { username, password })

  afterAll(async () => {
    await client.deleteFile(remoteBase).catch(() => undefined)
  })

  it('round-trips Unicode, MOVE, remote-only, deletion, and a large file', async () => {
    const root = await temporaryWorkspace('tc-live-webdav-')
    await writeFile(path.join(root, '中文笔记.md'), '第一版')
    await writeFile(path.join(root, 'large.bin'), Buffer.alloc(32 * 1024 * 1024, 0x5a))
    const workspace: WorkspaceProfile = { id: `webdav-${runId}`, name: '兼容矩阵', path: root, autoSync: false, syncOnFocus: false, state: 'idle', targets: [] }
    const target: SyncTarget = {
      id: 'live-webdav', name: 'Live WebDAV', enabled: true, maxFileSizeMb: 128,
      config: { kind: 'webdav', endpoint: liveWebDavUrl!, username, remotePath: `${remoteBase}/library` },
    }

    const initial = await planWebDavSync(workspace, target, deviceId, password)
    await runWebDavSync(workspace, target, initial, { preserveLocalOnly: true }, deviceId, password)
    expect(Buffer.from(await client.getFileContents(`${remoteBase}/library/中文笔记.md`) as ArrayBuffer).toString()).toBe('第一版')
    expect((await client.stat(`${remoteBase}/library/large.bin`)).size).toBe(32 * 1024 * 1024)
    const committedState = JSON.parse(Buffer.from(await client.getFileContents(`${remoteBase}/library/.tianchuang-cloud/state.tc`) as ArrayBuffer).toString()) as { files: Record<string, { remoteEtag?: string }> }
    expect(committedState.files['large.bin'].remoteEtag).toBeTruthy()
    expect((await planWebDavSync(workspace, target, deviceId, password)).direction).toBe('none')

    await client.putFileContents(`${remoteBase}/library/远端新增.txt`, 'cloud-only')
    const pull = await planWebDavSync(workspace, target, deviceId, password)
    expect(pull.issues).toContainEqual({ path: '远端新增.txt', kind: 'remote-only' })
    await runWebDavSync(workspace, target, pull, { preserveLocalOnly: true }, deviceId, password)
    expect(await readFile(path.join(root, '远端新增.txt'), 'utf8')).toBe('cloud-only')

    await rm(path.join(root, '中文笔记.md'))
    const deletion = await planWebDavSync(workspace, target, deviceId, password)
    expect(deletion.issues).toContainEqual({ path: '中文笔记.md', kind: 'remote-delete' })
    await runWebDavSync(workspace, target, deletion, { preserveLocalOnly: true, deleteRemote: true }, deviceId, password)
    await expect(client.stat(`${remoteBase}/library/中文笔记.md`)).rejects.toMatchObject({ status: 404 })
  }, 120_000)

  it('really aborts a large HTTP upload and leaves no published or temporary file', async () => {
    const root = await temporaryWorkspace('tc-live-webdav-cancel-')
    await writeFile(path.join(root, 'cancel.bin'), Buffer.alloc(64 * 1024 * 1024, 0x43))
    const workspace: WorkspaceProfile = { id: `webdav-cancel-${runId}`, name: '取消测试', path: root, autoSync: false, syncOnFocus: false, state: 'idle', targets: [] }
    const remotePath = `${remoteBase}/cancel-library`
    const target: SyncTarget = {
      id: 'live-webdav-cancel', name: 'Live WebDAV', enabled: true, maxFileSizeMb: 128,
      config: { kind: 'webdav', endpoint: liveWebDavUrl!, username, remotePath },
    }
    const plan = await planWebDavSync(workspace, target, deviceId, password)
    const controller = new AbortController()

    await expect(runWebDavSync(workspace, target, plan, { preserveLocalOnly: true }, deviceId, password, {
      signal: controller.signal,
      onTransferProgress: ({ transferredBytes }) => {
        if (transferredBytes > 0 && !controller.signal.aborted) controller.abort(new DOMException('live cancellation', 'AbortError'))
      },
    })).rejects.toMatchObject({ name: 'AbortError' })

    await expect(client.stat(`${remotePath}/cancel.bin`)).rejects.toMatchObject({ status: 404 })
    const entries = await client.getDirectoryContents(remotePath, { deep: false })
    expect(entries.some((entry) => entry.basename.includes('.tianchuang-') && entry.basename.endsWith('.tmp'))).toBe(false)
  }, 120_000)

  ;(largeWebDavMb > 0 ? it : it.skip)('streams a configured large file without buffering it in process memory', async () => {
    const root = await temporaryWorkspace('tc-live-webdav-large-')
    const size = largeWebDavMb * 1024 * 1024
    const largeFile = path.join(root, 'stream-large.bin')
    await writeFile(largeFile, '')
    await truncate(largeFile, size)
    const workspace: WorkspaceProfile = { id: `webdav-large-${runId}`, name: '大容量测试', path: root, autoSync: false, syncOnFocus: false, state: 'idle', targets: [] }
    const remotePath = `${remoteBase}/large-library`
    const target: SyncTarget = {
      id: 'live-webdav-large', name: 'Live WebDAV', enabled: true, maxFileSizeMb: largeWebDavMb + 64,
      config: { kind: 'webdav', endpoint: liveWebDavUrl!, username, remotePath },
    }
    const plan = await planWebDavSync(workspace, target, deviceId, password)
    const baselineRss = process.memoryUsage().rss
    let peakRss = baselineRss
    const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss) }, 20)
    try {
      await runWebDavSync(workspace, target, plan, { preserveLocalOnly: true }, deviceId, password)
    } finally {
      clearInterval(sampler)
    }

    expect((await client.stat(`${remotePath}/stream-large.bin`)).size).toBe(size)
    expect((await planWebDavSync(workspace, target, deviceId, password)).direction).toBe('none')
    console.info(`LIVE_LARGE_RESULT sizeMiB=${largeWebDavMb} rssGrowthMiB=${((peakRss - baselineRss) / 1024 / 1024).toFixed(1)}`)
    expect(peakRss - baselineRss).toBeLessThan(Math.max(128 * 1024 * 1024, size / 2))
  }, 300_000)
})

const liveNasDestination = process.env.TC_NAS_LIVE_DESTINATION
const nasDescribe = liveNasDestination ? describe : describe.skip

nasDescribe('live SMB/NAS compatibility', () => {
  const runId = randomUUID().replaceAll('-', '')
  const destination = path.join(liveNasDestination ?? os.tmpdir(), `tc-cloud-integration-${runId}`)

  afterAll(async () => {
    await rm(destination, { recursive: true, force: true })
  })

  it('round-trips Unicode, remote-only files, and confirmed deletion over UNC', async () => {
    const root = await temporaryWorkspace('tc-live-nas-')
    await writeFile(path.join(root, '本机文档.txt'), 'local')
    const workspace: WorkspaceProfile = { id: `nas-${runId}`, name: 'NAS兼容矩阵', path: root, autoSync: false, syncOnFocus: false, state: 'idle', targets: [] }
    const target: SyncTarget = {
      id: 'live-nas', name: 'Live SMB', enabled: true, maxFileSizeMb: 128,
      config: { kind: 'local', destinationPath: destination, remoteDirectory: 'library', locationType: 'network' },
    }

    await runLocalSync(workspace, target, await planLocalSync(workspace, target, deviceId), { preserveLocalOnly: true }, deviceId)
    expect(await readFile(path.join(destination, 'library', '本机文档.txt'), 'utf8')).toBe('local')

    await writeFile(path.join(destination, 'library', '远端新增.txt'), 'nas-only')
    const pull = await planLocalSync(workspace, target, deviceId)
    expect(pull.issues).toContainEqual({ path: '远端新增.txt', kind: 'remote-only' })
    await runLocalSync(workspace, target, pull, { preserveLocalOnly: true }, deviceId)
    expect(await readFile(path.join(root, '远端新增.txt'), 'utf8')).toBe('nas-only')

    await rm(path.join(root, '本机文档.txt'))
    const deletion = await planLocalSync(workspace, target, deviceId)
    expect(deletion.issues).toContainEqual({ path: '本机文档.txt', kind: 'remote-delete' })
    await runLocalSync(workspace, target, deletion, { preserveLocalOnly: true, deleteRemote: true }, deviceId)
    await expect(readFile(path.join(destination, 'library', '本机文档.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 120_000)
})
