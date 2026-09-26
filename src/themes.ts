// 主题系统：样式基底（glass / neumorphism）+ 令牌表。
// 令牌是 CSS 自定义属性名到值的映射，应用时注入到 documentElement 的内联样式，
// 覆盖 index.css 中 :root 的玻璃默认值。导入主题只允许令牌表，不允许任意 CSS。

export type ThemeStyle = 'glass' | 'neumorphism'

export const THEME_TOKEN_NAMES = [
  'bg-page',
  'surface',
  'glass',
  'window-mask',
  'shadow-window',
  'ink',
  'muted',
  'quiet',
  'line',
  'cyan',
  'blue',
  'blue-strong',
  'green',
  'amber',
  'red',
  'shadow-dark',
  'shadow-light',
  'shadow-raised',
  'shadow-raised-hover',
  'shadow-pressed',
  'shadow-inset',
  'shadow-inset-focus',
  'radius',
  'radius-small',
  'transition-surface',
] as const

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number]
export type ThemeTokens = Partial<Record<ThemeTokenName, string>>

export interface ThemeDocument {
  name: string
  style: ThemeStyle
  tokens: ThemeTokens
}

export const TOKEN_LABELS: Record<ThemeTokenName, string> = {
  'bg-page': '页面基础背景',
  surface: '常规面板表面',
  glass: '浮层玻璃表面',
  'window-mask': '窗口遮罩',
  'shadow-window': '窗口级阴影',
  ink: '主文字',
  muted: '次要文字',
  quiet: '弱化文字',
  line: '分隔线与描边',
  cyan: '强调色（青/主强调）',
  blue: '强调色（链接与高亮）',
  'blue-strong': '强调色（加强态）',
  green: '成功状态',
  amber: '警示状态',
  red: '危险状态',
  'shadow-dark': '暗阴影色（右下 +X/+Y）',
  'shadow-light': '亮阴影色（左上 -X/-Y）',
  'shadow-raised': '凸起阴影',
  'shadow-raised-hover': '凸起悬停阴影（应缩小）',
  'shadow-pressed': '按下内凹阴影',
  'shadow-inset': '输入槽默认内凹',
  'shadow-inset-focus': '输入槽聚焦内凹（应更浅）',
  radius: '通用圆角',
  'radius-small': '小圆角',
  'transition-surface': '表面过渡',
}

// 值只允许颜色/长度/阴影所需的字符，禁止 url()、@、引号、花括号等注入载体。
const TOKEN_VALUE_PATTERN = /^[#a-zA-Z0-9(),.%\s/_-]{1,160}$/

export interface ThemeParseResult {
  ok: boolean
  theme?: ThemeDocument
  errors: string[]
}

export function parseThemeDocument(value: unknown): ThemeParseResult {
  const errors: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['主题文件必须是一个 JSON 对象'] }
  }
  const source = value as Record<string, unknown>
  const name = typeof source.name === 'string' ? source.name.trim() : ''
  if (!name || name.length > 24) errors.push('主题名称 name 必须是 1-24 个字符')
  if (source.style !== 'glass' && source.style !== 'neumorphism') {
    errors.push("样式基底 style 只能是 \"glass\" 或 \"neumorphism\"")
  }
  const tokens: ThemeTokens = {}
  if (typeof source.tokens !== 'object' || source.tokens === null || Array.isArray(source.tokens)) {
    errors.push('令牌表 tokens 必须是对象')
  } else {
    for (const [key, tokenValue] of Object.entries(source.tokens as Record<string, unknown>)) {
      if (!(THEME_TOKEN_NAMES as readonly string[]).includes(key)) {
        errors.push(`未知令牌 "${key}"`)
        continue
      }
      if (typeof tokenValue !== 'string' || !TOKEN_VALUE_PATTERN.test(tokenValue)) {
        errors.push(`令牌 "${key}" 的值必须是 160 字符以内的颜色/长度/阴影值`)
        continue
      }
      tokens[key as ThemeTokenName] = tokenValue.trim()
    }
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, theme: { name, style: source.style as ThemeStyle, tokens }, errors: [] }
}

