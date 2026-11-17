const THUMBNAILS = Array.from({ length: 10 }, (_, index) => `./assets/library-defaults/thumbnail-${String(index + 1).padStart(2, '0')}.jpg`)
const BACKGROUNDS = Array.from({ length: 10 }, (_, index) => `./assets/library-defaults/background-${String(index + 1).padStart(2, '0')}.jpg`)

function stableIndex(value: string, length: number, salt: number): number {
  let hash = (2166136261 ^ salt) >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash % length
}

/** Workspace ids are random and stable, so this appears random on import but remains identical after restart. */
export function defaultWorkspaceThumbnail(workspaceId: string): string {
  return THUMBNAILS[stableIndex(workspaceId, THUMBNAILS.length, 0x5443)]
}

export function defaultWorkspaceBackground(workspaceId: string): string {
  return BACKGROUNDS[stableIndex(workspaceId, BACKGROUNDS.length, 0x434c4f55)]
}

export function resolveWorkspaceVisuals(
  workspaceIds: string[],
  overrides: Record<string, string | undefined>,
  kind: 'thumbnail' | 'background',
): Record<string, string> {
  const pool = kind === 'thumbnail' ? THUMBNAILS : BACKGROUNDS
  const salt = kind === 'thumbnail' ? 0x5443 : 0x434c4f55
  const used = new Set<string>()
  return Object.fromEntries(workspaceIds.map((workspaceId) => {
    const override = overrides[workspaceId]
    if (override) return [workspaceId, override]
    const preferred = stableIndex(workspaceId, pool.length, salt)
    let selected = pool[preferred]
    for (let step = 0; step < pool.length; step += 1) {
      const candidate = pool[(preferred + step) % pool.length]
      if (!used.has(candidate)) { selected = candidate; break }
    }
    used.add(selected)
    return [workspaceId, selected]
  }))
}
