import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { DEFAULT_TERMINAL_DISPLAY } from './lib/terminalDisplay'

// 一次性迁移：终端默认恢复为 Weft 主题、12px、Noto Sans Mono CJK
try {
  const displayKey = 'serialdebug.terminal.display'
  const marker = 'serialdebug.terminal.display.weftDefault.v1'
  if (!window.localStorage.getItem(marker)) {
    window.localStorage.setItem(
      displayKey,
      JSON.stringify(DEFAULT_TERMINAL_DISPLAY)
    )
    window.localStorage.removeItem('serialdebug.terminal.customThemes')
    window.localStorage.setItem(marker, '1')
  }
} catch {
  // 隐私模式下忽略
}

const platform = window.terminalAPI?.platform
// 让 CSS 能针对不同平台定制窗口顶部栏（macOS 需要给信号灯留位置）
if (platform) document.documentElement.dataset.platform = platform

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
