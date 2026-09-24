import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installDemoApi } from './demo-api.ts'

if (import.meta.env.DEV && !window.tianchuang) installDemoApi()

const bridgeUnavailable = (
  <main className="startup-error">
    <strong>桌面服务未能启动</strong>
    <p>请重新启动天创云端。如果问题持续，请重新安装当前版本。</p>
  </main>
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.tianchuang ? <App /> : bridgeUnavailable}
  </StrictMode>,
)
