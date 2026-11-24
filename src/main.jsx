import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const platform = window.terminalAPI?.platform
// 让 CSS 能针对不同平台定制窗口顶部栏（macOS 需要给信号灯留位置）
if (platform) document.documentElement.dataset.platform = platform

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
