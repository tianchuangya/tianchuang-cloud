import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, Crop, LoaderCircle, X, ZoomIn } from 'lucide-react'
import type { WorkspaceProfile } from '../../electron/types'

function CoverCropDialog({ workspace, source, onClose, onSave }: { workspace: WorkspaceProfile; source: string; onClose: () => void; onSave: (dataUrl: string) => Promise<void> }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const update = () => setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight })
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    update()
    return () => observer.disconnect()
  }, [])

  const baseScale = naturalSize.width && viewportSize.width
    ? Math.max(viewportSize.width / naturalSize.width, viewportSize.height / naturalSize.height)
    : 1
  const displayWidth = naturalSize.width * baseScale
  const displayHeight = naturalSize.height * baseScale
  const clampOffset = (x: number, y: number, nextZoom = zoom) => ({
    x: Math.max(-(displayWidth * nextZoom - viewportSize.width) / 2, Math.min((displayWidth * nextZoom - viewportSize.width) / 2, x)),
    y: Math.max(-(displayHeight * nextZoom - viewportSize.height) / 2, Math.min((displayHeight * nextZoom - viewportSize.height) / 2, y)),
  })

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    setOffset(clampOffset(
      dragRef.current.offsetX + event.clientX - dragRef.current.x,
      dragRef.current.offsetY + event.clientY - dragRef.current.y,
    ))
  }
  const finishDrag = () => { dragRef.current = null }
  const changeZoom = (nextZoom: number) => {
    setZoom(nextZoom)
    setOffset((current) => clampOffset(current.x, current.y, nextZoom))
  }
  const save = async () => {
    if (!naturalSize.width || !viewportSize.width) return
    setSaving(true)
    setError('')
    try {
      const image = new Image()
      image.src = source
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = 1280
      canvas.height = 720
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法创建封面画布')
      const scale = baseScale * zoom
      const sourceWidth = viewportSize.width / scale
      const sourceHeight = viewportSize.height / scale
      const sourceX = (naturalSize.width - sourceWidth) / 2 - offset.x / scale
      const sourceY = (naturalSize.height - sourceHeight) / 2 - offset.y / scale
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
      await onSave(canvas.toDataURL('image/png', .92))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setSaving(false)
    }
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="modal glass-modal cover-crop-modal" initial={{ opacity: 0, scale: .97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .98, y: 8 }} transition={{ type: 'spring', bounce: 0, duration: .28 }}>
        <header><div className="settings-symbol"><Crop size={21} /></div><div><h2>调整“{workspace.name}”的封面</h2><p>拖动图片选择区域，使用滑杆调整缩放</p></div><button className="icon-button" title="关闭" onClick={onClose}><X size={18} /></button></header>
        <div className="cover-crop-content">
          <div ref={viewportRef} className="cover-crop-viewport" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
            <img
              src={source}
              alt="待裁剪封面"
              draggable={false}
              onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              style={{ width: displayWidth || 'auto', height: displayHeight || 'auto', transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
            />
            <span className="cover-crop-grid" aria-hidden="true" />
          </div>
          <label className="cover-zoom-control"><ZoomIn size={16} /><span>缩放</span><input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => changeZoom(Number(event.target.value))} /><output>{Math.round(zoom * 100)}%</output></label>
          <p className="cover-crop-note">封面将保存为 1280 × 720 PNG，并作为相对路径文件随资料库同步。</p>
          {error && <p className="form-error"><AlertTriangle size={15} />{error}</p>}
        </div>
        <footer><button className="plain-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving || !naturalSize.width} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={17} /> : <Crop size={17} />}保存封面</button></footer>
      </motion.section>
    </motion.div>
  )
}

export default CoverCropDialog
