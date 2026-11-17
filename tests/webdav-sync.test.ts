import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => {
  const files = new Map<string, { contents: Buffer; lastmod: string }>()
  const directories = new Set<string>(['/'])
  let failMoveDestination = ''
  let failReadPath = ''
  let failStatPath = ''
  const normalize = (value: string) => `/${value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '/')
  const client = {
    getDirectoryContents: async (root: string) => {
      const prefix = `${normalize(root).replace(/\/$/, '')}/`
      return [...files.entries()].filter(([name]) => name.startsWith(prefix)).map(([filename, value]) => ({ filename, type: 'file', size: value.contents.length, lastmod: value.lastmod, etag: `"${createHash('sha256').update(value.contents).digest('hex')}"` }))
    },
    getFileContents: async (name: string) => {
      if (normalize(name) === failReadPath) throw new Error('read failed by test server')
      const entry = files.get(normalize(name))
      if (!entry) throw new Error('404')
      return Buffer.from(entry.contents)
    },
    createReadStream: (name: string) => Readable.from((async function* () {
      if (normalize(name) === failReadPath) throw new Error('read failed by test server')
      const entry = files.get(normalize(name))
      if (!entry) throw new Error('404')
      yield Buffer.from(entry.contents)
    })()),
    exists: async (name: string) => directories.has(normalize(name)) || files.has(normalize(name)),
    createDirectory: async (name: string) => { directories.add(normalize(name)); return true },
    deleteFile: async (name: string) => { files.delete(normalize(name)); return true },
    putFileContents: async (name: string, contents: Buffer | string | Readable, options?: { signal?: AbortSignal; onUploadProgress?: (event: { loaded: number; total: number }) => void }) => {
      let value: Buffer
      if (Buffer.isBuffer(contents) || typeof contents === 'string') value = Buffer.from(contents)
      else {
        const chunks: Buffer[] = []
        for await (const chunk of contents) chunks.push(Buffer.from(chunk))
        value = Buffer.concat(chunks)
      }
      options?.onUploadProgress?.({ loaded: value.length, total: value.length })
      options?.signal?.throwIfAborted()
      files.set(normalize(name), { contents: value, lastmod: new Date().toISOString() })
      return true
    },
    moveFile: async (source: string, destination: string, options?: { signal?: AbortSignal }) => {
      options?.signal?.throwIfAborted()
      const normalizedSource = normalize(source)
      const normalizedDestination = normalize(destination)
      if (normalizedDestination === failMoveDestination) throw new Error('MOVE rejected by test server')
      const entry = files.get(normalizedSource)
      if (!entry) throw new Error('404')
      files.set(normalizedDestination, entry)
      files.delete(normalizedSource)
      return true
    },
    stat: async (name: string) => {
      if (normalize(name) === failStatPath) throw new Error('stat failed by test server')
      const entry = files.get(normalize(name))
      if (!entry) throw new Error('404')
      return { size: entry.contents.length }
    },
    getQuota: async () => ({ used: 10, available: 1000 }),
  }
  return {
    files, directories, normalize, client,
    failMoveTo(destination = '') { failMoveDestination = destination },
    failReadFrom(source = '') { failReadPath = source },
    failStatFrom(source = '') { failStatPath = source },
  }
})

vi.mock('webdav', () => ({ createClient: () => mock.client }))

import { planWebDavSync, runWebDavSync } from '../electron/providers/webdav.js'
import { readLocalSyncState, readTargetBaseState } from '../electron/sync-state.js'
import type { SyncTarget, WorkspaceProfile } from '../electron/types.js'

const roots: string[] = []
const deviceId = '11111111111111111111111111111111'

async function temporary(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tc-webdav-'))
  roots.push(root)
  return root
}

function fixtures(root: string): [WorkspaceProfile, SyncTarget] {
  return [
    { id: 'workspace', name: 'Notes', path: root, autoSync: true, syncOnFocus: true, state: 'idle', targets: [] },
    { id: 'webdav-target', name: 'WebDAV', enabled: true, maxFileSizeMb: 100, config: { kind: 'webdav', endpoint: 'https://example.test', username: 'user', remotePath: '/warehouse/notes' } },
  ]
}

afterEach(async () => {
  mock.files.clear()
  mock.directories.clear()
  mock.directories.add('/')
  mock.failMoveTo()
  mock.failReadFrom()
  mock.failStatFrom()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('WebDAV provider integration', () => {
  it('rejects a remote path that attempts directory traversal', async () => {
    const root = await temporary()
    const [workspace, target] = fixtures(root)
    if (target.config.kind !== 'webdav') throw new Error('invalid fixture')
    target.config.remotePath = '/../outside'

    await expect(planWebDavSync(workspace, target, deviceId, 'secret')).rejects.toThrow('远端路径无效')
  })

  it('detects and uploads an equal-size content change through state hashes', async () => {
    const root = await temporary()
    await writeFile(path.join(root, 'note.md'), 'aaaa')
    const [workspace, target] = fixtures(root)
    const initial = await planWebDavSync(workspace, target, deviceId, 'secret')
    await runWebDavSync(workspace, target, initial, { preserveLocalOnly: true }, deviceId, 'secret')

    await writeFile(path.join(root, 'note.md'), 'bbbb')
    const changed = await planWebDavSync(workspace, target, deviceId, 'secret')
    expect(changed.issues).toContainEqual(expect.objectContaining({ path: 'note.md', kind: 'conflict' }))
    await runWebDavSync(workspace, target, changed, { preserveLocalOnly: true }, deviceId, 'secret')
    expect(mock.files.get('/warehouse/notes/note.md')?.contents.toString()).toBe('bbbb')
  })

  it('reuses a committed ETag hash without downloading an unchanged large remote file', async () => {
    const root = await temporary()
    await writeFile(path.join(root, 'large.bin'), Buffer.alloc(4 * 1024 * 1024, 0x55))
    const [workspace, target] = fixtures(root)
    await runWebDavSync(workspace, target, await planWebDavSync(workspace, target, deviceId, 'secret'), { preserveLocalOnly: true }, deviceId, 'secret')
    mock.failReadFrom('/warehouse/notes/large.bin')

    const unchanged = await planWebDavSync(workspace, target, deviceId, 'secret')
    expect(unchanged.direction).toBe('none')
  })

  it('accepts the detailed directory response shape returned by the real client', async () => {
    const original = mock.client.getDirectoryContents
    mock.client.getDirectoryContents = async (root: string) => ({ data: await original(root) }) as never
    try {
      const root = await temporary()
      const [workspace, target] = fixtures(root)
      mock.directories.add('/warehouse/notes')
      mock.files.set('/warehouse/notes/cloud.md', { contents: Buffer.from('remote'), lastmod: new Date().toISOString() })
      const plan = await planWebDavSync(workspace, target, deviceId, 'secret')
      expect(plan.issues).toContainEqual({ path: 'cloud.md', kind: 'remote-only' })
    } finally {
      mock.client.getDirectoryContents = original
    }
  })

  it('detects an equal-size difference on a legacy remote without state hashes', async () => {
    const root = await temporary()
    await writeFile(path.join(root, 'note.md'), 'local')
    const [workspace, target] = fixtures(root)
    mock.directories.add('/warehouse/notes')
    mock.files.set('/warehouse/notes/note.md', { contents: Buffer.from('cloud'), lastmod: new Date().toISOString() })

    const plan = await planWebDavSync(workspace, target, deviceId, 'secret')
    expect(plan.direction).toBe('bidirectional')
    expect(plan.issues).toContainEqual(expect.objectContaining({ path: 'note.md', kind: 'conflict' }))
  })

  it('publishes a renamed Chinese display name even when file contents are unchanged', async () => {
    const root = await temporary()
    await writeFile(path.join(root, 'note.md'), 'unchanged')
    const [workspace, target] = fixtures(root)
    await runWebDavSync(workspace, target, await planWebDavSync(workspace, target, deviceId, 'secret'), { preserveLocalOnly: true }, deviceId, 'secret')

    workspace.name = '中文资料'
    const renamePlan = await planWebDavSync(workspace, target, deviceId, 'secret')
    expect(renamePlan.direction).toBe('upload')
    expect(renamePlan.actions).toContain('更新远端资料库中文名称映射')
    await runWebDavSync(workspace, target, renamePlan, { preserveLocalOnly: true }, deviceId, 'secret')

    const state = JSON.parse(mock.files.get('/warehouse/notes/.tianchuang-cloud/state.tc')!.contents.toString()) as { workspaceName?: string }
    expect(state.workspaceName).toBe('中文资料')
  })

  it('downloads an unmanaged remote-only file instead of deleting it', async () => {
    const root = await temporary()
    const [workspace, target] = fixtures(root)
    mock.directories.add('/warehouse/notes')
    mock.files.set('/warehouse/notes/cloud.md', { contents: Buffer.from('remote'), lastmod: new Date().toISOString() })
    const plan = await planWebDavSync(workspace, target, deviceId, 'secret')
    expect(plan.issues).toContainEqual({ path: 'cloud.md', kind: 'remote-only' })
    await runWebDavSync(workspace, target, plan, { preserveLocalOnly: true }, deviceId, 'secret')
    expect(await readFile(path.join(root, 'cloud.md'), 'utf8')).toBe('remote')
  })

  it('ignores an orphaned atomic upload temporary file after an interrupted process', async () => {
    const root = await temporary()
    const [workspace, target] = fixtures(root)
    mock.directories.add('/warehouse/notes')
    mock.files.set(`/warehouse/notes/note.md.tianchuang-${'a'.repeat(32)}.tmp`, { contents: Buffer.from('partial'), lastmod: new Date().toISOString() })

    const plan = await planWebDavSync(workspace, target, deviceId, 'secret')
    expect(plan.issues).not.toContainEqual(expect.objectContaining({ kind: 'remote-only' }))
    expect(plan.direction).toBe('upload')
    expect(plan.actions).toContain('更新远端资料库中文名称映射')
  })

  it('rejects a stale plan when the remote state changes after review', async () => {
    const root = await temporary()
    await writeFile(path.join(root, 'note.md'), 'local')
    const [workspace, target] = fixtures(root)
    const plan = await planWebDavSync(workspace, target, deviceId, 'secret')
    mock.directories.add('/warehouse/notes/.tianchuang-cloud')
    mock.files.set('/warehouse/notes/.tianchuang-cloud/state.tc', { contents: Buffer.from(JSON.stringify({
      schemaVersion: 2, workspaceId: 'workspace', revisionId: 'a'.repeat(32), generation: 1,
      deviceId, createdAt: new Date().toISOString(), files: {}, targetHeads: {},
    })), lastmod: new Date().toISOString() })
    await expect(runWebDavSync(workspace, target, plan, { preserveLocalOnly: true }, deviceId, 'secret')).rejects.toThrow('确认期间')
  })

  it('rejects a stale plan when local content changes after review', async () => {
    const root = await temporary()
    await writeFile(path.join(root, 'note.md'), 'before')
    const [workspace, target] = fixtures(root)
    const plan = await planWebDavSync(workspace, target, deviceId, 'secret')
    await writeFile(path.join(root, 'note.md'), 'after!')

    await expect(runWebDavSync(workspace, target, plan, { preserveLocalOnly: true }, deviceId, 'secret'))
      .rejects.toThrow('本机资料库在确认期间发生变化')
  })

  it('rejects a stale legacy plan when remote files change without a state document', async () => {
    const root = await temporary()
    const [workspace, target] = fixtures(root)
    mock.directories.add('/warehouse/notes')
    mock.files.set('/warehouse/notes/cloud.md', { contents: Buffer.from('before'), lastmod: '2026-01-01T00:00:00.000Z' })
    const plan = await planWebDavSync(workspace, target, deviceId, 'secret')
    mock.files.set('/warehouse/notes/cloud.md', { contents: Buffer.from('after!'), lastmod: '2026-01-01T00:01:00.000Z' })

    await expect(runWebDavSync(workspace, target, plan, { preserveLocalOnly: true }, deviceId, 'secret'))
      .rejects.toThrow('WebDAV 文件在确认期间已经变化')
  })

  it('does not publish state or advance local baselines when the server rejects the atomic MOVE', async () => {
    const root = await temporary()
    await writeFile(path.join(root, 'note.md'), 'pending upload')
    const [workspace, target] = fixtures(root)
    const plan = await planWebDavSync(workspace, target, deviceId, 'secret')
    mock.failMoveTo('/warehouse/notes/.tianchuang-cloud/state.tc')

    await expect(runWebDavSync(workspace, target, plan, { preserveLocalOnly: true }, deviceId, 'secret'))
      .rejects.toThrow('MOVE rejected')

    expect(mock.files.has('/warehouse/notes/note.md')).toBe(true)
    expect(mock.files.has('/warehouse/notes/.tianchuang-cloud/state.tc')).toBe(false)
    expect([...mock.files.keys()].some((name) => name.endsWith('.tmp'))).toBe(false)
    expect(await readLocalSyncState(root)).toBeUndefined()
    expect(await readTargetBaseState(root, target.id)).toBeUndefined()
  })

  it('keeps the previous remote file when an atomic content MOVE fails', async () => {
    const root = await temporary()
    await writeFile(path.join(root, 'note.md'), 'new-longer-content')
    const [workspace, target] = fixtures(root)
    mock.directories.add('/warehouse/notes')
    mock.files.set('/warehouse/notes/note.md', { contents: Buffer.from('old-content'), lastmod: new Date().toISOString() })
    const plan = await planWebDavSync(workspace, target, deviceId, 'secret')
    mock.failMoveTo('/warehouse/notes/note.md')

    await expect(runWebDavSync(workspace, target, plan, { preserveLocalOnly: true }, deviceId, 'secret'))
      .rejects.toThrow('MOVE rejected')

    expect(mock.files.get('/warehouse/notes/note.md')?.contents.toString()).toBe('old-content')
    expect([...mock.files.keys()].some((name) => name.endsWith('.tmp'))).toBe(false)
    expect(await readLocalSyncState(root)).toBeUndefined()
  })

  it('restores a pending remote deletion when publishing the new state fails', async () => {
    const root = await temporary()
    await writeFile(path.join(root, 'note.md'), 'keep me until commit')
    const [workspace, target] = fixtures(root)
    await runWebDavSync(workspace, target, await planWebDavSync(workspace, target, deviceId, 'secret'), { preserveLocalOnly: true }, deviceId, 'secret')

    await rm(path.join(root, 'note.md'))
    const deletion = await planWebDavSync(workspace, target, deviceId, 'secret')
    expect(deletion.issues).toContainEqual({ path: 'note.md', kind: 'remote-delete' })
    mock.failMoveTo('/warehouse/notes/.tianchuang-cloud/state.tc')

    await expect(runWebDavSync(workspace, target, deletion, { preserveLocalOnly: true, deleteRemote: true }, deviceId, 'secret'))
      .rejects.toThrow('MOVE rejected')
    expect(mock.files.get('/warehouse/notes/note.md')?.contents.toString()).toBe('keep me until commit')
    expect([...mock.files.keys()].some((name) => name.includes('.tianchuang-delete-'))).toBe(false)
  })

  it('recovers an interrupted staged deletion before planning', async () => {
    const root = await temporary()
    const [workspace, target] = fixtures(root)
    mock.directories.add('/warehouse/notes')
    mock.files.set(`/warehouse/notes/note.md.tianchuang-delete-${'b'.repeat(32)}.tmp`, { contents: Buffer.from('recover me'), lastmod: new Date().toISOString() })

    const plan = await planWebDavSync(workspace, target, deviceId, 'secret')
    expect(mock.files.get('/warehouse/notes/note.md')?.contents.toString()).toBe('recover me')
    expect([...mock.files.keys()].some((name) => name.includes('.tianchuang-delete-'))).toBe(false)
    expect(plan.issues).toContainEqual({ path: 'note.md', kind: 'remote-only' })
  })

  it('fails the sync instead of silently skipping an unreadable remote-only file', async () => {
    const root = await temporary()
    const [workspace, target] = fixtures(root)
    mock.directories.add('/warehouse/notes')
    mock.files.set('/warehouse/notes/cloud.md', { contents: Buffer.from('remote'), lastmod: new Date().toISOString() })
    const plan = await planWebDavSync(workspace, target, deviceId, 'secret')
    mock.failReadFrom('/warehouse/notes/cloud.md')

    await expect(runWebDavSync(workspace, target, plan, { preserveLocalOnly: true }, deviceId, 'secret'))
      .rejects.toThrow('read failed')
    expect(await readLocalSyncState(root)).toBeUndefined()
    expect(mock.files.has('/warehouse/notes/.tianchuang-cloud/state.tc')).toBe(false)
  })

  it('does not treat a state-document read failure as a missing legacy state', async () => {
    const root = await temporary()
    const [workspace, target] = fixtures(root)
    mock.directories.add('/warehouse/notes')
    mock.failReadFrom('/warehouse/notes/.tianchuang-cloud/state.tc')

    await expect(planWebDavSync(workspace, target, deviceId, 'secret')).rejects.toThrow('read failed')
  })

  it('aborts execution when the reviewed state document becomes unreadable', async () => {
    const root = await temporary()
    await writeFile(path.join(root, 'note.md'), 'first')
    const [workspace, target] = fixtures(root)
    await runWebDavSync(workspace, target, await planWebDavSync(workspace, target, deviceId, 'secret'), { preserveLocalOnly: true }, deviceId, 'secret')
    await writeFile(path.join(root, 'note.md'), 'second')
    const plan = await planWebDavSync(workspace, target, deviceId, 'secret')
    mock.failReadFrom('/warehouse/notes/.tianchuang-cloud/state.tc')

    await expect(runWebDavSync(workspace, target, plan, { preserveLocalOnly: true }, deviceId, 'secret'))
      .rejects.toThrow('read failed')
  })

  it('does not treat a remote stat failure as a missing file', async () => {
    const root = await temporary()
    await writeFile(path.join(root, 'note.md'), 'pending')
    const [workspace, target] = fixtures(root)
    const plan = await planWebDavSync(workspace, target, deviceId, 'secret')
    mock.failStatFrom('/warehouse/notes/note.md')

    await expect(runWebDavSync(workspace, target, plan, { preserveLocalOnly: true }, deviceId, 'secret'))
      .rejects.toThrow('stat failed')
    expect(mock.files.has('/warehouse/notes/note.md')).toBe(false)
  })

  it('aborts an upload and leaves no remote temporary or state file', async () => {
    const root = await temporary()
    await writeFile(path.join(root, 'large.bin'), Buffer.alloc(8 * 1024 * 1024, 0x7a))
    const [workspace, target] = fixtures(root)
    const plan = await planWebDavSync(workspace, target, deviceId, 'secret')
    const controller = new AbortController()

    await expect(runWebDavSync(workspace, target, plan, { preserveLocalOnly: true }, deviceId, 'secret', {
      signal: controller.signal,
      onTransferProgress: () => controller.abort(new DOMException('test cancellation', 'AbortError')),
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(mock.files.has('/warehouse/notes/large.bin')).toBe(false)
    expect(mock.files.has('/warehouse/notes/.tianchuang-cloud/state.tc')).toBe(false)
    expect([...mock.files.keys()].some((name) => name.endsWith('.tmp'))).toBe(false)
    expect(await readLocalSyncState(root)).toBeUndefined()
  })
})
