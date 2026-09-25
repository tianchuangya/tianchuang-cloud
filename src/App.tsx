import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Activity, AlertTriangle, ArchiveRestore, ArrowLeft, Check, ChevronRight, Cloud, CloudUpload,
  Droplets, FileWarning, Folder, FolderInput, GitBranch, Globe2, Grid2X2, HardDrive, History, Image as ImageIcon, ImagePlus, Layers3, LoaderCircle,
  LockKeyhole, LogIn, Monitor, MoreHorizontal, MousePointer2, Plus, RefreshCw, Server,
  Settings, ShieldCheck, Sparkles, SunMedium, Trash2, Waves, X,
} from 'lucide-react'
import type {
  AppSnapshot, GitHubSession, ProviderKind, SyncPlan, SyncProgress, TargetDraft, WorkspaceProfile,
} from '../electron/types'
import AnimatedContent from './components/AnimatedContent'
import CursorExperience from './components/CursorExperience'
import FadeContent from './components/FadeContent'
import InteractiveBackdrop from './components/InteractiveBackdrop'
import GridMotion from './components/GridMotion'
import LogoLoop, { type LogoLoopItem } from './components/LogoLoop'
import {
  loadCursorPreferences, saveCursorPreferences, type BackgroundEffect, type CursorEffect, type CursorPreferences, type CursorStyle, type LibraryView,
} from './components/cursor-preferences'
import './App.css'

const EMPTY_SNAPSHOT: AppSnapshot = { workspaces: [], activity: [] }
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
    node: <><span className="loop-avatar">创</span><span><strong>是天创呀</strong><small>项目作者</small></span></>,
  },
]

function relativeTime(value?: string): string {
  if (!value) return '尚未同步'
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  return `${Math.floor(seconds / 86400)} 天前`
}

function providerLabel(kind: ProviderKind, locationType?: 'local' | 'removable' | 'network'): string {
  if (kind === 'git') return 'Git 仓库'
  if (kind === 'webdav') return 'WebDAV'
  if (locationType === 'removable') return '移动硬盘'
  if (locationType === 'network') return '网络磁盘 / NAS'
  return '本机文件夹'
}

function repositoryNameFor(value: string): string {
  return value.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'tianchuang-data'
}

