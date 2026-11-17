import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { afterEach, describe, expect, it } from 'vitest'
import { deleteWarehouseLibraryBackup, planWarehouseGitSync, runWarehouseGitSync } from '../electron/providers/warehouse-git.js'
import { readLocalSyncState, readTargetBaseState } from '../electron/sync-state.js'
import type { SyncTarget, WorkspaceProfile } from '../electron/types.js'

const roots: string[] = []
const deviceId = '11111111111111111111111111111111'

async function temporary(name: string): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), `tc-warehouse-${name}-`))
  roots.push(value)
  return value
}

function fixtures(id: string, root: string, remote: string): [WorkspaceProfile, SyncTarget] {
  return [
    { id, name: id, path: root, autoSync: true, syncOnFocus: true, state: 'idle', targets: [] },
    { id: `target-${id}`, name: 'Warehouse', enabled: true, maxFileSizeMb: 100, config: { kind: 'git', provider: 'generic', remoteUrl: remote, branch: 'main', warehouse: true, libraryId: id } },
  ]
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('shared Git Warehouse provider', () => {
  it('stores multiple workspaces in isolated library directories without overwriting each other', async () => {
    const remote = await temporary('remote')
    await simpleGit(remote).init(true)
    const cache = await temporary('cache')
    const firstRoot = await temporary('first')
    const secondRoot = await temporary('second')
    await writeFile(path.join(firstRoot, 'first.md'), 'first library')
    await writeFile(path.join(secondRoot, 'second.md'), 'second library')
    const [first, firstTarget] = fixtures('library-one', firstRoot, remote)
    const [second, secondTarget] = fixtures('library-two', secondRoot, remote)

    const firstPlan = await planWarehouseGitSync(first, firstTarget, cache, deviceId)
    expect(firstPlan.direction).toBe('upload')
    await runWarehouseGitSync(first, firstTarget, firstPlan, { preserveLocalOnly: true }, cache, deviceId)

    const secondPlan = await planWarehouseGitSync(second, secondTarget, cache, deviceId)
    expect(secondPlan.direction).toBe('upload')
    await runWarehouseGitSync(second, secondTarget, secondPlan, { preserveLocalOnly: true }, cache, deviceId)

    const inspection = await temporary('inspection')
    await rm(inspection, { recursive: true, force: true })
    await simpleGit().clone(remote, inspection, ['--branch', 'main'])
    expect(await readFile(path.join(inspection, 'libraries', 'library-one', 'files', 'first.md'), 'utf8')).toBe('first library')
    expect(await readFile(path.join(inspection, 'libraries', 'library-two', 'files', 'second.md'), 'utf8')).toBe('second library')
    expect(await readFile(path.join(inspection, '.tc-cloud', 'libraries', 'library-one.json'), 'utf8')).toContain('"schemaVersion": 2')
    expect((await planWarehouseGitSync(first, firstTarget, cache, deviceId)).direction).toBe('none')

    await deleteWarehouseLibraryBackup(first, firstTarget, cache)
    const afterDelete = await temporary('after-delete')
    await rm(afterDelete, { recursive: true, force: true })
    await simpleGit().clone(remote, afterDelete, ['--branch', 'main'])
    await expect(readFile(path.join(afterDelete, 'libraries', 'library-one', 'files', 'first.md'))).rejects.toThrow()
    expect(await readFile(path.join(afterDelete, 'libraries', 'library-two', 'files', 'second.md'), 'utf8')).toBe('second library')
  })

  it('restores a Warehouse-only file into an empty workspace with the same library id', async () => {
    const remote = await temporary('restore-remote')
    await simpleGit(remote).init(true)
    const cache = await temporary('restore-cache')
    const sourceRoot = await temporary('source')
    await writeFile(path.join(sourceRoot, 'cloud.md'), 'from warehouse')
    const [source, sourceTarget] = fixtures('shared-library', sourceRoot, remote)
    const upload = await planWarehouseGitSync(source, sourceTarget, cache, deviceId)
    await runWarehouseGitSync(source, sourceTarget, upload, { preserveLocalOnly: true }, cache, deviceId)

    const restoredRoot = await temporary('restored')
    await mkdir(restoredRoot, { recursive: true })
    const [restored, restoredTarget] = fixtures('shared-library', restoredRoot, remote)
    restored.freshRestore = true
    const restorePlan = await planWarehouseGitSync(restored, restoredTarget, cache, '22222222222222222222222222222222')
    expect(restorePlan.issues).toContainEqual({ path: 'cloud.md', kind: 'remote-only' })
    await runWarehouseGitSync(restored, restoredTarget, restorePlan, { preserveLocalOnly: true }, cache, '22222222222222222222222222222222')
    expect(await readFile(path.join(restoredRoot, 'cloud.md'), 'utf8')).toBe('from warehouse')
  })

  it('publishes a renamed Chinese display name without moving the stable library directory', async () => {
    const remote = await temporary('rename-remote')
    await simpleGit(remote).init(true)
    const cache = await temporary('rename-cache')
    const root = await temporary('rename-root')
    await writeFile(path.join(root, 'note.md'), 'unchanged')
    const [workspace, target] = fixtures('stable-library', root, remote)
    await runWarehouseGitSync(workspace, target, await planWarehouseGitSync(workspace, target, cache, deviceId), { preserveLocalOnly: true }, cache, deviceId)

    workspace.name = '中文资料'
    const renamePlan = await planWarehouseGitSync(workspace, target, cache, deviceId)
    expect(renamePlan.direction).toBe('upload')
    expect(renamePlan.actions).toContain('更新 Warehouse 中的资料库中文名称映射')
    await runWarehouseGitSync(workspace, target, renamePlan, { preserveLocalOnly: true }, cache, deviceId)

    const inspection = await temporary('rename-inspection')
    await rm(inspection, { recursive: true, force: true })
    await simpleGit().clone(remote, inspection, ['--branch', 'main'])
    const state = JSON.parse(await readFile(path.join(inspection, '.tc-cloud', 'libraries', 'stable-library.json'), 'utf8')) as { workspaceName?: string }
    expect(state.workspaceName).toBe('中文资料')
    expect(await readFile(path.join(inspection, 'libraries', 'stable-library', 'files', 'note.md'), 'utf8')).toBe('unchanged')
  })

  it('detects concurrent edits from the per-target base and can keep the remote version', async () => {
    const remote = await temporary('conflict-remote')
    await simpleGit(remote).init(true)
    const cache = await temporary('conflict-cache')
    const firstRoot = await temporary('conflict-first')
    await writeFile(path.join(firstRoot, 'shared.md'), 'base')
    const [first, firstTarget] = fixtures('conflict-library', firstRoot, remote)
    const initial = await planWarehouseGitSync(first, firstTarget, cache, deviceId)
    await runWarehouseGitSync(first, firstTarget, initial, { preserveLocalOnly: true }, cache, deviceId)

    const secondRoot = await temporary('conflict-second')
    const [second, secondTarget] = fixtures('conflict-library', secondRoot, remote)
    const restore = await planWarehouseGitSync(second, secondTarget, cache, '22222222222222222222222222222222')
    await runWarehouseGitSync(second, secondTarget, restore, { preserveLocalOnly: true }, cache, '22222222222222222222222222222222')

    await writeFile(path.join(secondRoot, 'shared.md'), 'second device edit')
    await writeFile(path.join(firstRoot, 'shared.md'), 'first device edit')
    const firstEdit = await planWarehouseGitSync(first, firstTarget, cache, deviceId)
    await runWarehouseGitSync(first, firstTarget, firstEdit, { preserveLocalOnly: true }, cache, deviceId)

    const conflict = await planWarehouseGitSync(second, secondTarget, cache, '22222222222222222222222222222222')
    expect(conflict.issues).toContainEqual(expect.objectContaining({ path: 'shared.md', kind: 'conflict' }))
    await runWarehouseGitSync(second, secondTarget, conflict, { preserveLocalOnly: false }, cache, '22222222222222222222222222222222')
    expect(await readFile(path.join(secondRoot, 'shared.md'), 'utf8')).toBe('first device edit')
  })

  it('rejects a plan when local files change while confirmation is open', async () => {
    const remote = await temporary('local-stale-remote')
    await simpleGit(remote).init(true)
    const cache = await temporary('local-stale-cache')
    const root = await temporary('local-stale-root')
    await writeFile(path.join(root, 'note.md'), 'planned content')
    const [workspace, target] = fixtures('local-stale-library', root, remote)
    const plan = await planWarehouseGitSync(workspace, target, cache, deviceId)

    await writeFile(path.join(root, 'note.md'), 'edited after planning')

    await expect(runWarehouseGitSync(workspace, target, plan, { preserveLocalOnly: true }, cache, deviceId))
      .rejects.toThrow('本机资料库在确认期间发生变化')
  })

  it('can adopt a legacy Warehouse directory that has files but no state document', async () => {
    const remote = await temporary('legacy-remote')
    await simpleGit(remote).init(true)
    const seed = await temporary('legacy-seed')
    const git = simpleGit(seed)
    await git.init()
    await git.addConfig('user.name', 'Warehouse Test')
    await git.addConfig('user.email', 'warehouse@example.test')
    await mkdir(path.join(seed, 'libraries', 'legacy-library', 'files'), { recursive: true })
    await writeFile(path.join(seed, 'libraries', 'legacy-library', 'files', 'cloud.md'), 'legacy content')
    await git.add('.').commit('legacy warehouse').branch(['-M', 'main']).addRemote('origin', remote).push('origin', 'main')

    const cache = await temporary('legacy-cache')
    const root = await temporary('legacy-root')
    const [workspace, target] = fixtures('legacy-library', root, remote)
    const plan = await planWarehouseGitSync(workspace, target, cache, deviceId)
    expect(plan.issues).toContainEqual({ path: 'cloud.md', kind: 'remote-only' })

    await runWarehouseGitSync(workspace, target, plan, { preserveLocalOnly: true }, cache, deviceId)
    expect(await readFile(path.join(root, 'cloud.md'), 'utf8')).toBe('legacy content')
  })

  it('does not advance the local baseline when the remote rejects a push', async () => {
    const remote = await temporary('rejected-remote')
    await simpleGit(remote).init(true)
    const hook = path.join(remote, 'hooks', 'pre-receive')
    await writeFile(hook, '#!/bin/sh\necho rejected-by-test >&2\nexit 1\n', 'utf8')
    await chmod(hook, 0o755)
    const cache = await temporary('rejected-cache')
    const root = await temporary('rejected-root')
    await writeFile(path.join(root, 'note.md'), 'must stay pending')
    const [workspace, target] = fixtures('rejected-library', root, remote)
    const plan = await planWarehouseGitSync(workspace, target, cache, deviceId)

    await expect(runWarehouseGitSync(workspace, target, plan, { preserveLocalOnly: true }, cache, deviceId))
      .rejects.toThrow()
    expect(await readLocalSyncState(root)).toBeUndefined()
    expect(await readTargetBaseState(root, target.id)).toBeUndefined()
  })
})
