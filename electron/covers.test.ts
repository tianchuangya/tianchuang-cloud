import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyWorkspaceBackground, findWorkspaceBackground } from './covers.js'

const temporaryFolders: string[] = []

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

describe('workspace background files', () => {
  it('copies the selected background into the workspace and replaces an older format', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'tc-cover-workspace-'))
    const sources = await mkdtemp(path.join(os.tmpdir(), 'tc-cover-source-'))
    temporaryFolders.push(workspace, sources)
    const first = path.join(sources, 'first.jpg')
    const second = path.join(sources, 'second.png')
    await writeFile(first, Buffer.from('first-background'))
    await writeFile(second, Buffer.from('second-background'))

    await copyWorkspaceBackground(workspace, first)
    const destination = await copyWorkspaceBackground(workspace, second)

    expect(path.basename(destination)).toBe('.tianchuang-background.png')
    expect(await findWorkspaceBackground(workspace)).toBe(destination)
    expect((await readFile(destination)).toString()).toBe('second-background')
    await expect(readFile(path.join(workspace, '.tianchuang-background.jpg'))).rejects.toThrow()
  })

  it('rejects unsupported background files', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'tc-cover-workspace-'))
    const source = path.join(workspace, 'background.txt')
    temporaryFolders.push(workspace)
    await writeFile(source, 'not an image')
    await expect(copyWorkspaceBackground(workspace, source)).rejects.toThrow('请选择')
  })
})
