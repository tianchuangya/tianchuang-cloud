import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { Folder } from 'lucide-react'
import type { WorkspaceProfile } from '../../electron/types'
import './GridMotion.css'

interface GridMotionProps {
  workspaces: WorkspaceProfile[]
  covers: Record<string, string | undefined>
  backgroundImage?: string
  onSelect: (workspaceId: string) => void
}

const CELL_COUNT = 28
const FOCUS_POSITIONS = [10, 17, 9, 18, 11, 16, 3, 24, 2, 25, 4, 23, 8, 19, 12, 15, 1, 26, 5, 22, 7, 20, 13, 14, 0, 27, 6, 21]

export default function GridMotion({ workspaces, covers, backgroundImage, onSelect }: GridMotionProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const items = useMemo(() => {
    const visible = workspaces.slice(0, CELL_COUNT)
    const positions = FOCUS_POSITIONS.slice(0, visible.length)
    return Array.from({ length: CELL_COUNT }, (_, index) => {
      const workspaceIndex = positions.indexOf(index)
      return { workspace: workspaceIndex >= 0 ? visible[workspaceIndex] : undefined }
    })
  }, [workspaces])

  useEffect(() => {
    const root = rootRef.current
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    let target = 0
    let current = 0
    const render = () => {
      current += (target - current) * .1
      rowRefs.current.forEach((row, index) => {
        if (row) row.style.transform = `translate3d(${current * (index % 2 ? -1 : 1)}px, 0, 0)`
      })
      frame = Math.abs(target - current) > .1 ? requestAnimationFrame(render) : 0
    }
    const move = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect()
      target = ((event.clientX - rect.left) / rect.width - .5) * 58
      if (!frame) frame = requestAnimationFrame(render)
    }
    const leave = () => {
      target = 0
      if (!frame) frame = requestAnimationFrame(render)
    }
    root.addEventListener('pointermove', move)
    root.addEventListener('pointerleave', leave)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      root.removeEventListener('pointermove', move)
      root.removeEventListener('pointerleave', leave)
    }
  }, [items])

  if (!workspaces.length) return null

  return (
    <div ref={rootRef} className="library-motion-grid" aria-label="动态资料库网格" style={{ '--motion-background': `url("${backgroundImage || '/assets/cloud-glass-bg.png'}")` } as CSSProperties}>
      {Array.from({ length: 4 }, (_, rowIndex) => (
        <div className="library-motion-row" key={rowIndex} ref={(element) => { rowRefs.current[rowIndex] = element }}>
          {items.slice(rowIndex * 7, rowIndex * 7 + 7).map(({ workspace }, columnIndex) => {
            if (!workspace) return <span className="library-motion-ambient" aria-hidden="true" key={`${rowIndex}-${columnIndex}-ambient`} style={{ backgroundPosition: `${columnIndex * 16}% ${rowIndex * 30}%` }} />
            const cover = covers[workspace.id]
            return (
              <button
                className={`library-motion-item ${cover ? 'has-cover' : ''}`}
                key={`${rowIndex}-${columnIndex}-${workspace.id}`}
                onClick={() => onSelect(workspace.id)}
                aria-label={`打开资料库 ${workspace.name}`}
                style={cover ? { '--library-cover': `url("${cover}")` } as CSSProperties : undefined}
              >
                <span className="motion-cover-placeholder"><Folder size={27} /></span>
                <span className="motion-item-copy"><strong>{workspace.name}</strong><small>{workspace.targets.length} 个备份目标</small></span>
              </button>
            )
          })}
        </div>
      ))}
      <div className="library-motion-vignette" aria-hidden="true" />
    </div>
  )
}
