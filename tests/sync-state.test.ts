import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanFiles } from '../electron/files.js'
import {
  buildWorkspaceSyncState, createRevisionId, parseLegacyPaths, parseSyncState,
  readLocalSyncState, readTargetBaseState, SYNC_STATE_FILE, writeLocalSyncState, writeTargetBaseState, writeTextAtomically,
} from '../electron/sync-state.js'

const folders: string[] = []

async function folder(): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), 'tc-state-'))
  folders.push(value)
  return value
}

afterEach(async () => Promise.all(folders.splice(0).map((value) => rm(value, { recursive: true, force: true }))))

describe('workspace sync state', () => {
  it('creates 32-character lowercase hexadecimal revision identifiers', () => {
    expect(createRevisionId()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('keeps a revision for unchanged content and advances it after an edit', async () => {
    const root = await folder()
    const note = path.join(root, 'note.md')
    await writeFile(note, 'one')
    const deviceId = createRevisionId()
    const first = await buildWorkspaceSyncState({ workspaceId: 'workspace', deviceId, files: await scanFiles(root), now: '2026-11-02T00:00:00.000Z' })
    const unchanged = await buildWorkspaceSyncState({ workspaceId: 'workspace', deviceId, files: await scanFiles(root), previous: first })
    expect(unchanged.revisionId).toBe(first.revisionId)
    expect(unchanged.generation).toBe(1)

    await writeFile(note, 'two')
    const edited = await buildWorkspaceSyncState({ workspaceId: 'workspace', deviceId, files: await scanFiles(root), previous: unchanged })
    expect(edited.revisionId).not.toBe(first.revisionId)
    expect(edited.parentRevisionId).toBe(first.revisionId)
    expect(edited.generation).toBe(2)
  })

  it('persists the original display name and preserves it during restore scans', async () => {
    const root = await folder()
    await writeFile(path.join(root, 'note.md'), '内容')
    const deviceId = createRevisionId()
    const original = await buildWorkspaceSyncState({ workspaceId: 'workspace', workspaceName: '干物妹 小埋', deviceId, files: await scanFiles(root) })
    const restored = await buildWorkspaceSyncState({ workspaceId: 'workspace', deviceId, files: await scanFiles(root), previous: original })
    expect(restored.workspaceName).toBe('干物妹 小埋')
    expect(parseSyncState(JSON.stringify(restored))?.workspaceName).toBe('干物妹 小埋')
  })

  it('advances the revision when only the display name changes', async () => {
    const root = await folder()
    await writeFile(path.join(root, 'note.md'), 'unchanged')
    const deviceId = createRevisionId()
    const original = await buildWorkspaceSyncState({ workspaceId: 'workspace', workspaceName: '旧名称', deviceId, files: await scanFiles(root) })
    const renamed = await buildWorkspaceSyncState({ workspaceId: 'workspace', workspaceName: '新名称', deviceId, files: await scanFiles(root), previous: original })

    expect(renamed.workspaceName).toBe('新名称')
    expect(renamed.revisionId).not.toBe(original.revisionId)
    expect(renamed.parentRevisionId).toBe(original.revisionId)
    expect(renamed.generation).toBe(original.generation + 1)
  })

  it('records deletions as tombstones', async () => {
    const root = await folder()
    const note = path.join(root, 'old.md')
    await writeFile(note, 'remove me')
    const deviceId = createRevisionId()
    const first = await buildWorkspaceSyncState({ workspaceId: 'workspace', deviceId, files: await scanFiles(root) })
    await rm(note)
    const next = await buildWorkspaceSyncState({ workspaceId: 'workspace', deviceId, files: await scanFiles(root), previous: first })
    expect(next.files['old.md']).toMatchObject({ deleted: true, fileId: first.files['old.md'].fileId })
  })

  it('writes atomically and validates untrusted state', async () => {
    const root = await folder()
    await writeFile(path.join(root, 'note.md'), 'safe')
    const state = await buildWorkspaceSyncState({ workspaceId: 'workspace', deviceId: createRevisionId(), files: await scanFiles(root) })
    await writeLocalSyncState(root, state)
    expect((await readLocalSyncState(root))?.revisionId).toBe(state.revisionId)
    expect((await stat(path.join(root, ...SYNC_STATE_FILE.split('/')))).isFile()).toBe(true)
    const text = await readFile(path.join(root, ...SYNC_STATE_FILE.split('/')), 'utf8')
    expect(parseSyncState(text)?.files['note.md'].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(parseSyncState(text.replace('note.md', '../escape.md'))).toBeUndefined()
  })

  it('only treats a missing state as optional and surfaces other I/O errors', async () => {
    const root = await folder()
    expect(await readLocalSyncState(root)).toBeUndefined()
    await mkdir(path.join(root, ...SYNC_STATE_FILE.split('/')), { recursive: true })
    await expect(readLocalSyncState(root)).rejects.toMatchObject({ code: expect.stringMatching(/EISDIR|EPERM|EACCES/) })
  })

  it('keeps the confirmed file unchanged when a temporary write runs out of disk space', async () => {
    const destination = 'memory/state.tc'
    const files = new Map<string, string>([[destination, 'confirmed']])
    let temporaryPath = ''
    const diskFull = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })

    await expect(writeTextAtomically(destination, 'unconfirmed', {
      createParent: async () => undefined,
      writeTemporary: async (filePath, contents) => {
        temporaryPath = filePath
        files.set(filePath, contents.slice(0, 3))
        throw diskFull
      },
      replace: async (source, target) => { files.set(target, files.get(source) ?? '') },
      removeTemporary: async (filePath) => { files.delete(filePath) },
    })).rejects.toMatchObject({ code: 'ENOSPC' })

    expect(files.get(destination)).toBe('confirmed')
    expect(temporaryPath).toMatch(/\.tmp$/)
    expect(files.has(temporaryPath)).toBe(false)
  })

  it('keeps the confirmed file and removes the temporary file when atomic replacement fails', async () => {
    const destination = 'memory/state.tc'
    const files = new Map<string, string>([[destination, 'confirmed']])
    let temporaryPath = ''

    await expect(writeTextAtomically(destination, 'unconfirmed', {
      createParent: async () => undefined,
      writeTemporary: async (filePath, contents) => {
        temporaryPath = filePath
        files.set(filePath, contents)
      },
      replace: async () => { throw new Error('replacement interrupted') },
      removeTemporary: async (filePath) => { files.delete(filePath) },
    })).rejects.toThrow('replacement interrupted')

    expect(files.get(destination)).toBe('confirmed')
    expect(files.has(temporaryPath)).toBe(false)
  })

  it('reads legacy managed file lists for migration', () => {
    expect(parseLegacyPaths(JSON.stringify({ version: 1, files: ['note.md', '../bad'], updatedAt: 'x' }))).toEqual(['note.md'])
  })

  it('keeps an independent comparison baseline for each target', async () => {
    const root = await folder()
    await writeFile(path.join(root, 'note.md'), 'baseline')
    const state = await buildWorkspaceSyncState({ workspaceId: 'workspace', deviceId: createRevisionId(), files: await scanFiles(root) })
    await writeTargetBaseState(root, 'target-one', state)
    expect((await readTargetBaseState(root, 'target-one'))?.revisionId).toBe(state.revisionId)
    expect(await readTargetBaseState(root, 'target-two')).toBeUndefined()
  })
})