export const BUILT_IN_THEMES: ThemeDocument[] = [
  { name: '云玻璃', style: 'glass', tokens: {} },
  {
    name: '新拟物派',
    style: 'neumorphism',
    tokens: {
      'bg-page': '#e0e5ec',
      surface: '#e0e5ec',
      glass: '#e0e5ec',
      'window-mask': 'rgba(224, 229, 236, .75)',
      'shadow-window': '12px 12px 24px #b8bcc2, -12px -12px 24px #ffffff',
      ink: '#333333',
      muted: '#6b7280',
      quiet: '#8f99a3',
      line: 'transparent',
      cyan: '#6d5dfc',
      blue: '#6d5dfc',
      'blue-strong': '#7d6dff',
      green: '#3f9f85',
      amber: '#c98a3d',
      red: '#d96459',
      'shadow-dark': '#b8bcc2',
      'shadow-light': '#ffffff',
      'shadow-raised': '8px 8px 16px #b8bcc2, -8px -8px 16px #ffffff',
      'shadow-raised-hover': '4px 4px 8px #b8bcc2, -4px -4px 8px #ffffff',
      'shadow-pressed': 'inset 4px 4px 8px #b8bcc2, inset -4px -4px 8px #ffffff',
      'shadow-inset': 'inset 6px 6px 12px #b8bcc2, inset -6px -6px 12px #ffffff',
      'shadow-inset-focus': 'inset 2px 2px 4px #b8bcc2, inset -2px -2px 4px #ffffff',
      radius: '16px',
      'radius-small': '12px',
      'transition-surface': 'box-shadow 300ms ease-in-out, background 300ms ease-in-out, border-color 300ms ease-in-out, transform 300ms ease-in-out',
    },
  },
]

export type SavedThemeSelection = { kind: 'builtin'; id: string } | { kind: 'custom'; theme: ThemeDocument }

const SELECTION_KEY = 'tianchuang.theme.v1'
const CUSTOM_THEMES_KEY = 'tianchuang.custom-themes.v1'

function applyTokens(tokens: ThemeTokens): void {
  for (const name of THEME_TOKEN_NAMES) {
    const value = tokens[name]
    if (value) document.documentElement.style.setProperty(`--${name}`, value)
    else document.documentElement.style.removeProperty(`--${name}`)
  }
}

export function applyTheme(theme: ThemeDocument): void {
  document.documentElement.dataset.theme = theme.style
  applyTokens(theme.tokens)
}

export function getSavedThemeSelection(): SavedThemeSelection {
  try {
    const raw = localStorage.getItem(SELECTION_KEY)
    if (!raw) return { kind: 'builtin', id: 'glass' }
    const parsed = JSON.parse(raw) as SavedThemeSelection
    if (parsed.kind === 'builtin') {
      return BUILT_IN_THEMES.some((theme) => theme.name === parsed.id) ? parsed : { kind: 'builtin', id: 'glass' }
    }
    const result = parseThemeDocument(parsed.theme)
    return result.ok && result.theme ? { kind: 'custom', theme: result.theme } : { kind: 'builtin', id: 'glass' }
  } catch {
    return { kind: 'builtin', id: 'glass' }
  }
}

export function saveThemeSelection(selection: SavedThemeSelection): void {
  localStorage.setItem(SELECTION_KEY, JSON.stringify(selection))
}

export function resolveTheme(selection: SavedThemeSelection): ThemeDocument {
  if (selection.kind === 'builtin') {
    return BUILT_IN_THEMES.find((theme) => theme.name === selection.id) ?? BUILT_IN_THEMES[0]
  }
  return selection.theme
}

export function applySavedTheme(): ThemeDocument {
  const theme = resolveTheme(getSavedThemeSelection())
  applyTheme(theme)
  return theme
}

export function listCustomThemes(): ThemeDocument[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown[]
    return parsed
      .map((item) => parseThemeDocument(item))
      .filter((result) => result.ok)
      .map((result) => result.theme as ThemeDocument)
  } catch {
    return []
  }
}

export function saveCustomTheme(theme: ThemeDocument): ThemeDocument[] {
  const themes = listCustomThemes().filter((item) => item.name !== theme.name)
  themes.push(theme)
  localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes))
  return themes
}

export function removeCustomTheme(name: string): ThemeDocument[] {
  const themes = listCustomThemes().filter((item) => item.name !== name)
  localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes))
  return themes
}
