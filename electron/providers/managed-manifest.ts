export const MANIFEST_DIRECTORY = '.tianchuang-cloud'
export const MANIFEST_FILE = `${MANIFEST_DIRECTORY}/manifest.json`

interface ManagedManifest {
  version: 1
  files: string[]
  updatedAt: string
}

export function parseManagedManifest(value: string | Buffer | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value.toString()) as Partial<ManagedManifest>
    if (parsed.version !== 1 || !Array.isArray(parsed.files)) return []
    return parsed.files.filter((item): item is string => {
      if (typeof item !== 'string' || !item || item.startsWith('/') || item.startsWith('\\')) return false
      const segments = item.replaceAll('\\', '/').split('/')
      return !segments.some((segment) => segment === '' || segment === '.' || segment === '..')
        && segments[0] !== MANIFEST_DIRECTORY
    })
  } catch {
    return []
  }
}

export function deletedManagedFiles(previous: string[], current: string[]): string[] {
  const currentPaths = new Set(current)
  return previous.filter((file) => !currentPaths.has(file)).sort((left, right) => left.localeCompare(right))
}

export function serializeManagedManifest(files: string[]): string {
  const manifest: ManagedManifest = {
    version: 1,
    files: [...new Set(files)].sort((left, right) => left.localeCompare(right)),
    updatedAt: new Date().toISOString(),
  }
  return `${JSON.stringify(manifest, null, 2)}\n`
}
