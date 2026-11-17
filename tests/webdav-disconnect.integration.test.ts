import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { planWebDavSync, runWebDavSync } from '../electron/providers/webdav.js'
import type { SyncTarget, WorkspaceProfile } from '../electron/types.js'

const roots: string[] = []
const children: ChildProcess[] = []

async function temporary(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

async function startServer(port: number, physicalRoot: string): Promise<ChildProcess> {
  const fixture = fileURLToPath(new URL('./fixtures/webdav-server-child.mjs', import.meta.url))
  const child = spawn(process.execPath, [fixture, String(port), physicalRoot], { stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebDAV fault server did not start')), 10_000)
    child.once('error', reject)
    child.stdout!.on('data', (chunk) => {
      if (!String(chunk).includes('WEBDAV_SERVER_READY')) return
      clearTimeout(timeout)
      resolve()
    })
  })
  return child
}

async function killServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
  if (!child.killed) child.kill('SIGKILL')
  await Promise.race([
    closed,
    new Promise<void>((resolve) => setTimeout(resolve, 5000)),
  ])
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(killServer))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
}, 60_000)

describe('WebDAV transport interruption', () => {
  it('does not publish state after the server dies mid-upload and succeeds after restart', async () => {
    const port = 18_700 + Math.floor(Math.random() * 500)
    const serverRoot = await temporary('tc-webdav-disconnect-server-')
    const workspaceRoot = await temporary('tc-webdav-disconnect-workspace-')
    await writeFile(path.join(workspaceRoot, 'large.bin'), Buffer.alloc(32 * 1024 * 1024, 0x64))
    const endpoint = `http://127.0.0.1:${port}`
    const workspace: WorkspaceProfile = { id: 'disconnect-workspace', name: '断网测试', path: workspaceRoot, autoSync: false, syncOnFocus: false, state: 'idle', targets: [] }
    const target: SyncTarget = { id: 'disconnect-target', name: 'Fault WebDAV', enabled: true, maxFileSizeMb: 128, config: { kind: 'webdav', endpoint, username: '', remotePath: '/fault/library' } }
    const firstServer = await startServer(port, serverRoot)
    const plan = await planWebDavSync(workspace, target)
    let killed = false

    await expect(runWebDavSync(workspace, target, plan, { preserveLocalOnly: true }, undefined, '', {
      onTransferProgress: () => {
        if (killed) return
        killed = true
        void killServer(firstServer)
      },
    })).rejects.toThrow()

    await startServer(port, serverRoot)
    const retry = await planWebDavSync(workspace, target)
    expect(retry.direction).toBe('upload')
    await runWebDavSync(workspace, target, retry, { preserveLocalOnly: true })
    expect(await readFile(path.join(serverRoot, 'fault', 'library', 'large.bin'))).toHaveLength(32 * 1024 * 1024)
    expect(await readFile(path.join(serverRoot, 'fault', 'library', '.tianchuang-cloud', 'state.tc'), 'utf8')).toContain('disconnect-workspace')
  }, 120_000)
})
