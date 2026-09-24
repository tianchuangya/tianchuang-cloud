import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Activity, AlertTriangle, ArchiveRestore, Check, ChevronRight, Cloud, CloudUpload,
  FileWarning, Folder, FolderInput, GitBranch, Globe2, HardDrive, History, LoaderCircle,
  LockKeyhole, LogIn, MoreHorizontal, Plus, RefreshCw, Server, Settings, ShieldCheck, Trash2, X,
} from 'lucide-react'
import type {
  AppSnapshot, GitHubSession, ProviderKind, SyncPlan, SyncProgress, TargetDraft, WorkspaceProfile,
} from '../electron/types'
import './App.css'

const EMPTY_SNAPSHOT: AppSnapshot = { workspaces: [], activity: [] }

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

  const refresh = async () => {
    const next = await window.tianchuang.getSnapshot()
    setSnapshot(next)
    setSelectedId((current) => current && next.workspaces.some((item) => item.id === current)
      ? current
      : next.workspaces[0]?.id)
  }

  useEffect(() => {
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

  return (
    <div
      className={`app-shell ${dragging ? 'is-dragging' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false) }}
      onDrop={(event) => void dropFolder(event)}
    >
      <header className="titlebar">
        <div className="brand-mark"><Cloud size={16} strokeWidth={2.3} /></div>
        <span>天创云端</span>
        <span className="titlebar-subtitle">Tianchuang Cloud</span>
      </header>

      <aside className="sidebar glass-material">
        <div className="sidebar-heading">
          <span>资料库</span>
          <button className="icon-button" title="添加资料库" aria-label="添加资料库" disabled={selectingFolder} onClick={(event) => { event.stopPropagation(); void addFolder() }}>{selectingFolder ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}</button>
        </div>
        <nav className="workspace-list" aria-label="资料库列表">
          {snapshot.workspaces.map((workspace) => (
            <button key={workspace.id} className={`workspace-nav ${workspace.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(workspace.id)}>
              <span className="nav-icon"><Folder size={17} /></span>
              <span className="nav-copy"><strong>{workspace.name}</strong><small>{workspace.targets.length} 个目标</small></span>
              <span className={`state-dot ${workspace.state}`} aria-label={workspace.state} />
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="sidebar-action add-library-action" disabled={selectingFolder} onClick={() => void addFolder()}><FolderInput size={17} /><span>添加资料库</span></button>
          <button className="sidebar-action"><Activity size={17} /><span>活动记录</span><span className="count">{snapshot.activity.length}</span></button>
          <button className="sidebar-action"><Settings size={17} /><span>设置</span></button>
        </div>
      </aside>

      <main className="content">
        {selected ? (
          <>
            <section className="workspace-header">
              <div>
                <div className="status-line"><span className={`status-pill ${selected.state}`}>{selected.state === 'syncing' ? '同步中' : selected.state === 'attention' ? '需要确认' : selected.state === 'error' ? '发生错误' : '已受保护'}</span><span>{relativeTime(selected.lastSyncAt)}</span></div>
                <h1>{selected.name}</h1>
                <p className="path-text" title={selected.path}>{selected.path}</p>
              </div>
              <div className="header-actions">
                <button className="secondary-button" onClick={() => setTargetDialog(true)}><Plus size={17} />添加目标</button>
                <button className="primary-button" onClick={() => void syncAllTargets()} disabled={selected.state === 'syncing'}><RefreshCw size={17} />立即同步</button>
              </div>
            </section>

            <section className="summary-strip" aria-label="同步摘要">
              <div><CloudUpload size={19} /><span><strong>{selected.targets.length}</strong>备份目标</span></div>
              <div><ShieldCheck size={19} /><span><strong>{selected.autoSync ? '开启' : '关闭'}</strong>后台同步</span></div>
              <div><History size={19} /><span><strong>{relativeTime(selected.lastSyncAt)}</strong>最近更新</span></div>
            </section>

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

            <section className="section-block settings-block">
              <div className="section-heading"><div><h2>自动化</h2><p>应用在后台监控变化，并在需要选择时通知你</p></div></div>
              <label className="setting-row"><span><strong>文件变化后自动同步</strong><small>连续编辑结束约 3 秒后检查所有目标</small></span><input type="checkbox" checked={selected.autoSync} onChange={(event) => void changeSetting({ autoSync: event.target.checked })} /><i /></label>
              <label className="setting-row"><span><strong>打开应用时检查</strong><small>回到天创云端时拉取其他电脑的最新版本</small></span><input type="checkbox" checked={selected.syncOnFocus} onChange={(event) => void changeSetting({ syncOnFocus: event.target.checked })} /><i /></label>
            </section>

            {snapshot.activity.some((item) => item.workspaceId === selected.id) && (
              <section className="section-block activity-block">
                <div className="section-heading"><div><h2>最近活动</h2><p>同步结果与恢复信息</p></div></div>
                <div className="activity-list">
                  {snapshot.activity.filter((item) => item.workspaceId === selected.id).slice(0, 5).map((item) => (
                    <div className="activity-row" key={item.id}><span className={`activity-icon ${item.level}`}>{item.level === 'success' ? <Check size={14} /> : item.level === 'warning' || item.level === 'error' ? <AlertTriangle size={14} /> : <History size={14} />}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div><time>{relativeTime(item.createdAt)}</time></div>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <section className="empty-state">
            <div className="empty-cloud"><Cloud size={42} /></div>
            <h1>把资料放进天创云端</h1>
            <p>选择一个文件夹，或直接拖到窗口中。添加后可以同时同步到 GitHub、Gitee、WebDAV 和磁盘。</p>
            <button className="primary-button large" disabled={selectingFolder} onClick={() => void addFolder()}>{selectingFolder ? <LoaderCircle className="spin" size={19} /> : <FolderInput size={19} />}选择文件夹</button>
          </section>
        )}
      </main>

      <AnimatePresence>
        {dragging && <motion.div className="drop-overlay glass-material" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div initial={{ scale: .96 }} animate={{ scale: 1 }}><FolderInput size={30} /><strong>松开以加入资料库</strong><span>文件夹内容不会被移动</span></motion.div></motion.div>}
        {targetDialog && selected && <TargetDialog workspace={selected} onClose={() => setTargetDialog(false)} onSaved={async () => { setTargetDialog(false); await refresh() }} />}
        {reviewPlan && <ReviewDialog plan={reviewPlan} onClose={() => setReviewPlan(undefined)} onRun={(preserve) => void runReviewedPlan(preserve)} />}
        {progress && <ProgressOverlay progress={progress} onClose={() => setProgress(undefined)} />}
        {notice && <motion.div className={`toast glass-material ${noticeError ? 'error' : ''}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>{noticeError ? <AlertTriangle size={16} /> : <Check size={16} />}{notice}</motion.div>}
      </AnimatePresence>
    </div>
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
