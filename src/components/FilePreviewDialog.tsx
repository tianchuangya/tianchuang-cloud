import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { AlertTriangle, ExternalLink, FolderOpen, LoaderCircle, X } from 'lucide-react'
import { motion } from 'motion/react'
import { previewKindOf, type PreviewKind } from '../../electron/preview-kind'
import type { WorkspaceFileEntry, WorkspaceProfile } from '../../electron/types'

function fileUrl(workspaceId: string, path: string): string {
  return `tianchuang-file://${workspaceId}/${path.split('/').map(encodeURIComponent).join('/')}`
}

const KIND_LABELS: Record<PreviewKind, string> = {
  image: '图片',
  markdown: 'Markdown',
  text: '文本',
  audio: '音频',
  video: '视频',
  pdf: 'PDF 文档',
  unknown: '未知格式',
}

type Props = {
  workspace: WorkspaceProfile
  entry: WorkspaceFileEntry
  onClose: () => void
}

export default function FilePreviewDialog({ workspace, entry, onClose }: Props) {
  const kind = previewKindOf(entry.name, entry.size)
  const url = fileUrl(workspace.id, entry.path)
  const [loaded, setLoaded] = useState<{ html?: string; text?: string; error?: string } | undefined>(
    kind === 'markdown' || kind === 'text' ? undefined : {},
  )
  const loading = loaded === undefined
  const error = loaded?.error ?? ''

  useEffect(() => {
    const onCancel = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onCancel)
    return () => window.removeEventListener('keydown', onCancel)
  }, [onClose])

  useEffect(() => {
    if (kind !== 'markdown' && kind !== 'text') return
    let active = true
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`读取失败（${response.status}）`)
        return response.text()
      })
      .then((content) => {
        if (!active) return
        setLoaded(kind === 'markdown' ? { html: DOMPurify.sanitize(marked.parse(content, { async: false }) as string) } : { text: content })
      })
      .catch((reason) => {
        if (active) setLoaded({ error: reason instanceof Error ? reason.message : String(reason) })
      })
    return () => { active = false }
  }, [kind, url])

  const openInSystem = async () => {
    await window.tianchuang.openWorkspaceFileInSystem(workspace.id, entry.path)
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="modal glass-modal file-preview-modal" initial={{ opacity: 0, scale: .97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .98, y: 8 }} transition={{ type: 'spring', bounce: 0, duration: .28 }}>
        <header>
          <div className="settings-symbol">{KIND_LABELS[kind] === '未知格式' ? <AlertTriangle size={20} /> : <span className="file-kind-badge">{KIND_LABELS[kind]}</span>}</div>
          <div><h2>{entry.name}</h2><p>{KIND_LABELS[kind]} · {entry.path}</p></div>
          <button className="icon-button" title="关闭" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="file-preview-body">
          {loading && <div className="collaboration-empty"><LoaderCircle className="spin" size={16} />正在读取文件…</div>}
          {error && <div className="form-error" role="alert"><AlertTriangle size={15} />{error}</div>}
          {!loading && !error && kind === 'image' && <div className="file-preview-media"><img src={url} alt={entry.name} /></div>}
          {!loading && !error && kind === 'video' && <div className="file-preview-media"><video src={url} controls autoPlay /></div>}
          {!loading && !error && kind === 'audio' && <div className="file-preview-media"><audio src={url} controls autoPlay /></div>}
          {!loading && !error && kind === 'pdf' && <iframe className="file-preview-frame" src={url} title={entry.name} />}
          {!loading && !error && kind === 'markdown' && <div className="md-preview" dangerouslySetInnerHTML={{ __html: loaded.html ?? '' }} />}
          {!loading && !error && kind === 'text' && <pre className="text-preview">{loaded.text ?? ''}</pre>}
          {!loading && !error && kind === 'unknown' && <div className="collaboration-empty">天创云端无法预览这种格式，请用系统应用打开。</div>}
        </div>
        <footer>
          <button className="plain-button" onClick={() => void window.tianchuang.revealWorkspaceFileInFolder(workspace.id, entry.path)}><FolderOpen size={16} />在文件夹中显示</button>
          <button className="secondary-button" onClick={() => void openInSystem()}><ExternalLink size={15} />用系统应用打开</button>
        </footer>
      </motion.section>
    </motion.div>
  )
}
