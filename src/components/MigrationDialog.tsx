import { useState } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, ArrowRightLeft, Check, FileWarning, GitBranch, HardDrive, LoaderCircle, Server, X } from 'lucide-react'
import type { DestinationCapacity, MigrationPlan, SyncTarget, WorkspaceProfile } from '../../electron/types'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function capacityLine(capacity: DestinationCapacity | undefined): string | undefined {
  if (!capacity) return undefined
  if (capacity.quotaTotal !== undefined) {
    const free = Math.max(0, capacity.quotaTotal - (capacity.quotaUsed ?? 0))
    return `目标服务剩余配额约 ${formatBytes(free)}（已用 ${formatBytes(capacity.quotaUsed ?? 0)} / ${formatBytes(capacity.quotaTotal)}）`
  }
  if (capacity.freeBytes !== undefined) return `目标磁盘剩余空间约 ${formatBytes(capacity.freeBytes)}`
  return undefined
}

type Props = {
  workspace: WorkspaceProfile
  sourceTarget: SyncTarget
  onClose: () => void
  onMigrated: (message: string) => void
}

// 多云迁移：把当前目标的备份迁移到同一资料库的另一个目标。
// 数据以本机文件为准；计划阶段展示文件量、目标容量与冲突，确认后复用常规同步管线执行。
export default function MigrationDialog({ workspace, sourceTarget, onClose, onMigrated }: Props) {
  const destinations = workspace.targets.filter((target) => target.id !== sourceTarget.id)
  const [destinationId, setDestinationId] = useState<string>()
  const [migration, setMigration] = useState<MigrationPlan>()
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [removeSource, setRemoveSource] = useState(false)

  const blocked = migration?.plan.direction === 'blocked'
  const tooLarge = migration?.plan.issues.filter((issue) => issue.kind === 'too-large') ?? []
  const remoteDeletes = migration?.plan.issues.filter((issue) => issue.kind === 'remote-delete') ?? []
  const [deleteExtra, setDeleteExtra] = useState(false)

  const choose = async (id: string) => {
    setDestinationId(id)
    setMigration(undefined)
    setError('')
    setLoading(true)
    try {
      setMigration(await window.tianchuang.planMigration(workspace.id, sourceTarget.id, id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  const migrate = async () => {
    if (!migration || running) return
    if (remoteDeletes.length > 0 && !deleteExtra) {
      setError('目标上存在多余的受管文件，请勾选“同时删除”后继续，或先清理目标。')
      return
    }
    setRunning(true)
    setError('')
    try {
      await window.tianchuang.runSync(migration.plan.id, { preserveLocalOnly: true, deleteRemote: deleteExtra && remoteDeletes.length > 0 })
      if (removeSource) await window.tianchuang.removeTarget(workspace.id, sourceTarget.id)
      onMigrated(`已迁移到“${migration.destinationName}”${removeSource ? '，并解除了原目标绑定' : ''}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setRunning(false)
    }
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="modal glass-modal migration-modal" initial={{ opacity: 0, scale: .97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .98, y: 8 }} transition={{ type: 'spring', bounce: 0, duration: .32 }}>
        <header><div className="settings-symbol"><ArrowRightLeft size={21} /></div><div><h2>迁移“{sourceTarget.name}”</h2><p>以本机文件为准，把备份迁移到另一个目标；计划确认后才会执行</p></div><button className="icon-button" title="关闭" onClick={onClose}><X size={18} /></button></header>
        <div className="migration-body">
          <div className="setting-group-heading"><strong>迁移到</strong><span>选择同一资料库下的另一个同步目标</span></div>
          {destinations.length ? <div className="migration-dest-list">
            {destinations.map((target) => <button key={target.id} className={destinationId === target.id ? 'active' : ''} onClick={() => void choose(target.id)}>
              {target.config.kind === 'git' ? <GitBranch size={17} /> : target.config.kind === 'webdav' ? <Server size={17} /> : <HardDrive size={17} />}
              <span><strong>{target.name}</strong><small>{target.config.kind === 'git' ? target.config.remoteUrl : target.config.kind === 'webdav' ? `${target.config.endpoint}${target.config.remotePath}` : target.config.destinationPath}</small></span>
              {destinationId === target.id && <Check size={15} />}
            </button>)}
          </div> : <div className="workspace-search-empty">这个资料库还没有其他目标，请先添加一个再迁移。</div>}
          {loading && <div className="collaboration-empty"><LoaderCircle className="spin" size={16} />正在生成迁移计划…</div>}
          {migration && !loading && <>
            <div className="plan-steps">
              <div><span>1</span>以本机 {migration.plan.metadata.totalBytes ? formatBytes(Number(migration.plan.metadata.totalBytes)) : '当前'} 的 {Number(migration.plan.metadata.fileCount ?? 0)} 个文件为准</div>
              {capacityLine(migration.capacity) && <div><span>2</span>{capacityLine(migration.capacity)}</div>}
              <div><span>{capacityLine(migration.capacity) ? 3 : 2}</span>{migration.plan.actions[0] || '执行同步'}</div>
            </div>
            {tooLarge.length > 0 && <div className="issue-list danger"><strong>超过目标大小限制，无法迁移</strong>{tooLarge.slice(0, 6).map((issue) => <div key={issue.path}><FileWarning size={15} /><span>{issue.path}</span></div>)}</div>}
            {remoteDeletes.length > 0 && <div className="issue-list danger"><strong>目标上有 {remoteDeletes.length} 个本机没有的受管文件</strong>{remoteDeletes.slice(0, 6).map((issue) => <div key={issue.path}><FileWarning size={15} /><span>{issue.path}</span></div>)}<label className="confirm-choice"><span><strong>同时删除这些文件</strong></span><input type="checkbox" checked={deleteExtra} onChange={(event) => setDeleteExtra(event.target.checked)} /><i /></label></div>}
            {migration.plan.direction === 'blocked' && <div className="form-error" role="alert"><AlertTriangle size={15} />{migration.plan.summary}</div>}
          </>}
          {error && <div className="form-error" role="alert"><AlertTriangle size={15} />{error}</div>}
          <label className="setting-row confirm-choice"><span><strong>迁移完成后移除原目标</strong><small>仅解除绑定，不会删除原目标上的备份文件</small></span><input type="checkbox" checked={removeSource} onChange={(event) => setRemoveSource(event.target.checked)} /><i /></label>
        </div>
        <footer>
          <button className="plain-button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={!migration || loading || running || blocked} onClick={() => void migrate()}>{running ? <LoaderCircle className="spin" size={16} /> : <ArrowRightLeft size={16} />}{running ? '正在迁移…' : '开始迁移'}</button>
        </footer>
      </motion.section>
    </motion.div>
  )
}

