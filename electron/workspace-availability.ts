import { stat } from 'node:fs/promises'

export async function workspaceSourceAvailable(folderPath: string): Promise<boolean> {
  const info = await stat(folderPath).catch(() => undefined)
  return info?.isDirectory() === true
}
