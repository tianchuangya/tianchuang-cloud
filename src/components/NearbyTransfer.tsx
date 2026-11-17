import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, Copy, FileUp, FolderUp, Laptop, LoaderCircle, MessageSquareText, Radio, RefreshCw, Search, Send, ShieldCheck, Smartphone, X } from 'lucide-react'
import type { NearbyDevice, NearbyEvent, NearbyState, NearbyTransfer } from '../../electron/types'
import { formatFileSize } from './workspace-meta'

const EMPTY: NearbyState = { status: 'starting', devices: [], receiveRequests: [], transfers: [] }

function deviceIcon(device: NearbyDevice) {
  return device.deviceType === 'mobile' ? <Smartphone size={20} /> : <Laptop size={20} />
}

function statusLabel(status: NearbyState['status']) {
  if (status === 'ready') return '可被发现'
  if (status === 'starting') return '正在启动'
  if (status === 'unavailable') return '服务不可用'
  return '已停止'
}

function transferLabel(transfer: NearbyTransfer) {
  if (transfer.status === 'complete') return transfer.direction === 'send' ? '发送完成' : '接收完成'
  if (transfer.status === 'error') return '传输失败'
  return transfer.direction === 'send' ? '正在发送' : '正在接收'
}

export default function NearbyTransfer() {
  const [state, setState] = useState<NearbyState>(EMPTY)
  const [selectedFingerprint, setSelectedFingerprint] = useState<string>()
  const [text, setText] = useState('')
  const [host, setHost] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ message: string; error?: boolean }>()
  const [receivedTexts, setReceivedTexts] = useState<Array<{ alias: string; text: string }>>([])

  const selected = useMemo(() => state.devices.find((device) => device.fingerprint === selectedFingerprint), [state.devices, selectedFingerprint])

  useEffect(() => {
    void window.tianchuang.getNearbyState().then((next) => {
      setState(next)
      setSelectedFingerprint((current) => current && next.devices.some((item) => item.fingerprint === current) ? current : next.devices[0]?.fingerprint)
    })
    return window.tianchuang.onNearbyEvent((event: NearbyEvent) => {
      if (event.type === 'state') setState(event.state)
      if (event.type === 'devices') {
        setState((current) => ({ ...current, devices: event.devices }))
        setSelectedFingerprint((current) => current && event.devices.some((item) => item.fingerprint === current) ? current : event.devices[0]?.fingerprint)
      }
      if (event.type === 'receive-request') setState((current) => ({ ...current, receiveRequests: [event.request, ...current.receiveRequests.filter((item) => item.sessionId !== event.request.sessionId)] }))
      if (event.type === 'transfer') setState((current) => ({ ...current, transfers: [event.transfer, ...current.transfers.filter((item) => item.id !== event.transfer.id)].slice(0, 30) }))
      if (event.type === 'text-received') {
        setReceivedTexts((current) => [{ alias: event.alias, text: event.text }, ...current].slice(0, 10))
        setNotice({ message: `收到来自 ${event.alias} 的文本` })
      }
      if (event.type === 'file-received') setNotice({ message: event.success ? `文件已保存到 ${event.path}` : event.message, error: !event.success })
      if (event.type === 'error') setNotice({ message: event.message, error: true })
    })
  }, [])

  const run = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true)
    setNotice(undefined)
    try {
      await action()
      if (success) setNotice({ message: success })
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : String(error), error: true })
    } finally {
      setBusy(false)
    }
  }

  const sendText = () => {
    if (!selected || !text.trim()) return
    void run(async () => {
      await window.tianchuang.sendNearbyText(selected.fingerprint, text)
      setText('')
    }, `文本已发送给 ${selected.alias}`)
  }

  return <div className="nearby-page">
    <section className="nearby-hero">
      <div>
        <span className="nearby-eyebrow"><Radio size={14} />附近传送</span>
        <h1>在设备之间直接传文件和文本</h1>
        <p>基于 LocalSend 协议，数据在局域网内点对点传输，不经过天创云端服务器。</p>
      </div>
      <div className={`nearby-service-status ${state.status}`}>
        <span className="nearby-status-dot" />
        <div><strong>{statusLabel(state.status)}</strong><small>{state.alias || '本机服务'}{state.port ? ` · 端口 ${state.port}` : ''}</small></div>
      </div>
    </section>

    {state.error && <div className="nearby-alert error"><AlertCircle size={17} /><div><strong>附近传送暂时不可用</strong><span>{state.error}</span></div></div>}
    {notice && <div className={`nearby-alert ${notice.error ? 'error' : 'success'}`}>{notice.error ? <AlertCircle size={17} /> : <Check size={17} />}<span>{notice.message}</span><button aria-label="关闭提示" onClick={() => setNotice(undefined)}><X size={15} /></button></div>}

    <div className="nearby-grid">
      <section className="nearby-panel device-panel">
        <div className="nearby-panel-heading">
          <div><h2>附近设备</h2><p>{state.devices.length ? `发现 ${state.devices.length} 台设备` : '等待同一网络中的设备出现'}</p></div>
          <button className="icon-button" title="重新扫描" disabled={state.status !== 'ready'} onClick={() => void run(() => window.tianchuang.refreshNearby())}><RefreshCw size={17} className={busy ? 'spin' : ''} /></button>
        </div>
        <div className="nearby-device-list">
          {state.devices.map((device) => <button key={device.fingerprint} className={`nearby-device ${selectedFingerprint === device.fingerprint ? 'selected' : ''}`} onClick={() => setSelectedFingerprint(device.fingerprint)}>
            <span className="nearby-device-icon">{deviceIcon(device)}</span>
            <span><strong>{device.alias}</strong><small>{device.model || (device.deviceType === 'mobile' ? '移动设备' : '桌面设备')}{device.host ? ` · ${device.host}` : ''}</small></span>
            <span className="device-online-dot" />
          </button>)}
          {!state.devices.length && <div className="nearby-empty"><Search size={23} /><strong>还没有发现设备</strong><span>打开另一台设备的 LocalSend 或天创云端，并保持在同一局域网。</span></div>}
        </div>
        <form className="nearby-manual" onSubmit={(event) => { event.preventDefault(); if (host.trim()) void run(() => window.tianchuang.probeNearby(host.trim()), '已发起设备连接检查') }}>
          <label htmlFor="nearby-host">手动连接</label>
          <div><input id="nearby-host" value={host} onChange={(event) => setHost(event.target.value)} placeholder="IP 地址或主机名" /><button type="submit" disabled={!host.trim() || state.status !== 'ready'}>查找</button></div>
        </form>
      </section>

      <section className="nearby-panel send-panel">
        <div className="nearby-panel-heading"><div><h2>发送内容</h2><p>{selected ? `发送到 ${selected.alias}` : '请先选择一台设备'}</p></div><ShieldCheck size={18} /></div>
        <div className="nearby-text-compose">
          <textarea value={text} onChange={(event) => setText(event.target.value)} disabled={!selected} placeholder="输入要发送的文本、链接或临时消息…" maxLength={16_000_000} />
          <div><span>{text.length.toLocaleString()} 字符</span><button className="primary-button" disabled={!selected || !text.trim() || busy} onClick={sendText}>{busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}发送文本</button></div>
        </div>
        <div className="nearby-file-actions">
          <button className="nearby-file-action" disabled={!selected || busy} onClick={() => selected && void run(() => window.tianchuang.selectAndSendNearbyFiles(selected.fingerprint, 'files'))}>
            <span><FileUp size={23} /></span><div><strong>选择文件</strong><small>可一次发送多个文件</small></div>
          </button>
          <button className="nearby-file-action" disabled={!selected || busy} onClick={() => selected && void run(() => window.tianchuang.selectAndSendNearbyFiles(selected.fingerprint, 'folder'))}>
            <span><FolderUp size={23} /></span><div><strong>选择文件夹</strong><small>完整保留目录结构</small></div>
          </button>
        </div>
        <p className="nearby-privacy"><ShieldCheck size={14} />连接使用 HTTPS 与设备证书指纹校验；接收文件前需要在对方设备确认。</p>
      </section>
    </div>

    {!!state.receiveRequests.length && <section className="nearby-panel receive-panel">
      <div className="nearby-panel-heading"><div><h2>等待接收确认</h2><p>确认来源和文件名后再接收</p></div></div>
      {state.receiveRequests.map((request) => <article className="nearby-receive" key={request.sessionId}>
        <span className="nearby-device-icon"><FileUp size={19} /></span>
        <div><strong>{request.alias} 想发送 {request.files.length} 个文件</strong><small>{request.files.slice(0, 3).map((file) => file.name).join('、')}{request.files.length > 3 ? '…' : ''} · {formatFileSize(request.totalBytes)}</small></div>
        <button className="secondary-button" onClick={() => void run(() => window.tianchuang.answerNearbyRequest(request.sessionId, false))}>拒绝</button>
        <button className="primary-button" onClick={() => void run(() => window.tianchuang.answerNearbyRequest(request.sessionId, true), '已开始接收，文件将保存到下载目录')}>接收</button>
      </article>)}
    </section>}

    {(receivedTexts.length > 0 || state.transfers.length > 0) && <section className="nearby-panel nearby-activity">
      <div className="nearby-panel-heading"><div><h2>最近传送</h2><p>当前会话中的文本与文件传输</p></div></div>
      {receivedTexts.map((item, index) => <article className="nearby-text-received" key={`${item.alias}-${index}`}><MessageSquareText size={18} /><div><strong>来自 {item.alias}</strong><p>{item.text}</p></div><button title="复制文本" onClick={() => void navigator.clipboard.writeText(item.text)}><Copy size={15} /></button></article>)}
      {state.transfers.map((transfer) => {
        const percent = transfer.totalBytes ? Math.min(100, Math.round(transfer.transferredBytes / transfer.totalBytes * 100)) : transfer.status === 'complete' ? 100 : 0
        return <article className={`nearby-transfer ${transfer.status}`} key={transfer.id}><div><strong>{transferLabel(transfer)}</strong><small>{formatFileSize(transfer.transferredBytes)} / {formatFileSize(transfer.totalBytes)}</small></div><div className="nearby-progress"><i style={{ width: `${percent}%` }} /></div><span>{percent}%</span>{transfer.status === 'running' && <button onClick={() => void window.tianchuang.cancelNearbyTransfer(transfer.id)}>取消</button>}</article>
      })}
    </section>}
  </div>
}
