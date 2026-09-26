import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, X } from 'lucide-react'

type ConfirmItem = { key: string; name: string; detail: string; danger?: boolean }

type Props = {
  title: string
  description: string
  items: ConfirmItem[]
  confirmLabel: string
  countdownMs?: number
  checkbox?: { label: string; defaultChecked: boolean }
  note?: string
  onConfirm: (extraChoice: boolean) => Promise<string>
  onClose: () => void
}

// 高风险操作确认弹窗（FuseButton 交互思路的项目化实现）：
// 确定按钮外圈有红色倒计时环，倒计时结束仍未点击则视为取消并自动关闭。
export default function DangerConfirmDialog({ title, description, items, confirmLabel, countdownMs = 0, checkbox, note, onConfirm, onClose }: Props) {
  const [extraChoice, setExtraChoice] = useState(checkbox?.defaultChecked ?? false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const closedRef = useRef(false)
  const runningRef = useRef(false)
  useEffect(() => { runningRef.current = running })
  const armed = countdownMs > 0 && (!checkbox || extraChoice)

  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => {
      if (!closedRef.current && !runningRef.current) {
        closedRef.current = true
        onClose()
      }
    }, countdownMs)
    return () => window.clearTimeout(timer)
  }, [armed, countdownMs, onClose])

  useEffect(() => {
    const onCancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closedRef.current) {
        closedRef.current = true
        onClose()
      }
    }
    window.addEventListener('keydown', onCancel)
    return () => window.removeEventListener('keydown', onCancel)
  }, [onClose])

  const confirm = async () => {
    if (running || closedRef.current) return
    setRunning(true)
    setError('')
    try {
      const message = await onConfirm(extraChoice)
      closedRef.current = true
      onClose()
      void message
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setRunning(false)
    }
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="modal glass-modal remove-workspace-modal" initial={{ opacity: 0, scale: .97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .98, y: 8 }} transition={{ type: 'spring', bounce: 0, duration: .28 }}>
        <header><div className="review-symbol danger"><AlertTriangle size={21} /></div><div><h2>{title}</h2><p>{description}</p></div><button className="icon-button" title="关闭" onClick={() => { closedRef.current = true; onClose() }}><X size={18} /></button></header>
        <div className="issue-list danger">
          {items.map((item) => <div key={item.key}><span className={`review-item-dot ${item.danger === false ? 'safe' : ''}`} /><span><strong>{item.name}</strong><small>{item.detail}</small></span></div>)}
        </div>
        {checkbox && <label className="setting-row confirm-choice"><span><strong>{checkbox.label}</strong></span><input type="checkbox" checked={extraChoice} onChange={(event) => setExtraChoice(event.target.checked)} /><i /></label>}
        {note && <div className="recovery-note"><AlertTriangle size={16} /><span>{note}</span></div>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <footer>
          <button className="plain-button" onClick={() => { closedRef.current = true; onClose() }}>{countdownMs ? '取消' : '保留备份'}</button>
          <span className="fuse-confirm">
            {!running && armed && <svg className="confirm-ring" viewBox="0 0 48 48" aria-hidden="true"><rect pathLength={1} style={{ animationDuration: `${countdownMs}ms` }} /></svg>}
            <button className="danger-button" disabled={running} onClick={() => void confirm()}>{running ? '正在处理…' : confirmLabel}</button>
          </span>
        </footer>
      </motion.section>
    </motion.div>
  )
}
