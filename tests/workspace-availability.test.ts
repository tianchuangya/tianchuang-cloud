import { mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { workspaceSourceAvailable } from '../electron/workspace-availability.js'

const roots: string[] = []

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('automatic sync source availability', () => {
  it('accepts directories and rejects missing paths or files', async () => {
    const root = path.join(os.tmpdir(), `tc-cloud-availability-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    roots.push(root)
    await mkdir(root, { recursive: true })
    const file = path.join(root, 'note.md')
    await writeFile(file, 'content')

    expect(await workspaceSourceAvailable(root)).toBe(true)
    expect(await workspaceSourceAvailable(file)).toBe(false)
    expect(await workspaceSourceAvailable(path.join(root, 'missing'))).toBe(false)
  })
})
