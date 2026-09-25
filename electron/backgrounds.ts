import { copyFile, mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg'])
const CUSTOM_BACKGROUND_PREFIX = 'custom-background'

export const backgroundFileFilters = [{ name: '背景图片', extensions: [...IMAGE_EXTENSIONS].map((item) => item.slice(1)) }]

export async function findCustomBackground(folderPath: string): Promise<string | undefined> {
  const files = await readdir(folderPath, { withFileTypes: true }).catch(() => [])
  const match = files.find((item) => item.isFile()
    && path.parse(item.name).name.toLowerCase() === CUSTOM_BACKGROUND_PREFIX
    && IMAGE_EXTENSIONS.has(path.extname(item.name).toLowerCase()))
  return match ? path.join(folderPath, match.name) : undefined
}

export async function clearCustomBackground(folderPath: string): Promise<void> {
  const files = await readdir(folderPath, { withFileTypes: true }).catch(() => [])
  await Promise.all(files
    .filter((item) => item.isFile() && path.parse(item.name).name.toLowerCase() === CUSTOM_BACKGROUND_PREFIX)
    .map((item) => unlink(path.join(folderPath, item.name)).catch(() => undefined)))
}

export async function copyCustomBackground(folderPath: string, sourcePath: string): Promise<string> {
  const extension = path.extname(sourcePath).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(extension)) throw new Error('请选择 PNG、JPG、WebP、GIF、AVIF 或 SVG 图片')
  const info = await stat(sourcePath).catch(() => undefined)
  if (!info?.isFile() || info.size > 20 * 1024 * 1024) throw new Error('背景图片不可访问或超过 20 MB')
  await mkdir(folderPath, { recursive: true })
  await clearCustomBackground(folderPath)
  const destination = path.join(folderPath, `${CUSTOM_BACKGROUND_PREFIX}${extension}`)
  await copyFile(sourcePath, destination)
  return destination
}

export async function imageDataUrl(filePath?: string): Promise<string | undefined> {
  if (!filePath) return undefined
  const info = await stat(filePath).catch(() => undefined)
  if (!info?.isFile() || info.size > 20 * 1024 * 1024) return undefined
  const mime: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  }
  const type = mime[path.extname(filePath).toLowerCase()]
  return type ? `data:${type};base64,${(await readFile(filePath)).toString('base64')}` : undefined
}