function ProviderIcon({ kind }: { kind: ProviderKind }) {
  if (kind === 'git') return <GitBranch size={18} />
  if (kind === 'webdav') return <Server size={18} />
  return <HardDrive size={18} />
}

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(EMPTY_SNAPSHOT)
  const [selectedId, setSelectedId] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const [targetDialog, setTargetDialog] = useState(false)
  const [reviewPlan, setReviewPlan] = useState<SyncPlan>()
  const [progress, setProgress] = useState<SyncProgress>()
  const [notice, setNotice] = useState<string>()
  const [noticeError, setNoticeError] = useState(false)
  const [selectingFolder, setSelectingFolder] = useState(false)
  const [menuTargetId, setMenuTargetId] = useState<string>()
  const [workspaceMenu, setWorkspaceMenu] = useState<{ id: string; x: number; y: number }>()
  const [removeWorkspaceDialog, setRemoveWorkspaceDialog] = useState<WorkspaceProfile>()
  const [settingsDialog, setSettingsDialog] = useState(false)
  const [cursorPreferences, setCursorPreferences] = useState(loadCursorPreferences)
  const [showOverview, setShowOverview] = useState(true)
  const [coverUrls, setCoverUrls] = useState<Record<string, string | undefined>>({})
  const [customBackground, setCustomBackground] = useState<string>()

  const refresh = async () => {
    const next = await window.tianchuang.getSnapshot()
    setSnapshot(next)
    setSelectedId((current) => current && next.workspaces.some((item) => item.id === current)
      ? current
      : next.workspaces[0]?.id)
  }

  useEffect(() => {
    void window.tianchuang.getCustomBackground().then(setCustomBackground)
    void window.tianchuang.getSnapshot().then((next) => {
      setSnapshot(next)
      setSelectedId(next.workspaces[0]?.id)
    })
    const offProgress = window.tianchuang.onProgress((item) => {
      setProgress(item)
      if (item.phase === 'complete') window.setTimeout(() => setProgress(undefined), 1400)
    })
    const offAttention = window.tianchuang.onAttention((plan) => setReviewPlan(plan))
    const offSnapshot = window.tianchuang.onSnapshot(() => void refresh())
    return () => { offProgress(); offAttention(); offSnapshot() }
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all(snapshot.workspaces.map(async (workspace) => [workspace.id, await window.tianchuang.getWorkspaceCover(workspace.id)] as const))
      .then((entries) => { if (active) setCoverUrls(Object.fromEntries(entries)) })
    return () => { active = false }
  }, [snapshot.workspaces])

  useEffect(() => {
    if (!workspaceMenu) return
    const close = () => setWorkspaceMenu(undefined)
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('click', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', closeOnEscape) }
  }, [workspaceMenu])

  const selected = useMemo(
    () => snapshot.workspaces.find((item) => item.id === selectedId),
    [snapshot.workspaces, selectedId],
  )

  const addFolder = async (folderPath?: string) => {
    if (selectingFolder) return
    setSelectingFolder(true)
    setNoticeError(false)
    try {
      const chosen = folderPath || await window.tianchuang.selectFolder()
      if (!chosen) return
      const workspace = await window.tianchuang.addWorkspace(chosen)
      await refresh()
      setSelectedId(workspace.id)
      setShowOverview(false)
      setNotice('资料库已加入，正在监听文件变化')
      window.setTimeout(() => setNotice(undefined), 3200)
    } catch (reason) {
      setNoticeError(true)
      setNotice(`添加失败：${reason instanceof Error ? reason.message : String(reason)}`)
      window.setTimeout(() => setNotice(undefined), 5200)
    } finally {
      setSelectingFolder(false)
    }
  }

  const dropFolder = async (event: React.DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (!file) return
    const folderPath = window.tianchuang.folderFromFile(file)
    if (folderPath) await addFolder(folderPath)
  }

  const checkTarget = async (workspaceId: string, targetId: string) => {
    setProgress({ workspaceId, targetId, phase: 'checking', title: '正在检查版本', detail: '比较本地文件和远端历史', percent: 12 })
    try {
      const plan = await window.tianchuang.planSync(workspaceId, targetId)
      if (plan.direction === 'none') {
        setProgress({ workspaceId, targetId, phase: 'complete', title: '已经是最新版本', detail: '没有创建重复提交，也没有上传文件', percent: 100 })
        window.setTimeout(() => setProgress(undefined), 1500)
      } else if (plan.requiresConfirmation || plan.direction === 'blocked') {
        setProgress(undefined)
        setReviewPlan(plan)
      } else {
        await window.tianchuang.runSync(plan.id, { preserveLocalOnly: true })
        await refresh()
      }
    } catch (error) {
      setProgress({ workspaceId, targetId, phase: 'error', title: '检查失败', detail: error instanceof Error ? error.message : String(error), percent: 100 })
    }
  }

  const runReviewedPlan = async (preserveLocalOnly: boolean) => {
    if (!reviewPlan || reviewPlan.direction === 'blocked') return
    const plan = reviewPlan
    setReviewPlan(undefined)
    try {
      await window.tianchuang.runSync(plan.id, { preserveLocalOnly })
      await refresh()
    } catch { /* progress event contains recovery instructions */ }
  }

  const syncAllTargets = async () => {
    if (!selected) return
    setProgress({ workspaceId: selected.id, phase: 'checking', title: '正在检查全部目标', detail: '依次比较每个云端版本', percent: 8 })
    try {
      await window.tianchuang.syncWorkspace(selected.id)
      await refresh()
      setProgress((current) => current?.phase === 'checking'
        ? { workspaceId: selected.id, phase: 'complete', title: '全部检查完成', detail: '所有目标已处理', percent: 100 }
        : current)
      window.setTimeout(() => setProgress(undefined), 1500)
    } catch (error) {
      setProgress({ workspaceId: selected.id, phase: 'error', title: '同步失败', detail: error instanceof Error ? error.message : String(error), percent: 100 })
    }
  }

  const changeSetting = async (changes: Partial<Pick<WorkspaceProfile, 'autoSync' | 'syncOnFocus' | 'name'>>) => {
    if (!selected) return
    await window.tianchuang.updateWorkspace(selected.id, {
      name: changes.name ?? selected.name,
      autoSync: changes.autoSync ?? selected.autoSync,
      syncOnFocus: changes.syncOnFocus ?? selected.syncOnFocus,
    })
    await refresh()
  }

  const changeCursorPreferences = (next: CursorPreferences) => {
    setCursorPreferences(next)
    saveCursorPreferences(next)
  }

  const selectWorkspaceCover = async (workspaceId: string) => {
    setWorkspaceMenu(undefined)
    setNoticeError(false)
    try {
      const updated = await window.tianchuang.selectWorkspaceCover(workspaceId)
      if (!updated) return
      await refresh()
      const cover = await window.tianchuang.getWorkspaceCover(workspaceId)
      setCoverUrls((current) => ({ ...current, [workspaceId]: cover }))
      setNotice('封面已保存到资料库根目录，将随资料一起同步')
      window.setTimeout(() => setNotice(undefined), 3600)
    } catch (reason) {
      setNoticeError(true)
      setNotice(`设置封面失败：${reason instanceof Error ? reason.message : String(reason)}`)
      window.setTimeout(() => setNotice(undefined), 5200)
    }
  }

  const selectCustomBackground = async () => {
    try {
      const image = await window.tianchuang.selectCustomBackground()
      if (image) setCustomBackground(image)
    } catch (reason) {
      setNoticeError(true)
      setNotice(`背景图设置失败：${reason instanceof Error ? reason.message : String(reason)}`)
      window.setTimeout(() => setNotice(undefined), 5200)
    }
  }

  const resetCustomBackground = async () => {
    await window.tianchuang.resetCustomBackground()
    setCustomBackground(undefined)
  }

  return (
    <div
      className={`app-shell ${dragging ? 'is-dragging' : ''} ${cursorPreferences.style === 'rectangle' ? 'cursor-rectangle' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false) }}
      onDrop={(event) => void dropFolder(event)}
    >
      <InteractiveBackdrop effect={cursorPreferences.effect === 'fluid' ? 'none' : cursorPreferences.backgroundEffect} image={customBackground} />
      <CursorExperience preferences={cursorPreferences} />
      <header className="titlebar">
        <div className="brand-mark"><Cloud size={16} strokeWidth={2.3} /></div>
        <span>天创云端</span>
        <span className="titlebar-subtitle">Tianchuang Cloud</span>
      </header>

      <aside className="sidebar glass-material">
        <div className="sidebar-heading">
          <button className={`library-home-button ${showOverview ? 'active' : ''}`} onClick={() => setShowOverview(true)}><Grid2X2 size={13} /><span>资料库</span></button>
          <button className="icon-button" title="添加资料库" aria-label="添加资料库" disabled={selectingFolder} onClick={(event) => { event.stopPropagation(); void addFolder() }}>{selectingFolder ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}</button>
        </div>
        <nav className="workspace-list" aria-label="资料库列表">
          {snapshot.workspaces.map((workspace) => (
            <button key={workspace.id} className={`workspace-nav ${!showOverview && workspace.id === selectedId ? 'active' : ''}`} title="右键管理资料库" onClick={() => { setSelectedId(workspace.id); setShowOverview(false) }} onContextMenu={(event) => { event.preventDefault(); setSelectedId(workspace.id); setWorkspaceMenu({ id: workspace.id, x: event.clientX, y: event.clientY }) }}>
              <span className="nav-icon"><Folder size={17} /></span>
              <span className="nav-copy"><strong>{workspace.name}</strong><small>{workspace.targets.length} 个目标</small></span>
              <span className={`state-dot ${workspace.state}`} aria-label={workspace.state} />
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="sidebar-action add-library-action" disabled={selectingFolder} onClick={() => void addFolder()}><FolderInput size={17} /><span>添加资料库</span></button>
          <button className="sidebar-action"><Activity size={17} /><span>活动记录</span><span className="count">{snapshot.activity.length}</span></button>
          <button className="sidebar-action" onClick={() => setSettingsDialog(true)}><Settings size={17} /><span>设置</span></button>
        </div>
      </aside>

      <main className="content">
        {showOverview && snapshot.workspaces.length ? (
          <WorkspaceOverview
            workspaces={snapshot.workspaces}
            covers={coverUrls}
            view={cursorPreferences.libraryView}
            onChangeView={(libraryView) => changeCursorPreferences({ ...cursorPreferences, libraryView })}
            onSelect={(workspaceId) => { setSelectedId(workspaceId); setShowOverview(false) }}
            onAdd={() => void addFolder()}
          />
        ) : selected ? (
          <>
            <AnimatedContent key={`${selected.id}-header`} container=".content" direction="horizontal" reverse distance={26} duration={.28} initialOpacity={.15} scale={.995}>
            <section className="workspace-header">
              <div>
                <button className="workspace-back-button" onClick={() => setShowOverview(true)}><ArrowLeft size={15} />返回资料库</button>
                <div className="status-line"><span className={`status-pill ${selected.state}`}>{selected.state === 'syncing' ? '同步中' : selected.state === 'attention' ? '需要确认' : selected.state === 'error' ? '发生错误' : '已受保护'}</span><span>{relativeTime(selected.lastSyncAt)}</span></div>
                <h1>{selected.name}</h1>
                <p className="path-text" title={selected.path}>{selected.path}</p>
              </div>
              <div className="header-actions">
                <button className="secondary-button" onClick={() => setTargetDialog(true)}><Plus size={17} />添加目标</button>
                <button className="primary-button" onClick={() => void syncAllTargets()} disabled={selected.state === 'syncing'}><RefreshCw size={17} />立即同步</button>
              </div>
            </section>
            </AnimatedContent>

            <AnimatedContent key={`${selected.id}-summary`} container=".content" distance={14} duration={.24} delay={.03} scale={.992}>
            <section className="summary-strip" aria-label="同步摘要">
              <div><CloudUpload size={19} /><span><strong>{selected.targets.length}</strong>备份目标</span></div>
              <div><ShieldCheck size={19} /><span><strong>{selected.autoSync ? '开启' : '关闭'}</strong>后台同步</span></div>
              <div><History size={19} /><span><strong>{relativeTime(selected.lastSyncAt)}</strong>最近更新</span></div>
            </section>
            </AnimatedContent>

            <AnimatedContent key={`${selected.id}-targets`} container=".content" distance={16} duration={.26} delay={.06} scale={.992}>
            <section className="section-block">
              <div className="section-heading"><div><h2>同步目标</h2><p>同一份资料可同时备份到多个位置</p></div></div>
              {selected.targets.length ? (
                <div className="target-list">
                  {selected.targets.map((target) => (
                    <article className="target-row" key={target.id}>
                      <div className={`provider-icon ${target.config.kind}`}><ProviderIcon kind={target.config.kind} /></div>
                      <div className="target-main">
                        <div className="target-title"><strong>{target.name}</strong><span>{providerLabel(target.config.kind, target.config.kind === 'local' ? target.config.locationType : undefined)}</span></div>
                        <p title={target.config.kind === 'git' ? target.config.remoteUrl : target.config.kind === 'webdav' ? target.config.endpoint : target.config.destinationPath}>{target.config.kind === 'git' ? target.config.remoteUrl : target.config.kind === 'webdav' ? `${target.config.endpoint}${target.config.remotePath}` : target.config.destinationPath}</p>
                      </div>
                      <div className={`target-health ${target.lastError ? 'bad' : ''}`} title={target.lastError}><span />{target.lastError ? '异常' : '正常'}</div>
                      <button className="sync-button" onClick={() => void checkTarget(selected.id, target.id)}><RefreshCw size={16} />同步</button>
                      <div className="more-wrap">
                        <button className="icon-button" title="更多操作" onClick={() => setMenuTargetId(menuTargetId === target.id ? undefined : target.id)}><MoreHorizontal size={18} /></button>
                        {menuTargetId === target.id && <div className="context-menu glass-material"><button onClick={async () => { await window.tianchuang.removeTarget(selected.id, target.id); setMenuTargetId(undefined); await refresh() }}><Trash2 size={15} />移除目标</button></div>}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <button className="inline-empty" onClick={() => setTargetDialog(true)}>
                  <span className="empty-symbol"><CloudUpload size={24} /></span>
                  <span><strong>添加第一个同步目标</strong><small>支持 GitHub、Gitee、WebDAV 与本地磁盘</small></span>
                  <ChevronRight size={18} />
                </button>
              )}
            </section>
            </AnimatedContent>

            <AnimatedContent key={`${selected.id}-automation`} container=".content" distance={14} duration={.24} delay={.09} scale={.994}>
            <section className="section-block settings-block">
              <div className="section-heading"><div><h2>自动化</h2><p>应用在后台监控变化，并在需要选择时通知你</p></div></div>
              <label className="setting-row"><span><strong>文件变化后自动同步</strong><small>连续编辑结束约 3 秒后检查所有目标</small></span><input type="checkbox" checked={selected.autoSync} onChange={(event) => void changeSetting({ autoSync: event.target.checked })} /><i /></label>
              <label className="setting-row"><span><strong>打开应用时检查</strong><small>回到天创云端时拉取其他电脑的最新版本</small></span><input type="checkbox" checked={selected.syncOnFocus} onChange={(event) => void changeSetting({ syncOnFocus: event.target.checked })} /><i /></label>
            </section>
            </AnimatedContent>

            {snapshot.activity.some((item) => item.workspaceId === selected.id) && (
              <AnimatedContent key={`${selected.id}-activity`} container=".content" distance={14} duration={.24} delay={.12} scale={.994}>
              <section className="section-block activity-block">
                <div className="section-heading"><div><h2>最近活动</h2><p>同步结果与恢复信息</p></div></div>
                <div className="activity-list">
                  {snapshot.activity.filter((item) => item.workspaceId === selected.id).slice(0, 5).map((item) => (
                    <div className="activity-row" key={item.id}><span className={`activity-icon ${item.level}`}>{item.level === 'success' ? <Check size={14} /> : item.level === 'warning' || item.level === 'error' ? <AlertTriangle size={14} /> : <History size={14} />}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div><time>{relativeTime(item.createdAt)}</time></div>
                  ))}
                </div>
              </section>
              </AnimatedContent>
            )}

            <AnimatedContent key={`${selected.id}-project-links`} container=".content" distance={12} duration={.24} scale={.996}>
              <section className="project-loop-section" aria-labelledby="project-loop-title">
                <div className="project-loop-heading"><span id="project-loop-title">项目与作者</span><small>开源链接</small></div>
                <LogoLoop logos={PROJECT_LINKS} speed={28} hoverSpeed={5} gap={10} ariaLabel="天创云端项目与作者链接" />
              </section>
            </AnimatedContent>
          </>
        ) : (
          <FadeContent className="empty-state-reveal" duration={300} blurAmount={8}>
          <section className="empty-state">
            <div className="empty-cloud"><Cloud size={42} /></div>
            <h1>把资料放进天创云端</h1>
            <p>选择一个文件夹，或直接拖到窗口中。添加后可以同时同步到 GitHub、Gitee、WebDAV 和磁盘。</p>
            <button className="primary-button large" disabled={selectingFolder} onClick={() => void addFolder()}>{selectingFolder ? <LoaderCircle className="spin" size={19} /> : <FolderInput size={19} />}选择文件夹</button>
          </section>
          </FadeContent>
        )}
      </main>

      <AnimatePresence>
        {workspaceMenu && <motion.div className="workspace-context-menu glass-modal" style={{ left: workspaceMenu.x, top: workspaceMenu.y }} initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .97 }} onClick={(event) => event.stopPropagation()}><button className="neutral" onClick={() => void selectWorkspaceCover(workspaceMenu.id)}><ImagePlus size={15} />设置资料库封面</button><button onClick={() => { const workspace = snapshot.workspaces.find((item) => item.id === workspaceMenu.id); setWorkspaceMenu(undefined); setRemoveWorkspaceDialog(workspace) }}><Trash2 size={15} />从列表移除</button></motion.div>}
        {dragging && <motion.div className="drop-overlay glass-material" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div initial={{ scale: .96 }} animate={{ scale: 1 }}><FolderInput size={30} /><strong>松开以加入资料库</strong><span>文件夹内容不会被移动</span></motion.div></motion.div>}
        {targetDialog && selected && <TargetDialog workspace={selected} onClose={() => setTargetDialog(false)} onSaved={async () => { setTargetDialog(false); await refresh() }} />}
        {reviewPlan && <ReviewDialog plan={reviewPlan} onClose={() => setReviewPlan(undefined)} onRun={(preserve) => void runReviewedPlan(preserve)} />}
        {removeWorkspaceDialog && <RemoveWorkspaceDialog workspace={removeWorkspaceDialog} onClose={() => setRemoveWorkspaceDialog(undefined)} onRemove={async () => { await window.tianchuang.removeWorkspace(removeWorkspaceDialog.id); setRemoveWorkspaceDialog(undefined); await refresh(); setNoticeError(false); setNotice('资料库已从天创云端移除，本地文件未改动'); window.setTimeout(() => setNotice(undefined), 3600) }} />}
        {settingsDialog && <CursorSettingsDialog preferences={cursorPreferences} customBackground={customBackground} onSelectBackground={selectCustomBackground} onResetBackground={resetCustomBackground} onChange={changeCursorPreferences} onClose={() => setSettingsDialog(false)} />}
        {progress && <ProgressOverlay progress={progress} onClose={() => setProgress(undefined)} />}
        {notice && <motion.div className={`toast glass-material ${noticeError ? 'error' : ''}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>{noticeError ? <AlertTriangle size={16} /> : <Check size={16} />}{notice}</motion.div>}
      </AnimatePresence>
    </div>
  )
}

