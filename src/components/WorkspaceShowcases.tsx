import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Folder } from 'lucide-react'
import type { WorkspaceProfile } from '../../electron/types'

type Props = {
  workspaces: WorkspaceProfile[]
  covers: Record<string, string | undefined>
  onSelect: (workspaceId: string) => void
}

function Cover({ workspace, cover }: { workspace: WorkspaceProfile; cover?: string }) {
  return cover ? <img src={cover} alt="" draggable={false} /> : <span className="showcase-fallback"><Folder size={38} /><small>{workspace.name.slice(0, 1).toUpperCase()}</small></span>
}

// 滚轮步进：React 的 onWheel 是被动监听，无法阻止页面滚动，也扛不住一次快速滚动
// 产生的大量事件。这里用原生非被动监听：累积位移达到阈值才切一步，并在切步后冷却
// 一小段时间，让一整圈快速滚动只前进有限的几步而不是原地抖动。
function useWheelSteps(onStep: (delta: 1 | -1) => void, options?: { threshold?: number; cooldownMs?: number }) {
  const threshold = options?.threshold ?? 90
  const cooldownMs = options?.cooldownMs ?? 240
  const stepRef = useRef(onStep)
  useEffect(() => { stepRef.current = onStep })
  const [element, setElement] = useState<HTMLElement | null>(null)
  const stateRef = useRef({ accumulated: 0, lockedUntil: 0 })
  useEffect(() => {
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      const state = stateRef.current
      if (event.deltaY === 0) return
      event.preventDefault()
      const now = performance.now()
      if (now < state.lockedUntil) return
      if (Math.sign(event.deltaY) !== Math.sign(state.accumulated)) state.accumulated = 0
      state.accumulated += event.deltaY
      if (Math.abs(state.accumulated) >= threshold) {
        const delta: 1 | -1 = state.accumulated > 0 ? 1 : -1
        state.accumulated = 0
        state.lockedUntil = now + cooldownMs
        stepRef.current(delta)
      }
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [element, threshold, cooldownMs])
  return setElement
}

export function AccordionWorkspaceView({ workspaces, covers, onSelect }: Props) {
  const pageSize = 5
  const [page, setPage] = useState(0)
  const [direction, setDirection] = useState<1 | -1>(1)
  const [active, setActive] = useState(0)
  const pageCount = Math.max(1, Math.ceil(workspaces.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const safeActive = Math.min(active, Math.max(0, workspaces.length - safePage * pageSize - 1))
  const visible = workspaces.slice(safePage * pageSize, safePage * pageSize + pageSize)
  const move = (delta: number) => { setDirection(delta > 0 ? 1 : -1); setPage((value) => (value + delta + pageCount) % pageCount); setActive(0) }
  const wheelRef = useWheelSteps((delta) => pageCount > 1 && move(delta))

  if (!workspaces.length) return <div className="showcase-empty"><Folder size={26} /><span>添加资料库后即可使用手风琴封面视图</span></div>
  return <section className="accordion-workspaces" ref={wheelRef} tabIndex={0} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(-1); if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(1) }}>
    <div className="showcase-toolbar"><span>{safePage + 1} / {pageCount}</span><button onClick={() => move(-1)} disabled={pageCount < 2} aria-label="上一组资料库"><ChevronLeft size={17} /></button><button onClick={() => move(1)} disabled={pageCount < 2} aria-label="下一组资料库"><ChevronRight size={17} /></button></div>
    <div key={safePage} className={`accordion-page-slide ${direction > 0 ? 'slide-next' : 'slide-prev'}`}>
      <div className="accordion-workspace-track">
        {visible.map((workspace, index) => <button key={workspace.id} className={safeActive === index ? 'active' : ''} onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => safeActive === index ? onSelect(workspace.id) : setActive(index)}>
          <span className="accordion-cover"><Cover workspace={workspace} cover={covers[workspace.id]} /></span>
          <span className="accordion-shade" />
          <span className="accordion-copy"><strong>{workspace.name}</strong><small>{workspace.targets.length} 个备份目标</small></span>
        </button>)}
      </div>
    </div>
    <p className="showcase-hint">滚动滚轮或使用方向键切换分组，悬停展开，再次点击打开资料库</p>
  </section>
}

export function DepthWorkspaceView({ workspaces, covers, onSelect }: Props) {
  const [active, setActive] = useState(0)
  const safeActive = Math.min(active, Math.max(0, workspaces.length - 1))
  const move = (delta: number) => workspaces.length && setActive((value) => (value + delta + workspaces.length) % workspaces.length)
  const wheelRef = useWheelSteps((delta) => move(delta))
  if (!workspaces.length) return <div className="showcase-empty"><Folder size={26} /><span>添加资料库后即可使用深度轮播视图</span></div>
  return <section className="depth-workspaces" ref={wheelRef} tabIndex={0} onKeyDown={(event) => { if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1) }}>
    <div className="depth-stage">
      {workspaces.map((workspace, index) => {
        let offset = index - safeActive
        if (offset > workspaces.length / 2) offset -= workspaces.length
        if (offset < -workspaces.length / 2) offset += workspaces.length
        const hidden = Math.abs(offset) > 3
        return <button key={workspace.id} className={offset === 0 ? 'active' : ''} style={{ transform: `translate(-50%, -50%) translateX(${offset * 170}px) translateZ(${-Math.abs(offset) * 145}px) rotateY(${-offset * 14}deg)`, opacity: Math.max(.34, 1 - Math.abs(offset) * .22), zIndex: 5 - Math.abs(offset) } as React.CSSProperties} aria-hidden={hidden} tabIndex={offset === 0 ? 0 : -1} onClick={() => offset === 0 ? onSelect(workspace.id) : setActive(index)}>
          <span className="depth-cover"><Cover workspace={workspace} cover={covers[workspace.id]} /></span>
          <span className="depth-copy"><strong>{workspace.name}</strong><small>{workspace.path}</small></span>
        </button>
      })}
    </div>
    <button className="depth-arrow previous" onClick={() => move(-1)} aria-label="上一个资料库"><ChevronLeft size={19} /></button><button className="depth-arrow next" onClick={() => move(1)} aria-label="下一个资料库"><ChevronRight size={19} /></button>
    <div className="depth-dots">{workspaces.map((workspace, index) => <button key={workspace.id} className={index === safeActive ? 'active' : ''} onClick={() => setActive(index)} aria-label={`查看 ${workspace.name}`} />)}</div>
  </section>
}
