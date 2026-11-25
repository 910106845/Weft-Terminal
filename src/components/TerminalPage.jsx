import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import Icon from './Icons'
import GhostCursor from './GhostCursor'
import BrandMark from './BrandMark'
import { isLiteLevel, useEffectsLevel } from '../lib/effects'
import PageTag from './PageTag'
import StatusCapsule from './StatusCapsule'
import GlassButton from './LiquidGlass'
import Modal from './Modal'
import TerminalCommandEditor from './TerminalCommandEditor'
import TerminalCommandLibrary from './TerminalCommandLibrary'
import Portal from './Portal'
import SshFilePanel from './SshFilePanel'
import {
  createTerminalCommand,
  normalizeTerminalCommands
} from '../lib/terminalCommands'
import {
  DEFAULT_TERMINAL_DISPLAY,
  TERMINAL_FONT_GROUPS,
  getTerminalFontFamily,
  normalizeTerminalDisplay
} from '../lib/terminalDisplay'
import {
  TERMINAL_THEMES,
  TUI_TERM_THEME,
  getTerminalTheme,
  isDarkTerminalTheme,
  terminalThemePreset,
  terminalThemeSwatch
} from '../lib/terminalThemes'
import { formatDateForFile, formatTime } from '../lib/format'
import { SSH_ENCODINGS, sshProfileLabel } from '../lib/sshProfiles'
import {
  findLogHighlights,
  getLogHighlightTerminalColors
} from '../lib/logHighlight'
import {
  loadTerminalHistory,
  mergeTerminalHistory,
  rememberTerminalCommand,
  terminalHistoryKey
} from '../lib/terminalHistory'

// cat 二进制文件时，字节流里会混进制表符绘图字符集（DEC Special Graphics）
// 和 G1/GL 切换。远端 shell 本身是正常的，但终端一旦被切到这个字符集，
// 之后所有输出——包括自己输入的回显——都会变成 ▒≤≥┌┘ 这类乱码，而二进制里
// 基本不会再出现复位指令。
// 处理方式：用户重新开始输入时，先把 G0/G1 复位回 ASCII 并把 GL 切回 G0，
// 保证接下来的回显和命令输出立刻恢复正常。全屏程序（vim/mc 等）跑在备用
// 缓冲区，不去动它们的字符集，避免影响它们自己的边框绘制。
function neutralizeCharset(term) {
  if (!term) return false
  if (term.buffer?.active?.type === 'alternate') return false
  term.write('\u001b(B\u001b)B\u000f')
  return true
}

// 当逐键跟踪失效（方向键、shell 补全、粘贴）时，从屏幕上的光标行反推命令。
// 优先用本次会话学到的提示符前缀；否则退回到 # / $ / % 结尾的常见提示符。
function commandFromScreenLine (raw, prompt) {
  const text = String(raw || '').trimEnd()
  if (!text) return ''
  const trimmedPrompt = String(prompt || '')
  if (trimmedPrompt && text.startsWith(trimmedPrompt)) {
    return text.slice(trimmedPrompt.length).trim()
  }
  const marks = ['# ', '$ ', '% ', ']# ', '] $ ', ']% ']
  let cut = -1
  for (const mark of marks) {
    const index = text.lastIndexOf(mark)
    if (index > cut) cut = index
  }
  if (cut < 0) return ''
  const command = text.slice(cut + 2).trim()
  return command
}

// 记录用户当前正在输入的一行，作为补全的过滤词。
// 只要遇到方向键、Tab 补全这类会让光标/内容脱离掌控的输入，就把 known 置为
// false，这一行不再参与补全，避免把补全词写到错误的位置。
function trackInputLine (line, data) {
  let submitted = false
  let index = 0
  while (index < data.length) {
    const code = data.charCodeAt(index)
    if (code === 27) {
      line.known = false
      if (data[index + 1] === '[') {
        index += 2
        while (index < data.length && !/[@-~]/.test(data[index])) index += 1
        index += 1
        continue
      }
      index += 1
      continue
    }
    const char = data[index]
    if (char === '\r' || char === '\n') {
      submitted = true
      index += 1
      continue
    }
    if (code === 127 || code === 8) {
      line.text = line.text.slice(0, -1)
      index += 1
      continue
    }
    if (code === 21) {
      line.text = ''
      index += 1
      continue
    }
    if (code === 23) {
      line.text = line.text.replace(/\S*\s*$/, '')
      index += 1
      continue
    }
    if (code === 3 || code === 4) {
      line.text = ''
      line.known = true
      index += 1
      continue
    }
    if (char === '\t') {
      line.known = false
      index += 1
      continue
    }
    if (code < 32) {
      index += 1
      continue
    }
    line.text += char
    index += 1
  }
  return submitted
}

function searchDecorationOptions(theme) {
  if (theme === 'dark') {
    return {
      matchBackground: '#5c4a1d',
      matchBorder: '#b98a24',
      matchOverviewRuler: '#b98a24',
      activeMatchBackground: '#c98a1f',
      activeMatchBorder: '#ffe09a',
      activeMatchColorOverviewRuler: '#ffe09a'
    }
  }
  return {
    matchBackground: '#f6d98a',
    matchBorder: '#d9a72e',
    matchOverviewRuler: '#d9a72e',
    activeMatchBackground: '#e0a12c',
    activeMatchBorder: '#9a6500',
    activeMatchColorOverviewRuler: '#9a6500'
  }
}

function terminalCommandKey(item) {
  return `${item.name || ''}\u0000${item.command || ''}`
}

function statusLabel(status) {
  if (status === 'running') return '运行中'
  if (status === 'starting') return '启动中'
  if (status === 'reconnecting') return '重连中'
  if (status === 'disconnected') return '已断开'
  if (status === 'exited') return '已退出'
  if (status === 'error') return '不可用'
  return '等待中'
}


function formatStatBytes(value, base = 1024) {
  const n = Math.max(0, Number(value) || 0)
  if (n >= base ** 4) return `${(n / base ** 4).toFixed(1)} TB`
  if (n >= base ** 3) return `${(n / base ** 3).toFixed(1)} GB`
  if (n >= base ** 2) return `${(n / base ** 2).toFixed(0)} MB`
  if (n >= base) return `${(n / base).toFixed(0)} KB`
  return `${Math.round(n)} B`
}

function formatStatRate(value) {
  const n = Math.max(0, Number(value) || 0)
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB/s`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB/s`
  return `${Math.round(n)} B/s`
}

function sysLevel(value) {
  const n = Number(value) || 0
  if (n >= 85) return 'is-hot'
  if (n >= 70) return 'is-warn'
  return ''
}

function SystemStatsBar({ stats, remote }) {
  if (!stats) return null
  const cpu = Math.round(Number(stats.cpu) || 0)
  const memPct = Math.round(Number(stats.mem?.percent) || 0)
  const diskPct = Math.round(Number(stats.disk?.percent) || 0)
  const rx = Number(stats.net?.rx) || 0
  const tx = Number(stats.net?.tx) || 0
  const latency = Math.round(Number(stats.latency) || 0)
  return (
    <div
      className="terminal-system-stats"
      title={remote ? '远端主机实时指标' : '本机实时指标'}
    >
      <span className={`sys-stat ${sysLevel(cpu)}`} title={`CPU ${cpu}%`}>
        <Icon name="cpu" size={12} />
        <em>CPU</em>
        <strong>{cpu}%</strong>
      </span>
      <span
        className={`sys-stat ${sysLevel(memPct)}`}
        title={`内存 ${formatStatBytes(stats.mem?.used)} / ${formatStatBytes(
          stats.mem?.total
        )}`}
      >
        <Icon name="memory" size={12} />
        <em>内存</em>
        <strong>{memPct}%</strong>
      </span>
      <span
        className={`sys-stat ${sysLevel(diskPct)}`}
        title={`磁盘 已用 ${formatStatBytes(
          stats.disk?.used,
          stats.disk?.base
        )} · 可用 ${formatStatBytes(
          stats.disk?.available,
          stats.disk?.base
        )} · 共 ${formatStatBytes(stats.disk?.total, stats.disk?.base)}`}
      >
        <Icon name="disk" size={12} />
        <em>磁盘</em>
        <strong>{diskPct}%</strong>
      </span>
      <span
        className="sys-stat is-net"
        title={`网络 ↓ ${formatStatRate(rx)} · ↑ ${formatStatRate(tx)}`}
      >
        <Icon name="network" size={12} />
        <strong>↓ {formatStatRate(rx)}</strong>
        <strong>↑ {formatStatRate(tx)}</strong>
      </span>
      {remote && latency > 0 ? (
        <span
          className={`sys-stat is-latency ${
            latency >= 300 ? 'is-hot' : latency >= 150 ? 'is-warn' : ''
          }`}
          title={`SSH 往返延迟 ${latency} ms${
            latency >= 150 ? ' · 网络较慢，终端会自动降低采样频率' : ''
          }`}
        >
          <Icon name="signal" size={12} />
          <em>延迟</em>
          <strong>{latency} ms</strong>
        </span>
      ) : null}
    </div>
  )
}

// 快速判断一行是否有可见字符，避免对超长日志行反复构建完整字符串
function bufferLineHasText (line) {
  if (!line) return false
  for (let x = 0; x < line.length; x += 1) {
    const code = line.getCell(x)?.getCode()
    if (code && code > 32 && code !== 127) return true
  }
  return false
}

