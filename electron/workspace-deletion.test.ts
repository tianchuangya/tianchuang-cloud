import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertSafeWorkspaceDelete, deleteWorkspaceFolder, removeWorkspaceMetadata } from './workspace-deletion.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('workspace deletion safety', () => {
  it('removes only generated metadata during a normal removal', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tc-remove-'))
    roots.push(root)
    await mkdir(path.join(root, '.tianchuang-cloud'), { recursive: true })
    await writeFile(path.join(root, '.tianchuang-cloud', 'state.tc'), 'state')
    await writeFile(path.join(root, '.tianchuang-cover.jpg'), 'cover')
    await writeFile(path.join(root, '.tianchuang-background.png'), 'background')
    await writeFile(path.join(root, 'notes.md'), 'keep')
    await removeWorkspaceMetadata(root)
    expect(await readFile(path.join(root, 'notes.md'), 'utf8')).toBe('keep')
    await expect(readFile(path.join(root, '.tianchuang-cloud', 'state.tc'))).rejects.toThrow()
    await expect(readFile(path.join(root, '.tianchuang-cover.jpg'))).rejects.toThrow()
  })

  it('rejects roots, the home folder, and a folder containing the running app', () => {
    expect(() => assertSafeWorkspaceDelete(path.parse(process.cwd()).root, process.cwd())).toThrow('安全保护')
    expect(() => assertSafeWorkspaceDelete(os.homedir(), process.cwd())).toThrow('安全保护')
    expect(() => assertSafeWorkspaceDelete(path.dirname(process.cwd()), process.cwd())).toThrow('当前应用')
  })

  it('permanently deletes an explicitly selected workspace folder', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'tc-delete-'))
    const target = path.join(parent, 'library')
    roots.push(parent)
    await mkdir(target)
    await writeFile(path.join(target, 'notes.md'), 'delete')
    await deleteWorkspaceFolder(target, process.cwd())
    await expect(readFile(path.join(target, 'notes.md'))).rejects.toThrow()
  })
})
