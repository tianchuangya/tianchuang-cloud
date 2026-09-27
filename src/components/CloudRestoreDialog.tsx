import { useState } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, ArchiveRestore, Folder, Laptop, LoaderCircle, ShieldCheck, X } from 'lucide-react'
import type { CloudConfigDocument, CloudRestoreSelection } from '../../electron/types'

function CloudRestoreDialog({ config, onClose, onRestored }: { config: CloudConfigDocument; onClose: () => void; onRestored: () => Promise<void> }) {
  const [paths, setPaths] = useState<Record<string, string>>({})
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState('')
  const selections: CloudRestoreSelection[] = config.workspaces.flatMap((workspace) => paths[workspace.id] ? [{ workspaceId: workspace.id, localPath: paths[workspace.id] }] : [])

  const chooseFolder = async (workspaceId: string) => {
    const folderPath = await window.tianchuang.selectFolder()
    if (folderPath) setPaths((current) => ({ ...current, [workspaceId]: folderPath }))
  }

  const restore = async () => {
    if (!selections.length) return
    setRestoring(true)
    setError('')
    try {
      await window.tianchuang.restoreCloudConfig(config, selections)
      await onRestored()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRestoring(false)
    }
  }

  return (
    <motion.div className="modal-backdrop cloud-restore-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="modal glass-modal cloud-restore-modal" initial={{ opacity: 0, y: 14, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: .98 }}>
        <header><div className="settings-symbol"><Laptop size={21} /></div><div><h2>发现其他设备的资料库</h2><p>{config.deviceName} 于 {new Date(config.updatedAt).toLocaleString()} 上传了配置</p></div><button className="icon-button" title="稍后处理" onClick={onClose}><X size={18} /></button></header>
        <div className="cloud-restore-body">
          <div className="recovery-note"><ShieldCheck size={16} /><span>请选择这些资料库在当前电脑上的文件夹。未选择的项目不会恢复，本机已有内容不会被覆盖。</span></div>
          <div className="cloud-workspace-list">
            {config.workspaces.map((workspace) => <article key={workspace.id}><span className="cloud-workspace-icon"><Folder size={18} /></span><span><strong>{workspace.name}</strong><small>{workspace.targets.length} 个同步目标 · 原路径 {workspace.pathHint}</small></span><button className={paths[workspace.id] ? 'selected' : ''} onClick={() => void chooseFolder(workspace.id)}>{paths[workspace.id] ? paths[workspace.id] : '选择本机文件夹'}</button></article>)}
          </div>
          <p className="cloud-restore-footnote">恢复后自动同步默认关闭；首次同步会把云端文件下载到所选文件夹（Git 目标会自动克隆远端历史）。WebDAV 与磁盘目标需要检查凭据或路径后手动启用。</p>
          {error && <div className="form-error cloud-config-error"><AlertTriangle size={15} />{error}</div>}
        </div>
        <footer><button className="plain-button" disabled={restoring} onClick={onClose}>暂不恢复</button><button className="primary-button" disabled={!selections.length || restoring} onClick={() => void restore()}>{restoring ? <LoaderCircle className="spin" size={16} /> : <ArchiveRestore size={16} />}恢复已选择的 {selections.length} 个资料库</button></footer>
      </motion.section>
    </motion.div>
  )
}

export default CloudRestoreDialog
