export type CursorStyle = 'rectangle' | 'system'
export type CursorEffect = 'none' | 'fluid' | 'fireworks'
export type BackgroundEffect = 'none' | 'ripple' | 'rays' | 'particles' | 'aurora' | 'iridescence' | 'threads' | 'topography'
export type LibraryView = 'glass' | 'motion' | 'accordion' | 'depth'
export type StartupMode = 'always' | 'once' | 'off'
export type StartupEffect = 'aurora' | 'light'

export interface CursorPreferences {
  style: CursorStyle
  effect: CursorEffect
  backgroundEffect: BackgroundEffect
  backgroundBlur: number
  backgroundOpacity: number
  libraryView: LibraryView
  startupMode: StartupMode
  startupEffect: StartupEffect
  cursorColor: string
  cursorTargetColor: string
}

export const DEFAULT_CURSOR_PREFERENCES: CursorPreferences = {
  style: 'rectangle',
  effect: 'none',
  backgroundEffect: 'ripple',
  backgroundBlur: 0,
  backgroundOpacity: 1,
  libraryView: 'glass',
  startupMode: 'always',
  startupEffect: 'aurora',
  cursorColor: '#dafcff',
  cursorTargetColor: '#b497cf',
}

const STORAGE_KEY = 'tianchuang.cursor-preferences.v1'

export function loadCursorPreferences(): CursorPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<CursorPreferences>
    const color = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
    const storedBackgroundEffect = (stored as { backgroundEffect?: string }).backgroundEffect
    return {
      style: stored.style === 'system' ? 'system' : 'rectangle',
      effect: stored.effect === 'fluid' || stored.effect === 'fireworks' ? stored.effect : 'none',
      backgroundEffect: storedBackgroundEffect === 'rays' || storedBackgroundEffect === 'particles' || storedBackgroundEffect === 'aurora' || storedBackgroundEffect === 'iridescence' || storedBackgroundEffect === 'threads' || storedBackgroundEffect === 'topography' || storedBackgroundEffect === 'none' || storedBackgroundEffect === 'static'
        ? (storedBackgroundEffect === 'static' ? 'none' : storedBackgroundEffect)
        : 'ripple',
      backgroundBlur: typeof stored.backgroundBlur === 'number' ? Math.min(24, Math.max(0, stored.backgroundBlur)) : 0,
      backgroundOpacity: typeof stored.backgroundOpacity === 'number' ? Math.min(1, Math.max(.2, stored.backgroundOpacity)) : 1,
      libraryView: stored.libraryView === 'motion' || stored.libraryView === 'accordion' || stored.libraryView === 'depth' ? stored.libraryView : 'glass',
      startupMode: stored.startupMode === 'once' || stored.startupMode === 'off' ? stored.startupMode : 'always',
      startupEffect: stored.startupEffect === 'light' ? 'light' : 'aurora',
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