function WorkspaceOverview({ workspaces, covers, view, onChangeView, onSelect, onAdd }: { workspaces: WorkspaceProfile[]; covers: Record<string, string | undefined>; view: LibraryView; onChangeView: (view: LibraryView) => void; onSelect: (workspaceId: string) => void; onAdd: () => void }) {
  return (
    <FadeContent className="library-overview" duration={320} blurAmount={7}>
      <section className="library-overview-header">
        <div><span className="overview-eyebrow">所有资料库</span><h1>你的同步空间</h1><p>封面随资料库保存，换一台电脑也能保持相同识别方式。</p></div>
        <div className="overview-actions">
          <div className="view-switch" aria-label="资料库显示方式">
            <button className={view === 'glass' ? 'active' : ''} title="玻璃图标" aria-label="玻璃图标视图" aria-pressed={view === 'glass'} onClick={() => onChangeView('glass')}><Grid2X2 size={16} /></button>
            <button className={view === 'motion' ? 'active' : ''} title="动态网格" aria-label="动态网格视图" aria-pressed={view === 'motion'} onClick={() => onChangeView('motion')}><Layers3 size={16} /></button>
          </div>
          <button className="secondary-button" onClick={onAdd}><FolderInput size={16} />添加资料库</button>
        </div>
      </section>
      {view === 'motion' ? <GridMotion workspaces={workspaces} covers={covers} onSelect={onSelect} /> : (
        <section className="library-glass-grid" aria-label="资料库">
          {workspaces.map((workspace, index) => (
            <motion.button className="library-glass-card" key={workspace.id} onClick={() => onSelect(workspace.id)} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * .035, .18), duration: .24 }}>
              <span className={`library-card-cover ${covers[workspace.id] ? 'has-cover' : ''}`}>
                {covers[workspace.id] ? <img src={covers[workspace.id]} alt="" /> : <Folder size={34} />}
              </span>
              <span className="library-card-copy"><strong>{workspace.name}</strong><small>{workspace.path}</small></span>
              <span className="library-card-meta"><i className={`state-dot ${workspace.state}`} /><span>{workspace.targets.length} 个备份目标</span><ChevronRight size={15} /></span>
            </motion.button>
          ))}
        </section>
      )}
    </FadeContent>
  )
}

