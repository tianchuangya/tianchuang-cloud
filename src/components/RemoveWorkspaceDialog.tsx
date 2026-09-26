import { useState } from 'react'
import { motion } from 'motion/react'
import { LoaderCircle, ShieldCheck, Trash2, X } from 'lucide-react'
import type { WorkspaceProfile } from '../../electron/types'

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

export default RemoveWorkspaceDialog
