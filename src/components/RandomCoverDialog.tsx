import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { RefreshCw, X } from 'lucide-react'
import type { WorkspaceProfile } from '../../electron/types'

// 程序生成的随机封面：在本地画布上按精选配色绘制渐变与柔光色块，
// 不依赖网络图片，也不往安装包里塞素材；生成结果走已有的封面保存管线。
const PALETTES: Array<{ base: [string, string]; blobs: string[] }> = [
  { base: ['#1c2f4a', '#0a1220'], blobs: ['#5b8bd0', '#8f6fd0', '#3fd2c7'] },
  { base: ['#3b1f47', '#120a1c'], blobs: ['#c86fd0', '#f0a35e', '#7f5bd0'] },
  { base: ['#0f3a33', '#07141a'], blobs: ['#3fd2a0', '#a5eef6', '#f5d76e'] },
  { base: ['#4a2318', '#180b08'], blobs: ['#f0945e', '#e76a6a', '#f5c76e'] },
  { base: ['#14283e', '#0a1018'], blobs: ['#6fd0e7', '#a8f0c0', '#5b8bd0'] },
  { base: ['#26203e', '#0d0b16'], blobs: ['#9d7fe0', '#e78ab8', '#6fc4d0'] },
]

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function paintCover(seed: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const context = canvas.getContext('2d')
  if (!context) return ''
  const random = mulberry32(seed)
  const palette = PALETTES[Math.floor(random() * PALETTES.length)]
  const angle = random() * Math.PI
  const gradient = context.createLinearGradient(
    640 - Math.cos(angle) * 760, 360 - Math.sin(angle) * 460,
    640 + Math.cos(angle) * 760, 360 + Math.sin(angle) * 460,
  )
  gradient.addColorStop(0, palette.base[0])
  gradient.addColorStop(1, palette.base[1])
  context.fillStyle = gradient
  context.fillRect(0, 0, 1280, 720)
  context.globalCompositeOperation = 'lighter'
  for (const color of palette.blobs) {
    const x = 160 + random() * 960
    const y = 120 + random() * 480
    const radius = 180 + random() * 280
    const blob = context.createRadialGradient(x, y, 0, x, y, radius)
    blob.addColorStop(0, `${color}66`)
    blob.addColorStop(1, '#00000000')
    context.fillStyle = blob
    context.fillRect(0, 0, 1280, 720)
  }
  context.globalCompositeOperation = 'source-over'
  const vignette = context.createRadialGradient(640, 340, 260, 640, 400, 820)
  vignette.addColorStop(0, '#00000000')
  vignette.addColorStop(1, 'rgba(3,8,12,.55)')
  context.fillStyle = vignette
  context.fillRect(0, 0, 1280, 720)
  return canvas.toDataURL('image/png', .92)
}

type Props = {
  workspace: WorkspaceProfile
  onSave: (dataUrl: string) => Promise<void>
  onClose: () => void
}

export default function RandomCoverDialog({ workspace, onSave, onClose }: Props) {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 0xffffff))
  const [saving, setSaving] = useState(false)
  const candidates = useMemo(() => [0, 1, 2, 3].map((offset) => paintCover(seed + offset * 7919)), [seed])
  const choose = async (dataUrl: string) => {
    if (saving) return
    setSaving(true)
    await onSave(dataUrl)
  }
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="modal glass-modal random-cover-modal" initial={{ opacity: 0, scale: .97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .98, y: 8 }} transition={{ type: 'spring', bounce: 0, duration: .28 }}>
        <header><div className="settings-symbol"><RefreshCw size={21} /></div><div><h2>为“{workspace.name}”随机生成封面</h2><p>点击任意一张立即应用，封面会随资料库同步到其他设备</p></div><button className="icon-button" title="关闭" onClick={onClose}><X size={18} /></button></header>
        <div className="random-cover-grid">
          {candidates.map((dataUrl, index) => <button key={index} onClick={() => void choose(dataUrl)} disabled={saving} aria-label={`应用第 ${index + 1} 张随机封面`}>{dataUrl && <img src={dataUrl} alt="" />}</button>)}
        </div>
        <footer>
          <button className="plain-button" onClick={onClose}>取消</button>
          <button className="secondary-button" disabled={saving} onClick={() => setSeed(Math.floor(Math.random() * 0xffffff))}><RefreshCw size={15} />换一批</button>
        </footer>
      </motion.section>
    </motion.div>
  )
}
