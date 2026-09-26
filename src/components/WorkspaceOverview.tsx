import { motion } from 'motion/react'
import { ChevronRight, Folder, FolderInput, Grid2X2, Image as ImageIcon, Layers3, Waves } from 'lucide-react'
import type { LibraryView } from './cursor-preferences'
import type { WorkspaceProfile } from '../../electron/types'
import FadeContent from './FadeContent'
import GridMotion from './GridMotion'
import { AccordionWorkspaceView, DepthWorkspaceView } from './WorkspaceShowcases'

function WorkspaceOverview({ workspaces, covers, backgroundImage, backgroundBlur, backgroundOpacity, view, onChangeView, onSelect, onAdd }: { workspaces: WorkspaceProfile[]; covers: Record<string, string | undefined>; backgroundImage?: string; backgroundBlur: number; backgroundOpacity: number; view: LibraryView; onChangeView: (view: LibraryView) => void; onSelect: (workspaceId: string) => void; onAdd: () => void }) {
  return (
    <FadeContent className="library-overview" duration={320} blurAmount={7}>
      <section className="library-overview-header">
        <div><span className="overview-eyebrow">所有资料库</span><h1>你的同步空间</h1><p>封面随资料库保存，换一台电脑也能保持相同识别方式。</p></div>
        <div className="overview-actions">
          <div className="view-switch" aria-label="资料库显示方式">
            <button className={view === 'glass' ? 'active' : ''} title="玻璃图标" aria-label="玻璃图标视图" aria-pressed={view === 'glass'} onClick={() => onChangeView('glass')}><Grid2X2 size={16} /></button>
            <button className={view === 'motion' ? 'active' : ''} title="动态网格" aria-label="动态网格视图" aria-pressed={view === 'motion'} onClick={() => onChangeView('motion')}><Layers3 size={16} /></button>
            <button className={view === 'accordion' ? 'active' : ''} title="手风琴封面" aria-label="手风琴封面视图" aria-pressed={view === 'accordion'} onClick={() => onChangeView('accordion')}><ImageIcon size={16} /></button>
            <button className={view === 'depth' ? 'active' : ''} title="深度轮播" aria-label="深度轮播视图" aria-pressed={view === 'depth'} onClick={() => onChangeView('depth')}><Waves size={16} /></button>
          </div>
          <button className="secondary-button" onClick={onAdd}><FolderInput size={16} />添加资料库</button>
        </div>
      </section>
      {view === 'motion' ? <GridMotion workspaces={workspaces} covers={covers} backgroundImage={backgroundImage} backgroundBlur={backgroundBlur} backgroundOpacity={backgroundOpacity} onSelect={onSelect} /> : view === 'accordion' ? <AccordionWorkspaceView workspaces={workspaces} covers={covers} onSelect={onSelect} /> : view === 'depth' ? <DepthWorkspaceView workspaces={workspaces} covers={covers} onSelect={onSelect} /> : (
        <section className="library-glass-grid" aria-label="资料库">
          {workspaces.map((workspace, index) => (
            <motion.button className={`library-glass-card ${covers[workspace.id] ? 'has-cover' : ''}`} key={workspace.id} onClick={() => onSelect(workspace.id)} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * .035, .18), duration: .24 }}>
              <span className={`library-card-cover ${covers[workspace.id] ? 'has-cover' : ''}`}>
                {covers[workspace.id] ? <img src={covers[workspace.id]} alt="" /> : <Folder size={34} />}
              </span>
              <span className="library-card-glass">
                <span className="library-card-copy"><strong>{workspace.name}</strong><small>{workspace.path}</small></span>
                <span className="library-card-meta"><i className={`state-dot ${workspace.state}`} /><span>{workspace.targets.length} 个备份目标</span><ChevronRight size={15} /></span>
              </span>
            </motion.button>
          ))}
        </section>
      )}
    </FadeContent>
  )
}

export default WorkspaceOverview
