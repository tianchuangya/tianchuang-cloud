import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRightLeft, Check, ChevronRight, Cloud, CloudOff, CloudUpload, Folder, FolderInput,
  GitBranch, Grid2X2, HardDrive, History, ImagePlus, Images, ListChecks, LoaderCircle, MoreHorizontal, Plus, RefreshCw,
  Server, Share2, Settings, ShieldCheck, Trash2,
} from 'lucide-react'
import type {
  AppSnapshot, CloudConfigDocument, ProviderKind, SyncDecision, SyncPlan, SyncProgress, SyncTarget, WorkspaceProfile,
} from '../electron/types'
import AnimatedContent from './components/AnimatedContent'
import CursorExperience from './components/CursorExperience'
import FadeContent from './components/FadeContent'
import InteractiveBackdrop from './components/InteractiveBackdrop'
import StartupExperience from './components/StartupExperience'
import { ProgressOverlay, ReviewDialog } from './components/SyncDialogs'
import WorkspaceOverview from './components/WorkspaceOverview'
import { providerLabel, relativeTime } from './components/workspace-meta'
import {
  loadCursorPreferences, saveCursorPreferences, type BackgroundEffect, type CursorPreferences,
} from './components/cursor-preferences'
import './App.css'

const SettingsDialog = lazy(() => import('./components/SettingsDialog'))
const TargetDialog = lazy(() => import('./components/TargetDialog'))
const CollaborationDialog = lazy(() => import('./components/CollaborationDialog'))
const CloudRestoreDialog = lazy(() => import('./components/CloudRestoreDialog'))
const CoverCropDialog = lazy(() => import('./components/CoverCropDialog'))
const RemoveWorkspaceDialog = lazy(() => import('./components/RemoveWorkspaceDialog'))
const DangerConfirmDialog = lazy(() => import('./components/DangerConfirmDialog'))
const MigrationDialog = lazy(() => import('./components/MigrationDialog'))
const RandomCoverDialog = lazy(() => import('./components/RandomCoverDialog'))

const EMPTY_SNAPSHOT: AppSnapshot = { workspaces: [], activity: [] }
type AppNavigationState = { view: 'overview' | 'workspace'; workspaceId?: string; settings?: boolean }

