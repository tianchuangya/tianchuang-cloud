import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { planLocalSync, runLocalSync } from '../electron/providers/local.js'
import { scanFiles } from '../electron/files.js'
import { readLocalSyncState } from '../electron/sync-state.js'
import type { SyncTarget, WorkspaceProfile } from '../electron/types.js'

const temporaryFolders: string[] = []

async function temporaryFolder(): Promise<string> {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'tianchuang-cloud-'))
  temporaryFolders.push(folder)
  return folder
}

function fixtures(source: string, destination: string): [WorkspaceProfile, SyncTarget] {
  return [
    { id: 'workspace', name: 'Notes', path: source, autoSync: true, syncOnFocus: true, state: 'idle', targets: [] },
    { id: 'target', name: 'Backup', enabled: true, maxFileSizeMb: 2048, config: { kind: 'local', destinationPath: destination } },
  ]
}

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

describe('local mirror provider', () => {
  it('rejects a configured mirror directory that escapes the selected destination', async () => {
    const source = await temporaryFolder()
    const destination = await temporaryFolder()
    const [workspace, target] = fixtures(source, destination)
    if (target.config.kind !== 'local') throw new Error('invalid fixture')
    target.config.remoteDirectory = '../outside'

    await expect(planLocalSync(workspace, target)).rejects.toThrow('子目录名称无效')
  })

  it('rejects a mirror destination inside the source workspace to prevent recursive backups', async () => {
    const source = await temporaryFolder()
    const [workspace, target] = fixtures(source, source)
    if (target.config.kind !== 'local') throw new Error('invalid fixture')
    target.config.remoteDirectory = 'nested-backup'

    await expect(planLocalSync(workspace, target)).rejects.toThrow('递归备份')
  })

  it('copies new files and skips unchanged content on the next plan', async () => {
    const source = await temporaryFolder()
    const destination = await temporaryFolder()
    await mkdir(path.join(source, '课程'), { recursive: true })
    await writeFile(path.join(source, '课程', '笔记.md'), '# 第一章\n')
    const [workspace, target] = fixtures(source, destination)

    const firstPlan = await planLocalSync(workspace, target)
    expect(firstPlan.direction).toBe('upload')
    expect(firstPlan.metadata.changed).toBe(1)

    const result = await runLocalSync(workspace, target, firstPlan, { preserveLocalOnly: true })
    expect(result).toContain('1 个文件')
    expect(await readFile(path.join(destination, 'Notes', '课程', '笔记.md'), 'utf8')).toBe('# 第一章\n')

    const secondPlan = await planLocalSync(workspace, target)
    expect(secondPlan.direction).toBe('none')
  })

  it('detects a same-size local edit through the synchronized state hash', async () => {
    const source = await temporaryFolder()
    const destination = await temporaryFolder()
    await writeFile(path.join(source, 'same.md'), 'aaaa')
    const [workspace, target] = fixtures(source, destination)
    const initial = await planLocalSync(workspace, target)
    await runLocalSync(workspace, target, initial, { preserveLocalOnly: true })
    await writeFile(path.join(source, 'same.md'), 'bbbb')

    const changed = await planLocalSync(workspace, target)
    expect(changed.issues).toContainEqual(expect.objectContaining({ path: 'same.md', kind: 'conflict' }))
    await runLocalSync(workspace, target, changed, { preserveLocalOnly: true })
    expect(await readFile(path.join(destination, 'Notes', 'same.md'), 'utf8')).toBe('bbbb')
  })

  it('updates the remote display-name mapping without moving a stable mirror directory', async () => {
    const source = await temporaryFolder()
    const destination = await temporaryFolder()
    await writeFile(path.join(source, 'note.md'), 'unchanged')
    const [workspace, target] = fixtures(source, destination)
    if (target.config.kind !== 'local') throw new Error('invalid fixture')
    target.config.remoteDirectory = 'stable-library-key'
    await runLocalSync(workspace, target, await planLocalSync(workspace, target), { preserveLocalOnly: true })

    workspace.name = '中文资料'
    const renamePlan = await planLocalSync(workspace, target)
    expect(renamePlan.direction).toBe('upload')
    expect(renamePlan.actions).toContain('更新镜像中的资料库中文名称映射')
    await runLocalSync(workspace, target, renamePlan, { preserveLocalOnly: true })

    expect((await readLocalSyncState(path.join(destination, 'stable-library-key')))?.workspaceName).toBe('中文资料')
    expect(await readFile(path.join(destination, 'stable-library-key', 'note.md'), 'utf8')).toBe('unchanged')
  })

  it('rejects a stale plan when local content changes after review', async () => {
    const source = await temporaryFolder()
    const destination = await temporaryFolder()
    await writeFile(path.join(source, 'note.md'), 'before')
    const [workspace, target] = fixtures(source, destination)
    const plan = await planLocalSync(workspace, target)
    await writeFile(path.join(source, 'note.md'), 'after!')

    await expect(runLocalSync(workspace, target, plan, { preserveLocalOnly: true }))
      .rejects.toThrow('本机资料库在确认期间发生变化')
  })

  it('rejects a stale legacy plan when mirror files change without a state document', async () => {
    const source = await temporaryFolder()
    const destination = await temporaryFolder()
    const backupRoot = path.join(destination, 'Notes')
    await mkdir(backupRoot, { recursive: true })
    await writeFile(path.join(backupRoot, 'cloud.md'), 'before')
    const [workspace, target] = fixtures(source, destination)
    const plan = await planLocalSync(workspace, target)
    await writeFile(path.join(backupRoot, 'cloud.md'), 'after!')

    await expect(runLocalSync(workspace, target, plan, { preserveLocalOnly: true }))
      .rejects.toThrow('镜像文件在确认期间已经变化')
  })

  it('requires explicit confirmation before deleting a previously managed backup', async () => {
    const source = await temporaryFolder()
    const destination = await temporaryFolder()
    await writeFile(path.join(source, 'obsolete.md'), 'remove later')
    const [workspace, target] = fixtures(source, destination)
    const firstPlan = await planLocalSync(workspace, target)
    await runLocalSync(workspace, target, firstPlan, { preserveLocalOnly: true })
    await rm(path.join(source, 'obsolete.md'))

    const deletePlan = await planLocalSync(workspace, target)
    expect(deletePlan.requiresConfirmation).toBe(true)
    expect(deletePlan.issues).toContainEqual({ path: 'obsolete.md', kind: 'remote-delete' })
    await expect(runLocalSync(workspace, target, deletePlan, { preserveLocalOnly: true })).rejects.toThrow('明确确认')

    await runLocalSync(workspace, target, deletePlan, { preserveLocalOnly: true, deleteRemote: true })
    await expect(readFile(path.join(destination, 'Notes', 'obsolete.md'))).rejects.toThrow()
  })

  it('recovers an interrupted staged mirror deletion before planning', async () => {
    const source = await temporaryFolder()
    const destination = await temporaryFolder()
    const backupRoot = path.join(destination, 'Notes')
    await mkdir(backupRoot, { recursive: true })
    await writeFile(path.join(backupRoot, `recover.md.tianchuang-delete-${'c'.repeat(32)}.tmp`), 'recover me')
    const [workspace, target] = fixtures(source, destination)

    const plan = await planLocalSync(workspace, target)
    expect(await readFile(path.join(backupRoot, 'recover.md'), 'utf8')).toBe('recover me')
    expect(plan.issues).toContainEqual({ path: 'recover.md', kind: 'remote-only' })
  })

  it('cancels a large mirror copy without publishing a partial file or state', async () => {
    const source = await temporaryFolder()
    const destination = await temporaryFolder()
    await writeFile(path.join(source, 'large.bin'), Buffer.alloc(8 * 1024 * 1024, 0x6b))
    const [workspace, target] = fixtures(source, destination)
    const plan = await planLocalSync(workspace, target)
    const controller = new AbortController()

    await expect(runLocalSync(workspace, target, plan, { preserveLocalOnly: true }, undefined, {
      signal: controller.signal,
      onTransferProgress: () => controller.abort(new DOMException('test cancellation', 'AbortError')),
    })).rejects.toMatchObject({ name: 'AbortError' })

    await expect(readFile(path.join(destination, 'Notes', 'large.bin'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await scanFiles(path.join(destination, 'Notes'))).map((file) => file.relativePath)).toEqual([])
    expect(await readLocalSyncState(source)).toBeUndefined()
  })

  it('requires confirmation before overwriting a newer destination file', async () => {
    const source = await temporaryFolder()
    const destination = await temporaryFolder()
    const backupRoot = path.join(destination, 'Notes')
    await mkdir(backupRoot, { recursive: true })
    await writeFile(path.join(source, 'note.md'), 'local')
    await writeFile(path.join(backupRoot, 'note.md'), 'newer remote copy')
    const future = new Date(Date.now() + 10_000)
    await utimes(path.join(backupRoot, 'note.md'), future, future)
    const [workspace, target] = fixtures(source, destination)

    const plan = await planLocalSync(workspace, target)
    expect(plan.direction).toBe('bidirectional')
    expect(plan.issues).toContainEqual(expect.objectContaining({ path: 'note.md', kind: 'conflict' }))

    await runLocalSync(workspace, target, plan, { preserveLocalOnly: false })
    expect(await readFile(path.join(source, 'note.md'), 'utf8')).toBe('newer remote copy')
  })

  it('blocks the plan when a file exceeds the target size limit', async () => {
    const source = await temporaryFolder()
    const destination = await temporaryFolder()
    await writeFile(path.join(source, 'huge.bin'), Buffer.alloc(2 * 1024 * 1024))
    const [workspace, target] = fixtures(source, destination)
    target.maxFileSizeMb = 1

    const plan = await planLocalSync(workspace, target)
    expect(plan.direction).toBe('blocked')
    expect(plan.issues[0]).toMatchObject({ path: 'huge.bin', kind: 'too-large' })
  })

  it('offers mirror-only files for download instead of deleting or ignoring them', async () => {
    const source = await temporaryFolder()
    const destination = await temporaryFolder()
    await writeFile(path.join(source, 'note.md'), 'local')
    const [workspace, target] = fixtures(source, destination)
    const firstPlan = await planLocalSync(workspace, target)
    await runLocalSync(workspace, target, firstPlan, { preserveLocalOnly: true })
    await writeFile(path.join(destination, 'Notes', 'from-other-device.md'), 'foreign content')

    const plan = await planLocalSync(workspace, target)
    expect(plan.direction).toBe('bidirectional')
    expect(plan.issues).toContainEqual({ path: 'from-other-device.md', kind: 'remote-only' })

    await runLocalSync(workspace, target, plan, { preserveLocalOnly: true, deleteRemote: false })
    expect(await readFile(path.join(source, 'from-other-device.md'), 'utf8')).toBe('foreign content')

    const settled = await planLocalSync(workspace, target)
    expect(settled.direction).toBe('none')
  })

  it('offers cloud content for download instead of deletion on a freshly restored workspace', async () => {
    const source = await temporaryFolder()
    const destination = await temporaryFolder()
    const backupRoot = path.join(destination, 'Notes')
    await mkdir(backupRoot, { recursive: true })
    await writeFile(path.join(backupRoot, 'cloud.md'), 'cloud content')
    await mkdir(path.join(backupRoot, '.tianchuang-cloud'), { recursive: true })
    await writeFile(path.join(backupRoot, '.tianchuang-cloud', 'manifest.json'), JSON.stringify({ version: 1, files: ['cloud.md'], updatedAt: '2026-01-01T00:00:00.000Z' }))
    const workspace = { id: 'workspace', name: 'Notes', path: source, autoSync: false, syncOnFocus: false, state: 'idle', targets: [], freshRestore: true }

    const plan = await planLocalSync(workspace, { id: 'target', name: 'Backup', enabled: true, maxFileSizeMb: 2048, config: { kind: 'local', destinationPath: destination } })
    expect(plan.issues).toContainEqual({ path: 'cloud.md', kind: 'remote-only' })
    expect(plan.issues.some((issue) => issue.kind === 'remote-delete')).toBe(false)

    await runLocalSync(workspace, { id: 'target', name: 'Backup', enabled: true, maxFileSizeMb: 2048, config: { kind: 'local', destinationPath: destination } }, plan, { preserveLocalOnly: true })
    expect(await readFile(path.join(source, 'cloud.md'), 'utf8')).toBe('cloud content')
  })

  it('ignores repository metadata and dependency folders', async () => {
    const source = await temporaryFolder()
    await mkdir(path.join(source, '.git'), { recursive: true })
    await mkdir(path.join(source, 'node_modules', 'package'), { recursive: true })
    await writeFile(path.join(source, '.git', 'config'), 'secret')
    await writeFile(path.join(source, 'node_modules', 'package', 'index.js'), 'large dependency')
    await writeFile(path.join(source, 'README.md'), 'kept')

    const files = await scanFiles(source)
    expect(files.map((file) => file.relativePath)).toEqual(['README.md'])
  })
})
