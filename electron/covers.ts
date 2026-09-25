import { copyFile, readFile, readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg'])
const COVER_NAMES = ['.tianchuang-cover', 'tianchuang-cover', 'cover', 'folder']

export async function findWorkspaceCover(folderPath: string): Promise<string | undefined> {
  const files = await readdir(folderPath, { withFileTypes: true }).catch(() => [])
  for (const baseName of COVER_NAMES) {
    const match = files.find((item) => item.isFile()
      && path.parse(item.name).name.toLowerCase() === baseName
      && IMAGE_EXTENSIONS.has(path.extname(item.name).toLowerCase()))
    if (match) return path.join(folderPath, match.name)
  }
  return undefined
}

export async function copyWorkspaceCover(folderPath: string, sourcePath: string): Promise<string> {
  const extension = path.extname(sourcePath).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(extension)) throw new Error('请选择 PNG、JPG、WebP、GIF、AVIF 或 SVG 图片')
  const sourceInfo = await stat(sourcePath).catch(() => undefined)
  if (!sourceInfo?.isFile() || sourceInfo.size > 12 * 1024 * 1024) throw new Error('封面图片不可访问或超过 12 MB')
  const destination = path.join(folderPath, `.tianchuang-cover${extension}`)
  const existing = await readdir(folderPath, { withFileTypes: true }).catch(() => [])
  await Promise.all(existing
    .filter((item) => item.isFile() && path.parse(item.name).name.toLowerCase() === '.tianchuang-cover')
    .map((item) => path.join(folderPath, item.name))
    .filter((filePath) => path.resolve(filePath) !== path.resolve(sourcePath) && path.resolve(filePath) !== path.resolve(destination))
    .map((filePath) => unlink(filePath).catch(() => undefined)))
  if (path.resolve(sourcePath) !== path.resolve(destination)) await copyFile(sourcePath, destination)
  return destination
}

export async function coverDataUrl(filePath?: string): Promise<string | undefined> {
  if (!filePath) return undefined
  const info = await stat(filePath).catch(() => undefined)
  if (!info?.isFile() || info.size > 12 * 1024 * 1024) return undefined
  const mime: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  }
  const extension = path.extname(filePath).toLowerCase()
  if (!mime[extension]) return undefined
  return `data:${mime[extension]};base64,${(await readFile(filePath)).toString('base64')}`
}

export const coverFileFilters = [{ name: '图片', extensions: [...IMAGE_EXTENSIONS].map((item) => item.slice(1)) }]
