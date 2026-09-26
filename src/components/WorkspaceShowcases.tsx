import { useState } from 'react'
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

export function AccordionWorkspaceView({ workspaces, covers, onSelect }: Props) {
  const pageSize = 5
  const [page, setPage] = useState(0)
  const [active, setActive] = useState(0)
  const pageCount = Math.max(1, Math.ceil(workspaces.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const safeActive = Math.min(active, Math.max(0, workspaces.length - safePage * pageSize - 1))
  const visible = workspaces.slice(safePage * pageSize, safePage * pageSize + pageSize)
  const move = (delta: number) => { setPage((value) => (value + delta + pageCount) % pageCount); setActive(0) }

  if (!workspaces.length) return <div className="showcase-empty"><Folder size={26} /><span>添加资料库后即可使用手风琴封面视图</span></div>
  return <section className="accordion-workspaces" onWheel={(event) => Math.abs(event.deltaY) > 18 && move(event.deltaY > 0 ? 1 : -1)}>
    <div className="showcase-toolbar"><span>{safePage + 1} / {pageCount}</span><button onClick={() => move(-1)} disabled={pageCount < 2} aria-label="上一组资料库"><ChevronLeft size={17} /></button><button onClick={() => move(1)} disabled={pageCount < 2} aria-label="下一组资料库"><ChevronRight size={17} /></button></div>
    <div className="accordion-workspace-track">
      {visible.map((workspace, index) => <button key={workspace.id} className={safeActive === index ? 'active' : ''} onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => safeActive === index ? onSelect(workspace.id) : setActive(index)}>
        <span className="accordion-cover"><Cover workspace={workspace} cover={covers[workspace.id]} /></span>
        <span className="accordion-shade" />
        <span className="accordion-copy"><strong>{workspace.name}</strong><small>{workspace.targets.length} 个备份目标</small></span>
      </button>)}
    </div>
  </section>
}

export function DepthWorkspaceView({ workspaces, covers, onSelect }: Props) {
  const [active, setActive] = useState(0)
  const safeActive = Math.min(active, Math.max(0, workspaces.length - 1))
  const move = (delta: number) => workspaces.length && setActive((value) => (value + delta + workspaces.length) % workspaces.length)
  if (!workspaces.length) return <div className="showcase-empty"><Folder size={26} /><span>添加资料库后即可使用深度轮播视图</span></div>
  return <section className="depth-workspaces" tabIndex={0} onKeyDown={(event) => { if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1) }} onWheel={(event) => Math.abs(event.deltaY) > 18 && move(event.deltaY > 0 ? 1 : -1)}>
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
