import { useEffect, useState, type CSSProperties } from 'react'
import { Box, CheckCircle2, Clapperboard, Download, ExternalLink, FileCog, Gamepad2, Image as ImageIcon, LoaderCircle, MonitorPlay, Network, PanelsTopLeft, Play, Radio, Settings2, ShieldAlert, Sparkles, Usb } from 'lucide-react'
import type { ToolboxState, ToolboxToolId, ToolboxToolState } from '../../electron/types'

const EMPTY: ToolboxState = { tools: [] }

function ToolIcon({ id }: { id: ToolboxToolId }) {
  if (id === 'localsend') return <Radio size={27} />
  if (id === 'sunshine') return <MonitorPlay size={27} />
  if (id === 'winisland') return <PanelsTopLeft size={27} />
  if (id === 'pecofence') return <PanelsTopLeft size={27} />
  if (id === 'filee') return <FileCog size={27} />
  if (id === 'rufus') return <Usb size={27} />
  if (id === 'windhawk') return <Settings2 size={27} />
  if (id === 'folia') return <ImageIcon size={27} />
  if (id === 'kazumi') return <Clapperboard size={27} />
  if (id === 'clash-verge') return <Network size={27} />
  return <Gamepad2 size={27} />
}

function statusText(tool: ToolboxToolState): string {
  if (tool.status === 'built-in') return '已内置'
  if (tool.status === 'running') return '正在运行'
  if (tool.status === 'installed') return '已安装'
  if (tool.status === 'downloading') return `下载中${tool.progress == null ? '' : ` ${tool.progress}%`}`
  if (tool.status === 'installing') return `安装中${tool.progress == null ? '' : ` ${tool.progress}%`}`
  if (tool.status === 'installer-opened') return '等待安装向导'
  if (tool.status === 'error') return '操作失败'
  return '可选安装'
}

export default function Toolbox({ onOpenLocalSend }: { onOpenLocalSend: () => void }) {
  const [state, setState] = useState<ToolboxState>(EMPTY)
  const [error, setError] = useState<string>()
  const [working, setWorking] = useState<ToolboxToolId>()

  useEffect(() => {
    let mounted = true
    void window.tianchuang.getToolboxState().then((next) => { if (mounted) setState(next) }).catch((reason) => setError(String(reason)))
    const remove = window.tianchuang.onToolboxEvent((event) => { if (mounted) setState(event.state) })
    const refresh = window.setInterval(() => void window.tianchuang.getToolboxState().then(setState), 5000)
    return () => { mounted = false; remove(); window.clearInterval(refresh) }
  }, [])

  const install = async (id: ToolboxToolId) => {
    setError(undefined); setWorking(id)
    try { setState(await window.tianchuang.installTool(id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setWorking(undefined) }
  }

  const launch = async (tool: ToolboxToolState) => {
    if (tool.id === 'localsend') { onOpenLocalSend(); return }
    setError(undefined); setWorking(tool.id)
    try { setState(await window.tianchuang.launchTool(tool.id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setWorking(undefined) }
  }

  return <section className="toolbox-page">
    <header className="toolbox-hero">
      <div>
        <span className="toolbox-eyebrow"><Sparkles size={14} />扩展能力</span>
        <h1>工具箱</h1>
        <p>按需安装，不把每一项功能都塞进主程序。内置传送、设备串流与游戏优化，各自保持清晰边界。</p>
      </div>
      <div className="toolbox-orbit" aria-hidden="true"><Box size={30} /><i /><i /><i /></div>
    </header>

    {error && <div className="toolbox-alert"><ShieldAlert size={18} /><span>{error}</span></div>}

    <div className="tool-grid">
      {state.tools.map((tool, index) => {
        const pending = working === tool.id || tool.status === 'downloading' || tool.status === 'installing'
        return <article className={`tool-card tool-${tool.id}`} key={tool.id} style={{ '--tool-index': index } as CSSProperties}>
          <div className="tool-card-top">
            <span className="tool-icon"><ToolIcon id={tool.id} /></span>
            <span className={`tool-status ${tool.status}`}><i />{statusText(tool)}</span>
          </div>
          <div className="tool-copy">
            <div className="tool-title"><h2>{tool.name}</h2>{tool.version && <small>{tool.version}</small>}</div>
            <p>{tool.summary}</p>
          </div>
          {(tool.status === 'downloading' || tool.status === 'installing') && <div className="tool-progress"><i style={{ width: `${tool.progress || 5}%` }} /></div>}
          {tool.message && <div className={`tool-message ${tool.status === 'error' ? 'error' : ''}`}>{tool.message}</div>}
          <div className="tool-meta"><span>{tool.license}</span>{tool.checksum && <span title={tool.checksum}>SHA-256 已固定</span>}{tool.defaultsAvailable && <span title="仅用于新配置，不覆盖现有设置；不含账号、订阅、令牌、历史和绝对路径">隐私清理默认配置</span>}</div>
          {tool.id === 'pavise' && <div className="tool-warning"><ShieldAlert size={14} />运行会请求管理员权限，并修改游戏调度相关系统设置。</div>}
          {tool.id === 'rufus' && <div className="tool-warning"><ShieldAlert size={14} />写入启动盘会清空所选 U 盘；工具箱只负责启动，不会自动选择磁盘。</div>}
          <div className="tool-actions">
            {tool.canLaunch && <button className="tool-primary" disabled={pending} onClick={() => void launch(tool)}>{pending ? <LoaderCircle className="spin" size={16} /> : tool.status === 'built-in' ? <ExternalLink size={16} /> : <Play size={16} />}{tool.status === 'built-in' ? '打开功能' : '运行'}</button>}
            {!tool.installed && tool.canInstall && <button className="tool-primary" disabled={pending} onClick={() => void install(tool.id)}>{pending ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}安装</button>}
            <button className="tool-secondary" onClick={() => void window.tianchuang.openToolLocation(tool.id)}>{tool.installed ? <CheckCircle2 size={15} /> : <ExternalLink size={15} />}{tool.installed && tool.id !== 'localsend' ? '安装位置' : '项目来源'}</button>
          </div>
        </article>
      })}
    </div>
  </section>
}
