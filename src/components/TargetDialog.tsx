import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import {
  AlertTriangle, ArchiveRestore, GitBranch, Globe2, HardDrive, LoaderCircle, LockKeyhole, LogIn,
  Plus, Server, ShieldCheck, X,
} from 'lucide-react'
import type { GitHubSession, ProviderKind, TargetDraft, WorkspaceProfile } from '../../electron/types'
import FadeContent from './FadeContent'
import { providerLabel, repositoryNameFor } from './workspace-meta'

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

  const refreshGitHubAccount = useCallback(async (showLoading = false) => {
    if (showLoading) setAccountLoading(true)
    try {
      const account = await window.tianchuang.getGitHubSession()
      setGitHubAccount(account)
      if (account.authenticated) setError('')
      return account
    } catch (reason) {
      const account = { available: false, authenticated: false, message: reason instanceof Error ? reason.message : String(reason) }
      setGitHubAccount(account)
      return account
    } finally {
      if (showLoading) setAccountLoading(false)
    }
  }, [])

  useEffect(() => {
    const initialCheck = window.setTimeout(() => { void refreshGitHubAccount(true) }, 0)
    const refreshAfterBrowserLogin = () => { void refreshGitHubAccount() }
    window.addEventListener('focus', refreshAfterBrowserLogin)
    return () => {
      window.clearTimeout(initialCheck)
      window.removeEventListener('focus', refreshAfterBrowserLogin)
    }
  }, [refreshGitHubAccount])

  const selectKind = (next: ProviderKind) => {
    setKind(next)
  }

  const login = async () => {
    setError('')
    setLoginPending(true)
    try {
      setGitHubAccount(await window.tianchuang.loginGitHub())
    } catch (reason) {
      const account = await refreshGitHubAccount()
      if (!account.authenticated) setError(reason instanceof Error ? reason.message : String(reason))
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
                <span><strong>{accountLoading ? '正在检查 GitHub 登录' : githubAccount?.authenticated ? githubAccount.displayName || githubAccount.username : githubAccount?.username ? `已找到 @${githubAccount.username}` : '尚未登录 GitHub'}</strong><small>{githubAccount?.authenticated ? `@${githubAccount.username} · 凭据保存在系统中` : githubAccount?.available === false ? '需要安装 Git Credential Manager' : githubAccount?.username ? '正在确认授权状态，返回应用后会自动刷新' : '登录后可直接创建仓库'}</small></span>
                {!accountLoading && !githubAccount?.authenticated && <button type="button" disabled={loginPending || githubAccount?.available === false} onClick={() => void (githubAccount?.username ? refreshGitHubAccount(true) : login())}>{loginPending || accountLoading ? <LoaderCircle className="spin" size={15} /> : <LogIn size={15} />}{githubAccount?.username ? '重新检查' : '登录'}</button>}
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
            <div className="form-note full"><ArchiveRestore size={16} /><span>{locationType === 'network' ? '网络磁盘或 NAS 需要先由操作系统挂载为可访问目录。' : locationType === 'removable' ? '移动硬盘断开时会停止该目标同步，不会影响其他备份。' : '本机文件夹适合备份到另一块内置磁盘或固定目录。'}镜像会记录受管文件；本地删除只有经你确认后才会传播到目标。</span></div>
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

export default TargetDialog
