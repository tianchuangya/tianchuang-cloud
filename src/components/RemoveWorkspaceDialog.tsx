import { useState } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, CloudOff, FolderX, LoaderCircle, ShieldCheck, Trash2, X } from 'lucide-react'
import type { WorkspaceDeleteOptions, WorkspaceProfile } from '../../electron/types'

interface Props {
  workspace: WorkspaceProfile
  onClose: () => void
  onRemove: () => Promise<void>
  onRequestDangerousDelete: (options: WorkspaceDeleteOptions) => void
}

export default function RemoveWorkspaceDialog({ workspace, onClose, onRemove, onRequestDangerousDelete }: Props) {
  const [permanent, setPermanent] = useState(false)
  const [deleteCloud, setDeleteCloud] = useState(false)
  const [deleteLocal, setDeleteLocal] = useState(false)
  const [removing, setRemoving] = useState(false)
  const dangerousReady = permanent && (deleteCloud || deleteLocal)
  const proceed = () => {
    if (permanent) { if (dangerousReady) onRequestDangerousDelete({ deleteCloud, deleteLocal }); return }
    setRemoving(true)
    void onRemove().catch(() => setRemoving(false))
  }
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className={`modal glass-modal remove-workspace-modal ${permanent ? 'is-dangerous' : ''}`} initial={{ opacity: 0, scale: .97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .98, y: 8 }} transition={{ type: 'spring', bounce: 0, duration: .28 }}>
        <header><div className={`review-symbol ${permanent ? 'danger' : 'safe'}`}>{permanent ? <AlertTriangle size={21} /> : <ShieldCheck size={21} />}</div><div><h2>{permanent ? `彻底删除“${workspace.name}”？` : `移除“${workspace.name}”？`}</h2><p>{permanent ? '选择要一并删除的数据，下一步仍会进行危险确认。' : '停止同步并清理天创云端配置，本地文档和云端备份保留。'}</p></div><button className="icon-button" title="关闭" onClick={onClose}><X size={18} /></button></header>
        <div className={`remove-workspace-copy ${permanent ? 'danger' : ''}`}>{permanent ? <AlertTriangle size={18} /> : <ShieldCheck size={18} />}<span><strong>{permanent ? '危险删除模式' : '安全移除模式'}</strong><small>{permanent ? '被选中的数据无法通过天创云端恢复，请逐项核对。' : '仅删除 .tianchuang-cloud/*.tc、缩略图和背景配置，不删除项目文档。'}</small></span></div>
        {permanent && <div className="permanent-delete-options">
          <label><span className="delete-option-icon"><CloudOff size={17} /></span><span><strong>删除云端备份</strong><small>删除此资料库绑定的 Git、WebDAV 与磁盘镜像备份</small></span><input type="checkbox" checked={deleteCloud} onChange={(event) => setDeleteCloud(event.target.checked)} /><i /></label>
          <label><span className="delete-option-icon"><FolderX size={17} /></span><span><strong>删除本地文档</strong><small>永久删除整个文件夹：{workspace.path}</small></span><input type="checkbox" checked={deleteLocal} onChange={(event) => setDeleteLocal(event.target.checked)} /><i /></label>
        </div>}
        <footer className="remove-workspace-footer">
          <label className="permanent-delete-toggle"><input type="checkbox" checked={permanent} onChange={(event) => { setPermanent(event.target.checked); if (!event.target.checked) { setDeleteCloud(false); setDeleteLocal(false) } }} /><i /><span>彻底删除</span></label>
          <span className="remove-workspace-actions"><button className="plain-button" onClick={onClose}>取消</button><button className="danger-button" disabled={removing || (permanent && !dangerousReady)} onClick={proceed}>{removing ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}{permanent ? '下一步' : '安全移除'}</button></span>
        </footer>
      </motion.section>
    </motion.div>
  )
}
