import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_THEMES, parseThemeDocument, resolveTheme, type SavedThemeSelection,
} from '../src/themes.js'

describe('theme document parsing', () => {
  it('accepts a valid custom theme document', () => {
    const result = parseThemeDocument({
      name: '暖沙新拟物',
      style: 'neumorphism',
      tokens: { 'bg-page': '#e8e2d9', 'shadow-dark': '#c4bcae', 'shadow-light': '#fffdf8' },
    })
    expect(result.ok).toBe(true)
    expect(result.theme?.tokens['bg-page']).toBe('#e8e2d9')
  })

  it('rejects unknown styles and token names', () => {
    const result = parseThemeDocument({ name: '坏主题', style: 'glassmorphism', tokens: { 'not-a-token': '#fff' } })
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('style'))).toBe(true)
    expect(result.errors.some((error) => error.includes('not-a-token'))).toBe(true)
  })

  it('rejects values that could carry injected code', () => {
    const result = parseThemeDocument({
      name: '注入',
      style: 'glass',
      tokens: { ink: 'red; } body { background: url(https://evil.example)' },
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
  })

  it('rejects non-object payloads and bad names', () => {
    expect(parseThemeDocument('neumorphism').ok).toBe(false)
    expect(parseThemeDocument(null).ok).toBe(false)
    expect(parseThemeDocument({ name: '', style: 'glass', tokens: {} }).ok).toBe(false)
    expect(parseThemeDocument({ name: 'x'.repeat(30), style: 'glass', tokens: {} }).ok).toBe(false)
  })

  it('ships valid built-in themes', () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(parseThemeDocument(theme).ok).toBe(true)
    }
    expect(BUILT_IN_THEMES.map((theme) => theme.style)).toEqual(['glass', 'neumorphism'])
  })
})

describe('theme selection resolution', () => {
  it('falls back to the glass theme for unknown builtin ids', () => {
    const selection: SavedThemeSelection = { kind: 'builtin', id: '不存在' }
    expect(resolveTheme(selection).name).toBe('云玻璃')
  })

  it('resolves the neumorphism builtin with prompt token values', () => {
    const theme = resolveTheme({ kind: 'builtin', id: '新拟物派' })
    expect(theme.style).toBe('neumorphism')
    expect(theme.tokens['bg-page']).toBe('#e0e5ec')
    expect(theme.tokens['shadow-raised']).toContain('8px 8px 16px #b8bcc2')
    expect(theme.tokens['shadow-raised']).toContain('-8px -8px 16px #ffffff')
    expect(theme.tokens.ink).toBe('#333333')
  })
})
