import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, Check, LoaderCircle, Share2, ShieldCheck, UserPlus, X } from 'lucide-react'
import type { GitHubCollaborator, GitHubCollaboratorPermission } from '../../electron/types'

function CollaborationDialog({ targetName, remoteUrl, onClose }: { targetName: string; remoteUrl: string; onClose: () => void }) {
  const [collaborators, setCollaborators] = useState<GitHubCollaborator[]>([])
  const [username, setUsername] = useState('')
  const [permission, setPermission] = useState<GitHubCollaboratorPermission>('pull')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState('')

  const refreshCollaborators = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setCollaborators(await window.tianchuang.listGitHubCollaborators(remoteUrl))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [remoteUrl])

  useEffect(() => {
    let active = true
    void window.tianchuang.listGitHubCollaborators(remoteUrl).then((items) => {
      if (active) setCollaborators(items)
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [remoteUrl])

  const invite = async () => {
    setSaving(true)
    setError('')
    setSent('')
    try {
      await window.tianchuang.inviteGitHubCollaborator({ remoteUrl, username, permission })
      setSent(`已向 @${username.trim().replace(/^@/, '')} 发送${permission === 'push' ? '可更新' : '只读'}邀请`)
      setUsername('')
      await refreshCollaborators()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="modal glass-modal collaboration-modal" initial={{ opacity: 0, scale: .97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .98, y: 8 }} transition={{ type: 'spring', bounce: 0, duration: .32 }}>
        <header><div className="review-symbol"><Share2 size={21} /></div><div><h2>协作与分享</h2><p>{targetName} · {remoteUrl}</p></div><button className="icon-button" title="关闭" onClick={onClose}><X size={18} /></button></header>
        <div className="collaboration-body">
          <div className="collaboration-invite">
            <label className="field"><span>GitHub 用户名</span><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="username" /></label>
            <label className="field"><span>协作权限</span><select value={permission} onChange={(event) => setPermission(event.target.value as GitHubCollaboratorPermission)}><option value="pull">只读，可接收更新</option><option value="push">可更新，可共同同步</option></select></label>
            <button className="primary-button" disabled={saving || !username.trim()} onClick={() => void invite()}>{saving ? <LoaderCircle className="spin" size={16} /> : <UserPlus size={16} />}发送邀请</button>
          </div>
          <div className="form-note"><ShieldCheck size={16} /><span>邀请由 GitHub 管理。对方接受后，在天创云端选择“已有仓库”并填入此地址即可接收更新。</span></div>
          {error && <div className="form-error" role="alert"><AlertTriangle size={15} />{error}</div>}
          {sent && <div className="form-success"><Check size={15} />{sent}</div>}
          <div className="collaboration-list">
            <strong>成员与待接受邀请</strong>
            {loading ? <div className="collaboration-empty"><LoaderCircle className="spin" size={16} />正在读取 GitHub 权限</div> : collaborators.length ? collaborators.map((item) => <div className="collaborator-row" key={`${item.username}-${item.pending}`}><span className="collaborator-avatar">{item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : item.username.slice(0, 1).toUpperCase()}</span><span><strong>@{item.username}</strong><small>{item.pending ? '等待对方接受邀请' : '已加入资料库'}</small></span><em>{item.permission === 'push' ? '可更新' : item.permission === 'pull' ? '只读' : item.permission}</em></div>) : <div className="collaboration-empty">尚未添加协作者</div>}
          </div>
        </div>
        <footer><button className="plain-button" onClick={onClose}>完成</button></footer>
      </motion.section>
    </motion.div>
  )
}

export default CollaborationDialog