function ProviderIcon({ kind }: { kind: ProviderKind }) {
  if (kind === 'git') return <GitBranch size={18} />
  if (kind === 'webdav') return <Server size={18} />
  return <HardDrive size={18} />
}

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(EMPTY_SNAPSHOT)
  const [windowMaximized, setWindowMaximized] = useState(false)
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
  const [appReady, setAppReady] = useState(false)
  const [showStartup, setShowStartup] = useState(() => {
    const preferences = loadCursorPreferences()
    return preferences.startupMode === 'always' || (preferences.startupMode === 'once' && localStorage.getItem('tianchuang.startup-seen.v1') !== 'true')
  })
  const [showOverview, setShowOverview] = useState(true)
  const [coverUrls, setCoverUrls] = useState<Record<string, string | undefined>>({})
  const [customBackground, setCustomBackground] = useState<string>()
  const [backgroundEffectPreview, setBackgroundEffectPreview] = useState<BackgroundEffect>()
  const [coverCrop, setCoverCrop] = useState<{ workspace: WorkspaceProfile; source: string }>()
  const [collaborationTarget, setCollaborationTarget] = useState<SyncTarget>()
  const [cloudRestore, setCloudRestore] = useState<CloudConfigDocument>()
  const [removeTargetDialog, setRemoveTargetDialog] = useState<{ workspace: WorkspaceProfile; target: SyncTarget }>()
  const [deleteBackupsDialog, setDeleteBackupsDialog] = useState<WorkspaceProfile>()
  const [randomCover, setRandomCover] = useState<WorkspaceProfile>()
  const [migrationDialog, setMigrationDialog] = useState<{ workspace: WorkspaceProfile; target: SyncTarget }>()
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkSelected, setBulkSelected] = useState<string[]>([])
  const [bulkRemoveDialog, setBulkRemoveDialog] = useState(false)
  const [workspaceFilter, setWorkspaceFilter] = useState('')

  const applyNavigation = (state: AppNavigationState) => {
    setShowOverview(state.view === 'overview')
    if (state.workspaceId) setSelectedId(state.workspaceId)
    setSettingsDialog(Boolean(state.settings))
    if (!state.settings) setBackgroundEffectPreview(undefined)
  }

  const navigate = (state: AppNavigationState) => {
    window.history.pushState({ tianchuangNavigation: state }, '')
    applyNavigation(state)
  }

  const currentNavigation = (): AppNavigationState => ({
    view: showOverview ? 'overview' : 'workspace',
    workspaceId: selectedId,
  })

  const closeSettings = () => {
    const state = window.history.state?.tianchuangNavigation as AppNavigationState | undefined
    if (state?.settings) window.history.back()
    else {
      setBackgroundEffectPreview(undefined)
      setSettingsDialog(false)
    }
  }

  const completeStartup = useCallback(() => {
    localStorage.setItem('tianchuang.startup-seen.v1', 'true')
    setShowStartup(false)
  }, [])

  const refresh = async () => {
    const next = await window.tianchuang.getSnapshot()
    setSnapshot(next)
    setSelectedId((current) => current && next.workspaces.some((item) => item.id === current)
      ? current
      : next.workspaces[0]?.id)
  }

  useEffect(() => {
    void window.tianchuang.getWindowMaximized().then(setWindowMaximized)
    return window.tianchuang.onWindowMaximized(setWindowMaximized)
  }, [])

  useEffect(() => {
    void window.tianchuang.getCustomBackground().then(setCustomBackground)
    void window.tianchuang.getSnapshot().then((next) => {
      setSnapshot(next)
      setSelectedId(next.workspaces[0]?.id)
      void window.tianchuang.getCloudConfigStatus().then((status) => {
        const config = status.config
        const hasUnseenWorkspace = config?.workspaces.some((remote) => !next.workspaces.some((local) => local.id === remote.id))
        const dismissed = config ? localStorage.getItem('tianchuang.cloud-config-dismissed') === config.updatedAt : true
        if (config && hasUnseenWorkspace && !dismissed) setCloudRestore(config)
      })
    }).finally(() => setAppReady(true))
    const offProgress = window.tianchuang.onProgress((item) => {
      setProgress(item)
      if (item.phase === 'complete') window.setTimeout(() => setProgress(undefined), 1400)
    })
    const offAttention = window.tianchuang.onAttention((plan) => setReviewPlan(plan))
    const offSnapshot = window.tianchuang.onSnapshot(() => void refresh())
    return () => { offProgress(); offAttention(); offSnapshot() }
  }, [])

  useEffect(() => {
    window.history.replaceState({ tianchuangNavigation: { view: 'overview' } satisfies AppNavigationState }, '')
    const onPopState = (event: PopStateEvent) => {
      const state = event.state?.tianchuangNavigation as AppNavigationState | undefined
      applyNavigation(state || { view: 'overview' })
    }
    const onMouseSideButton = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return
      event.preventDefault()
      event.stopPropagation()
      if (event.button === 3) window.history.back()
      else window.history.forward()
    }
    window.addEventListener('popstate', onPopState)
    window.addEventListener('mousedown', onMouseSideButton, true)
    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('mousedown', onMouseSideButton, true)
    }
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

  useEffect(() => {
    if (!menuTargetId) return
    const close = () => setMenuTargetId(undefined)
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('click', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', closeOnEscape) }
  }, [menuTargetId])

  const selected = useMemo(
    () => snapshot.workspaces.find((item) => item.id === selectedId),
    [snapshot.workspaces, selectedId],
  )

  const visibleWorkspaces = useMemo(() => {
    const query = workspaceFilter.trim().toLowerCase()
    if (!query) return snapshot.workspaces
    return snapshot.workspaces.filter((workspace) => workspace.name.toLowerCase().includes(query))
  }, [snapshot.workspaces, workspaceFilter])

  const addFolder = async (folderPath?: string) => {
    if (selectingFolder) return
    setSelectingFolder(true)
    setNoticeError(false)
    try {
      const chosen = folderPath || await window.tianchuang.selectFolder()
      if (!chosen) return
      const workspace = await window.tianchuang.addWorkspace(chosen)
      await refresh()
      navigate({ view: 'workspace', workspaceId: workspace.id })
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
        await window.tianchuang.runSync(plan.id, { preserveLocalOnly: true, deleteRemote: false })
        await refresh()
      }
    } catch (error) {
      setProgress({ workspaceId, targetId, phase: 'error', title: '检查失败', detail: error instanceof Error ? error.message : String(error), percent: 100 })
    }
  }

  const runReviewedPlan = async (decision: SyncDecision) => {
    if (!reviewPlan || reviewPlan.direction === 'blocked') return
    const plan = reviewPlan
    setReviewPlan(undefined)
    try {
      await window.tianchuang.runSync(plan.id, decision)
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

  const changeSetting = async (changes: Partial<Pick<WorkspaceProfile, 'autoSync' | 'syncOnChange' | 'syncOnFocus' | 'autoSyncDelaySeconds' | 'errorNotifyCooldownMinutes' | 'name'>>) => {
    if (!selected) return
    await window.tianchuang.updateWorkspace(selected.id, {
      name: changes.name ?? selected.name,
      autoSync: changes.autoSync ?? selected.autoSync,
      syncOnChange: changes.syncOnChange ?? selected.syncOnChange ?? true,
      syncOnFocus: changes.syncOnFocus ?? selected.syncOnFocus,
      autoSyncDelaySeconds: changes.autoSyncDelaySeconds ?? selected.autoSyncDelaySeconds ?? 3,
      errorNotifyCooldownMinutes: changes.errorNotifyCooldownMinutes ?? selected.errorNotifyCooldownMinutes ?? 10,
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
      const workspace = snapshot.workspaces.find((item) => item.id === workspaceId)
      const source = await window.tianchuang.pickWorkspaceCover(workspaceId)
      if (workspace && source) setCoverCrop({ workspace, source })
    } catch (reason) {
      setNoticeError(true)
      setNotice(`设置封面失败：${reason instanceof Error ? reason.message : String(reason)}`)
      window.setTimeout(() => setNotice(undefined), 5200)
    }
  }

  const saveCroppedCover = async (dataUrl: string) => {
    if (!coverCrop) return
    const workspaceId = coverCrop.workspace.id
    await window.tianchuang.saveWorkspaceCover(workspaceId, dataUrl)
    setCoverCrop(undefined)
    await refresh()
    const cover = await window.tianchuang.getWorkspaceCover(workspaceId)
    setCoverUrls((current) => ({ ...current, [workspaceId]: cover }))
    setNoticeError(false)
    setNotice('封面选区已保存，将随资料一起同步')
    window.setTimeout(() => setNotice(undefined), 3600)
  }

  const saveRandomCover = async (dataUrl: string) => {
    if (!randomCover) return
    const workspaceId = randomCover.id
    await window.tianchuang.saveWorkspaceCover(workspaceId, dataUrl)
    setRandomCover(undefined)
    await refresh()
    const cover = await window.tianchuang.getWorkspaceCover(workspaceId)
    setCoverUrls((current) => ({ ...current, [workspaceId]: cover }))
    setNoticeError(false)
    setNotice('随机封面已应用，将随资料一起同步')
    window.setTimeout(() => setNotice(undefined), 3600)
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
      className={`app-shell ${windowMaximized ? 'window-maximized' : ''} ${dragging ? 'is-dragging' : ''} ${cursorPreferences.style === 'rectangle' ? 'cursor-rectangle' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false) }}
      onDrop={(event) => void dropFolder(event)}
    >
      <InteractiveBackdrop effect={cursorPreferences.effect === 'fluid' ? 'none' : (backgroundEffectPreview || cursorPreferences.backgroundEffect)} image={customBackground} blur={cursorPreferences.backgroundBlur} opacity={cursorPreferences.backgroundOpacity} />
      <CursorExperience preferences={cursorPreferences} />
      <AnimatePresence>{showStartup && <StartupExperience key="startup-experience" ready={appReady} effect={cursorPreferences.startupEffect} onComplete={completeStartup} />}</AnimatePresence>
      <header className="titlebar">
        <div className="brand-mark"><img src="/assets/app-icon.png" alt="" /></div>
        <span>天创云端</span>
        <span className="titlebar-subtitle">Tianchuang Cloud</span>
      </header>

      <aside className="sidebar glass-material">
        <div className="sidebar-heading">
          <button className={`library-home-button ${showOverview ? 'active' : ''}`} onClick={() => navigate({ view: 'overview' })}><Grid2X2 size={13} /><span>资料库</span></button>
          <button className="icon-button" title="添加资料库" aria-label="添加资料库" disabled={selectingFolder} onClick={(event) => { event.stopPropagation(); void addFolder() }}>{selectingFolder ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}</button>
        </div>
        <input className="workspace-search" type="search" placeholder="查找资料库" aria-label="查找资料库" value={workspaceFilter} onChange={(event) => setWorkspaceFilter(event.target.value)} />
        <nav className="workspace-list" aria-label="资料库列表">
          {visibleWorkspaces.map((workspace) => (
            <button key={workspace.id} className={`workspace-nav ${!showOverview && workspace.id === selectedId ? 'active' : ''} ${bulkMode && bulkSelected.includes(workspace.id) ? 'bulk-selected' : ''}`} title={bulkMode ? '点击选择或取消选择' : '右键管理资料库'} onClick={() => { if (bulkMode) { setBulkSelected((current) => current.includes(workspace.id) ? current.filter((id) => id !== workspace.id) : [...current, workspace.id]); return } navigate({ view: 'workspace', workspaceId: workspace.id }) }} onContextMenu={(event) => { if (bulkMode) { event.preventDefault(); setBulkSelected((current) => current.includes(workspace.id) ? current.filter((id) => id !== workspace.id) : [...current, workspace.id]); return } event.preventDefault(); setSelectedId(workspace.id); setWorkspaceMenu({ id: workspace.id, x: event.clientX, y: event.clientY }) }}>
              <span className={`nav-icon ${coverUrls[workspace.id] ? 'has-cover' : ''}`}>
                {coverUrls[workspace.id] ? <img src={coverUrls[workspace.id]} alt="" /> : <Folder size={17} />}
              </span>
              <span className="nav-copy"><strong>{workspace.name}</strong><small>{workspace.targets.length} 个目标</small></span>
              {bulkMode && <span className={`bulk-check ${bulkSelected.includes(workspace.id) ? 'on' : ''}`} aria-hidden="true" />}
              {!bulkMode && <span className={`state-dot ${workspace.state}`} aria-label={workspace.state} />}
            </button>
          ))}
          {!visibleWorkspaces.length && <div className="workspace-search-empty">没有匹配“{workspaceFilter.trim()}”的资料库</div>}
        </nav>
        <div className="sidebar-footer">
          <button className="sidebar-action add-library-action" disabled={selectingFolder} onClick={() => void addFolder()}><FolderInput size={17} /><span>添加资料库</span></button>
          <button className="sidebar-action"><Activity size={17} /><span>活动记录</span><span className="count">{snapshot.activity.length}</span></button>
          <button className="sidebar-action" onClick={() => navigate({ ...currentNavigation(), settings: true })}><Settings size={17} /><span>设置</span></button>
        </div>
      </aside>

      <main className="content">
        {showOverview && snapshot.workspaces.length ? (
          <WorkspaceOverview
            workspaces={snapshot.workspaces}
            covers={coverUrls}
            backgroundImage={customBackground}
            backgroundBlur={cursorPreferences.backgroundBlur}
            backgroundOpacity={cursorPreferences.backgroundOpacity}
            view={cursorPreferences.libraryView}
            onChangeView={(libraryView) => changeCursorPreferences({ ...cursorPreferences, libraryView })}
            onSelect={(workspaceId) => navigate({ view: 'workspace', workspaceId })}
            onAdd={() => void addFolder()}
          />
        ) : selected ? (
          <>
            <AnimatedContent key={`${selected.id}-header`} container=".content" direction="horizontal" reverse distance={26} duration={.28} initialOpacity={.15} scale={.995}>
            <section className="workspace-header">
              <div>
                <button className="workspace-back-button" onClick={() => navigate({ view: 'overview' })}><ArrowLeft size={15} />返回资料库</button>
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
              <div className="section-heading with-action"><div><h2>同步目标</h2><p>同一份资料可同时备份到多个位置</p></div><button className="secondary-button" onClick={() => setTargetDialog(true)}><Plus size={14} />添加目标</button></div>
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
                        {menuTargetId === target.id && <div className="context-menu glass-material" onClick={(event) => event.stopPropagation()}>{target.config.kind === 'git' && target.config.provider === 'github' && <button onClick={() => { setCollaborationTarget(target); setMenuTargetId(undefined) }}><Share2 size={15} />协作与分享</button>}{selected.targets.length > 1 && <button onClick={() => { setMigrationDialog({ workspace: selected, target }); setMenuTargetId(undefined) }}><ArrowRightLeft size={15} />迁移到其他目标</button>}<button className="danger" onClick={() => { setRemoveTargetDialog({ workspace: selected, target }); setMenuTargetId(undefined) }}><Trash2 size={15} />移除目标</button></div>}
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
              <div className="section-heading"><div><h2>自动同步</h2><p>控制这个资料库何时在后台检查并同步</p></div></div>
              <label className="setting-row master-setting-row"><span><strong>自动同步总开关</strong><small>关闭后只保留“立即同步”，不会在后台自动传输</small></span><input type="checkbox" checked={selected.autoSync} onChange={(event) => void changeSetting({ autoSync: event.target.checked })} /><i /></label>
              <label className={`setting-row ${selected.autoSync ? '' : 'disabled'}`}><span><strong>文件变化后同步</strong><small>连续编辑结束后，按下面设置的等待时间检查所有目标</small></span><input type="checkbox" disabled={!selected.autoSync} checked={selected.syncOnChange !== false} onChange={(event) => void changeSetting({ syncOnChange: event.target.checked })} /><i /></label>
              <label className={`setting-row ${selected.autoSync ? '' : 'disabled'}`}><span><strong>打开应用时检查</strong><small>回到天创云端时拉取其他电脑的最新版本</small></span><input type="checkbox" disabled={!selected.autoSync} checked={selected.syncOnFocus} onChange={(event) => void changeSetting({ syncOnFocus: event.target.checked })} /><i /></label>
              <label className={`setting-range-row ${selected.autoSync && selected.syncOnChange !== false ? '' : 'disabled'}`}><span><strong>自动同步频率</strong><small>最后一次文件变化后等待多久再同步</small></span><input aria-label="自动同步频率" type="range" min="3" max="300" step="1" disabled={!selected.autoSync || selected.syncOnChange === false} value={selected.autoSyncDelaySeconds ?? 3} onChange={(event) => void changeSetting({ autoSyncDelaySeconds: Number(event.target.value) })} /><output>{selected.autoSyncDelaySeconds ?? 3} 秒</output></label>
              <label className={`setting-range-row ${selected.autoSync ? '' : 'disabled'}`}><span><strong>失败告警频率</strong><small>同一资料库持续失败时，限制弹窗与系统通知频率</small></span><input aria-label="失败告警频率" type="range" min="1" max="120" step="1" disabled={!selected.autoSync} value={selected.errorNotifyCooldownMinutes ?? 10} onChange={(event) => void changeSetting({ errorNotifyCooldownMinutes: Number(event.target.value) })} /><output>{selected.errorNotifyCooldownMinutes ?? 10} 分钟</output></label>
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
        {workspaceMenu && <motion.div key="workspace-menu" className="workspace-context-menu glass-modal" style={{ left: workspaceMenu.x, top: workspaceMenu.y }} initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .97 }} onClick={(event) => event.stopPropagation()}><button onClick={() => void selectWorkspaceCover(workspaceMenu.id)}><ImagePlus size={15} />设置资料库封面</button><button onClick={() => { const workspace = snapshot.workspaces.find((item) => item.id === workspaceMenu.id); setWorkspaceMenu(undefined); if (workspace) setRandomCover(workspace) }}><Images size={15} />从软件内随机</button><button onClick={() => { setWorkspaceMenu(undefined); setBulkMode(true); setBulkSelected([]) }}><ListChecks size={15} />批量管理</button>{(snapshot.workspaces.find((item) => item.id === workspaceMenu.id)?.targets.length ?? 0) > 0 && <button className="danger" onClick={() => { const workspace = snapshot.workspaces.find((item) => item.id === workspaceMenu.id); setWorkspaceMenu(undefined); if (workspace) setDeleteBackupsDialog(workspace) }}><CloudOff size={15} />删除云端备份</button>}<button className="danger" onClick={() => { const workspace = snapshot.workspaces.find((item) => item.id === workspaceMenu.id); setWorkspaceMenu(undefined); setRemoveWorkspaceDialog(workspace) }}><Trash2 size={15} />从列表移除</button></motion.div>}
        {dragging && <motion.div key="drop-overlay" className="drop-overlay glass-material" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div initial={{ scale: .96 }} animate={{ scale: 1 }}><FolderInput size={30} /><strong>松开以加入资料库</strong><span>文件夹内容不会被移动</span></motion.div></motion.div>}
        {targetDialog && selected && <Suspense key="target-dialog" fallback={null}><TargetDialog workspace={selected} onClose={() => setTargetDialog(false)} onSaved={async () => { setTargetDialog(false); await refresh() }} /></Suspense>}
        {reviewPlan && <ReviewDialog key="review-dialog" plan={reviewPlan} onClose={() => setReviewPlan(undefined)} onRun={(decision) => void runReviewedPlan(decision)} />}
        {removeWorkspaceDialog && <Suspense key="remove-workspace-dialog" fallback={null}><RemoveWorkspaceDialog workspace={removeWorkspaceDialog} onClose={() => setRemoveWorkspaceDialog(undefined)} onRemove={async () => { await window.tianchuang.removeWorkspace(removeWorkspaceDialog.id); setRemoveWorkspaceDialog(undefined); await refresh(); setNoticeError(false); setNotice('资料库已从天创云端移除，本地文件未改动'); window.setTimeout(() => setNotice(undefined), 3600) }} /></Suspense>}
        {settingsDialog && <Suspense key="settings-dialog" fallback={null}><SettingsDialog preferences={cursorPreferences} customBackground={customBackground} onSelectBackground={selectCustomBackground} onResetBackground={resetCustomBackground} onPreviewBackgroundEffect={setBackgroundEffectPreview} onRequestRestore={setCloudRestore} onChange={changeCursorPreferences} onClose={closeSettings} /></Suspense>}
        {coverCrop && <Suspense key="cover-crop-dialog" fallback={null}><CoverCropDialog workspace={coverCrop.workspace} source={coverCrop.source} onClose={() => setCoverCrop(undefined)} onSave={saveCroppedCover} /></Suspense>}
        {collaborationTarget?.config.kind === 'git' && <Suspense key="collaboration-dialog" fallback={null}><CollaborationDialog targetName={collaborationTarget.name} remoteUrl={collaborationTarget.config.remoteUrl} onClose={() => setCollaborationTarget(undefined)} /></Suspense>}
        {cloudRestore && <Suspense key="cloud-restore-dialog" fallback={null}><CloudRestoreDialog config={cloudRestore} onClose={() => { localStorage.setItem('tianchuang.cloud-config-dismissed', cloudRestore.updatedAt); setCloudRestore(undefined) }} onRestored={async () => { localStorage.setItem('tianchuang.cloud-config-dismissed', cloudRestore.updatedAt); setCloudRestore(undefined); await refresh(); setNoticeError(false); setNotice('其他设备的资料库配置已恢复，请检查凭据与本机路径'); window.setTimeout(() => setNotice(undefined), 5200) }} /></Suspense>}
        {removeTargetDialog && <Suspense key="remove-target-dialog" fallback={null}><DangerConfirmDialog
          title={`移除同步目标“${removeTargetDialog.target.name}”？`}
          description={removeTargetDialog.target.config.kind === 'git' ? '解除绑定后天创云端不再同步到该仓库；仓库与本机文件都会保留。' : removeTargetDialog.target.config.kind === 'webdav' ? '移除后天创云端不再同步到该 WebDAV 目录。' : '移除后天创云端不再同步到该磁盘镜像。'}
          items={[{
            key: removeTargetDialog.target.id,
            name: removeTargetDialog.target.name,
            detail: removeTargetDialog.target.config.kind === 'git' ? `仓库 ${removeTargetDialog.target.config.remoteUrl} 会完整保留` : removeTargetDialog.target.config.kind === 'webdav' ? `服务器目录 ${removeTargetDialog.target.config.remotePath}` : `镜像位置 ${(removeTargetDialog.target.config as { destinationPath: string }).destinationPath}`,
            danger: removeTargetDialog.target.config.kind !== 'git',
          }]}
          checkbox={removeTargetDialog.target.config.kind === 'webdav' ? { label: '同时删除 WebDAV 上的备份目录（含其中全部文件）', defaultChecked: false } : removeTargetDialog.target.config.kind === 'local' ? { label: '同时删除磁盘镜像中的备份文件', defaultChecked: false } : undefined}
          note={removeTargetDialog.target.config.kind === 'git' ? '仓库本身不会被删除；如需删除整个仓库，请使用资料库右键菜单中的“删除云端备份”。' : '勾选删除备份后，倒计时环走完仍未确认将自动取消。'}
          countdownMs={6000}
          confirmLabel="确认移除"
          onConfirm={async (deleteBackup) => {
            const message = await window.tianchuang.removeTarget(removeTargetDialog.workspace.id, removeTargetDialog.target.id, { deleteBackup })
            setNoticeError(false)
            setNotice(message)
            window.setTimeout(() => setNotice(undefined), 4200)
            return message
          }}
          onClose={() => { setRemoveTargetDialog(undefined); void refresh() }} /></Suspense>}
        {deleteBackupsDialog && <Suspense key="delete-backups-dialog" fallback={null}><DangerConfirmDialog
          title={`删除“${deleteBackupsDialog.name}”的全部云端备份？`}
          description="所有目标的云端备份都会被删除，资料库会从列表移除；本地文件不会被删除，删除后自动同步也不会重新上传。"
          items={deleteBackupsDialog.targets.map((target) => ({
            key: target.id,
            name: target.name,
            detail: target.config.kind === 'git' ? (target.config.provider === 'github' ? '将调用 GitHub API 删除整个仓库（需要凭据具有 delete_repo 权限）' : '天创云端不会自动删除该仓库，请到对应平台网页端手动删除') : target.config.kind === 'webdav' ? `将删除 WebDAV 目录 ${target.config.remotePath} 及其中全部文件` : '将删除镜像目录中的全部备份文件',
            danger: !(target.config.kind === 'git' && target.config.provider !== 'github'),
          }))}
          note="倒计时环走完仍未点击确认，将自动取消本次操作。"
          countdownMs={6000}
          confirmLabel="全部删除"
          onConfirm={async () => {
            const message = await window.tianchuang.deleteWorkspaceBackups(deleteBackupsDialog.id)
            setNoticeError(false)
            setNotice(message)
            window.setTimeout(() => setNotice(undefined), 5200)
            return message
          }}
          onClose={() => { setDeleteBackupsDialog(undefined); void refresh() }} /></Suspense>}
        {bulkMode && <motion.div key="bulk-bar" className="bulk-bar glass-modal" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
          <strong>已选择 {bulkSelected.length} 个资料库</strong>
          <button className="secondary-button" disabled={!bulkSelected.length} onClick={() => setBulkRemoveDialog(true)}><Trash2 size={15} />移除所选</button>
          <button className="plain-button" onClick={() => { setBulkMode(false); setBulkSelected([]) }}>退出批量管理</button>
        </motion.div>}
        {bulkRemoveDialog && <Suspense key="bulk-remove-dialog" fallback={null}><DangerConfirmDialog
          title={`从列表移除 ${bulkSelected.length} 个资料库？`}
          description="仅从天创云端移除，不会删除本地文件，也不会删除任何云端备份。"
          items={snapshot.workspaces.filter((workspace) => bulkSelected.includes(workspace.id)).map((workspace) => ({ key: workspace.id, name: workspace.name, detail: workspace.path, danger: false }))}
          confirmLabel={`移除 ${bulkSelected.length} 个`}
          onConfirm={async () => {
            const count = bulkSelected.length
            for (const id of bulkSelected) await window.tianchuang.removeWorkspace(id)
            setBulkMode(false)
            setBulkSelected([])
            await refresh()
            setNoticeError(false)
            setNotice(`已移除 ${count} 个资料库，本地文件未改动`)
            window.setTimeout(() => setNotice(undefined), 4200)
            return 'ok'
          }}
          onClose={() => { setBulkRemoveDialog(false); void refresh() }} /></Suspense>}
        {randomCover && <Suspense key="random-cover-dialog" fallback={null}><RandomCoverDialog workspace={randomCover} onSave={saveRandomCover} onClose={() => setRandomCover(undefined)} /></Suspense>}
        {migrationDialog && <Suspense key="migration-dialog" fallback={null}><MigrationDialog workspace={migrationDialog.workspace} sourceTarget={migrationDialog.target} onClose={() => setMigrationDialog(undefined)} onMigrated={(message) => { setMigrationDialog(undefined); void refresh(); setNoticeError(false); setNotice(message); window.setTimeout(() => setNotice(undefined), 5200) }} /></Suspense>}
        {progress && <ProgressOverlay key="progress-overlay" progress={progress} onClose={() => setProgress(undefined)} />}
        {notice && <motion.div key="notice-toast" className={`toast glass-material ${noticeError ? 'error' : ''}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>{noticeError ? <AlertTriangle size={16} /> : <Check size={16} />}{notice}</motion.div>}
      </AnimatePresence>
    </div>
  )
}
export default App
