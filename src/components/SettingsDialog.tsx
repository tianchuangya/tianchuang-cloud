import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import {
  Activity, AlertTriangle, ArchiveRestore, Bell, Check, Cloud, Droplets, GitBranch, Globe2, Grid2X2, History,
  Image as ImageIcon, Laptop, Layers3, LoaderCircle, LogIn, Monitor, MousePointer2,
  Download, Palette, Search, Settings, ShieldCheck, Sparkles, SunMedium, Upload, UserRound, Waves, X,
} from 'lucide-react'
import { DEFAULT_NOTIFICATION_PREFERENCES, type CloudConfigDocument, type CloudConfigStatus, type GitHubAccountSession, type NotificationPreferences } from '../../electron/types'
import {
  BUILT_IN_THEMES, applyTheme, getSavedThemeSelection, listCustomThemes, parseThemeDocument,
  removeCustomTheme, resolveTheme, saveCustomTheme, saveThemeSelection,
  type SavedThemeSelection, type ThemeDocument,
} from '../themes'
import FadeContent from './FadeContent'
import LogoLoop, { type LogoLoopItem } from './LogoLoop'
import { useBackgroundPreview } from './background-preview'
import type { BackgroundEffect, CursorEffect, CursorPreferences, CursorStyle, LibraryView, StartupEffect, StartupMode } from './cursor-preferences'

const PROJECT_LINKS: LogoLoopItem[] = [
  {
    title: 'Tianchuang Cloud',
    ariaLabel: '打开 Tianchuang Cloud GitHub 仓库',
    href: 'https://github.com/tianchuangya/tianchuang-cloud',
    node: <><GitBranch size={17} /><span><strong>Tianchuang Cloud</strong><small>GitHub 项目仓库</small></span></>,
  },
  {
    title: '是天创呀',
    ariaLabel: '打开是天创呀的 GitHub 主页',
    href: 'https://github.com/tianchuangya',
    node: <><img className="loop-avatar" src="/assets/author-avatar.png" alt="是天创呀头像" /><span><strong>是天创呀</strong><small>项目作者</small></span></>,
  },
  {
    title: '天创域',
    ariaLabel: '打开是天创呀的个人博客',
    href: 'https://tianchuangya.cc/welcome',
    node: <><Globe2 size={17} /><span><strong>天创域</strong><small>个人博客</small></span></>,
  },
]

