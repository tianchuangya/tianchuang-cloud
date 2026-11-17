import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { copyFileAtomically, scanFiles, writeFileAtomically, writeReadableAtomically } from '../electron/files.js'

const folders: string[] = []

async function folder(): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), 'tc-atomic-file-'))
  folders.push(value)
  return value
}

afterEach(async () => Promise.all(folders.splice(0).map((value) => rm(value, { recursive: true, force: true }))))

describe('atomic file replacement', () => {
  it('replaces a file only after the complete temporary write succeeds', async () => {
    const root = await folder()
    const destination = path.join(root, 'note.md')
    await writeFile(destination, 'confirmed')

    await writeFileAtomically(destination, Buffer.from('complete replacement'))

    expect(await readFile(destination, 'utf8')).toBe('complete replacement')
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('keeps the confirmed destination and removes the temporary file when copying fails', async () => {
    const root = await folder()
    const destination = path.join(root, 'note.md')
    await writeFile(destination, 'confirmed')

    await expect(copyFileAtomically(path.join(root, 'missing.md'), destination)).rejects.toMatchObject({ code: 'ENOENT' })

    expect(await readFile(destination, 'utf8')).toBe('confirmed')
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('keeps the confirmed destination when an independent writer process is killed before replacement', async () => {
    const root = await folder()
    const destination = path.join(root, 'note.md')
    const temporary = `${destination}.tianchuang-${'a'.repeat(32)}.tmp`
    await writeFile(destination, 'confirmed')
    const fixture = fileURLToPath(new URL('./fixtures/atomic-write-child.mjs', import.meta.url))
    const child = spawn(process.execPath, [fixture, temporary, 'unconfirmed'], { stdio: ['ignore', 'pipe', 'pipe'] })

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('child writer did not reach the temporary-file checkpoint')), 5000)
      child.once('error', reject)
      child.stdout.on('data', (chunk) => {
        if (!String(chunk).includes('TEMPORARY_READY')) return
        clearTimeout(timeout)
        resolve()
      })
    })
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
    child.kill()
    await closed

    expect(await readFile(destination, 'utf8')).toBe('confirmed')
    expect(await readFile(temporary, 'utf8')).toBe('unconfirmed')
    expect((await scanFiles(root)).map((file) => file.relativePath)).toEqual(['note.md'])
    await rm(temporary)
  })

  it('keeps the confirmed file and removes the partial temporary file when the destination reports disk full', async () => {
    const root = await folder()
    const destination = path.join(root, 'large.bin')
    await writeFile(destination, 'confirmed')
    let temporaryPath = ''
    const diskFull = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })

    await expect(writeReadableAtomically(Readable.from(Buffer.alloc(2 * 1024 * 1024, 0x62)), destination, {
      createDestinationStream: (temporary) => {
        temporaryPath = temporary
        let written = 0
        return new Writable({
          write(chunk: Buffer, _encoding, callback) {
            written += chunk.length
            callback(written >= 512 * 1024 ? diskFull : undefined)
          },
        })
      },
    })).rejects.toMatchObject({ code: 'ENOSPC' })

    expect(await readFile(destination, 'utf8')).toBe('confirmed')
    expect(temporaryPath).toMatch(/\.tmp$/)
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('survives killing the real atomic-copy process and completes on retry', async () => {
    const root = await folder()
    const destination = path.join(root, 'large.bin')
    await writeFile(destination, 'confirmed')
    const fixture = fileURLToPath(new URL('./fixtures/slow-atomic-copy-child.mjs', import.meta.url))
    const child = spawn(process.execPath, ['--experimental-strip-types', fixture, destination], { stdio: ['ignore', 'pipe', 'pipe'] })

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('slow copy did not create a growing temporary file')), 10_000)
      child.once('error', reject)
      const poll = setInterval(async () => {
        const temporary = (await readdir(root)).find((name) => name.endsWith('.tmp'))
        if (!temporary) return
        clearInterval(poll)
        clearTimeout(timeout)
        resolve()
      }, 10)
    })
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
    child.kill('SIGKILL')
    await closed

    expect(await readFile(destination, 'utf8')).toBe('confirmed')
    expect((await scanFiles(root)).map((file) => file.relativePath)).toEqual(['large.bin'])
    await writeReadableAtomically(Readable.from(Buffer.from('retry-complete')), destination)
    expect(await readFile(destination, 'utf8')).toBe('retry-complete')
    for (const name of await readdir(root)) if (name.endsWith('.tmp')) await rm(path.join(root, name), { force: true })
  }, 20_000)
})
