import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { afterEach, describe, expect, it } from 'vitest'
import { planGitSync, runGitSync } from '../electron/providers/git.js'
import { buildWorkspaceSyncState, readLocalSyncState, readTargetBaseState, writeLocalSyncState } from '../electron/sync-state.js'
import { scanFiles } from '../electron/files.js'
import type { SyncTarget, WorkspaceProfile } from '../electron/types.js'

const temporaryFolders: string[] = []

async function temporaryFolder(name: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `tianchuang-git-${name}-`))
  temporaryFolders.push(root)
  return root
}

async function configure(folder: string): Promise<void> {
  const git = simpleGit(folder)
  await git.addConfig('user.name', 'Test User')
  await git.addConfig('user.email', 'test@example.com')
}

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

describe('git sync planning', () => {
  it('detects a clean repository without proposing a duplicate upload', async () => {
    const remote = await temporaryFolder('remote')
    await simpleGit(remote).init(true)
    const seed = await temporaryFolder('seed')
    await simpleGit(seed).init()
    await configure(seed)
    await writeFile(path.join(seed, 'note.md'), 'version one')
    await writeLocalSyncState(seed, await buildWorkspaceSyncState({
      workspaceId: 'workspace',
      workspaceName: 'Notes',
      deviceId: '00000000000000000000000000000001',
      files: await scanFiles(seed),
    }))
    await simpleGit(seed).add('.').commit('initial').branch(['-M', 'main']).addRemote('origin', remote).push('origin', 'main')
    const local = await temporaryFolder('local')
    await simpleGit().clone(remote, local, ['--branch', 'main'])
    const workspace: WorkspaceProfile = { id: 'workspace', name: 'Notes', path: local, autoSync: true, syncOnFocus: true, state: 'idle', targets: [] }
    const target: SyncTarget = { id: 'target', name: 'Git', enabled: true, maxFileSizeMb: 100, config: { kind: 'git', remoteUrl: remote, branch: 'main', provider: 'generic' } }

    const plan = await planGitSync(workspace, target)
    expect(plan.direction).toBe('none')
    expect(plan.actions).toEqual(['无需传输'])
  })

  it('uploads the original Chinese display name even when user files are unchanged', async () => {
    const remote = await temporaryFolder('name-remote')
    await simpleGit(remote).init(true)
    const local = await temporaryFolder('name-local')
    const git = simpleGit(local)
    await git.init()
    await configure(local)
    await writeFile(path.join(local, 'note.md'), 'unchanged note')
    const legacyState = await buildWorkspaceSyncState({
      workspaceId: 'workspace',
      deviceId: '00000000000000000000000000000001',
      files: await scanFiles(local),
    })
    await writeLocalSyncState(local, legacyState)
    await git.add('.').commit('initial without display name').branch(['-M', 'main']).addRemote('origin', remote).push('origin', 'main')
    const workspace: WorkspaceProfile = { id: 'workspace', name: '干物妹 小埋', path: local, autoSync: true, syncOnFocus: true, state: 'idle', targets: [] }
    const target: SyncTarget = { id: 'target', name: 'Git', enabled: true, maxFileSizeMb: 100, config: { kind: 'git', remoteUrl: remote, branch: 'main', provider: 'generic' } }

    const plan = await planGitSync(workspace, target)
    expect(plan.direction).toBe('upload')
    expect(plan.actions).toContain('更新资料库中文名称映射')
    await runGitSync(workspace, target, plan, { preserveLocalOnly: true })

    expect((await readLocalSyncState(local))?.workspaceName).toBe('干物妹 小埋')
    const remoteState = JSON.parse(await simpleGit(remote).raw(['show', 'main:.tianchuang-cloud/state.tc'])) as { workspaceName?: string }
    expect(remoteState.workspaceName).toBe('干物妹 小埋')
  })

  it('asks before merging a remote update with a local-only note', async () => {
    const remote = await temporaryFolder('remote')
    await simpleGit(remote).init(true)
    const seed = await temporaryFolder('seed')
    await simpleGit(seed).init()
    await configure(seed)
    await writeFile(path.join(seed, 'shared.md'), 'version one')
    await simpleGit(seed).add('.').commit('initial').branch(['-M', 'main']).addRemote('origin', remote).push('origin', 'main')
    const local = await temporaryFolder('local')
    await simpleGit().clone(remote, local, ['--branch', 'main'])
    await writeFile(path.join(local, 'pc-only.md'), 'keep this note')
    await writeFile(path.join(seed, 'laptop-only.md'), 'new remote note')
    await simpleGit(seed).add('.').commit('remote update').push('origin', 'main')
    const workspace: WorkspaceProfile = { id: 'workspace', name: 'Notes', path: local, autoSync: true, syncOnFocus: true, state: 'idle', targets: [] }
    const target: SyncTarget = { id: 'target', name: 'Git', enabled: true, maxFileSizeMb: 100, config: { kind: 'git', remoteUrl: remote, branch: 'main', provider: 'generic' } }

    const plan = await planGitSync(workspace, target)
    expect(plan.direction).toBe('bidirectional')
    expect(plan.requiresConfirmation).toBe(true)
    expect(plan.issues).toContainEqual({ path: 'pc-only.md', kind: 'local-only' })
    expect(plan.metadata.behind).toBe(1)
  })

  it('renames a first local master branch and pushes it to main', async () => {
    const remote = await temporaryFolder('empty-remote')
    await simpleGit(remote).init(true)
    const local = await temporaryFolder('master-local')
    const git = simpleGit(local)
    await git.init()
    await configure(local)
    await writeFile(path.join(local, 'note.md'), 'first version')
    await git.add('.').commit('initial')
    const workspace: WorkspaceProfile = { id: 'workspace', name: 'Notes', path: local, autoSync: true, syncOnFocus: true, state: 'idle', targets: [] }
    const target: SyncTarget = { id: 'target', name: 'GitHub', enabled: true, maxFileSizeMb: 100, config: { kind: 'git', remoteUrl: remote, branch: 'main', provider: 'github' } }

    const plan = await planGitSync(workspace, target)
    expect(plan.direction).toBe('upload')
    await runGitSync(workspace, target, plan, { preserveLocalOnly: true })

    expect((await git.revparse(['--abbrev-ref', 'HEAD'])).trim()).toBe('main')
    expect((await simpleGit().listRemote(['--heads', remote, 'main'])).trim()).not.toBe('')
  })

  it('clones remote history into an empty folder on a new device', async () => {
    const remote = await temporaryFolder('remote')
    await simpleGit(remote).init(true)
    const seed = await temporaryFolder('seed')
    await simpleGit(seed).init()
    await configure(seed)
    await writeFile(path.join(seed, 'shared.md'), 'shared version')
    await simpleGit(seed).add('.').commit('initial').branch(['-M', 'main']).addRemote('origin', remote).push('origin', 'main')
    const local = await temporaryFolder('fresh-device')
    const workspace: WorkspaceProfile = { id: 'workspace', name: 'Notes', path: local, autoSync: false, syncOnFocus: true, state: 'idle', targets: [] }
    const target: SyncTarget = { id: 'target', name: 'GitHub', enabled: true, maxFileSizeMb: 100, config: { kind: 'git', remoteUrl: remote, branch: 'main', provider: 'github' } }

    const plan = await planGitSync(workspace, target)
    expect(plan.direction).toBe('bidirectional')
    await runGitSync(workspace, target, plan, { preserveLocalOnly: true })

    expect(await readFile(path.join(local, 'shared.md'), 'utf8')).toBe('shared version')
    expect((await simpleGit(local).raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('main')
  })

  it('requires explicit confirmation before pushing a tracked deletion', async () => {
    const remote = await temporaryFolder('delete-remote')
    await simpleGit(remote).init(true)
    const local = await temporaryFolder('delete-local')
    const git = simpleGit(local)
    await git.init()
    await configure(local)
    await writeFile(path.join(local, 'obsolete.md'), 'tracked')
    await git.add('.').commit('initial').branch(['-M', 'main']).addRemote('origin', remote).push('origin', 'main')
    await rm(path.join(local, 'obsolete.md'))
    const workspace: WorkspaceProfile = { id: 'workspace', name: 'Notes', path: local, autoSync: true, syncOnFocus: true, state: 'idle', targets: [] }
    const target: SyncTarget = { id: 'target', name: 'Git', enabled: true, maxFileSizeMb: 100, config: { kind: 'git', remoteUrl: remote, branch: 'main', provider: 'generic' } }

    const plan = await planGitSync(workspace, target)
    expect(plan.requiresConfirmation).toBe(true)
    expect(plan.issues).toContainEqual({ path: 'obsolete.md', kind: 'remote-delete' })
    await expect(runGitSync(workspace, target, plan, { preserveLocalOnly: true })).rejects.toThrow('明确确认')
  })

  it('rejects a plan if a new tracked deletion appears after review', async () => {
    const remote = await temporaryFolder('stale-local-remote')
    await simpleGit(remote).init(true)
    const local = await temporaryFolder('stale-local')
    const git = simpleGit(local)
    await git.init()
    await configure(local)
    await writeFile(path.join(local, 'keep.md'), 'tracked')
    await git.add('.').commit('initial').branch(['-M', 'main']).addRemote('origin', remote).push('origin', 'main')
    await writeFile(path.join(local, 'new.md'), 'planned upload')
    const workspace: WorkspaceProfile = { id: 'workspace', name: 'Notes', path: local, autoSync: true, syncOnFocus: true, state: 'idle', targets: [] }
    const target: SyncTarget = { id: 'target', name: 'Git', enabled: true, maxFileSizeMb: 100, config: { kind: 'git', remoteUrl: remote, branch: 'main', provider: 'generic' } }
    const plan = await planGitSync(workspace, target)

    await rm(path.join(local, 'keep.md'))

    await expect(runGitSync(workspace, target, plan, { preserveLocalOnly: true }))
      .rejects.toThrow('本机资料库在确认期间发生变化')
  })

  it('does not advance the local revision or target baseline when the remote rejects a push', async () => {
    const remote = await temporaryFolder('rejected-remote')
    await simpleGit(remote).init(true)
    const hook = path.join(remote, 'hooks', 'pre-receive')
    await writeFile(hook, '#!/bin/sh\necho rejected-by-test >&2\nexit 1\n', 'utf8')
    await chmod(hook, 0o755)

    const local = await temporaryFolder('rejected-local')
    const git = simpleGit(local)
    await git.init()
    await configure(local)
    await writeFile(path.join(local, 'note.md'), 'pending upload')
    await git.add('.').commit('local work').branch(['-M', 'main'])
    const confirmedHead = (await git.revparse(['HEAD'])).trim()
    const workspace: WorkspaceProfile = { id: 'workspace', name: 'Notes', path: local, autoSync: true, syncOnFocus: true, state: 'idle', targets: [] }
    const target: SyncTarget = { id: 'target', name: 'Git', enabled: true, maxFileSizeMb: 100, config: { kind: 'git', remoteUrl: remote, branch: 'main', provider: 'generic' } }

    const plan = await planGitSync(workspace, target)
    await expect(runGitSync(workspace, target, plan, { preserveLocalOnly: true })).rejects.toThrow(/rejected|failed to push/i)

    expect(await readLocalSyncState(local)).toBeUndefined()
    expect(await readTargetBaseState(local, target.id)).toBeUndefined()
    expect((await git.revparse(['HEAD'])).trim()).toBe(confirmedHead)
    expect((await simpleGit().listRemote(['--heads', remote, 'main'])).trim()).toBe('')
    expect((await planGitSync(workspace, target)).direction).toBe('upload')
  })
})
