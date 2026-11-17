import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight, Cloud, FolderInput, GitBranch, HardDrive, Image as ImageIcon, Layers3, Orbit, Server, Waves } from 'lucide-react'
import { lazy, Suspense, type CSSProperties } from 'react'
import type { LibraryView } from './cursor-preferences'
import type { WorkspaceProfile } from '../../electron/types'
import FadeContent from './FadeContent'
import GridMotion from './GridMotion'
import { AccordionWorkspaceView, DepthWorkspaceView } from './WorkspaceShowcases'
import { relativeTime } from './workspace-meta'

const RippleDistortion = lazy(() => import('./RippleDistortion.jsx'))

const LIBRARY_PALETTES = [
  ['#6287ff', '#79d8eb'],
  ['#a779ff', '#637dff'],
  ['#43c49a', '#6ea8ff'],
  ['#ed8e72', '#ae78ff'],
  ['#5ebbe8', '#6476e8'],
  ['#e6ad58', '#e67589'],
  ['#6bbda9', '#98c969'],
  ['#987ee8', '#dd7db6'],
] as const

function targetIcon(kind: WorkspaceProfile['targets'][number]['config']['kind']) {
  if (kind === 'git') return <GitBranch size={12} />
  if (kind === 'webdav') return <Server size={12} />
  return <HardDrive size={12} />
}

function stateText(state: WorkspaceProfile['state']) {
  if (state === 'syncing' || state === 'checking') return '正在同步'
  if (state === 'attention') return '等待确认'
  if (state === 'error') return '需要处理'
  return '同步正常'
}

function WorkspaceOverview({ workspaces, thumbnails, backgrounds, backgroundImage, backgroundBlur, backgroundOpacity, libraryRippleEnabled, view, activeId, onChangeView, onFocus, onSelect, onAdd }: { workspaces: WorkspaceProfile[]; thumbnails: Record<string, string | undefined>; backgrounds: Record<string, string | undefined>; backgroundImage?: string; backgroundBlur: number; backgroundOpacity: number; libraryRippleEnabled: boolean; view: LibraryView; activeId?: string; onChangeView: (view: LibraryView) => void; onFocus: (workspaceId: string) => void; onSelect: (workspaceId: string) => void; onAdd: () => void }) {
  const featuredId = workspaces.find((workspace) => workspace.targets.length > 0)?.id ?? workspaces[0]?.id
  const connectedCount = workspaces.filter((workspace) => workspace.targets.length > 0).length
  const targetCount = workspaces.reduce((total, workspace) => total + workspace.targets.length, 0)
  const resolvedActiveId = workspaces.some((workspace) => workspace.id === activeId) ? activeId : featuredId
  const activeIndex = Math.max(0, workspaces.findIndex((workspace) => workspace.id === resolvedActiveId))
  const active = workspaces[activeIndex] ?? workspaces[0]
  const activePalette = LIBRARY_PALETTES[activeIndex % LIBRARY_PALETTES.length]
  const activeBackground = active ? backgrounds[active.id] || './assets/library-defaults/background-01.jpg' : ''
  return (
    <FadeContent className="library-overview" duration={320} blurAmount={7}>
      <section className="library-overview-header">
        <div className="library-overview-title"><h1>资料库</h1><p>{workspaces.length} 个资料库，{connectedCount} 个已连接，共 {targetCount} 个备份目标</p></div>
        <div className="overview-actions">
          <div className="view-switch" aria-label="资料库显示方式">
            <button className={view === 'glass' ? 'active' : ''} title="资料库星轨" aria-label="资料库星轨视图" aria-pressed={view === 'glass'} onClick={() => onChangeView('glass')}><Orbit size={16} /></button>
            <button className={view === 'motion' ? 'active' : ''} title="动态网格" aria-label="动态网格视图" aria-pressed={view === 'motion'} onClick={() => onChangeView('motion')}><Layers3 size={16} /></button>
            <button className={view === 'accordion' ? 'active' : ''} title="手风琴封面" aria-label="手风琴封面视图" aria-pressed={view === 'accordion'} onClick={() => onChangeView('accordion')}><ImageIcon size={16} /></button>
            <button className={view === 'depth' ? 'active' : ''} title="深度轮播" aria-label="深度轮播视图" aria-pressed={view === 'depth'} onClick={() => onChangeView('depth')}><Waves size={16} /></button>
          </div>
          <button className="primary-button library-add-button" onClick={onAdd}><FolderInput size={16} />添加资料库</button>
        </div>
      </section>
      {view === 'motion' ? <GridMotion workspaces={workspaces} backgrounds={backgrounds} activeId={resolvedActiveId} backgroundImage={backgroundImage} backgroundBlur={backgroundBlur} backgroundOpacity={backgroundOpacity} onFocus={onFocus} onOpen={onSelect} /> : view === 'accordion' ? <AccordionWorkspaceView workspaces={workspaces} covers={thumbnails} activeId={resolvedActiveId} onFocus={onFocus} onOpen={onSelect} /> : view === 'depth' ? <DepthWorkspaceView workspaces={workspaces} covers={thumbnails} activeId={resolvedActiveId} onFocus={onFocus} onOpen={onSelect} /> : (
        active && <section className="library-orbit-deck solo" aria-label="资料库星轨" style={{ '--library-accent': activePalette[0], '--library-accent-secondary': activePalette[1] } as CSSProperties}>
          <div className="library-focus-stage has-cover">
            <img className="library-focus-cover" src={activeBackground} alt="" />
            {libraryRippleEnabled && <Suspense fallback={null}><RippleDistortion className="library-focus-ripple" src={activeBackground} brushSize={220} strength={0.075} swirl={0.28} rings={3} spread={3.8} fade={2.3} spacing={38} dispersion={0.012} glint={0.13} tint="#78ddeb" tintAmount={0.06} highlightColor="#eafcff" grayscale={false} trigger="both" clickStrength={1.45} quality="medium" ambientStrength={0} overlayOnly maxActiveWaves={8} style={{}} /></Suspense>}
            <div className="library-focus-grid" aria-hidden="true" />
            <AnimatePresence mode="wait">
              <motion.div className="library-focus-content" key={active.id} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: .22, ease: [0.22, 1, 0.36, 1] }}>
                <span className="library-focus-status"><i className={`state-dot ${active.state}`} />{stateText(active.state)}</span>
                <div className="library-focus-title"><span className={thumbnails[active.id] ? 'has-thumbnail' : ''} aria-hidden="true">{thumbnails[active.id] ? <img src={thumbnails[active.id]} alt="" /> : active.name.trim().slice(0, 1).toUpperCase()}</span><div><h2>{active.name}</h2><p>{active.path}</p></div></div>
                <div className="library-focus-targets">
                  {active.targets.length ? active.targets.slice(0, 4).map((target) => <span key={target.id}>{targetIcon(target.config.kind)}{target.name}</span>) : <span className="empty"><Cloud size={13} />尚未连接备份目标</span>}
                </div>
                <div className="library-focus-footer"><span><strong>{active.targets.length}</strong>备份目标</span><span><strong>{active.lastSyncAt ? relativeTime(active.lastSyncAt) : '尚未'}</strong>最近同步</span><button onClick={() => onSelect(active.id)}>进入资料库<ArrowUpRight size={16} /></button></div>
              </motion.div>
            </AnimatePresence>
          </div>
        </section>
      )}
    </FadeContent>
  )
}

export default WorkspaceOverview
