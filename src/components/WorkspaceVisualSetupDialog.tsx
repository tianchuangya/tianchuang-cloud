import { ImagePlus, X } from 'lucide-react'
import type { WorkspaceProfile } from '../../electron/types'

interface Props {
  workspace: WorkspaceProfile
  thumbnail?: string
  background?: string
  onPickThumbnail: () => void
  onPickBackground: () => void
  onClose: () => void
}

export default function WorkspaceVisualSetupDialog({ workspace, thumbnail, background, onPickThumbnail, onPickBackground, onClose }: Props) {
  return (
    <div className="modal-backdrop visual-setup-layer" role="presentation">
      <section className="glass-modal visual-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="visual-setup-title">
        <header>
          <div><span>新资料库</span><h2 id="visual-setup-title">设置“{workspace.name}”的外观</h2><p>两张图各司其职，之后也能从资料库右键菜单修改。</p></div>
          <button className="icon-button" aria-label="关闭" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="visual-setup-grid">
          <button className="visual-pick-card thumbnail" onClick={onPickThumbnail}>
            <span className="visual-pick-preview">{thumbnail ? <img src={thumbnail} alt="当前缩略图" /> : <ImagePlus size={25} />}</span>
            <span><strong>缩略图</strong><small>接近正方形，显示在左侧资料库轨道</small></span>
          </button>
          <button className="visual-pick-card background" onClick={onPickBackground}>
            <span className="visual-pick-preview"><img src={background} alt="当前背景图" /></span>
            <span><strong>背景图</strong><small>横向图片，显示在资料库聚焦舞台</small></span>
          </button>
        </div>
        <footer><span>每个资料库会自动获得一组稳定随机的默认图片，也可以随时替换。</span><button className="primary-button" onClick={onClose}>完成</button></footer>
      </section>
    </div>
  )
}
