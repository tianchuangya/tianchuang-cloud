import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream as createFileWriteStream } from 'node:fs'
import { copyFile, mkdir, opendir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Transform, type Readable, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const IGNORED_DIRECTORIES = new Set(['.git', '.tianchuang-cloud', 'node_modules', '.DS_Store'])
const ATOMIC_TEMPORARY_FILE = /\.tianchuang-[0-9a-f]{32}\.tmp$/
const STAGED_DELETE_FILE = /\.tianchuang-delete-[0-9a-f]{32}\.tmp$/

export interface ScannedFile {
  absolutePath: string
  relativePath: string
  size: number
  modifiedAt: number
}

export async function scanFiles(root: string): Promise<ScannedFile[]> {
  const files: ScannedFile[] = []

  async function walk(directory: string): Promise<void> {
    const handle = await opendir(directory)
    for await (const entry of handle) {
      if (entry.isSymbolicLink() || IGNORED_DIRECTORIES.has(entry.name)) continue
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolutePath)
      } else if (entry.isFile()) {
        if (ATOMIC_TEMPORARY_FILE.test(entry.name) || STAGED_DELETE_FILE.test(entry.name)) continue
        const info = await stat(absolutePath).catch(() => undefined)
        if (!info?.isFile()) continue
        files.push({
          absolutePath,
          relativePath: path.relative(root, absolutePath).split(path.sep).join('/'),
          size: info.size,
          modifiedAt: info.mtimeMs,
        })
      }
    }
  }

  await walk(root)
  return files
}

export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export async function ensureParent(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
}

async function replaceFromTemporary(destination: string, transfer: (temporary: string) => Promise<unknown>): Promise<void> {
  await ensureParent(destination)
  const temporary = `${destination}.tianchuang-${randomUUID().replaceAll('-', '')}.tmp`
  try {
    await transfer(temporary)
    await rename(temporary, destination)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => { /* preserve the transfer failure */ })
    throw error
  }
}

export interface TransferOptions {
  signal?: AbortSignal
  onProgress?: (bytes: number) => void
  /** Test/fault-injection seam; production uses node:fs createWriteStream. */
  createDestinationStream?: (temporaryPath: string) => Writable
}

function progressTransform(onProgress?: (bytes: number) => void): Transform {
  let transferred = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      transferred += chunk.length
      onProgress?.(transferred)
      callback(null, chunk)
    },
  })
}

export async function writeReadableAtomically(source: Readable, destination: string, options: TransferOptions = {}): Promise<void> {
  await replaceFromTemporary(destination, async (temporary) => {
    const destinationStream = options.createDestinationStream?.(temporary) ?? createFileWriteStream(temporary)
    await pipeline(source, progressTransform(options.onProgress), destinationStream, { signal: options.signal })
  })
}

export async function copyFileAtomically(source: string, destination: string, options: TransferOptions = {}): Promise<void> {
  if (!options.signal && !options.onProgress) {
    await replaceFromTemporary(destination, (temporary) => copyFile(source, temporary))
    return
  }
  await writeReadableAtomically(createReadStream(source), destination, options)
}

export async function writeFileAtomically(destination: string, contents: string | Uint8Array): Promise<void> {
  await replaceFromTemporary(destination, (temporary) => writeFile(temporary, contents))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
