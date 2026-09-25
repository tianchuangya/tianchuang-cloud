export type CursorStyle = 'rectangle' | 'system'
export type CursorEffect = 'none' | 'fluid' | 'fireworks'
export type BackgroundEffect = 'static' | 'ripple'
export type LibraryView = 'glass' | 'motion'

export interface CursorPreferences {
  style: CursorStyle
  effect: CursorEffect
  backgroundEffect: BackgroundEffect
  libraryView: LibraryView
  cursorColor: string
  cursorTargetColor: string
}

export const DEFAULT_CURSOR_PREFERENCES: CursorPreferences = {
  style: 'rectangle',
  effect: 'none',
  backgroundEffect: 'ripple',
  libraryView: 'glass',
  cursorColor: '#dafcff',
  cursorTargetColor: '#b497cf',
}

const STORAGE_KEY = 'tianchuang.cursor-preferences.v1'

export function loadCursorPreferences(): CursorPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<CursorPreferences>
    const color = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
    return {
      style: stored.style === 'system' ? 'system' : 'rectangle',
      effect: stored.effect === 'fluid' || stored.effect === 'fireworks' ? stored.effect : 'none',
      backgroundEffect: stored.backgroundEffect === 'static' ? 'static' : 'ripple',
      libraryView: stored.libraryView === 'motion' ? 'motion' : 'glass',
      cursorColor: color(stored.cursorColor, DEFAULT_CURSOR_PREFERENCES.cursorColor),
      cursorTargetColor: color(stored.cursorTargetColor, DEFAULT_CURSOR_PREFERENCES.cursorTargetColor),
    }
  } catch {
    return DEFAULT_CURSOR_PREFERENCES
  }
}

export function saveCursorPreferences(preferences: CursorPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
}