function CursorSettingsDialog({ preferences, customBackground, onSelectBackground, onResetBackground, onChange, onClose }: { preferences: CursorPreferences; customBackground?: string; onSelectBackground: () => Promise<void>; onResetBackground: () => Promise<void>; onChange: (preferences: CursorPreferences) => void; onClose: () => void }) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const setStyle = (style: CursorStyle) => onChange({ ...preferences, style })
  const setEffect = (effect: CursorEffect) => onChange({ ...preferences, effect })
  const setBackgroundEffect = (backgroundEffect: BackgroundEffect) => onChange({ ...preferences, backgroundEffect })
  const setLibraryView = (libraryView: LibraryView) => onChange({ ...preferences, libraryView })

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="modal glass-modal cursor-settings-modal" initial={{ opacity: 0, transform: 'translateY(10px) scale(.97)' }} animate={{ opacity: 1, transform: 'translateY(0) scale(1)' }} exit={{ opacity: 0, transform: 'translateY(8px) scale(.98)' }} transition={{ type: 'spring', bounce: 0, duration: .28 }}>
        <header><div className="settings-symbol"><MousePointer2 size={21} /></div><div><h2>外观与动态效果</h2><p>设置会立即预览并仅保存在这台设备上</p></div><button className="icon-button" title="关闭" onClick={onClose}><X size={18} /></button></header>
        <div className="cursor-settings-content">
          <FadeContent duration={220} blurAmount={4}>
          <section>
            <div className="setting-group-heading"><strong>指针外观</strong><span>选择日常操作时使用的指针</span></div>
            <div className="cursor-choice-grid two">
              <button className={preferences.style === 'rectangle' ? 'active' : ''} onClick={() => setStyle('rectangle')} aria-pressed={preferences.style === 'rectangle'}><span className="cursor-preview rectangle"><i /></span><span><strong>矩形高亮</strong><small>清晰、轻量，适合深色界面</small></span><Check size={15} /></button>
              <button className={preferences.style === 'system' ? 'active' : ''} onClick={() => setStyle('system')} aria-pressed={preferences.style === 'system'}><span className="cursor-preview system"><MousePointer2 size={20} /></span><span><strong>系统原生</strong><small>跟随 Windows、macOS 或 Linux</small></span><Check size={15} /></button>
            </div>
          </section>
          </FadeContent>
          <FadeContent duration={220} delay={55} blurAmount={4}>
          <section>
            <div className="setting-group-heading"><strong>背景图</strong><span>底图与动态效果相互独立</span></div>
            <div className="background-image-settings">
              <div className="background-image-preview">{customBackground ? <img src={customBackground} alt="当前自定义背景预览" /> : <img src="/assets/cloud-glass-bg.png" alt="默认背景预览" />}</div>
              <div><strong>{customBackground ? '自定义背景' : '天创云端默认背景'}</strong><small>{customBackground ? '图片已复制到应用数据目录' : '当前项目内置的玻璃云端背景'}</small><span><button className="secondary-button" onClick={() => void onSelectBackground()}><ImageIcon size={15} />选择图片</button>{customBackground && <button className="plain-button" onClick={() => void onResetBackground()}>恢复默认</button>}</span></div>
            </div>
          </section>
          </FadeContent>
          <FadeContent duration={220} delay={24} blurAmount={4}>
          <section>
            <div className="setting-group-heading"><strong>资料库视图</strong><span>选择进入资料库首页时的浏览方式</span></div>
            <div className="cursor-choice-grid two">
              <button className={preferences.libraryView === 'glass' ? 'active' : ''} onClick={() => setLibraryView('glass')} aria-pressed={preferences.libraryView === 'glass'}><span className="effect-preview quiet"><Grid2X2 size={20} /></span><span><strong>玻璃图标</strong><small>清晰直观，适合日常管理</small></span><Check size={15} /></button>
              <button className={preferences.libraryView === 'motion' ? 'active' : ''} onClick={() => setLibraryView('motion')} aria-pressed={preferences.libraryView === 'motion'} disabled={reduceMotion}><span className="effect-preview ripple"><Layers3 size={20} /></span><span><strong>动态网格</strong><small>使用封面构成有序运动网格</small></span><Check size={15} /></button>
            </div>
          </section>
          </FadeContent>
          <FadeContent duration={220} delay={30} blurAmount={4}>
          <section>
            <div className="setting-group-heading"><strong>指针配色</strong><span>分别设置空闲状态和控件吸附状态</span></div>
            <div className="cursor-color-grid">
              <label><span><strong>基础颜色</strong><small>{preferences.cursorColor}</small></span><input type="color" value={preferences.cursorColor} onChange={(event) => onChange({ ...preferences, cursorColor: event.target.value })} /></label>
              <label><span><strong>吸附颜色</strong><small>{preferences.cursorTargetColor}</small></span><input type="color" value={preferences.cursorTargetColor} onChange={(event) => onChange({ ...preferences, cursorTargetColor: event.target.value })} /></label>
            </div>
          </section>
          </FadeContent>
          <FadeContent duration={220} delay={35} blurAmount={4}>
          <section>
            <div className="setting-group-heading"><strong>动态轨迹</strong><span>装饰效果不会改变点击行为</span></div>
            <div className="cursor-choice-grid three">
              <button className={preferences.effect === 'none' ? 'active' : ''} onClick={() => setEffect('none')} aria-pressed={preferences.effect === 'none'}><span className="effect-preview quiet"><Monitor size={20} /></span><span><strong>关闭</strong><small>性能优先</small></span><Check size={15} /></button>
              <button className={preferences.effect === 'fluid' ? 'active' : ''} onClick={() => setEffect('fluid')} aria-pressed={preferences.effect === 'fluid'} disabled={reduceMotion}><span className="effect-preview fluid"><Waves size={20} /></span><span><strong>流体彩雾</strong><small>移动时产生渐色流体</small></span><Check size={15} /></button>
              <button className={preferences.effect === 'fireworks' ? 'active' : ''} onClick={() => setEffect('fireworks')} aria-pressed={preferences.effect === 'fireworks'} disabled={reduceMotion}><span className="effect-preview fireworks"><Sparkles size={20} /></span><span><strong>白色点击烟花</strong><small>缓慢扩散并柔和消退</small></span><Check size={15} /></button>
            </div>
          </section>
          </FadeContent>
          <FadeContent duration={220} delay={70} blurAmount={4}>
          <section>
            <div className="setting-group-heading"><strong>背景动态效果</strong><span>效果叠加在当前背景图上</span></div>
            <div className="cursor-choice-grid two">
              <button className={preferences.backgroundEffect === 'none' ? 'active' : ''} onClick={() => setBackgroundEffect('none')} aria-pressed={preferences.backgroundEffect === 'none'}><span className="effect-preview quiet"><Layers3 size={20} /></span><span><strong>无动态效果</strong><small>只显示背景图与透明玻璃材质</small></span><Check size={15} /></button>
              <button className={preferences.backgroundEffect === 'ripple' ? 'active' : ''} onClick={() => setBackgroundEffect('ripple')} aria-pressed={preferences.backgroundEffect === 'ripple'} disabled={reduceMotion}><span className="effect-preview ripple"><Droplets size={20} /></span><span><strong>水波折射</strong><small>移动和点击时扰动背景材质</small></span><Check size={15} /></button>
              <button className={preferences.backgroundEffect === 'rays' ? 'active' : ''} onClick={() => setBackgroundEffect('rays')} aria-pressed={preferences.backgroundEffect === 'rays'} disabled={reduceMotion}><span className="effect-preview rays"><SunMedium size={20} /></span><span><strong>侧光流束</strong><small>缓慢移动的半透明光束</small></span><Check size={15} /></button>
              <button className={preferences.backgroundEffect === 'particles' ? 'active' : ''} onClick={() => setBackgroundEffect('particles')} aria-pressed={preferences.backgroundEffect === 'particles'} disabled={reduceMotion}><span className="effect-preview particles"><Sparkles size={20} /></span><span><strong>微光粒子</strong><small>低密度白色粒子缓慢漂移</small></span><Check size={15} /></button>
            </div>
          </section>
          </FadeContent>
          {reduceMotion && <div className="motion-safety-note"><ShieldCheck size={16} /><span>系统已启用“减少动态效果”，动态轨迹会暂时停用，指针外观不受影响。</span></div>}
          {preferences.backgroundEffect === 'ripple' && preferences.effect === 'fluid' && <div className="motion-safety-note"><ShieldCheck size={16} /><span>流体彩雾启用期间，水波背景会自动暂停，避免两个实时流体效果同时占用 GPU。</span></div>}
          <div className="performance-note"><Waves size={16} /><span>流体彩雾使用 GPU 实时渲染；在电池模式或远程桌面中，建议选择点击烟花或关闭。</span></div>
        </div>
        <footer><button className="primary-button" onClick={onClose}>完成</button></footer>
      </motion.section>
    </motion.div>
  )
}

