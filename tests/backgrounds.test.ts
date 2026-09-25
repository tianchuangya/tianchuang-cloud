import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { clearCustomBackground, copyCustomBackground, findCustomBackground, imageDataUrl } from '../electron/backgrounds.js'

const temporaryFolders: string[] = []

async function temporaryFolder(): Promise<string> {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'tianchuang-background-'))
  temporaryFolders.push(folder)
  return folder
}

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

describe('custom application backgrounds', () => {
  it('copies and reads a selected background', async () => {
    const folder = await temporaryFolder()
    const source = path.join(folder, 'source.png')
    await writeFile(source, Buffer.from([1, 2, 3]))

    const result = await copyCustomBackground(path.join(folder, 'appearance'), source)

    expect(await findCustomBackground(path.join(folder, 'appearance'))).toBe(result)
    expect(await imageDataUrl(result)).toBe('data:image/png;base64,AQID')
  })

  it('keeps only the latest app-owned background and can reset it', async () => {
    const folder = await temporaryFolder()
    const appearance = path.join(folder, 'appearance')
    const png = path.join(folder, 'first.png')
    const jpg = path.join(folder, 'second.jpg')
    await writeFile(png, Buffer.from([1]))
    await writeFile(jpg, Buffer.from([2]))

    await copyCustomBackground(appearance, png)
    await copyCustomBackground(appearance, jpg)
    expect(await readdir(appearance)).toEqual(['custom-background.jpg'])

    await clearCustomBackground(appearance)
    expect(await findCustomBackground(appearance)).toBeUndefined()
  })
})
