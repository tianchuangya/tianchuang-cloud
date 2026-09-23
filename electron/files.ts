import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, opendir, stat } from 'node:fs/promises'
import path from 'node:path'

const IGNORED_DIRECTORIES = new Set(['.git', '.tianchuang-cloud', 'node_modules', '.DS_Store'])

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
        const info = await stat(absolutePath)
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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