function CursorSettingsDialog({ preferences, customBackground, onSelectBackground, onResetBackground, onPreviewBackgroundEffect, onRequestRestore, onChange, onClose }: { preferences: CursorPreferences; customBackground?: string; onSelectBackground: () => Promise<void>; onResetBackground: () => Promise<void>; onPreviewBackgroundEffect: (effect?: BackgroundEffect) => void; onRequestRestore: (config: CloudConfigDocument) => void; onChange: (preferences: CursorPreferences) => void; onClose: () => void }) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const [backgroundEffectSearch, setBackgroundEffectSearch] = useState('')
  const [category, setCategory] = useState<'startup' | 'appearance' | 'library' | 'notifications' | 'account' | 'about'>('startup')
  const [subpage, setSubpage] = useState<'launch' | 'pointer' | 'background' | 'theme' | 'view' | 'alerts' | 'devices' | 'links'>('launch')
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES)
  useEffect(() => {
    let active = true
    void window.tianchuang.getNotificationPreferences().then((next) => {
      if (active) setNotificationPrefs(next)
    }).catch(() => { /* 保持默认值，打开面板时会重试 */ })
    return () => { active = false }
  }, [])
  const [customThemes, setCustomThemes] = useState<ThemeDocument[]>(() => listCustomThemes())
  const [themeSelection, setThemeSelection] = useState<SavedThemeSelection>(() => getSavedThemeSelection())
  const [themeError, setThemeError] = useState('')
  const chooseTheme = (theme: ThemeDocument, kind: 'builtin' | 'custom') => {
    applyTheme(theme)
    const selection: SavedThemeSelection = kind === 'builtin' ? { kind: 'builtin', id: theme.name } : { kind: 'custom', theme }
    saveThemeSelection(selection)
    setThemeSelection(selection)
    setThemeError('')
  }
  const importTheme = async () => {
    try {
      const raw = await window.tianchuang.openThemeFile()
      if (!raw) return
      const result = parseThemeDocument(raw)
      if (!result.ok || !result.theme) {
        setThemeError(result.errors.join('；'))
        return
      }
      setCustomThemes(saveCustomTheme(result.theme))
      chooseTheme(result.theme, 'custom')
    } catch (reason) {
      setThemeError(`主题文件解析失败：${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }
  const exportTheme = async () => {
    await window.tianchuang.saveThemeFile(resolveTheme(themeSelection).name, resolveTheme(themeSelection))
  }
  const changeNotificationPrefs = (changes: Partial<NotificationPreferences>) => {
    const next = { ...notificationPrefs, ...changes }
    setNotificationPrefs(next)
    void window.tianchuang.saveNotificationPreferences(next).then(setNotificationPrefs)
  }
  const setStyle = (style: CursorStyle) => onChange({ ...preferences, style })
  const setEffect = (effect: CursorEffect) => onChange({ ...preferences, effect })
  const setBackgroundEffect = (backgroundEffect: BackgroundEffect) => onChange({ ...preferences, backgroundEffect })
  const setLibraryView = (libraryView: LibraryView) => onChange({ ...preferences, libraryView })
  const { immersivePreview, startPreview, cancelPreview, commitPreview } = useBackgroundPreview({ onPreviewChange: onPreviewBackgroundEffect, onCommit: setBackgroundEffect })
  const setStartupMode = (startupMode: StartupMode) => onChange({ ...preferences, startupMode })
  const setStartupEffect = (startupEffect: StartupEffect) => onChange({ ...preferences, startupEffect })
  const backgroundEffects: Array<{ value: BackgroundEffect; title: string; description: string; className: string; icon: React.ReactNode }> = [
    { value: 'none', title: '无动态效果', description: '只显示背景图与透明玻璃材质', className: 'quiet', icon: <Layers3 size={20} /> },
    { value: 'ripple', title: '水波折射', description: '移动或点击时扰动背景材质', className: 'ripple', icon: <Droplets size={20} /> },
    { value: 'rays', title: '侧光流束', description: '缓慢移动的半透明光束', className: 'rays', icon: <SunMedium size={20} /> },
    { value: 'particles', title: '微光粒子', description: '低密度白色粒子缓慢漂移', className: 'particles', icon: <Sparkles size={20} /> },
    { value: 'aurora', title: '柔光极光', description: 'OGL 柔和光带与色彩流动', className: 'aurora', icon: <Waves size={20} /> },
    { value: 'iridescence', title: '虹彩流光', description: '跟随指针缓慢折射的丝滑光泽', className: 'iridescence', icon: <Droplets size={20} /> },
    { value: 'threads', title: '光丝网络', description: '由中心展开的半透明流动丝线', className: 'threads', icon: <Waves size={20} /> },
    { value: 'topography', title: '动态地形', description: '连续变形的发光等高线', className: 'topography', icon: <Activity size={20} /> },
  ]
  const visibleBackgroundEffects = backgroundEffects.filter((item) => `${item.title}${item.description}${item.value}`.toLowerCase().includes(backgroundEffectSearch.trim().toLowerCase()))
  const chooseCategory = (next: 'startup' | 'appearance' | 'library' | 'notifications' | 'account' | 'about') => {
    setCategory(next)
    setSubpage(next === 'startup' ? 'launch' : next === 'appearance' ? 'pointer' : next === 'library' ? 'view' : next === 'notifications' ? 'alerts' : next === 'account' ? 'devices' : 'links')
    cancelPreview()
  }

  return (
    <motion.div className={`modal-backdrop settings-backdrop${immersivePreview ? ' is-immersive-preview' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="immersive-preview-hint"><span />正在预览背景效果，移动鼠标返回设置</div>
      <motion.section className="modal glass-modal cursor-settings-modal" initial={{ opacity: 0, transform: 'translateY(10px) scale(.97)' }} animate={{ opacity: 1, transform: 'translateY(0) scale(1)' }} exit={{ opacity: 0, transform: 'translateY(8px) scale(.98)' }} transition={{ type: 'spring', bounce: 0, duration: .28 }}>
        <header><div className="settings-symbol"><Settings size={21} /></div><div><h2>设置</h2><p>按大类与子项管理天创云端</p></div><button className="icon-button" title="关闭" onClick={onClose}><X size={18} /></button></header>
        <nav className="settings-top-nav" aria-label="设置大类">
          <button className={category === 'startup' ? 'active' : ''} onClick={() => chooseCategory('startup')}><Cloud size={15} />启动体验</button>
          <button className={category === 'appearance' ? 'active' : ''} onClick={() => chooseCategory('appearance')}><MousePointer2 size={15} />外观与动态</button>
          <button className={category === 'library' ? 'active' : ''} onClick={() => chooseCategory('library')}><Layers3 size={15} />资料库</button>
          <button className={category === 'notifications' ? 'active' : ''} onClick={() => chooseCategory('notifications')}><Bell size={15} />通知</button>
          <button className={category === 'account' ? 'active' : ''} onClick={() => chooseCategory('account')}><UserRound size={15} />账户与设备</button>
          <button className={category === 'about' ? 'active' : ''} onClick={() => chooseCategory('about')}><Globe2 size={15} />关于</button>
        </nav>
        <div className="settings-cross-layout">
          <aside className="settings-side-nav" aria-label="设置子类">
            {category === 'startup' && <button className="active" onClick={() => setSubpage('launch')}>启动动画</button>}
            {category === 'appearance' && <>
              <button className={subpage === 'pointer' ? 'active' : ''} onClick={() => setSubpage('pointer')}>指针与轨迹</button>
              <button className={subpage === 'background' ? 'active' : ''} onClick={() => setSubpage('background')}>背景与效果</button>
              <button className={subpage === 'theme' ? 'active' : ''} onClick={() => setSubpage('theme')}>主题</button>
            </>}
            {category === 'library' && <button className="active" onClick={() => setSubpage('view')}>浏览方式</button>}
            {category === 'notifications' && <button className="active" onClick={() => setSubpage('alerts')}>同步通知</button>}
            {category === 'account' && <button className="active" onClick={() => setSubpage('devices')}>主配置仓库</button>}
            {category === 'about' && <button className="active" onClick={() => setSubpage('links')}>项目与作者</button>}
          </aside>
          <div className="cursor-settings-content">
            {category === 'startup' && <FadeContent key="startup" duration={220} blurAmount={4}>
              <section className="settings-panel-stack">
                <div><div className="setting-group-heading"><strong>显示时机</strong><span>启动动画不会延迟资料库加载</span></div><div className="cursor-choice-grid three">
                  <button className={preferences.startupMode === 'always' ? 'active' : ''} onClick={() => setStartupMode('always')} aria-pressed={preferences.startupMode === 'always'}><span className="effect-preview aurora"><Sparkles size={20} /></span><span><strong>每次启动</strong><small>每次打开应用时展示</small></span><Check size={15} /></button>
                  <button className={preferences.startupMode === 'once' ? 'active' : ''} onClick={() => setStartupMode('once')} aria-pressed={preferences.startupMode === 'once'}><span className="effect-preview quiet"><History size={20} /></span><span><strong>仅首次</strong><small>新环境第一次打开时展示</small></span><Check size={15} /></button>
                  <button className={preferences.startupMode === 'off' ? 'active' : ''} onClick={() => setStartupMode('off')} aria-pressed={preferences.startupMode === 'off'}><span className="effect-preview quiet"><Monitor size={20} /></span><span><strong>关闭</strong><small>直接进入资料库</small></span><Check size={15} /></button>
                </div></div>
                <div><div className="setting-group-heading"><strong>动画风格</strong><span>与常驻背景效果相互独立</span></div><div className="cursor-choice-grid two">
                  <button className={preferences.startupEffect === 'aurora' ? 'active' : ''} onClick={() => setStartupEffect('aurora')} aria-pressed={preferences.startupEffect === 'aurora'} disabled={reduceMotion}><span className="effect-preview aurora"><Waves size={20} /></span><span><strong>柔光极光</strong><small>流动色带与玻璃云层</small></span><Check size={15} /></button>
                  <button className={preferences.startupEffect === 'light' ? 'active' : ''} onClick={() => setStartupEffect('light')} aria-pressed={preferences.startupEffect === 'light'}><span className="effect-preview rays"><SunMedium size={20} /></span><span><strong>侧光掠影</strong><small>更克制的缓慢光束</small></span><Check size={15} /></button>
                </div></div>
                <div className="startup-settings-preview" data-effect={preferences.startupEffect}><span><img src="/assets/app-icon.png" alt="" /><strong>天创云端</strong><small>{preferences.startupEffect === 'aurora' ? '柔光极光' : '侧光掠影'}</small></span></div>
                <div className="performance-note"><ShieldCheck size={16} /><span>资料库会在动画期间并行加载；进度完成后按任意键或点击画面进入软件。</span></div>
              </section>
            </FadeContent>}
            {category === 'appearance' && subpage === 'pointer' && <FadeContent key="pointer" duration={220} blurAmount={4}>
              <section className="settings-panel-stack">
                <div><div className="setting-group-heading"><strong>指针外观</strong><span>选择日常操作时使用的指针</span></div><div className="cursor-choice-grid two">
                  <button className={preferences.style === 'rectangle' ? 'active' : ''} onClick={() => setStyle('rectangle')} aria-pressed={preferences.style === 'rectangle'}><span className="cursor-preview rectangle"><i /></span><span><strong>矩形高亮</strong><small>清晰、轻量，适合深色界面</small></span><Check size={15} /></button>
                  <button className={preferences.style === 'system' ? 'active' : ''} onClick={() => setStyle('system')} aria-pressed={preferences.style === 'system'}><span className="cursor-preview system"><MousePointer2 size={20} /></span><span><strong>系统原生</strong><small>跟随 Windows、macOS 或 Linux</small></span><Check size={15} /></button>
                </div></div>
                <div><div className="setting-group-heading"><strong>指针配色</strong><span>空闲与吸附状态独立设置</span></div><div className="cursor-color-grid">
                  <label><span><strong>基础颜色</strong><small>{preferences.cursorColor}</small></span><input type="color" value={preferences.cursorColor} onChange={(event) => onChange({ ...preferences, cursorColor: event.target.value })} /></label>
                  <label><span><strong>吸附颜色</strong><small>{preferences.cursorTargetColor}</small></span><input type="color" value={preferences.cursorTargetColor} onChange={(event) => onChange({ ...preferences, cursorTargetColor: event.target.value })} /></label>
                </div></div>
                <div><div className="setting-group-heading"><strong>动态轨迹</strong><span>装饰效果不会改变点击行为</span></div><div className="cursor-choice-grid three">
                  <button className={preferences.effect === 'none' ? 'active' : ''} onClick={() => setEffect('none')} aria-pressed={preferences.effect === 'none'}><span className="effect-preview quiet"><Monitor size={20} /></span><span><strong>关闭</strong><small>性能优先</small></span><Check size={15} /></button>
                  <button className={preferences.effect === 'fluid' ? 'active' : ''} onClick={() => setEffect('fluid')} aria-pressed={preferences.effect === 'fluid'} disabled={reduceMotion}><span className="effect-preview fluid"><Waves size={20} /></span><span><strong>流体彩雾</strong><small>移动时产生渐色流体</small></span><Check size={15} /></button>
                  <button className={preferences.effect === 'fireworks' ? 'active' : ''} onClick={() => setEffect('fireworks')} aria-pressed={preferences.effect === 'fireworks'} disabled={reduceMotion}><span className="effect-preview fireworks"><Sparkles size={20} /></span><span><strong>白色点击烟花</strong><small>缓慢扩散并柔和消退</small></span><Check size={15} /></button>
                </div></div>
                {reduceMotion && <div className="motion-safety-note"><ShieldCheck size={16} /><span>系统已启用“减少动态效果”，动态轨迹会暂时停用。</span></div>}
              </section>
            </FadeContent>}
            {category === 'appearance' && subpage === 'background' && <FadeContent key="background" duration={220} blurAmount={4}>
              <section className="settings-panel-stack">
                <div><div className="setting-group-heading"><strong>背景图</strong><span>底图与动态效果相互独立</span></div><div className="background-image-settings">
                  <div className="background-image-preview">{customBackground ? <img src={customBackground} alt="当前自定义背景预览" /> : <img src="/assets/cloud-glass-bg.png" alt="默认背景预览" />}</div>
                  <div><strong>{customBackground ? '自定义背景' : '天创云端默认背景'}</strong><small>{customBackground ? '图片已复制到应用数据目录' : '当前项目内置的玻璃云端背景'}</small><span><button className="secondary-button" onClick={() => void onSelectBackground()}><ImageIcon size={15} />选择图片</button>{customBackground && <button className="plain-button" onClick={() => void onResetBackground()}>恢复默认</button>}</span></div>
                </div><div className="background-tuning-grid">
                  <label><span><strong>背景模糊</strong><small>{preferences.backgroundBlur}px</small></span><input aria-label="背景模糊" type="range" min="0" max="24" step="1" value={preferences.backgroundBlur} onInput={(event) => onChange({ ...preferences, backgroundBlur: Number(event.currentTarget.value) })} /></label>
                  <label><span><strong>背景不透明度</strong><small>{Math.round(preferences.backgroundOpacity * 100)}%</small></span><input type="range" min="20" max="100" step="5" value={preferences.backgroundOpacity * 100} onChange={(event) => onChange({ ...preferences, backgroundOpacity: Number(event.target.value) / 100 })} /></label>
                </div></div>
                <div><div className="setting-group-heading"><strong>背景动态效果</strong><span>悬停 1 秒进入沉浸预览</span></div><label className="effect-search"><Search size={15} /><input value={backgroundEffectSearch} onChange={(event) => setBackgroundEffectSearch(event.target.value)} placeholder="搜索背景效果" /></label><div className="cursor-choice-grid two">
                  {visibleBackgroundEffects.map((item) => <button key={item.value} className={preferences.backgroundEffect === item.value ? 'active' : ''} onPointerEnter={() => { if (!reduceMotion) startPreview(item.value) }} onPointerLeave={cancelPreview} onClick={() => commitPreview(item.value)} aria-pressed={preferences.backgroundEffect === item.value} disabled={reduceMotion && item.value !== 'none'}><span className={`effect-preview ${item.className}`}>{item.icon}</span><span><strong>{item.title}</strong><small>{item.description} · 停留预览</small></span><Check size={15} /></button>)}
                </div>{!visibleBackgroundEffects.length && <div className="effect-search-empty">没有匹配的背景效果</div>}</div>
                {preferences.backgroundEffect === 'ripple' && preferences.effect === 'fluid' && <div className="motion-safety-note"><ShieldCheck size={16} /><span>流体彩雾启用期间，水波背景会自动暂停，避免同时占用 GPU。</span></div>}
                <div className="performance-note"><Waves size={16} /><span>实时背景使用 GPU 渲染；电池模式或远程桌面中建议降低动态效果。</span></div>
              </section>
            </FadeContent>}
            {category === 'appearance' && subpage === 'theme' && <FadeContent key="theme" duration={220} blurAmount={4}>
              <section className="settings-panel-stack">
                <div>
                  <div className="setting-group-heading"><strong>主题</strong><span>切换界面样式基底；主题文件只包含颜色与阴影令牌，不执行任何代码</span></div>
                  <div className="theme-grid">
                    {BUILT_IN_THEMES.map((theme) => <button key={theme.name} className={`theme-card ${(themeSelection.kind === 'builtin' && themeSelection.id === theme.name) ? 'active' : ''}`} onClick={() => chooseTheme(theme, 'builtin')}>
                      <span className="theme-swatch" style={{ background: theme.tokens['bg-page'] || (theme.style === 'neumorphism' ? '#e0e5ec' : '#0b1014') }} />
                      <strong>{theme.name}</strong>
                      <small>{theme.style === 'neumorphism' ? '新拟物派 · 浅色软浮雕' : '云玻璃 · 深色毛玻璃'}</small>
                    </button>)}
                    {customThemes.map((theme) => <span key={theme.name} className={`theme-card ${(themeSelection.kind === 'custom' && themeSelection.theme.name === theme.name) ? 'active' : ''}`} role="button" tabIndex={0} onClick={() => chooseTheme(theme, 'custom')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') chooseTheme(theme, 'custom') }}>
                      <span className="theme-swatch" style={{ background: theme.tokens['bg-page'] || (theme.style === 'neumorphism' ? '#e0e5ec' : '#0b1014') }} />
                      <strong>{theme.name}</strong>
                      <small>{theme.style === 'neumorphism' ? '自定义 · 新拟物基底' : '自定义 · 云玻璃基底'}</small>
                      <button className="icon-button" title="删除此主题" onClick={(event) => { event.stopPropagation(); setCustomThemes(removeCustomTheme(theme.name)); if (themeSelection.kind === 'custom' && themeSelection.theme.name === theme.name) chooseTheme(BUILT_IN_THEMES[0], 'builtin') }}><X size={14} /></button>
                    </span>)}
                  </div>
                  {themeError && <div className="form-error theme-import-error" role="alert"><AlertTriangle size={15} />{themeError}</div>}
                  <div className="theme-actions">
                    <button className="secondary-button" onClick={() => void importTheme()}><Upload size={15} />导入主题文件</button>
                    <button className="secondary-button" onClick={() => void exportTheme()}><Download size={15} />导出当前主题</button>
                  </div>
                </div>
                <div className="performance-note"><Palette size={16} /><span>新拟物主题使用纯色浅底，会暂时隐藏背景图与动态效果；切换回云玻璃立即恢复。主题编写指南见项目 docs/theme-system.md。</span></div>
              </section>
            </FadeContent>}
            {category === 'library' && <FadeContent key="library" duration={220} blurAmount={4}><section><div className="setting-group-heading"><strong>资料库视图</strong><span>进入资料库首页时的浏览方式</span></div><div className="cursor-choice-grid two">
              <button className={preferences.libraryView === 'glass' ? 'active' : ''} onClick={() => setLibraryView('glass')} aria-pressed={preferences.libraryView === 'glass'}><span className="effect-preview quiet"><Grid2X2 size={20} /></span><span><strong>玻璃图标</strong><small>清晰直观，适合日常管理</small></span><Check size={15} /></button>
              <button className={preferences.libraryView === 'motion' ? 'active' : ''} onClick={() => setLibraryView('motion')} aria-pressed={preferences.libraryView === 'motion'} disabled={reduceMotion}><span className="effect-preview ripple"><Layers3 size={20} /></span><span><strong>动态网格</strong><small>使用封面构成有序运动网格</small></span><Check size={15} /></button>
              <button className={preferences.libraryView === 'accordion' ? 'active' : ''} onClick={() => setLibraryView('accordion')} aria-pressed={preferences.libraryView === 'accordion'} disabled={reduceMotion}><span className="effect-preview iridescence"><ImageIcon size={20} /></span><span><strong>手风琴封面</strong><small>分组浏览，悬停展开当前资料库</small></span><Check size={15} /></button>
              <button className={preferences.libraryView === 'depth' ? 'active' : ''} onClick={() => setLibraryView('depth')} aria-pressed={preferences.libraryView === 'depth'} disabled={reduceMotion}><span className="effect-preview topography"><Waves size={20} /></span><span><strong>深度轮播</strong><small>滚轮、方向键与按钮切换封面</small></span><Check size={15} /></button>
            </div></section></FadeContent>}
            {category === 'notifications' && subpage === 'alerts' && <FadeContent key="notifications" duration={220} blurAmount={4}>
              <section className="settings-panel-stack">
                <div>
                  <div className="setting-group-heading"><strong>系统通知</strong><span>只控制系统通知；应用内的进度浮层始终显示</span></div>
                  <label className="setting-row"><span><strong>同步成功通知</strong><small>每个目标同步完成后发送一条系统通知</small></span><input type="checkbox" checked={notificationPrefs.syncSuccess} onChange={(event) => changeNotificationPrefs({ syncSuccess: event.target.checked })} /><i /></label>
                  <label className="setting-row"><span><strong>同步失败通知</strong><small>同步失败时发送系统通知，自动同步仍受各资料库的失败告警冷却限制</small></span><input type="checkbox" checked={notificationPrefs.syncFailure} onChange={(event) => changeNotificationPrefs({ syncFailure: event.target.checked })} /><i /></label>
                </div>
                <div className="performance-note"><Bell size={16} /><span>AI 完成提醒与声音偏好会在 AI 助手启用后加入这里。</span></div>
              </section>
            </FadeContent>}
            {category === 'account' && <FadeContent key="account" duration={220} blurAmount={4}><CloudAccountSettings onRequestRestore={onRequestRestore} /></FadeContent>}
            {category === 'about' && <FadeContent key="about" duration={220} blurAmount={4}><section className="settings-about-panel"><div className="setting-group-heading"><strong>项目与作者</strong><span>个人主页与项目链接</span></div><p>这里集中展示天创云端项目、作者主页以及后续加入的个人作品。</p><div className="settings-project-loop"><LogoLoop logos={PROJECT_LINKS} speed={28} hoverSpeed={5} gap={10} ariaLabel="天创云端项目与作者链接" /></div></section></FadeContent>}
          </div>
        </div>
        <footer><button className="primary-button" onClick={onClose}>完成</button></footer>
      </motion.section>
    </motion.div>
  )
}

function CloudAccountSettings({ onRequestRestore }: { onRequestRestore: (config: CloudConfigDocument) => void }) {
  const [status, setStatus] = useState<CloudConfigStatus>()
  const [accounts, setAccounts] = useState<GitHubAccountSession[]>([])
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')

  const refreshStatus = async (showLoading = true) => {
    if (showLoading) setLoading(true)
    try {
      const next = await window.tianchuang.getCloudConfigStatus()
      setStatus(next)
      setError(next.authenticated ? '' : next.message || '')
      return next
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      return undefined
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => {
    void window.tianchuang.listGithubAccounts().then(setAccounts).catch(() => { /* 账号列表不可用时按主账号处理 */ })
    let active = true
    void window.tianchuang.getCloudConfigStatus().then((next) => {
      if (!active) return
      setStatus(next)
      setError(next.authenticated ? '' : next.message || '')
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  const login = async () => {
    setError('')
    setLoading(true)
    try {
      await window.tianchuang.loginGitHub()
      setAccounts(await window.tianchuang.listGithubAccounts())
      const next = await refreshStatus(false)
      // 登录成功后立即检查云端配置：发现其他设备备份的资料库时直接弹出恢复提示
      if (next?.config) {
        const snapshot = await window.tianchuang.getSnapshot()
        const hasUnseenWorkspace = next.config.workspaces.some((remote) => !snapshot.workspaces.some((local) => local.id === remote.id))
        if (hasUnseenWorkspace) onRequestRestore(next.config)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  const publish = async () => {
    setPublishing(true)
    setError('')
    try {
      const next = await window.tianchuang.publishCloudConfig()
      setStatus(next)
      if (next.updatedAt) localStorage.setItem('tianchuang.cloud-config-dismissed', next.updatedAt)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setPublishing(false)
    }
  }

  return (
    <section className="settings-panel-stack cloud-account-settings">
      <div>
        <div className="setting-group-heading"><strong>GitHub 主账户</strong><span>凭据由系统 Git Credential Manager 保存</span></div>
        <div className="cloud-account-card">
          <span className={`account-symbol ${status?.authenticated ? 'connected' : ''}`}>{status?.authenticated ? <ShieldCheck size={18} /> : <LogIn size={18} />}</span>
          <span><strong>{loading ? '正在检查登录状态' : status?.authenticated ? `@${status.username}` : '尚未登录 GitHub'}</strong><small>{status?.authenticated ? '可创建私人配置仓库并同步设备配置' : '登录后才能备份或发现其他设备配置'}</small></span>
          {!status?.authenticated && <button className="secondary-button" disabled={loading} onClick={() => void login()}>{loading ? <LoaderCircle className="spin" size={15} /> : <LogIn size={15} />}登录</button>}
        </div>
      </div>
      {accounts.length > 0 && <div>
        <div className="setting-group-heading"><strong>GitHub 多账号</strong><span>添加账号后，可在创建同步目标时选择使用哪个身份</span></div>
        <div className="account-list">
          {accounts.map((account) => <div className="account-row" key={account.username}><span className="collaborator-avatar">{account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : account.username.slice(0, 1).toUpperCase()}</span><span><strong>@{account.username}</strong><small>{account.displayName || 'GitHub 账号'}</small></span>{account.primary && <em>主账号</em>}</div>)}
          <button className="secondary-button" disabled={loading} onClick={() => void login()}>{loading ? <LoaderCircle className="spin" size={15} /> : <LogIn size={15} />}添加账号</button>
        </div>
      </div>}
      <div>
        <div className="setting-group-heading"><strong>私人主配置仓库</strong><span>固定名称：tianchuang-cloud-config</span></div>
        <div className="cloud-config-card">
          <div className="cloud-config-copy"><span className="cloud-config-icon"><Laptop size={21} /></span><span><strong>{status?.repositoryExists ? '主配置仓库已连接' : '尚未建立主配置仓库'}</strong><small>{status?.hasRemoteConfig ? `${status.workspaceCount} 个资料库 · 更新于 ${new Date(status.updatedAt || '').toLocaleString()}` : '保存资料库名称、目标地址和同步偏好，不保存密码或访问令牌'}</small></span></div>
          <div className="cloud-config-actions">
            {status?.repositoryUrl && <button className="plain-button" onClick={() => window.open(status.repositoryUrl)}>打开仓库</button>}
            {status?.config && <button className="secondary-button" onClick={() => onRequestRestore(status.config!)}><ArchiveRestore size={15} />查看恢复内容</button>}
            <button className="primary-button" disabled={!status?.authenticated || publishing} onClick={() => void publish()}>{publishing ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}{status?.hasRemoteConfig ? '更新云端配置' : '创建并备份'}</button>
          </div>
        </div>
      </div>
      <div className="performance-note"><ShieldCheck size={16} /><span>恢复操作只合并你明确选择的资料库，不会静默覆盖本机数据。WebDAV 密码、GitHub 令牌和系统凭据不会写入仓库。</span></div>
      {error && <div className="form-error cloud-config-error"><AlertTriangle size={15} />{error}</div>}
    </section>
  )
}

export default CursorSettingsDialog
