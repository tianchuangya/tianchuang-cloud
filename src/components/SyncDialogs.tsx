import { motion } from 'motion/react'
import {
  AlertTriangle, ArchiveRestore, Check, Cloud, FileWarning, Folder, RefreshCw, ShieldCheck, Trash2, X,
} from 'lucide-react'
import type { SyncDecision, SyncPlan, SyncProgress } from '../../electron/types'

export function ReviewDialog({ plan, onClose, onRun }: { plan: SyncPlan; onClose: () => void; onRun: (decision: SyncDecision) => void }) {
  const blocked = plan.direction === 'blocked'
  const localOnly = plan.issues.filter((item) => item.kind === 'local-only')
  const fileConflicts = plan.issues.filter((item) => item.kind === 'conflict' && item.size !== undefined)
  const remoteOnly = plan.issues.filter((item) => item.kind === 'remote-only')
  const tooLarge = plan.issues.filter((item) => item.kind === 'too-large')
  const remoteDeletes = plan.issues.filter((item) => item.kind === 'remote-delete')
  const dangerous = blocked || remoteDeletes.length > 0
  const mergeable = localOnly.length + fileConflicts.length > 0
  const title = blocked ? '同步暂时无法继续'
    : remoteDeletes.length ? '确认删除云端文件'
      : fileConflicts.length ? '两端文件存在差异'
        : remoteOnly.length ? '远端有本地缺少的文件'
          : '发现本地独有内容'
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="modal glass-modal review-modal" initial={{ opacity: 0, scale: .97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .98, y: 8 }} transition={{ type: 'spring', bounce: 0, duration: .32 }}>
        <header><div className={`review-symbol ${dangerous ? 'danger' : ''}`}>{dangerous ? <FileWarning size={22} /> : <ArchiveRestore size={22} />}</div><div><h2>{title}</h2><p>{plan.summary}</p></div><button className="icon-button" title="关闭" onClick={onClose}><X size={18} /></button></header>
        <div className="plan-steps">{plan.actions.map((action, index) => <div key={action}><span>{index + 1}</span>{action}</div>)}</div>
        {localOnly.length > 0 && <div className="issue-list"><strong>仅在这台电脑上发现</strong>{localOnly.slice(0, 8).map((item) => <div key={item.path}><Folder size={15} /><span>{item.path}</span></div>)}{localOnly.length > 8 && <small>以及另外 {localOnly.length - 8} 个文件</small>}</div>}
        {fileConflicts.length > 0 && <div className="issue-list"><strong>两端都修改过，需要选择保留方向</strong>{fileConflicts.slice(0, 8).map((item) => <div key={item.path}><FileWarning size={15} /><span>{item.path}</span></div>)}{fileConflicts.length > 8 && <small>以及另外 {fileConflicts.length - 8} 个文件</small>}</div>}
        {remoteOnly.length > 0 && <div className="issue-list"><strong>远端有本地缺少的文件，确认后会下载到本机</strong>{remoteOnly.slice(0, 8).map((item) => <div key={item.path}><Cloud size={15} /><span>{item.path}</span></div>)}{remoteOnly.length > 8 && <small>以及另外 {remoteOnly.length - 8} 个文件</small>}</div>}
        {tooLarge.length > 0 && <div className="issue-list danger"><strong>超过目标大小限制</strong>{tooLarge.slice(0, 8).map((item) => <div key={item.path}><FileWarning size={15} /><span>{item.path}</span></div>)}</div>}
        {remoteDeletes.length > 0 && <div className="issue-list danger"><strong>确认后将从“{plan.targetName}”删除</strong>{remoteDeletes.slice(0, 8).map((item) => <div key={item.path}><Trash2 size={15} /><span>{item.path}</span></div>)}{remoteDeletes.length > 8 && <small>以及另外 {remoteDeletes.length - 8} 个文件</small>}</div>}
        <div className="recovery-note"><ShieldCheck size={16} /><span>{remoteDeletes.length ? '只会删除天创云端清单中记录的文件；此操作可能无法从目标端撤销。' : '发生冲突时不会静默覆盖；Git 同步会先在应用数据目录保留恢复副本。'}</span></div>
        <footer>
          <button className="plain-button" onClick={onClose}>稍后处理</button>
          {!blocked && remoteDeletes.length === 0 && mergeable && <button className="secondary-button" onClick={() => onRun({ preserveLocalOnly: false, deleteRemote: false })}>以远端为准</button>}
          {!blocked && remoteDeletes.length === 0 && mergeable && <button className="primary-button" onClick={() => onRun({ preserveLocalOnly: true, deleteRemote: false })}><ArchiveRestore size={17} />保留并合并</button>}
          {!blocked && remoteDeletes.length === 0 && !mergeable && remoteOnly.length > 0 && <button className="primary-button" onClick={() => onRun({ preserveLocalOnly: true, deleteRemote: false })}><ArchiveRestore size={17} />下载到本机</button>}
          {!blocked && remoteDeletes.length > 0 && <button className="danger-button" onClick={() => onRun({ preserveLocalOnly: true, deleteRemote: true })}><Trash2 size={17} />确认删除并同步</button>}
        </footer>
      </motion.section>
    </motion.div>
  )
}

export function ProgressOverlay({ progress, onClose }: { progress: SyncProgress; onClose: () => void }) {
  const done = progress.phase === 'complete' || progress.phase === 'error'
  return (
    <motion.div className="progress-float glass-modal" initial={{ opacity: 0, scale: .94, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .96, y: 10 }} transition={{ type: 'spring', bounce: .08, duration: .36 }}>
      <div className={`progress-symbol ${progress.phase}`}>{progress.phase === 'complete' ? <Check size={20} /> : progress.phase === 'error' ? <AlertTriangle size={20} /> : <RefreshCw className="spin" size={20} />}</div>
      <div className="progress-copy"><strong>{progress.title}</strong><span>{progress.detail}</span><div className="progress-track"><motion.i animate={{ width: `${progress.percent}%` }} /></div></div>
      {done && <button className="icon-button" title="关闭" onClick={onClose}><X size={16} /></button>}
    </motion.div>
  )
}
