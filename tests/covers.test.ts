import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { copyWorkspaceCover, coverDataUrl, findWorkspaceCover } from '../electron/covers.js'

const temporaryFolders: string[] = []

async function temporaryFolder(): Promise<string> {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'tianchuang-cover-'))
  temporaryFolders.push(folder)
  return folder
}

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

describe('workspace covers', () => {
  it('finds supported conventional cover names', async () => {
    const folder = await temporaryFolder()
    await writeFile(path.join(folder, 'cover.png'), Buffer.from([1, 2, 3]))

    expect(await findWorkspaceCover(folder)).toBe(path.join(folder, 'cover.png'))
  })

  it('copies a cover into the workspace and replaces an older generated format', async () => {
    const folder = await temporaryFolder()
    const first = path.join(folder, 'first.png')
    const second = path.join(folder, 'second.jpg')
    await writeFile(first, Buffer.from([1, 2, 3]))
    await writeFile(second, Buffer.from([4, 5, 6]))

    await copyWorkspaceCover(folder, first)
    const result = await copyWorkspaceCover(folder, second)
    const generated = (await readdir(folder)).filter((name) => name.startsWith('.tianchuang-cover.'))

    expect(result).toBe(path.join(folder, '.tianchuang-cover.jpg'))
    expect(generated).toEqual(['.tianchuang-cover.jpg'])
    expect(await coverDataUrl(result)).toBe('data:image/jpeg;base64,BAUG')
  })

  it('rejects unsupported cover formats', async () => {
    const folder = await temporaryFolder()
    const source = path.join(folder, 'cover.txt')
    await writeFile(source, 'not an image')

    await expect(copyWorkspaceCover(folder, source)).rejects.toThrow('请选择 PNG')
  })
})