function RemoveWorkspaceDialog({ workspace, onClose, onRemove }: { workspace: WorkspaceProfile; onClose: () => void; onRemove: () => Promise<void> }) {
  const [removing, setRemoving] = useState(false)
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="modal glass-modal remove-workspace-modal" initial={{ opacity: 0, scale: .97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .98, y: 8 }} transition={{ type: 'spring', bounce: 0, duration: .28 }}>
        <header><div className="review-symbol danger"><Trash2 size={21} /></div><div><h2>移除“{workspace.name}”？</h2><p>它将不再出现在天创云端中，也不会继续后台同步。</p></div><button className="icon-button" title="关闭" onClick={onClose}><X size={18} /></button></header>
        <div className="remove-workspace-copy"><ShieldCheck size={18} /><span><strong>文件不会被删除</strong><small>本地文件夹、GitHub 仓库和其他云端备份都会原样保留。</small></span></div>
        <footer><button className="plain-button" onClick={onClose}>取消</button><button className="danger-button" disabled={removing} onClick={() => { setRemoving(true); void onRemove().catch(() => setRemoving(false)) }}>{removing ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}从列表移除</button></footer>
      </motion.section>
    </motion.div>
  )
}

function TargetDialog({ workspace, onClose, onSaved }: { workspace: WorkspaceProfile; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<ProviderKind>('git')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [provider, setProvider] = useState<'github' | 'gitee' | 'generic'>('github')
  const [repositoryMode, setRepositoryMode] = useState<'create' | 'existing'>('create')
  const [repositoryName, setRepositoryName] = useState(repositoryNameFor(workspace.name))
  const [repositoryPrivate, setRepositoryPrivate] = useState(true)
  const [githubAccount, setGitHubAccount] = useState<GitHubSession>()
  const [accountLoading, setAccountLoading] = useState(true)
  const [loginPending, setLoginPending] = useState(false)
  const [destinationPath, setDestinationPath] = useState('')
  const [locationType, setLocationType] = useState<'local' | 'removable' | 'network'>('local')
  const [endpoint, setEndpoint] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remotePath, setRemotePath] = useState(`/TianchuangCloud/${workspace.name}`)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.tianchuang.getGitHubSession()
      .then(setGitHubAccount)
      .catch((reason) => setGitHubAccount({ available: false, authenticated: false, message: reason instanceof Error ? reason.message : String(reason) }))
      .finally(() => setAccountLoading(false))
  }, [])

  const selectKind = (next: ProviderKind) => {
    setKind(next)
  }

  const login = async () => {
    setError('')
    setLoginPending(true)
    try {
      setGitHubAccount(await window.tianchuang.loginGitHub())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoginPending(false)
    }
  }

  const save = async () => {
    setError('')
    setSaving(true)
    try {
      let config: TargetDraft['config']
      let createdRepository = false
      if (kind === 'git') {
        let selectedRemote = remoteUrl.trim()
        if (provider === 'github' && repositoryMode === 'create') {
          if (!githubAccount?.authenticated) throw new Error('请先登录 GitHub')
          const repository = await window.tianchuang.createGitHubRepository({
            name: repositoryName,
            description: `${workspace.name} 的天创云端同步仓库`,
            private: repositoryPrivate,
          })
          selectedRemote = repository.cloneUrl
          createdRepository = true
        }
        if (!selectedRemote) throw new Error('请输入 Git 仓库地址')
        config = { kind, remoteUrl: selectedRemote, branch: branch.trim() || 'main', provider }
      } else if (kind === 'local') {
        if (!destinationPath) throw new Error('请选择备份磁盘或文件夹')
        config = { kind, destinationPath, locationType }
      } else {
        if (!endpoint || !username) throw new Error('请填写 WebDAV 地址和用户名')
        config = { kind, endpoint: endpoint.trim(), username: username.trim(), remotePath: remotePath.trim() }
      }
      await window.tianchuang.addTarget({ workspaceId: workspace.id, name: providerLabel(kind, kind === 'local' ? locationType : undefined), maxFileSizeMb: kind === 'git' ? 100 : 2048, config, password })
      if (createdRepository) await window.tianchuang.syncWorkspace(workspace.id)
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setSaving(false)
    }
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="modal glass-modal target-modal" initial={{ opacity: 0, scale: .97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .98, y: 8 }} transition={{ type: 'spring', bounce: 0, duration: .32 }}>
        <header><div><h2>添加同步目标</h2><p>一份资料可以同时备份到多个位置</p></div><button className="icon-button" title="关闭" onClick={onClose}><X size={18} /></button></header>
        <div className="provider-tabs" role="tablist">
          <button className={kind === 'git' ? 'active' : ''} onClick={() => selectKind('git')}><GitBranch size={17} />GitHub / Gitee</button>
          <button className={kind === 'webdav' ? 'active' : ''} onClick={() => selectKind('webdav')}><Server size={17} />WebDAV</button>
          <button className={kind === 'local' ? 'active' : ''} onClick={() => selectKind('local')}><HardDrive size={17} />磁盘</button>
        </div>
        <FadeContent key={`${kind}-${provider}-${repositoryMode}`} className="form-panel-reveal" duration={230} blurAmount={5} role="tabpanel">
        <div className="form-grid">
          {kind === 'git' && <>
            <label className="field"><span>服务</span><select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}><option value="github">GitHub</option><option value="gitee">Gitee</option><option value="generic">其他 Git</option></select></label>
            <label className="field"><span>分支</span><input value={branch} onChange={(event) => setBranch(event.target.value)} /></label>
            {provider === 'github' && <>
              <div className="github-account full">
                <span className={`account-symbol ${githubAccount?.authenticated ? 'connected' : ''}`}>{githubAccount?.authenticated ? <ShieldCheck size={17} /> : <LogIn size={17} />}</span>
                <span><strong>{accountLoading ? '正在检查 GitHub 登录' : githubAccount?.authenticated ? githubAccount.displayName || githubAccount.username : '尚未登录 GitHub'}</strong><small>{githubAccount?.authenticated ? `@${githubAccount.username} · 凭据保存在系统中` : githubAccount?.available === false ? '需要安装 Git Credential Manager' : '登录后可直接创建仓库'}</small></span>
                {!accountLoading && !githubAccount?.authenticated && <button type="button" disabled={loginPending || githubAccount?.available === false} onClick={() => void login()}>{loginPending ? <LoaderCircle className="spin" size={15} /> : <LogIn size={15} />}登录</button>}
              </div>
              <div className="repository-mode full" role="group" aria-label="仓库来源">
                <button type="button" className={repositoryMode === 'create' ? 'active' : ''} onClick={() => setRepositoryMode('create')}>新建仓库</button>
                <button type="button" className={repositoryMode === 'existing' ? 'active' : ''} onClick={() => setRepositoryMode('existing')}>已有仓库</button>
              </div>
              {repositoryMode === 'create' ? <>
                <label className="field full"><span>仓库名称</span><input value={repositoryName} onChange={(event) => setRepositoryName(event.target.value)} placeholder="study-notes" /></label>
                <div className="visibility-options full">
                  <button type="button" className={repositoryPrivate ? 'active' : ''} onClick={() => setRepositoryPrivate(true)}><LockKeyhole size={16} /><span><strong>私有仓库</strong><small>仅你和授权成员可见</small></span></button>
                  <button type="button" className={!repositoryPrivate ? 'active' : ''} onClick={() => setRepositoryPrivate(false)}><Globe2 size={16} /><span><strong>公开仓库</strong><small>任何人都可以查看</small></span></button>
                </div>
              </> : <label className="field full"><span>仓库地址</span><input placeholder="https://github.com/用户名/仓库.git" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} /></label>}
            </>}
            {provider !== 'github' && <label className="field full"><span>仓库地址</span><input placeholder="https://gitee.com/用户名/仓库.git" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} /></label>}
            <div className="form-note full"><ShieldCheck size={16} /><span>GitHub 登录由系统 Git Credential Manager 处理，访问令牌不会写入天创云端配置。</span></div>
          </>}
          {kind === 'local' && <>
            <label className="field full"><span>位置类型</span><select value={locationType} onChange={(event) => setLocationType(event.target.value as typeof locationType)}><option value="local">本机文件夹</option><option value="removable">移动硬盘</option><option value="network">网络磁盘 / NAS</option></select></label>
            <label className="field full"><span>目标文件夹</span><div className="input-action"><input readOnly value={destinationPath} placeholder="选择移动硬盘、NAS 挂载目录或其他文件夹" /><button onClick={async () => { const value = await window.tianchuang.selectMirrorFolder(); if (value) setDestinationPath(value) }}>选择</button></div></label>
            <div className="form-note full"><ArchiveRestore size={16} /><span>{locationType === 'network' ? '网络磁盘或 NAS 需要先由操作系统挂载为可访问目录。' : locationType === 'removable' ? '移动硬盘断开时会停止该目标同步，不会影响其他备份。' : '本机文件夹适合备份到另一块内置磁盘或固定目录。'}镜像只复制新增和变化文件，不自动删除历史文件。</span></div>
          </>}
          {kind === 'webdav' && <>
            <label className="field full"><span>服务器地址</span><input placeholder="https://cloud.example.com/remote.php/dav/files/name" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></label>
            <label className="field"><span>用户名</span><input value={username} onChange={(event) => setUsername(event.target.value)} /></label>
            <label className="field"><span>密码或应用密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label className="field full"><span>远端路径</span><input value={remotePath} onChange={(event) => setRemotePath(event.target.value)} /></label>
          </>}
        </div>
        </FadeContent>
        {error && <div className="form-error" role="alert"><AlertTriangle size={15} />{error}</div>}
        <footer><button className="plain-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}添加目标</button></footer>
      </motion.section>
    </motion.div>
  )
}

