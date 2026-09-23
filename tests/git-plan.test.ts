import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { afterEach, describe, expect, it } from 'vitest'
import { planGitSync } from '../electron/providers/git.js'
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
    await simpleGit(seed).add('.').commit('initial').branch(['-M', 'main']).addRemote('origin', remote).push('origin', 'main')
    const local = await temporaryFolder('local')
    await simpleGit().clone(remote, local, ['--branch', 'main'])
    const workspace: WorkspaceProfile = { id: 'workspace', name: 'Notes', path: local, autoSync: true, syncOnFocus: true, state: 'idle', targets: [] }
    const target: SyncTarget = { id: 'target', name: 'Git', enabled: true, maxFileSizeMb: 100, config: { kind: 'git', remoteUrl: remote, branch: 'main', provider: 'generic' } }

    const plan = await planGitSync(workspace, target)
    expect(plan.direction).toBe('none')
    expect(plan.actions).toEqual(['无需传输'])
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
})
