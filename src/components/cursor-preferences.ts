export type CursorStyle = 'rectangle' | 'system'
export type CursorEffect = 'none' | 'fluid' | 'fireworks'

export interface CursorPreferences {
  style: CursorStyle
  effect: CursorEffect
}

export const DEFAULT_CURSOR_PREFERENCES: CursorPreferences = {
  style: 'rectangle',
  effect: 'none',
}

const STORAGE_KEY = 'tianchuang.cursor-preferences.v1'

export function loadCursorPreferences(): CursorPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<CursorPreferences>
    return {
      style: stored.style === 'system' ? 'system' : 'rectangle',
      effect: stored.effect === 'fluid' || stored.effect === 'fireworks' ? stored.effect : 'none',
    }
  } catch {
    return DEFAULT_CURSOR_PREFERENCES
  }
}

export function saveCursorPreferences(preferences: CursorPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
}