function ReviewDialog({ plan, onClose, onRun }: { plan: SyncPlan; onClose: () => void; onRun: (preserve: boolean) => void }) {
  const blocked = plan.direction === 'blocked'
  const localOnly = plan.issues.filter((item) => item.kind === 'local-only')
  const tooLarge = plan.issues.filter((item) => item.kind === 'too-large')
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="modal glass-modal review-modal" initial={{ opacity: 0, scale: .97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .98, y: 8 }} transition={{ type: 'spring', bounce: 0, duration: .32 }}>
        <header><div className={`review-symbol ${blocked ? 'danger' : ''}`}>{blocked ? <FileWarning size={22} /> : <ArchiveRestore size={22} />}</div><div><h2>{blocked ? '同步暂时无法继续' : '发现本地独有内容'}</h2><p>{plan.summary}</p></div><button className="icon-button" title="关闭" onClick={onClose}><X size={18} /></button></header>
        <div className="plan-steps">{plan.actions.map((action, index) => <div key={action}><span>{index + 1}</span>{action}</div>)}</div>
        {localOnly.length > 0 && <div className="issue-list"><strong>仅在这台电脑上发现</strong>{localOnly.slice(0, 8).map((item) => <div key={item.path}><Folder size={15} /><span>{item.path}</span></div>)}{localOnly.length > 8 && <small>以及另外 {localOnly.length - 8} 个文件</small>}</div>}
        {tooLarge.length > 0 && <div className="issue-list danger"><strong>超过目标大小限制</strong>{tooLarge.slice(0, 8).map((item) => <div key={item.path}><FileWarning size={15} /><span>{item.path}</span></div>)}</div>}
        <div className="recovery-note"><ShieldCheck size={16} /><span>执行前会在应用数据目录生成恢复副本，发生冲突时不会静默覆盖。</span></div>
        <footer>
          <button className="plain-button" onClick={onClose}>稍后处理</button>
          {!blocked && localOnly.length > 0 && <button className="secondary-button" onClick={() => onRun(false)}>以远端为准</button>}
          {!blocked && <button className="primary-button" onClick={() => onRun(true)}><ArchiveRestore size={17} />保留并合并</button>}
        </footer>
      </motion.section>
    </motion.div>
  )
}

function ProgressOverlay({ progress, onClose }: { progress: SyncProgress; onClose: () => void }) {
  const done = progress.phase === 'complete' || progress.phase === 'error'
  return (
    <motion.div className="progress-float glass-modal" initial={{ opacity: 0, scale: .94, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .96, y: 10 }} transition={{ type: 'spring', bounce: .08, duration: .36 }}>
      <div className={`progress-symbol ${progress.phase}`}>{progress.phase === 'complete' ? <Check size={20} /> : progress.phase === 'error' ? <AlertTriangle size={20} /> : <RefreshCw className="spin" size={20} />}</div>
      <div className="progress-copy"><strong>{progress.title}</strong><span>{progress.detail}</span><div className="progress-track"><motion.i animate={{ width: `${progress.percent}%` }} /></div></div>
      {done && <button className="icon-button" title="关闭" onClick={onClose}><X size={16} /></button>}
    </motion.div>
  )
}

export default App