export default function TerminalPage({
  sessionId,
  active,
  visible = active,
  accent,
  statusAccent,
  tagAccent,
  resolvedTheme,
  onToggleTheme,
  onMetaChange,
  onNewTerminal,
  onNewSsh,
  commands = [],
  setCommands,
  display = DEFAULT_TERMINAL_DISPLAY,
  setDisplay,
  initialShellId = '',
  sshProfile = null,
  sshCredentials = null,
  onEditSsh,
  transport = 'local',
  split = false,
  onPaneDragStart,
  onPaneDragEnd,
  paneTitle,
  paneTag,
  paneTagClass
}) {
  const effectsLevel = useEffectsLevel()
  const [status, setStatus] = useState('starting')
  const [shellInfo, setShellInfo] = useState(null)
  const [pid, setPid] = useState(null)
  const [size, setSize] = useState({ cols: 80, rows: 24 })
  const [systemStats, setSystemStats] = useState(null)
  const [reconnectAttempt, setReconnectAttempt] = useState(0)
  const [offlineInputCount, setOfflineInputCount] = useState(0)

  useEffect(() => {
    if (!visible || status !== 'running') return undefined
    let stopped = false
    let timer = null
    const baseInterval = transport === 'ssh' ? 3000 : 2000
    let slowFactor = 1
    const tick = async () => {
      if (stopped) return
      // 正在输入时先不采样，避免和按键/回显抢同一条链路
      if (Date.now() - lastInputAtRef.current < 1200) {
        timer = setTimeout(tick, 1200)
        return
      }
      const startedAt = performance.now()
      try {
        const result = await window.terminalAPI?.stats?.(sessionId)
        if (!stopped && result?.ok) {
          setSystemStats(result)
          const latency = Number(result.latency) || 0
          slowFactor =
            latency > 180 || performance.now() - startedAt > 1500 ? 2 : 1
        }
      } catch {
        // 系统信息不可用时保持上一帧
      }
      if (!stopped) timer = setTimeout(tick, baseInterval * slowFactor)
    }
    tick()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [visible, sessionId, status, transport])
  const [error, setError] = useState('')
  const [exitInfo, setExitInfo] = useState(null)
  const [libraryOpen, setLibraryOpen] = useState(false)

  useEffect(() => {
    if (!visible) {
      setLibraryOpen(false)
      setFilePanelOpen(false)
    }
  }, [visible])
  const [commandEditor, setCommandEditor] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [toast, setToast] = useState(null)
  const [displayMenuOpen, setDisplayMenuOpen] = useState(false)
  const [shells, setShells] = useState([])
  const [shellMenuOpen, setShellMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState({ index: -1, count: 0 })
  const [alternateScreen, setAlternateScreen] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [suggestionIndex, setSuggestionIndex] = useState(-1)
  const [suggestBox, setSuggestBox] = useState(null)
  const [suggestPrefix, setSuggestPrefix] = useState('')
  const [hostKeyPrompt, setHostKeyPrompt] = useState(null)
  const [filePanelOpen, setFilePanelOpen] = useState(false)

  const containerRef = useRef(null)
  const surfaceRef = useRef(null)
  const lineRef = useRef({ text: '', known: true })
  const suggestionRef = useRef({ items: [], index: -1 })
  const historyRef = useRef([])
  const commandsRef = useRef([])
  const inputTrackerRef = useRef(null)
  const promptRef = useRef('')
  const suggestionKeysRef = useRef(null)
  const displayMenuRef = useRef(null)
  const shellMenuRef = useRef(null)
  const searchInputRef = useRef(null)
  const searchAddonRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const activeRef = useRef(active)
  const visibleRef = useRef(visible)
  const aliveRef = useRef(true)
  const themeRef = useRef(resolvedTheme)
  const displayRef = useRef(display)
  const shellIdRef = useRef(initialShellId)
  const fitFrameRef = useRef(null)
  const scrollbarFrameRef = useRef(null)
  // 用户向上滚动时暂存新输出，避免和自动跟随互相拉扯导致抖动
  const outputHoldRef = useRef({ paused: false, chunks: [], size: 0 })
  const lastOutputAtRef = useRef(0)
  const pendingClearRef = useRef(false)
  const clearPollRef = useRef(0)
  const logDecorationRefs = useRef([])
  const logHighlightTimerRef = useRef(null)
  const logHighlightSignatureRef = useRef('')
  const timestampEntriesRef = useRef([])
  const timestampScanMarkerRef = useRef(null)
  const timestampGutterRef = useRef(null)
  const timestampTimerRef = useRef(null)
  const timestampRowHeightRef = useRef(0)
  const toastTimerRef = useRef(null)
  const lastInputAtRef = useRef(0)
  const statusRef = useRef(status)
  const spawnSessionRef = useRef(null)
  const scheduleReconnectRef = useRef(null)
  const reconnectRef = useRef({ attempts: 0, timer: null })
  const offlineToastAtRef = useRef(0)
  const pendingInputRef = useRef('')
  const pendingReplayRef = useRef(null)
  const manualDisconnectRef = useRef(false)
  const showToastRef = useRef(null)
  const isMac = window.terminalAPI?.platform === 'darwin'
  const isSsh = transport === 'ssh'
  const commandScopeLabel = isSsh ? 'SSH 指令' : '本地终端指令'
  const commandLibraryLabel = isSsh ? '远程终端指令库' : '本地终端指令库'

  activeRef.current = active
  visibleRef.current = visible
  themeRef.current = resolvedTheme
  displayRef.current = display
  statusRef.current = status

  const showToast = useCallback((message, kind = 'success') => {
    setToast({ message, kind })
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 2400)
  }, [])
  showToastRef.current = showToast

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  const updateDisplay = useCallback(
    (patch) => {
      if (!setDisplay) return
      setDisplay((prev) =>
        normalizeTerminalDisplay({ ...(prev || DEFAULT_TERMINAL_DISPLAY), ...patch })
      )
    },
    [setDisplay]
  )

  const clearLogDecorations = useCallback(() => {
    for (const item of logDecorationRefs.current) {
      try {
        item.decoration?.dispose()
      } catch {
        // 装饰可能已随缓冲区销毁
      }
      try {
        item.marker?.dispose()
      } catch {
        // 标记可能已经失效
      }
    }
    logDecorationRefs.current = []
    logHighlightSignatureRef.current = ''
  }, [])

  const applyLogHighlights = useCallback(() => {
    const term = termRef.current
    const container = containerRef.current
    if (!term || !container) return
    if (
      displayRef.current.logHighlight === false ||
      term.buffer.active.type !== 'normal'
    ) {
      clearLogDecorations()
      return
    }
    if (container.clientWidth < 40 || container.clientHeight < 40) return

    const buffer = term.buffer.active
    const theme = themeRef.current
    const colors = getLogHighlightTerminalColors(theme)
    const startY = Math.max(0, buffer.viewportY)
    const endY = Math.min(buffer.length - 1, startY + term.rows - 1)
    const plans = []
    const signatureParts = []

    for (let y = startY; y <= endY; y++) {
      const line = buffer.getLine(y)
      if (!line) continue
      const text = line.translateToString(true)
      if (!text) continue
      const matches = findLogHighlights(text)
      if (!matches.length) continue

      signatureParts.push(
        `${y}:${text}:${matches
          .map((match) => `${match.start}-${match.end}-${match.tone}`)
          .join(',')}`
      )

      let columnMap = null
      if (/[^\x00-\x7f]/.test(text)) {
        columnMap = []
        let index = 0
        for (let col = 0; col < term.cols; col++) {
          const cell = line.getCell(col)
          if (!cell) break
          if (cell.getWidth() === 0) continue
          const chars = cell.getChars() || ' '
          for (let i = 0; i < chars.length; i++) {
            columnMap[index] = col
            index += 1
          }
          if (index >= text.length) break
        }
      }

      for (const match of matches) {
        const startCol = columnMap
          ? columnMap[match.start]
          : match.start
        const endCol = columnMap
          ? (columnMap[match.end - 1] ?? startCol) + 1
          : match.end
        if (startCol === undefined) continue
        const x = Math.max(0, Math.min(term.cols - 1, startCol))
        const width = Math.max(
          1,
          Math.min(term.cols - x, endCol - startCol)
        )
        plans.push({ y, x, width, tone: match.tone })
      }
    }

    const nextSignature = `${theme}|${signatureParts.join('\n')}`
    if (nextSignature === logHighlightSignatureRef.current) return

    clearLogDecorations()
    logHighlightSignatureRef.current = nextSignature

    const cursorLine = buffer.baseY + buffer.cursorY
    for (const plan of plans) {
      const color = colors[plan.tone]
      if (!color) continue
      const marker = term.registerMarker(plan.y - cursorLine)
      if (!marker) continue
      const decoration = term.registerDecoration({
        marker,
        x: plan.x,
        width: plan.width,
        layer: 'top',
        foregroundColor: color.fg
      })
      if (!decoration) {
        marker.dispose()
        continue
      }
      decoration.onRender((element) => {
        element.classList.add('xterm-log-highlight')
      })
      logDecorationRefs.current.push({ marker, decoration })
    }
  }, [clearLogDecorations])

  const scheduleLogHighlights = useCallback(
    (delay = 80) => {
      // 不在每次输出时重置计时器，否则持续滚动日志会一直得不到刷新。
      if (logHighlightTimerRef.current) return
      // 正在打字时把扫描让出去，优先保证按键回显
      const typing = Date.now() - lastInputAtRef.current < 600
      logHighlightTimerRef.current = setTimeout(() => {
        logHighlightTimerRef.current = null
        applyLogHighlights()
      }, typing ? Math.max(delay, 300) : delay)
    },
    [applyLogHighlights]
  )

  const clearTimestampMarkers = useCallback(() => {
    for (const item of timestampEntriesRef.current) {
      try {
        item.marker?.dispose()
      } catch {
        // 标记可能已经随缓冲区销毁
      }
    }
    timestampEntriesRef.current = []
    try {
      timestampScanMarkerRef.current?.dispose()
    } catch {
      // ignore
    }
    timestampScanMarkerRef.current = null
    const gutter = timestampGutterRef.current
    if (gutter) gutter.replaceChildren()
  }, [])

  const updateTimestampLabels = useCallback(() => {
    const term = termRef.current
    const container = containerRef.current
    if (!term || !container) return
    const gutter = timestampGutterRef.current
    const buffer = term.buffer.active

    if (displayRef.current.showTimestamps === false) {
      for (const item of timestampEntriesRef.current) {
        try {
          item.marker?.dispose()
        } catch {
          // ignore
        }
      }
      timestampEntriesRef.current = []
      try {
        timestampScanMarkerRef.current?.dispose()
      } catch {
        // ignore
      }
      timestampScanMarkerRef.current = null
      if (gutter) gutter.replaceChildren()
      return
    }

    if (buffer.type === 'alternate') {
      if (gutter) gutter.replaceChildren()
      return
    }

    const now = Date.now()
    const entries = timestampEntriesRef.current.filter(
      (item) => item.marker && !item.marker.isDisposed && item.marker.line >= 0
    )
    timestampEntriesRef.current = entries

    const byLine = new Map()
    for (const item of entries) {
      byLine.set(item.marker.line, item)
    }

    const cursorLine = buffer.baseY + buffer.cursorY
    const addMarker = (y) => {
      if (byLine.has(y)) return
      const marker = term.registerMarker(y - cursorLine)
      if (!marker) return
      const entry = { marker, time: now }
      entries.push(entry)
      byLine.set(y, entry)
    }

    const scanMarker = timestampScanMarkerRef.current
    const scanStart =
      scanMarker && !scanMarker.isDisposed ? scanMarker.line + 1 : 0
    const start = Math.max(scanStart, buffer.length - 400)
    for (let y = start; y < buffer.length; y += 1) {
      const line = buffer.getLine(y)
      if (!line) continue
      if (!bufferLineHasText(line)) continue
      addMarker(y)
    }

    const rows = term.rows
    const labels = []
    for (let i = 0; i < rows; i += 1) {
      const y = buffer.viewportY + i
      const line = buffer.getLine(y)
      if (!line || line.isWrapped) {
        labels.push('')
        continue
      }
      const hasText = bufferLineHasText(line)
      if (hasText && !byLine.has(y)) addMarker(y)
      const entry = byLine.get(y)
      labels.push(
        hasText && entry?.time
          ? formatTime(new Date(entry.time)).slice(0, 8)
          : ''
      )
    }

    while (entries.length > 400) {
      const removed = entries.shift()
      try {
        removed.marker?.dispose()
      } catch {
        // ignore
      }
    }

    try {
      timestampScanMarkerRef.current?.dispose()
    } catch {
      // ignore
    }
    timestampScanMarkerRef.current = term.registerMarker(
      buffer.length - 1 - cursorLine
    )

    const screen = container.querySelector('.xterm-screen')
    const screenHeight = screen?.getBoundingClientRect().height || 0
    const rowHeight = rows > 0 ? screenHeight / rows : 0
    if (Math.abs(rowHeight - timestampRowHeightRef.current) > 0.25) {
      timestampRowHeightRef.current = rowHeight
    }

    if (gutter) {
      if (gutter.childElementCount !== labels.length) {
        gutter.replaceChildren()
        for (let i = 0; i < labels.length; i += 1) {
          const span = document.createElement('span')
          span.className = 'terminal-time-label'
          gutter.appendChild(span)
        }
      }
      for (let i = 0; i < labels.length; i += 1) {
        const span = gutter.children[i]
        if (span && span.textContent !== labels[i]) {
          span.textContent = labels[i]
        }
      }
      gutter.style.setProperty('--timestamp-rows', String(rows))
      gutter.style.setProperty(
        '--timestamp-total-height',
        `${screenHeight || 0}px`
      )
    }
  }, [])

  const scheduleTimestampUpdate = useCallback(
    (delay = 60) => {
      if (timestampTimerRef.current) return
      // 输入时延迟扫描时间戳列，避免每个回显字符都做一次 400 行扫描
      const typing = Date.now() - lastInputAtRef.current < 600
      timestampTimerRef.current = setTimeout(() => {
        timestampTimerRef.current = null
        updateTimestampLabels()
      }, typing ? Math.max(delay, 500) : delay)
    },
    [updateTimestampLabels]
  )

  const syncTerminalScrollbar = useCallback(() => {
    const container = containerRef.current
    const term = termRef.current
    if (!container || !term) return
    const viewport = container.querySelector('.xterm-viewport')
    if (!viewport) return
    const buffer = term.buffer.active
    const isAlternate = buffer.type === 'alternate'
    let hasScrollback = false
    if (!isAlternate && buffer.length > term.rows) {
      // 终端缩放时会留下空白回看行，只看真正有内容的行，
      // 避免没有内容时仍然显示滚动条。
      const start = Math.max(0, buffer.baseY - 200)
      for (let y = buffer.baseY - 1; y >= start; y -= 1) {
        const line = buffer.getLine(y)
        if (line && bufferLineHasText(line)) {
          hasScrollback = true
          break
        }
      }
    }
    const scrolled = !isAlternate && buffer.viewportY < buffer.baseY
    const scrollable = !isAlternate && (hasScrollback || scrolled)
    container.classList.toggle('is-scrollable', scrollable)
  }, [])

  const fitTerminal = useCallback(() => {
    const container = containerRef.current
    if (!container || container.clientWidth < 40 || container.clientHeight < 40) {
      return
    }
    try {
      fitRef.current?.fit()
    } catch {
      // 容器尺寸变化过程中可能暂时无法计算
    }
    syncTerminalScrollbar()
    scheduleLogHighlights(0)
    scheduleTimestampUpdate(0)
  }, [
    scheduleLogHighlights,
    scheduleTimestampUpdate,
    syncTerminalScrollbar
  ])

  const scheduleFit = useCallback(() => {
    if (fitFrameRef.current) cancelAnimationFrame(fitFrameRef.current)
    fitFrameRef.current = requestAnimationFrame(() => {
      fitTerminal()
      fitFrameRef.current = requestAnimationFrame(() => {
        fitFrameRef.current = null
        fitTerminal()
        const term = termRef.current
        if (term) term.refresh(0, term.rows - 1)
      })
    })
  }, [fitTerminal])

  useEffect(() => {
    return () => {
      if (fitFrameRef.current) cancelAnimationFrame(fitFrameRef.current)
      if (scrollbarFrameRef.current) {
        cancelAnimationFrame(scrollbarFrameRef.current)
      }
      if (logHighlightTimerRef.current) {
        clearTimeout(logHighlightTimerRef.current)
      }
      if (timestampTimerRef.current) {
        clearTimeout(timestampTimerRef.current)
      }
      clearLogDecorations()
      clearTimestampMarkers()
    }
  }, [clearLogDecorations, clearTimestampMarkers])

  useEffect(() => {
    if (!displayMenuOpen) return undefined
    const onPointerDown = (event) => {
      if (!displayMenuRef.current?.contains(event.target)) {
        setDisplayMenuOpen(false)
      }
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setDisplayMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [displayMenuOpen])

  useEffect(() => {
    if (transport !== 'ssh') return undefined
    const off = window.terminalAPI?.onHostKey?.((payload) => {
      if (!payload || payload.terminalId !== sessionId) return
      setHostKeyPrompt(payload)
    })
    return () => off?.()
  }, [sessionId, transport])

  useEffect(() => {
    if (status !== 'starting') setHostKeyPrompt(null)
  }, [status])

  useEffect(() => {
    if (status !== 'running') setFilePanelOpen(false)
  }, [status])

  useEffect(() => {
    if (transport === 'ssh') return undefined
    let alive = true
    const api = window.terminalAPI
    if (!api?.shells) return undefined
    api.shells()
      .then((result) => {
        if (!alive || !result?.ok) return
        setShells(Array.isArray(result.shells) ? result.shells : [])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!shellMenuOpen) return undefined
    const onPointerDown = (event) => {
      if (!shellMenuRef.current?.contains(event.target)) {
        setShellMenuOpen(false)
      }
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setShellMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [shellMenuOpen])

  const normalizedSearchQuery = searchQuery.trim()

  const closeSearch = useCallback(() => {
    searchAddonRef.current?.clearDecorations()
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResult({ index: -1, count: 0 })
    termRef.current?.focus()
  }, [])

  const toggleSearch = useCallback(() => {
    if (searchOpen) closeSearch()
    else setSearchOpen(true)
  }, [closeSearch, searchOpen])

  const resetTerminalSearch = useCallback(() => {
    searchAddonRef.current?.clearDecorations()
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResult({ index: -1, count: 0 })
  }, [])

  const goSearch = useCallback(
    (direction) => {
      const addon = searchAddonRef.current
      if (!addon || !normalizedSearchQuery) return
      const options = {
        decorations: searchDecorationOptions(
          isDarkTerminalTheme(displayRef.current.themeId, themeRef.current)
            ? 'dark'
            : 'light'
        ),
        incremental: false
      }
      if (direction < 0) addon.findPrevious(normalizedSearchQuery, options)
      else addon.findNext(normalizedSearchQuery, options)
    },
    [normalizedSearchQuery]
  )

  useEffect(() => {
    if (!searchOpen) return undefined
    const frame = requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [searchOpen])

  useEffect(() => {
    const addon = searchAddonRef.current
    if (!addon) return
    if (!searchOpen || !normalizedSearchQuery) {
      addon.clearDecorations()
      setSearchResult({ index: -1, count: 0 })
      return
    }
    addon.findNext(normalizedSearchQuery, {
      decorations: searchDecorationOptions(
        isDarkTerminalTheme(display.themeId, resolvedTheme) ? 'dark' : 'light'
      ),
      incremental: true
    })
  }, [normalizedSearchQuery, resolvedTheme, searchOpen])

  useEffect(() => {
    if (!active) return undefined
    const handler = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') {
        return
      }
      if (
        document.querySelector('.modal-overlay') ||
        document.querySelector('.drawer-layer.is-open')
      ) {
        return
      }
      event.preventDefault()
      setSearchOpen(true)
      requestAnimationFrame(() => {
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active])

  const spawnSession = useCallback(async (options = {}) => {
    const reconnect = Boolean(options?.reconnect)
    const term = termRef.current
    if (!term) return false

    const api = window.terminalAPI
    if (!api) {
      setStatus('error')
      setError('终端接口不可用，请重新启动应用')
      return false
    }

    setStatus(reconnect ? 'reconnecting' : 'starting')
    setError('')
    setExitInfo(null)

    try {
      const request = {
        cols: Math.max(80, term.cols || 80),
        rows: Math.max(24, term.rows || 24)
      }
      if (transport === 'ssh') {
        if (!sshProfile?.host || !sshProfile?.username) {
          setStatus('error')
          setError('请先配置 SSH 主机和用户名')
          return false
        }
        if (sshProfile.authType === 'password' && !sshCredentials?.password) {
          setStatus('error')
          setError('请输入 SSH 密码，或点击“编辑连接”修改认证方式')
          return false
        }
        if (sshProfile.authType === 'key' && !sshProfile.privateKeyPath) {
          setStatus('error')
          setError('请选择 SSH 私钥文件，或点击“编辑连接”修改认证方式')
          return false
        }
        request.transport = 'ssh'
        request.ssh = {
          ...sshProfile,
          password: sshCredentials?.password || '',
          passphrase: sshCredentials?.passphrase || ''
        }
      } else {
        request.shellId = shellIdRef.current || undefined
      }
      const result = await api.create(sessionId, request)
      if (!aliveRef.current) return false
      if (!result || !result.ok) {
        if (!reconnect) {
          setStatus('error')
          setError(result?.error || '终端启动失败')
        }
        return false
      }
      if (result.shell?.id) shellIdRef.current = result.shell.id
      setShellInfo(result.shell || null)
      setPid(result.pid || null)
      setStatus('running')
      neutralizeCharset(term)
      if (reconnect) {
        reconnectRef.current.attempts = 0
        setReconnectAttempt(0)
        const pendingInput = pendingInputRef.current
        pendingInputRef.current = ''
        setOfflineInputCount(0)
        if (pendingInput) {
          const replay = { text: pendingInput }
          pendingReplayRef.current = replay
          // 兜底：如果远端没有输出（极简 shell），1.5s 后仍然填回去
          setTimeout(() => {
            if (!aliveRef.current || pendingReplayRef.current !== replay) return
            pendingReplayRef.current = null
            window.terminalAPI?.write(sessionId, replay.text)
            showToastRef.current?.('已恢复连接，断线期间输入已填入（未执行）')
            term.focus()
          }, 1500)
        }
      }
      scheduleFit()
      // SSH 建立期间发生的尺寸变化可能早于 PTY 创建，这里再同步一次，
      // 避免远端 Shell 的列数与实际终端不一致导致补全/重绘错位。
      window.terminalAPI?.resize(sessionId, term.cols, term.rows)
      term.focus()
      return true
    } catch (errorValue) {
      if (!aliveRef.current) return false
      if (!reconnect) {
        setStatus('error')
        setError(errorValue.message || '终端启动失败')
      }
      return false
    }
  }, [scheduleFit, sessionId, sshCredentials, sshProfile, transport])

  spawnSessionRef.current = spawnSession

  const cancelReconnect = useCallback(() => {
    const state = reconnectRef.current
    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = null
    }
    state.attempts = 0
    pendingInputRef.current = ''
    setOfflineInputCount(0)
    setReconnectAttempt(0)
    setStatus((current) => (current === 'reconnecting' ? 'exited' : current))
  }, [])

  const scheduleReconnect = useCallback(() => {
    const state = reconnectRef.current
    if (state.timer) return
    const delays = [500, 1000, 2500, 5000, 8000, 12000, 15000]
    if (state.attempts >= delays.length) {
      setStatus('error')
      setError('网络中断，自动重连已停止；请点击“重试”')
      setReconnectAttempt(0)
      return
    }
    const delay = delays[state.attempts]
    state.attempts += 1
    setReconnectAttempt(state.attempts)
    setStatus('reconnecting')
    state.timer = setTimeout(async () => {
      state.timer = null
      if (!aliveRef.current) return
      const ok = await spawnSessionRef.current({ reconnect: true })
      if (ok) {
        setReconnectAttempt(0)
        return
      }
      scheduleReconnectRef.current()
    }, delay)
  }, [])

  scheduleReconnectRef.current = scheduleReconnect

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    aliveRef.current = true
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      cursorInactiveStyle: 'outline',
      fontFamily: getTerminalFontFamily(
        displayRef.current.fontFamily
      ),
      fontWeight: 450,
      fontWeightBold: 700,
      fontSize: displayRef.current.fontSize,
      lineHeight: displayRef.current.lineHeight,
      letterSpacing: 0.2,
      scrollback: 6000,
      convertEol: false,
      rightClickSelectsWord: true,
      allowProposedApi: true,
      theme: getTerminalTheme(
        displayRef.current.themeId,
        themeRef.current
      )
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    const unicode11Addon = new Unicode11Addon()
    term.loadAddon(unicode11Addon)
    term.unicode.activeVersion = '11'
    term.open(container)

    // 优先使用 WebGL 渲染器，长日志滚动比 DOM 渲染流畅很多；
    // 显卡/远程桌面不支持时自动退回 xterm 默认渲染器。
    let webglAddon = null
    try {
      webglAddon = new WebglAddon()
      term.loadAddon(webglAddon)
      webglAddon.onContextLoss(() => {
        try {
          webglAddon?.dispose()
        } catch {
          // ignore
        }
        webglAddon = null
      })
    } catch {
      webglAddon = null
    }

    // 直接写入 PTY，绕过 xterm 的 bracketed paste，避免 zsh 等 Shell
    // 把粘贴内容显示成高亮/反显的 paste 区域。
    const onPaste = (event) => {
      const text =
        event.clipboardData?.getData('text/plain') ||
        window.terminalAPI?.clipboard?.readText() ||
        ''
      if (!text) return
      event.preventDefault()
      event.stopPropagation()
      inputTrackerRef.current?.(text)
      neutralizeCharset(term)
      window.terminalAPI?.write(sessionId, text)
    }
    container.addEventListener('paste', onPaste, true)

    const searchAddon = new SearchAddon()
    term.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon
    const searchResultsDisposable = searchAddon.onDidChangeResults((result) => {
      setSearchResult({
        index: result.resultIndex,
        count: result.resultCount
      })
    })
    const bufferChangeDisposable = term.buffer.onBufferChange((buffer) => {
      const isAlternate = buffer?.type === 'alternate'
      setAlternateScreen(isAlternate)
      term.options.theme = isAlternate
        ? TUI_TERM_THEME
        : getTerminalTheme(displayRef.current.themeId, themeRef.current)
      term.options.minimumContrastRatio = isAlternate ? 4.5 : 1
      if (!isAlternate) neutralizeCharset(term)
      scheduleFit()
      if (isAlternate) {
        requestAnimationFrame(() => {
          term.scrollToTop()
          term.refresh(0, Math.max(0, term.rows - 1))
        })
      }
    })
    termRef.current = term
    fitRef.current = fitAddon

    const writeParsedDisposable = term.onWriteParsed(() => {
      if (!scrollbarFrameRef.current) {
        scrollbarFrameRef.current = requestAnimationFrame(() => {
          scrollbarFrameRef.current = null
          syncTerminalScrollbar()
        })
      }
      scheduleLogHighlights(150)
      scheduleTimestampUpdate(100)
    })
    let scrollIdleTimer = 0
    const onTerminalScroll = () => {
      // 滚动时不要每帧扫描时间戳和高亮，长行内容下会明显掉帧。
      // 等滚动停下来 120ms 后再统一刷新一次。
      if (scrollIdleTimer) clearTimeout(scrollIdleTimer)
      scrollIdleTimer = setTimeout(() => {
        scrollIdleTimer = 0
        if (timestampTimerRef.current) {
          clearTimeout(timestampTimerRef.current)
          timestampTimerRef.current = null
        }
        scheduleTimestampUpdate(0)
        scheduleLogHighlights(0)
      }, 120)
      syncOutputHold()
    }
    const scrollDisposable = term.onScroll(onTerminalScroll)
    const viewportElement = container.querySelector('.xterm-viewport')

    const HOLD_LIMIT = 8 * 1024 * 1024
    const WRITE_HIGH = 512 * 1024
    const WRITE_LOW = 128 * 1024
    let pendingWriteBytes = 0
    let flowPaused = false
    const pauseFlow = () => {
      if (flowPaused) return
      flowPaused = true
      window.terminalAPI?.pause?.(sessionId)
    }
    const resumeFlow = () => {
      if (!flowPaused) return
      flowPaused = false
      window.terminalAPI?.resume?.(sessionId)
    }
    const writeToTerm = (data) => {
      if (!data) return
      pendingWriteBytes += data.length
      if (pendingWriteBytes >= WRITE_HIGH) pauseFlow()
      term.write(data, () => {
        pendingWriteBytes = Math.max(0, pendingWriteBytes - data.length)
        if (pendingWriteBytes <= WRITE_LOW) resumeFlow()
      })
    }
    const outputHold = outputHoldRef.current
    const flushHeldOutput = () => {
      if (!outputHold.chunks.length) {
        outputHold.paused = false
        return
      }
      const data = outputHold.chunks.join('')
      outputHold.chunks = []
      outputHold.size = 0
      outputHold.paused = false
      writeToTerm(data)
    }
    const syncOutputHold = () => {
      if (!viewportElement) return
      const atBottom =
        viewportElement.scrollTop + viewportElement.clientHeight >=
        viewportElement.scrollHeight - 4
      if (atBottom) {
        flushHeldOutput()
      } else {
        outputHold.paused = true
      }
    }
    viewportElement?.addEventListener('scroll', onTerminalScroll, {
      passive: true
    })
    viewportElement?.addEventListener('scroll', syncOutputHold, {
      passive: true
    })

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true

      // 补全菜单打开时，方向键/Tab/Enter/Esc 先交给菜单。
      const suggestKeys = suggestionKeysRef.current
      if (suggestKeys?.isOpen()) {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          suggestKeys.move(1)
          return false
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          suggestKeys.move(-1)
          return false
        }
        if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
          event.preventDefault()
          suggestKeys.accept(false)
          return false
        }
        if (event.key === 'Enter' && !event.ctrlKey && !event.altKey && !event.metaKey) {
          if (suggestionRef.current.index >= 0) {
            // 选中候选只填入命令行，不直接执行
            event.preventDefault()
            suggestKeys.accept(false)
            return false
          }
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          suggestKeys.close()
          return false
        }
      }

      // Tab 必须发给 Shell 做补全，不能被浏览器当作焦点切换。
      if (
        event.key === 'Tab' &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        event.preventDefault()
        neutralizeCharset(term)
        window.terminalAPI?.write(sessionId, '\t')
        return false
      }

      const key = event.key.toLowerCase()
      const selection = term.hasSelection() ? term.getSelection() : ''
      // macOS 用 Cmd+C；Windows/Linux 用 Ctrl+C（有选中时）或 Ctrl+Shift+C
      const copyCombo = isMac
        ? event.metaKey && !event.ctrlKey && !event.altKey
        : event.ctrlKey && !event.altKey

      if (copyCombo && key === 'c') {
        if (selection) {
          event.preventDefault()
          event.stopPropagation()
          window.terminalAPI?.clipboard?.writeText(selection)
          // Windows/Linux 复制后取消选中，下一次 Ctrl+C 就能正常发送 SIGINT
          if (!isMac) term.clearSelection()
          return false
        }
        // 没有选中：Ctrl+Shift+C / Cmd+C 不发送字符；
        // Windows/Linux 的普通 Ctrl+C 继续交给 Shell 发送 SIGINT
        if (isMac || event.shiftKey) {
          event.preventDefault()
          return false
        }
        return true
      }

      // macOS Cmd+V 交给系统 Edit > Paste 菜单处理。
      // Windows/Linux 的 Ctrl+V 会被 xterm 当作控制字符，需显式粘贴。
      if (!isMac && event.ctrlKey && key === 'v') {
        event.preventDefault()
        event.stopPropagation()
        const text = window.terminalAPI?.clipboard?.readText()
        if (text) {
          inputTrackerRef.current?.(text)
          neutralizeCharset(term)
          window.terminalAPI?.write(sessionId, text)
        }
        return false
      }

      return true
    })

    let replayInFlight = null
    let replayTimer = 0
    const offData = window.terminalAPI?.onData((payload) => {
      if (payload?.terminalId === sessionId) {
        lastOutputAtRef.current = Date.now()
        // 重连成功后先等远端输出安静下来（提示符/MOTD 画完），
        // 再把断线期间暂存的输入填回命令行，避免 Shell 启动阶段重复回显。
        if (pendingReplayRef.current) {
          replayInFlight = pendingReplayRef.current
          pendingReplayRef.current = null
        }
        if (replayInFlight) {
          if (replayTimer) clearTimeout(replayTimer)
          replayTimer = setTimeout(() => {
            const replay = replayInFlight
            replayInFlight = null
            if (!aliveRef.current || !replay) return
            window.terminalAPI?.write(sessionId, replay.text)
            showToastRef.current?.('已恢复连接，断线期间输入已填入（未执行）')
            termRef.current?.focus()
          }, 500)
        }
        if (outputHold.paused) {
          outputHold.chunks.push(payload.data)
          outputHold.size += payload.data.length
          if (outputHold.size >= 4 * 1024 * 1024) pauseFlow()
          while (
            outputHold.chunks.length > 1 &&
            outputHold.size > HOLD_LIMIT
          ) {
            outputHold.size -= outputHold.chunks.shift().length
          }
        } else {
          writeToTerm(payload.data)
        }
        if (
          payload.data.length > 24 ||
          payload.data.indexOf('\n') !== -1
        ) {
          suggestionKeysRef.current?.close()
        }
      }
    })
    const offExit = window.terminalAPI?.onExit((payload) => {
      if (!payload || payload.terminalId !== sessionId) return
      // 手动断开：保留当前画面，等待用户点“重连”
      if (manualDisconnectRef.current) return
      // 网络断开（不是用户输入 exit）：自动重连，保留当前回看内容
      if (
        transport === 'ssh' &&
        payload.network &&
        statusRef.current === 'running'
      ) {
        setExitInfo(payload)
        term.write(
          '\r\n\u001b[38;5;108m[网络连接中断 · 正在自动重连…]\u001b[0m\r\n'
        )
        scheduleReconnect()
        return
      }
      setStatus('exited')
      setExitInfo(payload)
      const code =
        payload.exitCode === undefined || payload.exitCode === null
          ? '未知'
          : payload.exitCode
      term.write(
        transport === 'ssh'
          ? `\r\n\u001b[38;5;108m[SSH 会话已断开 · 点击“重启”重新连接]\u001b[0m\r\n`
          : `\r\n\u001b[38;5;108m[进程已退出 · code ${code} · 点击“重启”重新打开]\u001b[0m\r\n`
      )
    })

    const dataDisposable = term.onData((data) => {
      lastInputAtRef.current = Date.now()
      if (outputHold.paused) {
        term.scrollToBottom()
        flushHeldOutput()
      }
      if (statusRef.current === 'disconnected') {
        if (Date.now() - offlineToastAtRef.current > 2400) {
          offlineToastAtRef.current = Date.now()
          showToastRef.current?.('已断开连接，点击“重连”继续', 'error')
        }
        return
      }
      if (transport === 'ssh' && statusRef.current !== 'running') {
        if (statusRef.current === 'reconnecting') {
          // 断线期间先暂存可打印字符，重连成功后填回命令行（不自动执行）
          const printable = data.replace(/[\x00-\x1f\x7f]/g, '')
          if (printable) {
            pendingInputRef.current = (
              pendingInputRef.current + printable
            ).slice(0, 4000)
            setOfflineInputCount(pendingInputRef.current.length)
          }
          if (Date.now() - offlineToastAtRef.current > 2400) {
            offlineToastAtRef.current = Date.now()
            showToastRef.current?.('连接中断，输入已暂存，重连后自动填入', 'error')
          }
        } else if (Date.now() - offlineToastAtRef.current > 2400) {
          offlineToastAtRef.current = Date.now()
          showToastRef.current?.('连接已断开，输入未发送', 'error')
        }
        return
      }
      if (data === '\r') neutralizeCharset(term)
      inputTrackerRef.current?.(data)
      window.terminalAPI?.write(sessionId, data)
    })
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      setSize({ cols, rows })
      window.terminalAPI?.resize(sessionId, cols, rows)
      suggestionKeysRef.current?.close()
    })
    const suggestScrollDisposable = term.onScroll(() => {
      suggestionKeysRef.current?.close()
    })

    const observer = new ResizeObserver(() => {
      if (!visibleRef.current) return
      scheduleFit()
    })
    observer.observe(container)

    const onWindowResize = () => {
      if (visibleRef.current) scheduleFit()
    }
    window.addEventListener('resize', onWindowResize)
    window.visualViewport?.addEventListener('resize', onWindowResize)

    const frame = requestAnimationFrame(() => {
      fitTerminal()
      scheduleFit()
      spawnSession()
    })

    return () => {
      aliveRef.current = false
      cancelAnimationFrame(frame)
      if (replayTimer) clearTimeout(replayTimer)
      observer.disconnect()
      window.removeEventListener('resize', onWindowResize)
      window.visualViewport?.removeEventListener('resize', onWindowResize)
      container.removeEventListener('paste', onPaste, true)
      offData?.()
      offExit?.()
      dataDisposable.dispose()
      resizeDisposable.dispose()
      suggestScrollDisposable.dispose()
      scrollDisposable.dispose()
      searchResultsDisposable.dispose()
      bufferChangeDisposable.dispose()
      writeParsedDisposable.dispose()
      scrollDisposable.dispose()
      viewportElement?.removeEventListener('scroll', onTerminalScroll)
      viewportElement?.removeEventListener('scroll', syncOutputHold)
      if (scrollIdleTimer) clearTimeout(scrollIdleTimer)
      clearLogDecorations()
      clearTimestampMarkers()
      if (flowPaused) window.terminalAPI?.resume?.(sessionId)
      try {
        webglAddon?.dispose()
      } catch {
        // ignore
      }
      webglAddon = null
      searchAddon.dispose()
      searchAddonRef.current = null
      window.terminalAPI?.close(sessionId)?.catch?.(() => {})
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [
    clearLogDecorations,
    clearTimestampMarkers,
    fitTerminal,
    scheduleFit,
    scheduleLogHighlights,
    scheduleReconnect,
    scheduleTimestampUpdate,
    sessionId,
    spawnSession,
    syncTerminalScrollbar
  ])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const nextDisplay = normalizeTerminalDisplay(display)
    term.options.fontFamily = getTerminalFontFamily(nextDisplay.fontFamily)
    term.options.fontSize = nextDisplay.fontSize
    term.options.lineHeight = nextDisplay.lineHeight
    term.options.cursorStyle = nextDisplay.cursorStyle
    term.options.theme = alternateScreen
      ? TUI_TERM_THEME
      : getTerminalTheme(nextDisplay.themeId, resolvedTheme)
    scheduleFit()
    scheduleLogHighlights(0)
    scheduleTimestampUpdate(0)
  }, [
    alternateScreen,
    display,
    resolvedTheme,
    scheduleFit,
    scheduleLogHighlights,
    scheduleTimestampUpdate
  ])

  useEffect(() => {
    if (!active) return undefined
    const frame = requestAnimationFrame(() => {
      scheduleFit()
      scheduleLogHighlights(0)
      scheduleTimestampUpdate(0)
      if (termRef.current) termRef.current.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [active, scheduleFit, scheduleLogHighlights, scheduleTimestampUpdate])

  useEffect(() => {
    onMetaChange?.(sessionId, {
      connected: status === 'running',
      portPath: '',
      batchRunning: false,
      shellId: shellInfo?.id || ''
    })
  }, [onMetaChange, sessionId, shellInfo?.id, status])

  useEffect(() => {
    if (!active) return undefined
    const handler = (event) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault()
        setLibraryOpen(true)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [active])

  const sendNativeClear = useCallback(() => {
    if (status !== 'running') return
    const api = window.terminalAPI
    if (!api?.write) return
    if (transport === 'ssh') {
      // readline / zsh / bash 的标准 ClearScreen
      api.write(sessionId, '\x0c')
      return
    }
    if (shellInfo?.id === 'cmd') {
      // cmd 不支持 Ctrl+L：空闲时用 Esc + cls；
      // 命令仍在输出时只发 Ctrl+L，避免把 cls 当成前台程序的输入。
      const busy = Date.now() - lastOutputAtRef.current < 700
      api.write(sessionId, busy ? '\x0c' : '\x1bcls\r')
      return
    }
    api.write(sessionId, '\x0c')
  }, [sessionId, shellInfo?.id, status, transport])

  const runFullClear = useCallback(() => {
    resetTerminalSearch()
    clearLogDecorations()
    clearTimestampMarkers()
    const term = termRef.current
    if (!term) return
    // 先清本地缓冲，保证点击后立即有反馈；
    // 再通知 Shell 清屏，让 ConPTY / 远端终端与 xterm 光标重新同步。
    const outputHold = outputHoldRef.current
    outputHold.paused = false
    outputHold.chunks = []
    outputHold.size = 0
    term.clear()
    sendNativeClear()
    term.focus()
  }, [
    clearLogDecorations,
    clearTimestampMarkers,
    resetTerminalSearch,
    sendNativeClear
  ])

  const schedulePendingClear = useCallback(() => {
    if (clearPollRef.current) return
    const tick = () => {
      clearPollRef.current = 0
      if (!pendingClearRef.current) return
      if (Date.now() - lastOutputAtRef.current < 700) {
        clearPollRef.current = window.setTimeout(tick, 250)
        return
      }
      pendingClearRef.current = false
      runFullClear()
    }
    clearPollRef.current = window.setTimeout(tick, 250)
  }, [runFullClear])

  const clearTerminal = useCallback(() => {
    const term = termRef.current
    if (!term) return
    // 命令仍在输出时只发送清屏请求，等输出停下来再做本地清屏。
    // 立刻本地清屏会让 ConPTY 的光标停在旧行，后续日志前面出现大片空白。
    const busy = Date.now() - lastOutputAtRef.current < 700
    if (busy && status === 'running') {
      pendingClearRef.current = true
      sendNativeClear()
      showToast('命令仍在输出，输出暂停后自动清屏')
      schedulePendingClear()
      term.focus()
      return
    }
    pendingClearRef.current = false
    runFullClear()
  }, [runFullClear, schedulePendingClear, sendNativeClear, showToast, status])

  useEffect(() => {
    return () => {
      if (clearPollRef.current) clearTimeout(clearPollRef.current)
      clearPollRef.current = 0
      pendingClearRef.current = false
    }
  }, [])

  const answerHostKey = useCallback(
    (accept) => {
      setHostKeyPrompt(null)
      window.terminalAPI?.respondHostKey?.(sessionId, accept)
    },
    [sessionId]
  )

  const restartTerminal = useCallback(async () => {
    const term = termRef.current
    if (!term) return
    manualDisconnectRef.current = false
    cancelReconnect()
    resetTerminalSearch()
    clearLogDecorations()
    clearTimestampMarkers()
    window.terminalAPI?.close(sessionId)?.catch?.(() => {})
    term.reset()
    await spawnSession()
  }, [
    cancelReconnect,
    clearLogDecorations,
    clearTimestampMarkers,
    resetTerminalSearch,
    sessionId,
    spawnSession
  ])

  const disconnectTerminal = useCallback(() => {
    manualDisconnectRef.current = true
    setSystemStats(null)
    setStatus('disconnected')
    window.terminalAPI?.close(sessionId)?.catch?.(() => {})
  }, [sessionId])

  const reconnectTerminal = useCallback(async () => {
    const ok = await spawnSession()
    if (ok) manualDisconnectRef.current = false
  }, [spawnSession])

  const switchShell = useCallback(
    async (shell) => {
      setShellMenuOpen(false)
      if (!shell || shell.id === shellInfo?.id) return
      shellIdRef.current = shell.id
      const term = termRef.current
      if (!term) return
      resetTerminalSearch()
      clearLogDecorations()
      clearTimestampMarkers()
      window.terminalAPI?.close(sessionId)?.catch?.(() => {})
      term.reset()
        await spawnSession()
    },
    [
      clearLogDecorations,
      clearTimestampMarkers,
      resetTerminalSearch,
      sessionId,
      shellInfo?.id,
      spawnSession
    ]
  )

  const openCreateCommand = useCallback(() => {
    setCommandEditor({ mode: 'create', command: '' })
  }, [])

  const openEditCommand = useCallback((item) => {
    setCommandEditor({ mode: 'edit', item })
  }, [])

  const saveCommand = useCallback(
    (values) => {
      if (!setCommands) return
      if (commandEditor?.mode === 'edit' && commandEditor.item) {
        setCommands((prev) =>
          prev.map((item) =>
            item.id === commandEditor.item.id
              ? {
                  ...item,
                  name: values.name.trim(),
                  command: values.command.trim()
                }
              : item
          )
        )
        showToast(`${commandScopeLabel}已更新`)
      } else {
        const record = createTerminalCommand(values)
        setCommands((prev) => [record, ...prev])
        showToast(`已新增${commandScopeLabel}`)
      }
      setCommandEditor(null)
    },
    [commandEditor, commandScopeLabel, setCommands, showToast]
  )

  const confirmDeleteCommand = useCallback(() => {
    if (!deleteTarget || !setCommands) return
    setCommands((prev) => prev.filter((item) => item.id !== deleteTarget.id))
    setDeleteTarget(null)
    showToast(`${commandScopeLabel}已删除`)
  }, [commandScopeLabel, deleteTarget, setCommands, showToast])

  const exportCommands = useCallback(async () => {
    if (!window.serialAPI?.exportFavorites) return
    if (!commands.length) {
      showToast(`${commandLibraryLabel}为空，暂无可导出的指令`)
      return
    }
    const payload = {
      version: 1,
      type: transport === 'ssh' ? 'ssh-terminal-commands' : 'local-terminal-commands',
      exportedAt: new Date().toISOString(),
      commands
    }
    let result
    try {
      result = await window.serialAPI.exportFavorites(
        JSON.stringify(payload, null, 2),
        `${transport === 'ssh' ? 'ssh-commands' : 'local-terminal-commands'}-${formatDateForFile(new Date())}.json`
      )
    } catch (error) {
      showToast(error.message || '导出失败')
      return
    }
    if (result.ok) {
      showToast(`${commandLibraryLabel}已导出：${result.filePath}`, 'success')
    } else if (!result.canceled) {
      showToast(result.error || '导出失败')
    }
  }, [commandLibraryLabel, commands, showToast, transport])

  const importCommands = useCallback(async () => {
    if (!window.serialAPI?.importFavorites || !setCommands) return
    let result
    try {
      result = await window.serialAPI.importFavorites()
    } catch (error) {
      showToast(error.message || '导入失败')
      return
    }
    if (!result || !result.ok) {
      if (result && !result.canceled) showToast(result.error || '导入失败')
      return
    }

    let parsed
    try {
      parsed = JSON.parse(result.content)
    } catch {
      showToast('导入失败：文件不是有效的 JSON')
      return
    }

    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.commands)
        ? parsed.commands
        : null
    if (!list) {
      showToast('导入失败：文件格式不正确')
      return
    }

    const normalized = normalizeTerminalCommands(list)
    if (normalized.length === 0) {
      showToast(`导入失败：文件中没有有效${commandScopeLabel}`)
      return
    }

    const keys = new Set(commands.map(terminalCommandKey))
    const ids = new Set(commands.map((item) => item.id))
    const additions = []
    let skipped = 0

    normalized.forEach((item, index) => {
      const key = terminalCommandKey(item)
      if (keys.has(key)) {
        skipped += 1
        return
      }
      keys.add(key)
      let id = item.id
      if (!id || ids.has(id)) {
        id = `terminal-command-${Date.now()}-${index}-${Math.random()
          .toString(36)
          .slice(2, 8)}`
      }
      ids.add(id)
      additions.push({
        ...item,
        id,
        createdAt: item.createdAt || Date.now(),
        lastUsedAt: item.lastUsedAt || 0
      })
    })

    if (additions.length === 0) {
      showToast(
        `没有新增${commandScopeLabel}${skipped ? `，${skipped} 条已存在` : ''}`
      )
      return
    }

    setCommands((prev) => [...additions, ...prev])
    showToast(
      `已导入 ${additions.length} 条${commandScopeLabel}${
        skipped ? `，跳过 ${skipped} 条重复` : ''
      }`,
      'success'
    )
  }, [commandScopeLabel, commands, setCommands, showToast])

  const reorderCommands = useCallback(
    (fromId, toId, position = 'before') => {
      if (!setCommands) return
      setCommands((prev) => {
        const fromIndex = prev.findIndex((item) => item.id === fromId)
        const targetIndex = prev.findIndex((item) => item.id === toId)
        if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) {
          return prev
        }
        const next = prev.slice()
        const [moved] = next.splice(fromIndex, 1)
        const insertIndex = next.findIndex((item) => item.id === toId)
        if (insertIndex < 0) return prev
        next.splice(
          position === 'after' ? insertIndex + 1 : insertIndex,
          0,
          moved
        )
        return next
      })
    },
    [setCommands]
  )

  const moveCommandToTop = useCallback(
    (id) => {
      if (!setCommands) return
      setCommands((prev) => {
        const index = prev.findIndex((item) => item.id === id)
        if (index <= 0) return prev
        const next = prev.slice()
        const [item] = next.splice(index, 1)
        next.unshift(item)
        return next
      })
    },
    [setCommands]
  )

  const markCommandUsed = useCallback(
    (id) => {
      if (!setCommands) return
      setCommands((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, lastUsedAt: Date.now() } : item
        )
      )
    },
    [setCommands]
  )

  const historyKey = useMemo(
    () =>
      terminalHistoryKey({
        transport,
        shellId: shellInfo?.id,
        host: sshProfile?.host
      }),
    [transport, shellInfo?.id, sshProfile?.host]
  )

  useEffect(() => {
    commandsRef.current = Array.isArray(commands) ? commands : []
  }, [commands])

  useEffect(() => {
    historyRef.current = loadTerminalHistory(historyKey)
  }, [historyKey])

  // 连上之后把 shell 自身的历史并进来：应用内逐键跟踪会漏掉用方向键、
  // Tab 补全或粘贴改过的命令，shell 的历史文件才是完整的。
  useEffect(() => {
    if (status !== 'running') return undefined
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const result = await window.terminalAPI?.history?.(sessionId)
        if (cancelled) return
        if (!result?.ok || !Array.isArray(result.commands) || !result.commands.length) {
          return
        }
        historyRef.current = mergeTerminalHistory(historyKey, result.commands)
      } catch {
        // 读取历史失败不影响终端使用
      }
    }, 900)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [status, sessionId, historyKey])

  const closeSuggestions = useCallback(() => {
    suggestionRef.current = { items: [], index: -1 }
    setSuggestions((prev) => (prev.length ? [] : prev))
    setSuggestionIndex(-1)
    setSuggestBox(null)
    setSuggestPrefix('')
  }, [])

  // 只在行首有 2 个字符以上、且光标状态可信时给建议，避免噪声。
  const suggestFor = useCallback(
    (text) => {
      const term = termRef.current
      if (!term || term.buffer.active.type === 'alternate') {
        closeSuggestions()
        return
      }
      if (!lineRef.current.known || text.length < 2) {
        closeSuggestions()
        return
      }
      const seen = new Set([text])
      const items = []
      const push = (value) => {
        const command = String(value || '').trim()
        if (!command || items.length >= 8 || seen.has(command)) return
        // 补全按大小写精确匹配：输入 Git 不再补出 git
        if (!command.startsWith(text)) return
        seen.add(command)
        items.push(command)
      }
      historyRef.current.forEach(push)
      commandsRef.current.forEach((item) => push(item.command))
      if (!items.length) {
        closeSuggestions()
        return
      }
      suggestionRef.current = { items, index: -1 }
      setSuggestions(items)
      setSuggestionIndex(-1)
      setSuggestPrefix(text)
    },
    [closeSuggestions]
  )

  // 把候选项贴在光标所在行的上方；靠近右侧时改成右对齐，避免溢出面板。
  useEffect(() => {
    if (!suggestions.length) {
      setSuggestBox(null)
      return
    }
    const term = termRef.current
    const surface = surfaceRef.current
    const screen = term?.element?.querySelector('.xterm-screen')
    if (!term || !surface || !screen) return
    const screenRect = screen.getBoundingClientRect()
    const surfaceRect = surface.getBoundingClientRect()
    if (!screenRect.width || !screenRect.height) return
    const cellWidth = screenRect.width / Math.max(1, term.cols)
    const cellHeight = screenRect.height / Math.max(1, term.rows)
    const cursorLeft =
      screenRect.left - surfaceRect.left + term.buffer.active.cursorX * cellWidth
    const cursorTop =
      screenRect.top - surfaceRect.top + term.buffer.active.cursorY * cellHeight
    const estimatedHeight = Math.min(suggestions.length, 6) * 26 + 12
    const below = cursorTop - estimatedHeight - 8 < 0
    setSuggestBox({
      left: Math.max(8, Math.min(cursorLeft, surfaceRect.width - 200)),
      right: Math.max(8, surfaceRect.width - cursorLeft),
      anchoredRight: cursorLeft > surfaceRect.width * 0.55,
      top: below ? cursorTop + cellHeight + 6 : cursorTop - 6,
      below
    })
  }, [suggestions])

  const acceptSuggestion = useCallback(
    (index, execute) => {
      const items = suggestionRef.current.items
      const command = items[index]
      const line = lineRef.current
      if (!command || !line.known || !line.text) {
        closeSuggestions()
        return
      }
      if (!command.startsWith(line.text)) {
        closeSuggestions()
        return
      }
      const suffix = command.slice(line.text.length)
      if (suffix) window.terminalAPI?.write(sessionId, suffix)
      termRef.current?.focus()
      closeSuggestions()
      if (execute) {
        window.terminalAPI?.write(sessionId, '\r')
        historyRef.current = rememberTerminalCommand(historyKey, command)
        line.text = ''
        line.known = true
      } else {
        line.text = command
      }
    },
    [closeSuggestions, historyKey, sessionId]
  )

  const trackInput = useCallback(
    (data) => {
      const line = lineRef.current
      const previous = line.text
      const submitted = trackInputLine(line, data)
      if (submitted) {
        const knownText = line.text.trim()
        const term = termRef.current
        const buffer = term?.buffer.active
        const screenLine = buffer
          ? buffer
              .getLine(buffer.baseY + buffer.cursorY)
              ?.translateToString(true) || ''
          : ''
        let command = ''
        if (line.known && knownText) {
          command = knownText
          const trimmed = screenLine.trimEnd()
          if (trimmed.endsWith(knownText)) {
            promptRef.current = trimmed.slice(0, trimmed.length - knownText.length)
          }
        } else {
          // 跟踪失效时用屏幕内容兜底，避免命令漏记
          command = commandFromScreenLine(screenLine, promptRef.current)
        }
        if (command) {
          historyRef.current = rememberTerminalCommand(historyKey, command)
        }
        line.text = ''
        line.known = true
        closeSuggestions()
        return
      }
      if (line.text === previous) return
      suggestFor(line.text)
    },
    [closeSuggestions, historyKey, suggestFor]
  )

  useEffect(() => {
    inputTrackerRef.current = trackInput
  }, [trackInput])

  useEffect(() => {
    suggestionKeysRef.current = {
      isOpen: () => suggestionRef.current.items.length > 0,
      move: (delta) => {
        const { items, index } = suggestionRef.current
        if (!items.length) return
        const next =
          index < 0
            ? delta > 0
              ? 0
              : items.length - 1
            : (index + delta + items.length) % items.length
        suggestionRef.current = { items, index: next }
        setSuggestionIndex(next)
      },
      accept: (execute) => {
        const { items, index } = suggestionRef.current
        if (!items.length) return
        acceptSuggestion(index < 0 ? 0 : index, execute)
      },
      close: closeSuggestions
    }
  }, [acceptSuggestion, closeSuggestions])

  const writeCommand = useCallback(
    (command, withEnter) => {
      if (status !== 'running') {
        showToast('终端未运行，请先重启终端', 'error')
        return false
      }
      const text = String(command ?? '')
      if (!text) return false
      let payload
      if (withEnter) {
        // 运行：把换行转换成回车，让 Shell 逐条执行，避免 LF 造成错位
        payload = `${text.replace(/\r?\n/g, '\r').replace(/\r+$/, '')}\r`
      } else if (/\r?\n/.test(text)) {
        // 填入多行指令：终端输入区只能保存一行。直接发送 LF 会被
        // PowerShell/cmd 当作未完成输入，出现 >> 续行和错位。
        // 这里按当前 Shell 的语句分隔符合并成一行，保留可编辑状态。
        const separator =
          transport === 'local' && shellInfo?.id === 'cmd' ? ' & ' : '; '
        payload = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .join(separator)
      } else {
        payload = text
      }
      neutralizeCharset(termRef.current)
      window.terminalAPI?.write(sessionId, payload)
      if (withEnter) {
        historyRef.current = rememberTerminalCommand(historyKey, text)
      }
      termRef.current?.focus()
      return true
    },
    [historyKey, sessionId, shellInfo?.id, showToast, status, transport]
  )

  const insertCommand = useCallback(
    (item) => {
      if (!writeCommand(item.command, false)) return
      markCommandUsed(item.id)
      setLibraryOpen(false)
      showToast(
        /\r?\n/.test(String(item.command || ''))
          ? '多行指令已合并为一行填入，按 Enter 执行'
          : '已填入终端，按 Enter 执行'
      )
    },
    [markCommandUsed, showToast, writeCommand]
  )

  const runCommand = useCallback(
    (item) => {
      if (!writeCommand(item.command, true)) return
      markCommandUsed(item.id)
      setLibraryOpen(false)
      showToast(`已运行${commandScopeLabel}`)
    },
    [markCommandUsed, showToast, writeCommand]
  )

  const terminalTheme = getTerminalTheme(display.themeId, resolvedTheme)
  const running = status === 'running'
  const starting = status === 'starting'
  const shellLabel =
    shellInfo?.label ||
    (transport === 'ssh' ? sshProfileLabel(sshProfile) : '本地 Shell')
  const stateText = statusLabel(status)
  const encodingLabel =
    transport === 'ssh'
      ? SSH_ENCODINGS.find(
          (option) => option.value === sshProfile?.encoding
        )?.label || 'UTF-8'
      : 'UTF-8'

  return (
    <div
      className={`app terminal-page ${isSsh ? 'is-ssh' : 'is-local'} ${
        split ? 'is-split' : ''
      }`}
      style={{
        '--term-surface-bg': terminalTheme.background,
        '--terminal-theme-muted': `color-mix(in srgb, ${terminalTheme.foreground} 58%, transparent)`
      }}
    >
      <header className="topbar">
        {active && !isLiteLevel(effectsLevel) ? (
          <GhostCursor
            className="topbar-ghost"
            theme={resolvedTheme}
            color={accent || '#2563eb'}
            brightness={resolvedTheme === 'dark' ? 0.95 : 0.62}
            size={72}
            trailLength={44}
            inertia={0.45}
            turbulence={0.55}
            drift={0.22}
            detail={1}
            grainIntensity={0.02}
            bloomStrength={0.3}
            bloomRadius={1}
            bloomThreshold={0.04}
            edgeIntensity={0.18}
            mixBlendMode="normal"
            zIndex={0}
            intro
          />
        ) : null}
        <div className="brand">
          <BrandMark active={active} />
          <div className="brand-text">
            <span className="brand-line">
              <span className="brand-title">Weft Terminal</span>
              <PageTag
                kind={isSsh ? 'ssh' : 'local'}
                label={isSsh ? 'SSH 终端' : '本地终端'}
                accent={tagAccent}
              />
            </span>
            <span className="brand-sub">WEAVE EVERY CONNECTION</span>
          </div>
          <span className="pane-title">
              <span className="pane-title-row">
                <span className="pane-title-main">{paneTitle || (isSsh ? 'SSH 终端' : '本地终端')}</span>
                {paneTag ? (
                  <span
                    className={`tab-kind-tag pane-kind-tag ${
                      paneTagClass || ''
                    }`}
                  >
                    {paneTag}
                  </span>
                ) : null}
              </span>
            <span className="pane-title-sub">
              {isSsh
                ? `${
                    sshProfile?.username && sshProfile?.host
                      ? `${sshProfile.username}@${sshProfile.host}`
                      : shellLabel
                  } · ${size.cols} × ${size.rows}`
                : `${shellLabel} · PID ${pid ?? '—'} · ${size.cols} × ${size.rows}`}
            </span>
          </span>
          {split ? (
            <button
              type="button"
              className="pane-drag-handle"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', sessionId)
                onPaneDragStart?.(sessionId, event)
              }}
              onDragEnd={onPaneDragEnd}
              title="拖动调整会话位置"
              aria-label="拖动调整会话位置"
            >
              <Icon name="grip" size={12} />
            </button>
          ) : null}
        </div>


        <div className="topbar-actions terminal-topbar-actions">
          <StatusCapsule
            active={running}
            accent={statusAccent || accent}
            enabled={active}
            theme={resolvedTheme}
            label={stateText}
            meta={shellInfo?.label}
          />

          <GlassButton
            size="sm"
            pill
            className="terminal-library-btn"
            onClick={() => {
              setFilePanelOpen(false)
              setLibraryOpen(true)
            }}
            title={commandLibraryLabel}
          >
            <Icon name="command" size={14} />
            <span>指令库</span>
            <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </GlassButton>

          {isSsh ? (
            <>
              <span className="topbar-sep" aria-hidden="true" />
              <button
                type="button"
                className="topbar-btn is-icon"
                onClick={() => {
                  setLibraryOpen(false)
                  setFilePanelOpen(true)
                }}
                title="远程文件管理"
                aria-label="远程文件管理"
                disabled={!running}
              >
                <Icon name="folder" size={15} />
              </button>
              {onEditSsh ? (
                <button
                  type="button"
                  className="topbar-btn is-icon"
                  onClick={onEditSsh}
                  title="编辑 SSH 连接"
                  aria-label="编辑 SSH 连接"
                >
                  <Icon name="edit" size={15} />
                </button>
              ) : null}
              <span className="topbar-sep" aria-hidden="true" />
            </>
          ) : (
            <span className="topbar-sep" aria-hidden="true" />
          )}

          <button
            type="button"
            className="topbar-btn is-icon"
            onClick={restartTerminal}
            title={isSsh ? '重新连接 SSH 会话' : '重启本地终端'}
            aria-label={isSsh ? '重新连接 SSH 会话' : '重启本地终端'}
            disabled={starting}
          >
            <Icon name="refresh" size={15} />
          </button>

          <button
            type="button"
            className="topbar-btn is-icon"
            onClick={clearTerminal}
            title="清空终端显示"
            aria-label="清空终端显示"
          >
            <Icon name="broom" size={15} />
          </button>

          {running || status === 'disconnected' ? (
            <button
              type="button"
              className={`topbar-btn is-icon ${
                status === 'disconnected' ? 'is-active' : ''
              }`}
              onClick={
                status === 'disconnected'
                  ? reconnectTerminal
                  : disconnectTerminal
              }
              title={status === 'disconnected' ? '重新连接' : '断开连接'}
              aria-label={status === 'disconnected' ? '重新连接' : '断开连接'}
            >
              <Icon
                name={status === 'disconnected' ? 'link' : 'unplug'}
                size={15}
              />
            </button>
          ) : null}

          <span className="topbar-sep" aria-hidden="true" />

          <button
            type="button"
            className="topbar-btn is-icon"
            onClick={isSsh ? onNewSsh : onNewTerminal}
            title={isSsh ? '新建 SSH 终端' : '新建本地终端'}
            aria-label={isSsh ? '新建 SSH 终端' : '新建本地终端'}
          >
            <Icon name="plus" size={15} />
          </button>

          <div className="terminal-display-wrap" ref={displayMenuRef}>
            <button
              type="button"
              className={`topbar-btn is-icon ${
                displayMenuOpen ? 'is-active' : ''
              }`}
              onClick={() => setDisplayMenuOpen((prev) => !prev)}
              title="终端显示设置"
              aria-label="终端显示设置"
            >
              <Icon name="format" size={15} />
            </button>
            {displayMenuOpen ? (
              <div className="terminal-display-menu">
                <div className="terminal-display-head">
                  <span>显示设置</span>
                  <button
                    type="button"
                    className="terminal-display-reset"
                    onClick={() => updateDisplay(DEFAULT_TERMINAL_DISPLAY)}
                  >
                    重置
                  </button>
                </div>
                <div className="terminal-display-themes">
                  <span className="terminal-display-label">主题</span>
                  <div className="terminal-theme-grid">
                    {TERMINAL_THEMES.map((theme) => {
                      const active = display.themeId === theme.id
                      return (
                        <button
                          key={theme.id}
                          type="button"
                          className={`terminal-theme-chip ${
                            active ? 'is-active' : ''
                          }`}
                          onClick={() =>
                            updateDisplay(terminalThemePreset(theme.id))
                          }
                          title={`${theme.label}：同时应用推荐字体、字号和光标样式`}
                        >
                          <span className="terminal-theme-colors">
                            {terminalThemeSwatch(theme.id, resolvedTheme).map(
                              (color, index) => (
                                <i key={index} style={{ background: color }} />
                              )
                            )}
                          </span>
                          <span className="terminal-theme-name">
                            {theme.label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <span className="terminal-theme-hint">
                    选择主题会同时应用推荐字体、字号和光标样式
                  </span>
                </div>
                <div className="terminal-display-row">
                  <span className="terminal-display-label">字号</span>
                  <div className="terminal-stepper">
                    <button
                      type="button"
                      onClick={() =>
                        updateDisplay({ fontSize: display.fontSize - 1 })
                      }
                      aria-label="减小字号"
                    >
                      −
                    </button>
                    <strong>{display.fontSize}px</strong>
                    <button
                      type="button"
                      onClick={() =>
                        updateDisplay({ fontSize: display.fontSize + 1 })
                      }
                      aria-label="增大字号"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="terminal-display-row">
                  <span className="terminal-display-label">字体</span>
                  <select
                    className="terminal-font-select"
                    value={display.fontFamily || 'system'}
                    onChange={(event) =>
                      updateDisplay({ fontFamily: event.target.value })
                    }
                  >
                    {TERMINAL_FONT_GROUPS.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="terminal-display-row">
                  <span className="terminal-display-label">行高</span>
                  <div className="terminal-seg">
                    {[
                      ['紧凑', 1.3],
                      ['标准', 1.45],
                      ['舒适', 1.6]
                    ].map(([label, value]) => (
                      <button
                        type="button"
                        key={value}
                        className={
                          Math.abs(display.lineHeight - value) < 0.01
                            ? 'is-active'
                            : ''
                        }
                        onClick={() => updateDisplay({ lineHeight: value })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="terminal-display-row">
                  <span className="terminal-display-label">光标</span>
                  <div className="terminal-seg">
                    {[
                      ['竖线', 'bar'],
                      ['方块', 'block'],
                      ['下划线', 'underline']
                    ].map(([label, value]) => (
                      <button
                        type="button"
                        key={value}
                        className={display.cursorStyle === value ? 'is-active' : ''}
                        onClick={() => updateDisplay({ cursorStyle: value })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="terminal-display-row">
                  <span className="terminal-display-label">时间</span>
                  <button
                    type="button"
                    className={`terminal-toggle ${
                      display.showTimestamps !== false ? 'is-on' : ''
                    }`}
                    onClick={() =>
                      updateDisplay({
                        showTimestamps: display.showTimestamps === false
                      })
                    }
                    aria-pressed={display.showTimestamps !== false}
                  >
                    <span />
                  </button>
                  <span className="terminal-display-hint">
                    左侧迷你时间戳
                  </span>
                </div>
                <div className="terminal-display-note">
                  调整后会自动适配行列；cat 二进制文件后显示异常，重新输入任意内容即可恢复
                </div>
              </div>
            ) : null}
          </div>

        </div>
      </header>

      <div className="terminal-stage">
        <section
          className={`terminal-panel ${alternateScreen ? 'is-alt-screen' : ''}`}
          aria-label={isSsh ? 'SSH 终端' : '本地终端'}
        >
          <div className="terminal-panel-head">
            <div className="terminal-panel-title">
              <Icon name={isSsh ? 'server' : 'terminal'} size={14} />
              {transport === 'ssh' ? (
                <span>{shellLabel}</span>
              ) : (
                <div className="terminal-shell-picker" ref={shellMenuRef}>
                  <button
                    type="button"
                    className="terminal-shell-trigger"
                    onClick={() => setShellMenuOpen((prev) => !prev)}
                    title="切换本地 Shell"
                    disabled={shells.length === 0}
                  >
                    <span>{shellLabel}</span>
                    <Icon name="chevron-down" size={11} />
                  </button>
                  {shellMenuOpen ? (
                    <div className="terminal-shell-menu">
                      <div className="terminal-shell-head">本地 Shell</div>
                      {shells.map((shell) => (
                        <button
                          type="button"
                          key={shell.id}
                          className={shellInfo?.id === shell.id ? 'is-active' : ''}
                          onClick={() => switchShell(shell)}
                        >
                          <span>{shell.label}</span>
                          <small>{shell.path}</small>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
              <span className="terminal-panel-badge">
                {transport === 'ssh' ? 'SSH' : '本地'}
              </span>
            </div>
            <div className="terminal-panel-meta">
              {systemStats ? (
                <>
                  <SystemStatsBar stats={systemStats} remote={isSsh} />
                  <span className="terminal-panel-sep" aria-hidden="true" />
                </>
              ) : null}
              <button
                type="button"
                className={`icon-btn mini terminal-time-trigger ${
                  display.showTimestamps !== false ? 'is-active' : ''
                }`}
                onClick={() =>
                  updateDisplay({
                    showTimestamps: display.showTimestamps === false
                  })
                }
                title="显示/隐藏时间戳"
                aria-pressed={display.showTimestamps !== false}
              >
                <Icon name="clock" size={12} />
              </button>
              <button
                type="button"
                className={`icon-btn mini terminal-search-trigger ${
                  searchOpen ? 'is-active' : ''
                }`}
                onClick={toggleSearch}
                title="搜索终端内容 (⌘F / Ctrl+F)"
                aria-pressed={searchOpen}
              >
                <Icon name="search" size={12} />
              </button>
              <span className={`terminal-live-dot ${running ? 'is-on' : ''}`} />
              <span
                className={`terminal-live-label ${running ? 'is-on' : ''}`}
              >
                {running ? '交互中' : stateText}
              </span>
              <span className="terminal-panel-sep" />
              <span className="terminal-size-chip">
                {size.cols} × {size.rows}
              </span>
            </div>
          </div>

          {searchOpen ? (
            <div className="console-search terminal-search" role="search">
              <Icon name="search" size={14} />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索终端内容"
                aria-label="搜索终端内容"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    closeSearch()
                  } else if (event.key === 'Enter') {
                    event.preventDefault()
                    goSearch(event.shiftKey ? -1 : 1)
                  }
                }}
              />
              <span className="console-search-count">
                {normalizedSearchQuery
                  ? `${searchResult.count ? Math.max(1, searchResult.index + 1) : 0}/${searchResult.count}`
                  : ''}
              </span>
              <button
                className="icon-btn mini"
                onClick={() => goSearch(-1)}
                disabled={searchResult.count === 0}
                title="上一个匹配"
              >
                <Icon name="chevron-down" size={12} className="rotate-180" />
              </button>
              <button
                className="icon-btn mini"
                onClick={() => goSearch(1)}
                disabled={searchResult.count === 0}
                title="下一个匹配"
              >
                <Icon name="chevron-down" size={12} />
              </button>
              <button className="icon-btn mini" onClick={closeSearch} title="关闭搜索">
                <Icon name="close" size={12} />
              </button>
            </div>
          ) : null}

          <div
            ref={surfaceRef}
            className={`terminal-surface ${
              display.showTimestamps !== false ? 'has-time-gutter' : ''
            }`}
          >
            {display.showTimestamps !== false ? (
              <div
                className="terminal-time-gutter"
                ref={timestampGutterRef}
                aria-hidden="true"
                onClick={() => termRef.current?.focus()}
              />
            ) : null}
            <div className="terminal-xterm" ref={containerRef} />
            {suggestions.length && suggestBox ? (
              <div
                className="terminal-suggest"
                role="listbox"
                aria-label="命令补全"
                style={{
                  top: suggestBox.top,
                  ...(suggestBox.anchoredRight
                    ? { right: suggestBox.right }
                    : { left: suggestBox.left }),
                  transform: suggestBox.below ? 'none' : 'translateY(-100%)'
                }}
              >
                {suggestions.map((item, index) => (
                  <button
                    key={item}
                    type="button"
                    role="option"
                    aria-selected={index === suggestionIndex}
                    className={`terminal-suggest-item ${
                      index === suggestionIndex ? 'is-active' : ''
                    }`}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      acceptSuggestion(index, false)
                    }}
                  >
                    <span className="terminal-suggest-prefix">
                      {item.slice(0, suggestPrefix.length)}
                    </span>
                    {item.slice(suggestPrefix.length)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {status === 'reconnecting' ? (
            <div className="terminal-overlay is-soft">
              <div className="terminal-loading terminal-reconnecting">
                <span className="terminal-spinner" />
                <span>
                  网络中断，正在自动重连…
                  {reconnectAttempt > 1 ? `（第 ${reconnectAttempt} 次）` : ''}
                  {offlineInputCount > 0
                    ? ` · 已暂存 ${offlineInputCount} 个字符`
                    : ''}
                </span>
                <button
                  type="button"
                  className="soft-btn terminal-reconnect-cancel"
                  onClick={cancelReconnect}
                >
                  停止重连
                </button>
              </div>
            </div>
          ) : null}

          {starting ? (
            <div className="terminal-overlay is-soft">
              <div className="terminal-loading">
                <span className="terminal-spinner" />
                {transport === 'ssh'
                  ? `正在连接 ${sshProfile?.host || 'SSH 服务器'}…`
                  : '正在启动本地 Shell…'}
              </div>
            </div>
          ) : null}

          {status === 'error' ? (
            <div className="terminal-overlay">
              <div className="terminal-error-card">
                <div className="terminal-error-icon">
                  <Icon name="alert" size={18} />
                </div>
                <div>
                  <strong>
                    {transport === 'ssh' ? 'SSH 连接失败' : '终端启动失败'}
                  </strong>
                  <p>
                    {error ||
                      (transport === 'ssh'
                        ? '无法建立 SSH 连接'
                        : '无法启动本地终端')}
                  </p>
                </div>
                <div className="terminal-error-actions">
                  {transport === 'ssh' && onEditSsh ? (
                    <button
                      type="button"
                      className="soft-btn"
                      onClick={onEditSsh}
                    >
                      编辑连接
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="soft-btn"
                    onClick={restartTerminal}
                  >
                    重试
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <footer className="statusbar">
        <div className={`status-state ${running ? 'ok' : status === 'error' ? 'error' : ''}`}>
          <span className="status-dot" />
          {running
            ? transport === 'ssh'
              ? `SSH 终端 · ${shellLabel}`
              : `本地终端 · ${shellLabel}`
            : status === 'reconnecting'
              ? `网络中断，正在重连${
                  reconnectAttempt > 1 ? `（第 ${reconnectAttempt} 次）` : ''
                }`
              : status === 'disconnected'
                ? '连接已断开 · 点击“重连”恢复'
                : status === 'exited'
                ? isSsh
                  ? 'SSH 会话已断开'
                  : '终端已退出'
                : status === 'error'
                  ? isSsh
                    ? 'SSH 连接失败'
                    : '终端不可用'
                  : isSsh
                    ? '正在建立 SSH 连接'
                    : '正在启动本地终端'}
          {exitInfo && status === 'exited' && transport !== 'ssh' ? (
            <span className="status-exit-code">code {exitInfo.exitCode ?? '未知'}</span>
          ) : null}
        </div>
        <div className="status-meta">
          <span>{encodingLabel}</span>
          <span className="status-sep" />
          <span>
            {pid
              ? `PID ${pid}`
              : transport === 'ssh'
                ? `${sshProfile?.username || ''}@${sshProfile?.host || ''}${
                    sshProfile?.port && sshProfile.port !== 22
                      ? `:${sshProfile.port}`
                      : ''
                  }`
                : '本地会话'}
          </span>
          <span className="status-sep" />
          <span>
            {size.cols} × {size.rows}
          </span>
        </div>
      </footer>

      <Portal>
        <TerminalCommandLibrary
          open={libraryOpen}
          scope={transport}
          commands={commands}
          onClose={() => setLibraryOpen(false)}
          onInsert={insertCommand}
          onRun={runCommand}
          onCreate={openCreateCommand}
          onEdit={openEditCommand}
          onDelete={setDeleteTarget}
          onImport={importCommands}
          onExport={exportCommands}
          onReorder={reorderCommands}
          onMoveTop={moveCommandToTop}
        />

        {commandEditor ? (
          <TerminalCommandEditor
            scope={transport}
            mode={commandEditor.mode}
            item={commandEditor.item}
            defaultCommand={commandEditor.command}
            onClose={() => setCommandEditor(null)}
            onSave={saveCommand}
          />
        ) : null}

        {hostKeyPrompt ? (
          <Modal
            title="确认 SSH 主机密钥"
            width={560}
            tone="ssh"
            icon={<Icon name="terminal" size={17} />}
            onClose={() => answerHostKey(false)}
            footer={
              <>
                <button className="soft-btn" onClick={() => answerHostKey(false)}>
                  取消
                </button>
                <button
                  className="primary-btn"
                  onClick={() => answerHostKey(true)}
                >
                  信任并继续
                </button>
              </>
            }
          >
            <p className="modal-tip">
              首次连接{' '}
              <strong>
                {hostKeyPrompt.host}:{hostKeyPrompt.port}
              </strong>
              ，请确认主机密钥指纹与服务器一致。
            </p>
            <div className="ssh-hostkey-card">
              <span className="micro-label">密钥类型</span>
              <code className="ssh-hostkey-value">{hostKeyPrompt.algo}</code>
              <span className="micro-label">SHA256 指纹</span>
              <code className="ssh-hostkey-value ssh-hostkey-fingerprint">
                {hostKeyPrompt.fingerprint}
              </code>
            </div>
            <p className="form-note">
              确认后会将该指纹保存到本机，后续连接自动校验。指纹不一致时会拒绝连接。
            </p>
          </Modal>
        ) : null}

        {deleteTarget ? (
          <Modal
            title={`删除${commandScopeLabel}`}
            width={400}
            icon={<Icon name="trash" size={17} />}
            onClose={() => setDeleteTarget(null)}
            footer={
              <>
                <button className="soft-btn" onClick={() => setDeleteTarget(null)}>
                  取消
                </button>
                <button className="danger-btn" onClick={confirmDeleteCommand}>
                  删除指令
                </button>
              </>
            }
          >
            <p className="modal-tip">
              确定删除「{deleteTarget.name}」吗？此操作不可撤销。
            </p>
          </Modal>
        ) : null}

        {isSsh ? (
          <SshFilePanel
            open={filePanelOpen}
            sessionId={sessionId}
            hostLabel={sshProfileLabel(sshProfile)}
            onClose={() => setFilePanelOpen(false)}
            onNotify={showToast}
          />
        ) : null}

        {toast ? (
          <div className={`toast ${toast.kind}`}>{toast.message}</div>
        ) : null}
      </Portal>
    </div>
  )
}
