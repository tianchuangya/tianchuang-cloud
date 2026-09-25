import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { planLocalSync, runLocalSync } from '../electron/providers/local.js'
import { scanFiles } from '../electron/files.js'
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
    expect(plan.requiresConfirmation).toBe(true)
    expect(plan.issues).toContainEqual({ path: 'note.md', kind: 'conflict' })
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
