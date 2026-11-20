import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './Sidebar'
import ReceivePane from './ReceivePane'
import SendPane from './SendPane'
import CommandLibrary from './CommandLibrary'
import FavoriteEditor from './FavoriteEditor'
import Modal from './Modal'
import Icon from './Icons'
import GhostCursor from './GhostCursor'
import BrandMark from './BrandMark'
import PageTag from './PageTag'
import StatusCapsule from './StatusCapsule'
import GlassButton from './LiquidGlass'
import {
  COMMON_BAUD_RATES,
  TAIL_OPTIONS,
  mergeSettings,
  normalizeChecksumTo
} from '../lib/defaults'
import {
  calculateChecksum,
  checksumToHex,
  getChecksumAlgo
} from '../lib/checksum'
import {
  bytesToHex,
  concatBytes,
  createDecoder,
  decodeChunk,
  formatBytes,
  formatDateForFile,
  formatHexText,
  formatTime,
  loadJSON,
  parseHexInput,
  saveJSON
} from '../lib/format'
import {
  createFavoriteRecord,
  favoriteSendSettings,
  normalizeFavorites,
  pickFavoriteSend
} from '../lib/favorites'
import {
  TERMINAL_FONT_GROUPS,
  getTerminalFontFamily
} from '../lib/terminalDisplay'

const LEGACY_SETTINGS_KEY = 'serialdebug.settings'
const LEGACY_UI_KEY = 'serialdebug.ui'

const MAX_LINES = 5000

function favoriteKey(item) {
  return `${item.name}\u0000${item.encoding || 'hex'}\u0000${item.text}`
}

function clampSidebarWidth(value) {
  const max = Math.max(320, Math.min(560, window.innerWidth - 520))
  return Math.min(max, Math.max(320, Number(value) || 378))
}

function clampSendHeight(value) {
  const max = Math.max(200, Math.min(620, window.innerHeight - 298))
  return Math.min(max, Math.max(180, Number(value) || 306))
}

function describeSendSettings(send) {
  const parts = [(send.encoding || 'hex').toUpperCase()]
  if (send.appendTail) {
    const tail = TAIL_OPTIONS.find((option) => option.value === send.tail)
    parts.push((tail?.label || 'CRLF').replace(/\s*\(.*\)/, ''))
  }
  if (send.checksum) {
    const algo = getChecksumAlgo(send.checksumAlgo)
    let label = algo.label
    if (algo.width > 1) {
      label += send.endian === 'little' ? ' 小端' : ' 大端'
    }
    parts.push(label)
  }
  return parts.join(' · ')
}

function describeOpenError(error, code) {
  const source = `${error || ''} ${code || ''}`.toLowerCase()
  if (code === 'EBUSY' || source.includes('busy') || source.includes('resource')) {
    return '串口被占用：请关闭其他正在使用该串口的程序，然后重试。'
  }
  if (
    code === 'EACCES' ||
    code === 'EPERM' ||
    source.includes('permission') ||
    source.includes('access denied')
  ) {
    return '没有访问权限：请检查系统权限、USB 驱动，或换一个串口再试。'
  }
  if (
    code === 'ENOENT' ||
    source.includes('no such file') ||
    source.includes('not found')
  ) {
    return '串口不存在或设备已断开：请重新插拔设备并刷新串口列表。'
  }
  if (
    source.includes('invalid') ||
    source.includes('unsupported') ||
    source.includes('baud')
  ) {
    return '串口参数不受支持：请检查波特率、数据位、校验位和停止位。'
  }
  return '无法打开串口：请检查端口是否被占用、设备是否在线，或参数是否受支持。'
}

function setByPath(source, path, value) {
  const next = { ...source }
  const keys = path.split('.')
  let target = next
  for (let i = 0; i < keys.length - 1; i += 1) {
    target[keys[i]] = { ...target[keys[i]] }
    target = target[keys[i]]
  }
  target[keys[keys.length - 1]] = value
  return next
}

export default function SessionPage({
  sessionId,
  active,
  accent,
  tagAccent,
  migrateLegacy = false,
  favorites,
  setFavorites,
  history,
  setHistory,
  customBauds,
  setCustomBauds,
  resolvedTheme,
  onToggleTheme,
  onMetaChange,
  onNewSerial
}) {
  const settingsKey = `serialdebug.settings.${sessionId}`
  const uiKey = `serialdebug.ui.${sessionId}`
  const [settings, setSettings] = useState(() => {
    const own = loadJSON(settingsKey, null)
    const legacy = migrateLegacy ? loadJSON(LEGACY_SETTINGS_KEY, null) : null
    return mergeSettings(own || legacy)
  })
  const [ports, setPorts] = useState([])
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [status, setStatus] = useState({ kind: 'idle', text: '等待连接…' })
  const [lines, setLines] = useState([])
  const [stats, setStats] = useState({ rx: 0, tx: 0 })
  const [sendText, setSendText] = useState('')
  const [looping, setLooping] = useState(false)
  const [receiveEnabled, setReceiveEnabled] = useState(true)
  const [uiDefaults] = useState(() => {
    const own = loadJSON(uiKey, null)
    if (own) return own
    return migrateLegacy ? loadJSON(LEGACY_UI_KEY, {}) : {}
  })
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clampSidebarWidth(uiDefaults.sidebarWidth ?? 378)
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    Boolean(uiDefaults.sidebarCollapsed)
  )
  const [sendHeight, setSendHeight] = useState(() =>
    clampSendHeight(uiDefaults.sendHeight ?? 306)
  )
  const [showSendPane, setShowSendPane] = useState(
    () => uiDefaults.sendCollapsed !== true
  )
  const [toast, setToast] = useState(null)
  const [modal, setModal] = useState(null)
  const [fontDraft, setFontDraft] = useState(12)
  const [fontFamilyDraft, setFontFamilyDraft] = useState('system')
  const [openError, setOpenError] = useState(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [favoriteEditor, setFavoriteEditor] = useState(null)
  const [favoriteToDelete, setFavoriteToDelete] = useState(null)
  const [batchState, setBatchState] = useState(null)

  const settingsRef = useRef(settings)
  const connectedRef = useRef(connected)
  const loopingRef = useRef(looping)
  const sendTextRef = useRef(sendText)
  const receiveEnabledRef = useRef(receiveEnabled)
  const decoderRef = useRef(createDecoder(settings.recv.encoding))
  const encodingRef = useRef(settings.recv.encoding)
  const pendingRef = useRef({ text: '', bytes: [], timer: null })
  const queueRef = useRef([])
  const flushTimerRef = useRef(null)
  const lineNoRef = useRef(0)
  const lineIdRef = useRef(0)
  const liveRef = useRef(null)
  const loopRef = useRef({ timer: null, remaining: 0, busy: false })
  const batchRef = useRef({
    timer: null,
    running: false,
    items: [],
    index: 0,
    cycle: 0,
    remaining: 0,
    interval: 500
  })
  const rxDeltaRef = useRef(0)
  const toastTimerRef = useRef(null)
  const stageRef = useRef(null)
  const customBaudsRef = useRef(customBauds)
  const favoritesRef = useRef(favorites)
  const activeRef = useRef(active)

  settingsRef.current = settings
  connectedRef.current = connected
  loopingRef.current = looping
  sendTextRef.current = sendText
  receiveEnabledRef.current = receiveEnabled
  customBaudsRef.current = customBauds
  favoritesRef.current = favorites
  activeRef.current = active

  const showToast = useCallback((message, kind = 'error') => {
    setToast({ message, kind })
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 2800)
  }, [])

  const update = useCallback((path, value) => {
    setSettings((prev) => setByPath(prev, path, value))
  }, [])

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null
      const batch = queueRef.current
      const rxDelta = rxDeltaRef.current
      rxDeltaRef.current = 0
      if (rxDelta > 0) {
        setStats((prev) => ({ ...prev, rx: prev.rx + rxDelta }))
      }
      if (batch.length === 0) return
      queueRef.current = []
      setLines((prev) => {
        let next = prev.slice()
        for (const op of batch) {
          if (op.type === 'push') {
            next.push(op.line)
          } else if (op.type === 'replace' && next.length > 0) {
            const index = next.length - 1
            if (next[index].id === op.id) {
              next[index] = { ...next[index], text: op.text }
            }
          }
        }
        if (next.length > MAX_LINES) next = next.slice(next.length - MAX_LINES)
        return next
      })
    }, 40)
  }, [])

  const pushLine = useCallback(
    (text, kind = 'rx', hex = false) => {
      liveRef.current = null
      lineNoRef.current += 1
      lineIdRef.current += 1
      const line = {
        id: lineIdRef.current,
        no: lineNoRef.current,
        time: Date.now(),
        text,
        kind,
        hex
      }
      queueRef.current.push({ type: 'push', line })
      scheduleFlush()
      return line
    },
    [scheduleFlush]
  )

  const endLive = useCallback(() => {
    liveRef.current = null
  }, [])

  const writeLive = useCallback(
    (text, kind = 'rx', hex = false) => {
      const live = liveRef.current
      if (live && live.kind === kind && live.hex === hex) {
        queueRef.current.push({ type: 'replace', id: live.id, text })
        scheduleFlush()
      } else {
        const line = pushLine(text, kind, hex)
        liveRef.current = { id: line.id, kind, hex }
      }
    },
    [pushLine, scheduleFlush]
  )

  const flushPending = useCallback(() => {
    const pending = pendingRef.current
    if (encodingRef.current === 'hex') {
      if (pending.bytes.length > 0) {
        const bytes = pending.bytes
        pending.bytes = []
        pushLine(bytesToHex(bytes), 'rx', true)
      }
    } else if (pending.text) {
      const text = pending.text
      pending.text = ''
      pushLine(text.replace(/\r$/, ''), 'rx', false)
    }
  }, [pushLine])

  const armIdleTimer = useCallback(() => {
    const pending = pendingRef.current
    if (pending.timer) return
    if (!settingsRef.current.recv.autoNewline) {
      pending.timer = null
      return
    }
    const interval = Math.max(1, Number(settingsRef.current.recv.interval) || 50)
    pending.timer = setTimeout(() => {
      pending.timer = null
      flushPending()
    }, interval)
  }, [flushPending])

  const handleTextOn = useCallback(
    (bytes) => {
      const pending = pendingRef.current
      const decoded = decodeChunk(decoderRef.current, bytes)
      const combined = pending.text + decoded
      const parts = combined.split('\n')
      pending.text = parts.pop() ?? ''
      for (const part of parts) pushLine(part.replace(/\r$/, ''), 'rx', false)
      armIdleTimer()
    },
    [armIdleTimer, pushLine]
  )

  const handleTextOff = useCallback(
    (bytes) => {
      const pending = pendingRef.current
      const decoded = decodeChunk(decoderRef.current, bytes)
      const combined = pending.text + decoded
      const parts = combined.split('\n')
      pending.text = parts.pop() ?? ''

      if (parts.length > 0) {
        writeLive(parts[0].replace(/\r$/, ''), 'rx', false)
        endLive()
        for (let i = 1; i < parts.length; i += 1) {
          pushLine(parts[i].replace(/\r$/, ''), 'rx', false)
        }
        if (pending.text) writeLive(pending.text.replace(/\r$/, ''), 'rx', false)
      } else {
        writeLive(combined.replace(/\r$/, ''), 'rx', false)
      }
    },
    [endLive, pushLine, writeLive]
  )

  const handleHexOn = useCallback(
    (bytes) => {
      const pending = pendingRef.current
      for (const byte of bytes) pending.bytes.push(byte)
      armIdleTimer()
    },
    [armIdleTimer]
  )

  const handleHexOff = useCallback(
    (bytes) => {
      const pending = pendingRef.current
      for (const byte of bytes) pending.bytes.push(byte)
      if (pending.bytes.length >= 1024) {
        const chunk = pending.bytes
        pending.bytes = []
        pushLine(bytesToHex(chunk), 'rx', true)
      } else {
        writeLive(bytesToHex(pending.bytes), 'rx', true)
      }
    },
    [pushLine, writeLive]
  )

  const resetPending = useCallback(() => {
    const pending = pendingRef.current
    if (pending.timer) clearTimeout(pending.timer)
    pending.timer = null
    pending.text = ''
    pending.bytes = []
  }, [])

  const stopLoop = useCallback(() => {
    const loop = loopRef.current
    if (loop.timer) clearTimeout(loop.timer)
    loop.timer = null
    loop.remaining = 0
    loop.busy = false
    setLooping(false)
  }, [])

  const stopBatchLoop = useCallback(
    (message = '') => {
      const batch = batchRef.current
      if (batch.timer) clearTimeout(batch.timer)
      const wasRunning = batch.running
      batch.timer = null
      batch.running = false
      batch.items = []
      batch.index = 0
      batch.cycle = 0
      batch.remaining = 0
      setBatchState(null)
      if (wasRunning && message) showToast(message, 'success')
    },
    [showToast]
  )

  const refreshPorts = useCallback(async () => {
    if (!window.serialAPI) return
    try {
      const result = await window.serialAPI.listPorts()
      if (!Array.isArray(result)) return
      setPorts(result)
      setSettings((prev) => {
        if (prev.portPath && result.some((port) => port.path === prev.portPath)) return prev
        if (!prev.portPath && result.length > 0) return { ...prev, portPath: result[0].path }
        return prev
      })
    } catch {
      // 串口列表读取失败时保持原列表
    }
  }, [])

  const clearReceive = useCallback(() => {
    resetPending()
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    queueRef.current = []
    liveRef.current = null
    rxDeltaRef.current = 0
    setLines([])
    lineNoRef.current = 0
    lineIdRef.current = 0
    setStats((prev) => ({ ...prev, rx: 0 }))
  }, [resetPending])

  const addHistory = useCallback((text, encoding) => {
    if (!text.trim()) return
    setHistory((prev) => {
      const filtered = prev.filter(
        (item) => !(item.text === text && item.encoding === encoding)
      )
      const item = { id: Date.now() + Math.random(), text, encoding, time: Date.now() }
      return [item, ...filtered].slice(0, 50)
    })
  }, [])

  const buildSendPayload = useCallback(async (text, send) => {
    if (!window.serialAPI) return { error: '请在 Electron 环境中运行' }
    let bytes

    if (send.encoding === 'hex') {
      const parsed = parseHexInput(text)
      if (parsed.error) return { error: parsed.error }
      bytes = parsed.bytes
    } else {
      try {
        const encoded = await window.serialAPI.encode(text, send.encoding)
        bytes = encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded)
      } catch (error) {
        return { error: `编码失败：${error.message}` }
      }
    }

    if (!bytes || bytes.length === 0) return { error: '发送内容为空' }

    if (send.appendTail) {
      const tail = TAIL_OPTIONS.find((option) => option.value === send.tail)
      if (tail) bytes = concatBytes(bytes, new Uint8Array(tail.bytes))
    }

    if (send.checksum) {
      const from = Math.max(0, (Number(send.checksumFrom) || 1) - 1)
      const frameTailBytes = normalizeChecksumTo(send.checksumTo)
      const to = bytes.length - frameTailBytes
      if (from >= to) return { error: '校验范围无效：帧尾字节数超过了可校验数据' }
      const checksum = calculateChecksum(
        bytes.slice(from, to),
        send.checksumAlgo,
        send.endian
      )
      let suffix = new Uint8Array(checksum.bytes)
      if (send.checksumHex) {
        const hex = checksumToHex(checksum.bytes)
        suffix = new Uint8Array(Array.from(hex, (char) => char.charCodeAt(0)))
      }
      bytes = concatBytes(bytes.slice(0, to), suffix, bytes.slice(to))
    }

    return { bytes }
  }, [])

  const performSend = useCallback(
    async ({ forLoop = false, silent = false, text: overrideText, send: overrideSend } = {}) => {
      if (!connectedRef.current) {
        if (!silent) showToast('请先打开串口')
        return false
      }
      if (!window.serialAPI) {
        if (!silent) showToast('请在 Electron 环境中运行')
        return false
      }

      const send = overrideSend || settingsRef.current.send
      const text = overrideText !== undefined ? overrideText : sendTextRef.current
      const payload = await buildSendPayload(text, send)
      if (payload.error) {
        if (!silent) showToast(payload.error)
        return false
      }

      let result
      try {
        result = await window.serialAPI.write(sessionId, { bytes: payload.bytes })
      } catch (error) {
        result = { ok: false, error: error.message }
      }
      if (!result || !result.ok) {
        if (!silent) showToast((result && result.error) || '发送失败')
        return false
      }

      setStats((prev) => ({ ...prev, tx: prev.tx + payload.bytes.length }))

      if (send.showSend) {
        if (!settingsRef.current.recv.autoNewline) {
          pendingRef.current.text = ''
          pendingRef.current.bytes = []
        }
        const hex = send.encoding === 'hex'
        let textToShow
        if (hex) {
          textToShow = bytesToHex(payload.bytes)
        } else {
          try {
            textToShow = createDecoder(send.encoding).decode(payload.bytes)
          } catch {
            textToShow = bytesToHex(payload.bytes)
          }
        }
        pushLine(textToShow, 'tx', hex)
      }

      if (!forLoop) addHistory(text, send.encoding)
      return true
    },
    [addHistory, buildSendPayload, pushLine, sessionId, showToast]
  )

  const startBatchLoop = useCallback(
    (ids, interval, count) => {
      if (!window.serialAPI) {
        showToast('请在 Electron 环境中运行')
        return false
      }
      if (!connectedRef.current) {
        showToast('请先打开串口')
        return false
      }
      const idSet = new Set(ids)
      const items = favoritesRef.current.filter((item) => idSet.has(item.id))
      if (items.length === 0) {
        showToast('请先勾选要循环的指令')
        return false
      }
      const encodings = new Set(items.map((item) => item.encoding || 'hex'))
      if (encodings.size > 1) {
        showToast('批量循环只能选择同一种编码的指令')
        return false
      }

      stopLoop()
      stopBatchLoop()
      const batch = batchRef.current
      const cycles = Math.max(0, parseInt(count, 10) || 0)
      batch.running = true
      batch.items = items
      batch.index = 0
      batch.cycle = 1
      batch.remaining = cycles > 0 ? cycles : Infinity
      batch.interval = Math.max(20, Number(interval) || 500)

      const publish = () => {
        const item = batch.items[batch.index]
        setBatchState({
          running: true,
          index: batch.index,
          total: batch.items.length,
          cycle: batch.cycle,
          currentId: item?.id,
          currentName: item?.name || ''
        })
      }

      const tick = async () => {
        if (!batch.running) return
        if (!connectedRef.current) {
          stopBatchLoop()
          return
        }
        const item = batch.items[batch.index]
        const send = favoriteSendSettings(item, settingsRef.current.send)
        const ok = await performSend({ text: item.text, send, forLoop: true })
        if (!batch.running) return
        if (!ok) {
          stopBatchLoop()
          return
        }

        batch.index += 1
        if (batch.index >= batch.items.length) {
          batch.index = 0
          batch.cycle += 1
          if (batch.remaining !== Infinity) {
            batch.remaining -= 1
            if (batch.remaining <= 0) {
              stopBatchLoop('批量循环已完成')
              return
            }
          }
        }

        publish()
        batch.timer = setTimeout(tick, batch.interval)
      }

      publish()
      tick()
      return true
    },
    [performSend, showToast, stopBatchLoop, stopLoop]
  )

  const startLoop = useCallback(
    (count, interval) => {
      const loop = loopRef.current
      if (loop.timer) clearTimeout(loop.timer)
      loop.busy = true
      loop.remaining = count > 0 ? count : Infinity
      setLooping(true)

      const tick = async () => {
        if (!loop.busy) return
        if (!connectedRef.current) {
          stopLoop()
          return
        }
        const ok = await performSend({ forLoop: true })
        if (!loop.busy) return
        if (!ok) {
          stopLoop()
          return
        }
        if (loop.remaining !== Infinity) {
          loop.remaining -= 1
          if (loop.remaining <= 0) {
            stopLoop()
            return
          }
        }
        loop.timer = setTimeout(tick, Math.max(20, interval))
      }

      tick()
    },
    [performSend, stopLoop]
  )

  const handleSend = useCallback(() => {
    if (loopingRef.current) {
      stopLoop()
      return
    }
    if (batchRef.current.running) {
      showToast('批量循环进行中，请先停止')
      return
    }
    if (!connectedRef.current) {
      showToast('请先打开串口')
      return
    }
    const send = settingsRef.current.send
    if (send.loop) {
      const interval = Math.max(20, Number(send.loopInterval) || 500)
      const rawCount = String(send.loopCount ?? '').trim()
      const count = rawCount === '' ? 0 : Math.max(0, parseInt(rawCount, 10) || 0)
      startLoop(count, interval)
    } else {
      performSend()
    }
  }, [performSend, showToast, startLoop, stopLoop])

  const togglePort = useCallback(async () => {
    if (!window.serialAPI) {
      showToast('请在 Electron 环境中运行')
      return
    }

    if (connectedRef.current) {
      stopLoop()
      stopBatchLoop()
      try {
        await window.serialAPI.close(sessionId)
      } catch {
        // 关闭失败时仍重置本地状态
      }
      flushPending()
      endLive()
      resetPending()
      setOpenError(null)
      setConnected(false)
      setStatus({ kind: 'idle', text: '串口已关闭' })
      return
    }

    const current = settingsRef.current
    if (!current.portPath) {
      showToast('请先选择串口')
      return
    }

    setConnecting(true)
    setStatus({ kind: 'idle', text: `正在打开 ${current.portPath}…` })
    resetPending()
    encodingRef.current = current.recv.encoding
    decoderRef.current = createDecoder(current.recv.encoding)

    let result
    try {
      result = await window.serialAPI.open(sessionId, {
        path: current.portPath,
        baudRate: current.baudRate,
        dataBits: current.dataBits,
        stopBits: current.stopBits,
        parity: current.parity,
        flowControl: current.flowControl,
        rts: current.rts,
        dtr: current.dtr
      })
    } catch (error) {
      result = { ok: false, error: error.message }
    }
    setConnecting(false)

    if (result && result.ok) {
      const rate = Number(current.baudRate)
      if (
        rate > 0 &&
        !COMMON_BAUD_RATES.includes(rate) &&
        !customBaudsRef.current.includes(rate)
      ) {
        setCustomBauds((prev) =>
          Array.from(new Set([...prev, rate])).sort((a, b) => a - b)
        )
        showToast(`自定义波特率 ${rate} 已保存`, 'success')
      }
      setOpenError(null)
      setConnected(true)
      setStatus({
        kind: 'ok',
        text: `${current.portPath} @ ${current.baudRate} 已连接`
      })
    } else {
      const rawMessage = (result && result.error) || '打开串口失败'
      const summary = describeOpenError(rawMessage, result && result.code)
      setOpenError({
        summary,
        detail: rawMessage,
        portPath: current.portPath,
        baudRate: current.baudRate,
        flowControl: current.flowControl
      })
      setStatus({ kind: 'error', text: summary })
    }
  }, [endLive, flushPending, resetPending, sessionId, showToast, stopBatchLoop, stopLoop])

  const selectPort = useCallback(
    async (path) => {
      if (path === settingsRef.current.portPath) return

      if (connectedRef.current) {
        stopLoop()
        try {
          await window.serialAPI?.close(sessionId)
        } catch {
          // 关闭失败时仍允许切换本地端口
        }
        flushPending()
        endLive()
        resetPending()
        setOpenError(null)
        setConnected(false)
        setStatus({ kind: 'idle', text: '串口已切换，请重新打开' })
        showToast('已切换串口，请重新打开', 'success')
      }

      update('portPath', path)
    },
    [endLive, flushPending, resetPending, showToast, stopLoop, update]
  )

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev)
  }, [])

  const startSidebarResize = useCallback(
    (event) => {
      if (sidebarCollapsed) return
      event.preventDefault()
      const startX = event.clientX
      const startWidth = sidebarWidth
      document.body.classList.add('is-resizing-col')
      const onMove = (moveEvent) => {
        setSidebarWidth(
          clampSidebarWidth(startWidth + moveEvent.clientX - startX)
        )
      }
      const onUp = () => {
        document.body.classList.remove('is-resizing-col')
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [sidebarCollapsed, sidebarWidth]
  )

  const startSendResize = useCallback(
    (event) => {
      if (!showSendPane) return
      event.preventDefault()
      const startY = event.clientY
      const startHeight = sendHeight
      const stageHeight = stageRef.current?.clientHeight || window.innerHeight
      const maxHeight = Math.max(200, stageHeight - 190)
      document.body.classList.add('is-resizing-row')
      const onMove = (moveEvent) => {
        const next = Math.min(
          maxHeight,
          Math.max(180, startHeight - (moveEvent.clientY - startY))
        )
        setSendHeight(next)
      }
      const onUp = () => {
        document.body.classList.remove('is-resizing-row')
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [sendHeight, showSendPane]
  )

  const removeBaud = useCallback(
    (rate) => {
      const value = Number(rate)
      setCustomBauds((prev) => prev.filter((item) => item !== value))
      showToast(`已移除自定义波特率 ${value}`, 'success')
    },
    [showToast]
  )

  const saveLog = useCallback(async () => {
    if (!lines.length) {
      showToast('暂无可保存的接收数据')
      return
    }
    if (!window.serialAPI) return
    const content = lines
      .map((line) => {
        const prefix = settingsRef.current.recv.timestamp
          ? `[${formatTime(new Date(line.time))}] `
          : ''
        return `${prefix}${line.text}`
      })
      .join('\n')
    let result
    try {
      result = await window.serialAPI.saveLog(
        content,
        `serial-${formatDateForFile(new Date())}.log`
      )
    } catch (error) {
      showToast(error.message || '保存日志失败')
      return
    }
    if (result.ok) showToast(`日志已保存：${result.filePath}`, 'success')
    else if (!result.canceled) showToast(result.error || '保存日志失败')
  }, [lines, showToast])

  const confirmModal = useCallback(() => {
    if (!modal || modal.type !== 'font') return
    const size = Math.min(32, Math.max(8, Number(fontDraft) || 12))
    update('recv.fontSize', size)
    update('recv.fontFamily', fontFamilyDraft)
    setModal(null)
  }, [fontDraft, fontFamilyDraft, modal, update])

  const openFont = useCallback(() => {
    setFontDraft(settingsRef.current.recv.fontSize)
    setFontFamilyDraft(settingsRef.current.recv.fontFamily || 'system')
    setModal({ type: 'font' })
  }, [])

  const touchFavorite = useCallback((id) => {
    setFavorites((prev) =>
      prev.map((item) => (item.id === id ? { ...item, lastUsedAt: Date.now() } : item))
    )
  }, [])

  const fillFavorite = useCallback(
    (item, shouldClose = false) => {
      setSendText(item.text)
      setSettings((prev) => ({
        ...prev,
        send: favoriteSendSettings(item, prev.send)
      }))
      touchFavorite(item.id)
      if (shouldClose) setLibraryOpen(false)
    },
    [touchFavorite]
  )

  const quickSendFavorite = useCallback(
    (item) => {
      if (batchRef.current.running) {
        showToast('批量循环进行中，请先停止')
        return
      }
      touchFavorite(item.id)
      const send = favoriteSendSettings(item, settingsRef.current.send)
      performSend({ text: item.text, send }).then((ok) => {
        if (ok) {
          showToast(
            `已发送「${item.name}」 · ${describeSendSettings(send)}`,
            'success'
          )
        }
      })
    },
    [performSend, showToast, touchFavorite]
  )

  const openCreateFavorite = useCallback((prefillText = '') => {
    setFavoriteEditor({ mode: 'create', item: null, text: prefillText })
  }, [])

  const handleAddFavorite = useCallback(() => {
    if (!sendTextRef.current.trim()) {
      showToast('发送区内容为空')
      return
    }
    openCreateFavorite(sendTextRef.current)
  }, [openCreateFavorite, showToast])

  const openEditFavorite = useCallback((item) => {
    setFavoriteEditor({ mode: 'edit', item })
  }, [])

  const saveFavorite = useCallback(
    (payload) => {
      if (!favoriteEditor) return
      const currentSend = settingsRef.current.send
      if (favoriteEditor.mode === 'create') {
        const record = createFavoriteRecord({
          name: payload.name,
          text: payload.text,
          encoding: payload.encoding,
          send: { ...currentSend, encoding: payload.encoding }
        })
        setFavorites((prev) => [record, ...prev])
        showToast('指令已收藏', 'success')
      } else {
        const item = favoriteEditor.item
        const send =
          payload.useCurrent || !item.send
            ? pickFavoriteSend({ ...currentSend, encoding: payload.encoding })
            : pickFavoriteSend({ ...item.send, encoding: payload.encoding })
        setFavorites((prev) =>
          prev.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  name: payload.name,
                  text: payload.text,
                  encoding: payload.encoding,
                  send
                }
              : entry
          )
        )
        showToast('指令已更新', 'success')
      }
      setFavoriteEditor(null)
    },
    [favoriteEditor, showToast]
  )

  const deleteFavorite = useCallback(() => {
    if (!favoriteToDelete) return
    setFavorites((prev) => prev.filter((item) => item.id !== favoriteToDelete.id))
    setFavoriteToDelete(null)
    showToast('指令已删除', 'success')
  }, [favoriteToDelete, showToast])

  const moveFavoriteToTop = useCallback((id) => {
    setFavorites((prev) => {
      const index = prev.findIndex((item) => item.id === id)
      if (index <= 0) return prev
      const next = prev.slice()
      const [item] = next.splice(index, 1)
      next.unshift(item)
      return next
    })
  }, [])

  const reorderFavorites = useCallback((fromId, toId, position = 'before') => {
    setFavorites((prev) => {
      const fromIndex = prev.findIndex((item) => item.id === fromId)
      const targetIndex = prev.findIndex((item) => item.id === toId)
      if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) {
        return prev
      }
      const next = prev.slice()
      const [moved] = next.splice(fromIndex, 1)
      const insertIndex = next.findIndex((item) => item.id === toId)
      if (insertIndex < 0) return prev
      next.splice(position === 'after' ? insertIndex + 1 : insertIndex, 0, moved)
      return next
    })
  }, [])

  const exportFavorites = useCallback(async () => {
    if (!window.serialAPI?.exportFavorites) return
    if (favoritesRef.current.length === 0) {
      showToast('指令库为空，暂无可导出的指令')
      return
    }
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      favorites: favoritesRef.current
    }
    let result
    try {
      result = await window.serialAPI.exportFavorites(
        JSON.stringify(payload, null, 2),
        `serial-commands-${formatDateForFile(new Date())}.json`
      )
    } catch (error) {
      showToast(error.message || '导出失败')
      return
    }
    if (result.ok) showToast(`指令库已导出：${result.filePath}`, 'success')
    else if (!result.canceled) showToast(result.error || '导出失败')
  }, [showToast])

  const importFavorites = useCallback(async () => {
    if (!window.serialAPI?.importFavorites) return
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
      : Array.isArray(parsed?.favorites)
        ? parsed.favorites
        : null
    if (!list) {
      showToast('导入失败：文件格式不正确')
      return
    }

    const normalized = normalizeFavorites(list)
    if (normalized.length === 0) {
      showToast('导入失败：文件中没有有效指令')
      return
    }

    const current = favoritesRef.current
    const keys = new Set(current.map(favoriteKey))
    const ids = new Set(current.map((item) => item.id))
    const additions = []
    let skipped = 0

    for (const item of normalized) {
      const key = favoriteKey(item)
      if (keys.has(key)) {
        skipped += 1
        continue
      }
      keys.add(key)
      let id = item.id
      if (!id || ids.has(id)) id = Date.now() + Math.random() + additions.length
      ids.add(id)
      additions.push({
        ...item,
        id,
        createdAt: item.createdAt || Date.now(),
        lastUsedAt: item.lastUsedAt || 0
      })
    }

    if (additions.length === 0) {
      showToast(`没有新增指令${skipped ? `，${skipped} 条已存在` : ''}`)
      return
    }

    setFavorites((prev) => [...prev, ...additions])
    showToast(
      `已导入 ${additions.length} 条指令${skipped ? `，跳过 ${skipped} 条重复` : ''}`,
      'success'
    )
  }, [showToast])

  const openLibrary = useCallback(() => setLibraryOpen(true), [])
  const closeLibrary = useCallback(() => setLibraryOpen(false), [])

  const shelfFavorites = useMemo(() => favorites.slice(0, 8), [favorites])

  useEffect(() => {
    const handler = (event) => {
      if (!activeRef.current) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setLibraryOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (!window.serialAPI) return undefined
    const offData = window.serialAPI.onData((payload) => {
      if (!payload || payload.sessionId !== sessionId) return
      if (!receiveEnabledRef.current) return
      const data = payload.data
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
      if (bytes.length === 0) return
      rxDeltaRef.current += bytes.length
      const { encoding, autoNewline } = settingsRef.current.recv
      if (encoding === 'hex') {
        if (autoNewline) handleHexOn(bytes)
        else handleHexOff(bytes)
      } else if (autoNewline) {
        handleTextOn(bytes)
      } else {
        handleTextOff(bytes)
      }
    })

    const offStatus = window.serialAPI.onStatus((payload) => {
      if (!payload || payload.sessionId !== sessionId) return
      if (payload.type === 'closed') {
        flushPending()
        endLive()
        resetPending()
        setConnected(false)
        setStatus({ kind: 'idle', text: payload.message || '串口已关闭' })
        stopLoop()
        stopBatchLoop()
      } else if (payload.type === 'error') {
        setStatus({ kind: 'error', text: payload.message })
        showToast(payload.message)
      }
    })

    return () => {
      offData()
      offStatus()
    }
  }, [
    endLive,
    flushPending,
    handleHexOff,
    handleHexOn,
    handleTextOff,
    handleTextOn,
    resetPending,
    sessionId,
    showToast,
    stopBatchLoop,
    stopLoop
  ])

  useEffect(() => {
    saveJSON(settingsKey, settings)
  }, [settings, settingsKey])

  useEffect(() => {
    saveJSON(uiKey, {
      sidebarWidth,
      sidebarCollapsed,
      sendHeight,
      sendCollapsed: !showSendPane
    })
  }, [sidebarWidth, sidebarCollapsed, sendHeight, showSendPane, uiKey])

  useEffect(() => {
    onMetaChange?.(sessionId, {
      portPath: settings.portPath,
      connected,
      batchRunning: Boolean(batchState?.running)
    })
  }, [
    batchState?.running,
    connected,
    onMetaChange,
    sessionId,
    settings.portPath
  ])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
      const pending = pendingRef.current
      if (pending.timer) clearTimeout(pending.timer)
      pending.timer = null
      pending.text = ''
      pending.bytes = []
      if (loopRef.current.timer) clearTimeout(loopRef.current.timer)
      loopRef.current.timer = null
      if (batchRef.current.timer) clearTimeout(batchRef.current.timer)
      batchRef.current.timer = null
      window.serialAPI?.close(sessionId)?.catch?.(() => {})
    }
  }, [sessionId])

  useEffect(() => {
    const handleResize = () => {
      setSidebarWidth((prev) => clampSidebarWidth(prev))
      const stageHeight = stageRef.current?.clientHeight || window.innerHeight
      setSendHeight((prev) =>
        Math.min(prev, Math.max(180, stageHeight - 190))
      )
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    refreshPorts()
    const timer = setInterval(refreshPorts, 5000)
    return () => clearInterval(timer)
  }, [refreshPorts])

  useEffect(() => {
    if (!connected || !window.serialAPI) return
    window.serialAPI
      .setSignals(sessionId, { rts: settings.rts, dtr: settings.dtr })
      .then((result) => {
        if (result && !result.ok) showToast(result.error || '设置信号失败')
      })
      .catch((error) => showToast(error.message || '设置信号失败'))
  }, [connected, sessionId, settings.rts, settings.dtr, showToast])

  useEffect(() => {
    if (encodingRef.current === settings.recv.encoding) return
    const pending = pendingRef.current
    if (pending.timer) {
      clearTimeout(pending.timer)
      pending.timer = null
    }
    if (liveRef.current) {
      endLive()
      pending.text = ''
      pending.bytes = []
    } else if (encodingRef.current === 'hex') {
      if (pending.bytes.length > 0) {
        pushLine(bytesToHex(pending.bytes), 'rx', true)
        pending.bytes = []
      }
      pending.text = ''
    } else {
      if (pending.text) {
        pushLine(pending.text.replace(/\r$/, ''), 'rx', false)
        pending.text = ''
      }
      pending.bytes = []
    }
    encodingRef.current = settings.recv.encoding
    decoderRef.current = createDecoder(settings.recv.encoding)
  }, [endLive, pushLine, settings.recv.encoding])

  useEffect(() => {
    if (settings.recv.autoNewline) {
      if (liveRef.current) {
        endLive()
        pendingRef.current.text = ''
        pendingRef.current.bytes = []
      } else {
        flushPending()
      }
    } else {
      const pending = pendingRef.current
      if (pending.timer) {
        clearTimeout(pending.timer)
        pending.timer = null
      }
      if (pending.text) writeLive(pending.text.replace(/\r$/, ''), 'rx', false)
      if (pending.bytes.length) writeLive(bytesToHex(pending.bytes), 'rx', true)
    }
  }, [endLive, flushPending, settings.recv.autoNewline, writeLive])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
      if (pendingRef.current.timer) clearTimeout(pendingRef.current.timer)
      if (loopRef.current.timer) clearTimeout(loopRef.current.timer)
      if (batchRef.current.timer) clearTimeout(batchRef.current.timer)
    }
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        {active ? (
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
              <PageTag kind="serial" label="串口工具" accent={tagAccent} />
            </span>
            <span className="brand-sub">WEAVE EVERY CONNECTION</span>
          </div>
        </div>


        {batchState ? (
          <div className="batch-runner" role="status">
            <span className="batch-pulse" />
            <span className="batch-runner-label">批量循环</span>
            <span className="batch-runner-progress">
              第 {batchState.cycle} 轮 · {batchState.index + 1}/{batchState.total}
            </span>
            <span className="batch-runner-name">{batchState.currentName}</span>
            <button
              className="batch-runner-stop"
              onClick={() => stopBatchLoop('批量循环已停止')}
              title="停止批量循环"
            >
              <Icon name="stop" size={11} />
            </button>
          </div>
        ) : null}

        <div className="topbar-actions">
          <StatusCapsule
            active={connected || connecting}
            enabled={active}
            theme={resolvedTheme}
            label={connecting ? '连接中' : connected ? '已连接' : '未连接'}
            meta={
              connected
                ? `${settings.portPath} · ${settings.baudRate}`
                : connecting
                  ? '正在打开…'
                  : undefined
            }
          />

          <GlassButton
            size="sm"
            className="library-trigger"
            onClick={openLibrary}
            title="打开指令库 (⌘K)"
          >
            <Icon name="command" size={14} />
            <span>指令库</span>
            <kbd>⌘K</kbd>
          </GlassButton>

          <span className="topbar-sep" aria-hidden="true" />

          <button
            type="button"
            className="topbar-btn new-serial-btn"
            onClick={onNewSerial}
            title="新建串口工具"
          >
            <Icon name="plus" size={14} />
            <span>新建</span>
          </button>

          <button
            className="topbar-btn is-icon theme-toggle"
            onClick={onToggleTheme}
            title={resolvedTheme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          >
            <Icon name={resolvedTheme === 'dark' ? 'sun' : 'moon'} size={16} />
          </button>
        </div>
      </header>

      <div className="workspace">
        {sidebarCollapsed ? null : (
          <div className="sidebar-shell" style={{ width: sidebarWidth }}>
            <Sidebar
              settings={settings}
              update={update}
              connected={connected}
              onOpenFont={openFont}
              onSaveLog={saveLog}
              customBauds={customBauds}
              onRemoveBaud={removeBaud}
            />
            <div
              className="col-resizer"
              role="separator"
              aria-orientation="vertical"
              tabIndex={0}
              title="拖动调整参数栏宽度"
              onPointerDown={startSidebarResize}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                event.preventDefault()
                setSidebarWidth((prev) =>
                  clampSidebarWidth(
                    prev + (event.key === 'ArrowRight' ? 12 : -12)
                  )
                )
              }}
            />
          </div>
        )}

        <main className="stage" ref={stageRef}>
          <ReceivePane
            active={active}
            lines={lines}
            recv={settings.recv}
            sendColor={settings.send.sendColor}
            enabled={receiveEnabled}
            onToggleEnabled={() => setReceiveEnabled((prev) => !prev)}
            onClear={clearReceive}
            onSaveLog={saveLog}
            onToggleAutoScroll={() =>
              update('recv.autoScroll', !settings.recv.autoScroll)
            }
            stats={stats}
            connected={connected}
          />
          {showSendPane ? (
            <div
              className="row-resizer"
              role="separator"
              aria-orientation="horizontal"
              tabIndex={0}
              title="拖动调整发送区高度"
              onPointerDown={startSendResize}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                const stageHeight = stageRef.current?.clientHeight || window.innerHeight
                const max = Math.max(200, stageHeight - 190)
                setSendHeight((prev) =>
                  Math.min(
                    max,
                    Math.max(180, prev + (event.key === 'ArrowUp' ? 12 : -12))
                  )
                )
              }}
            >
              <span className="row-resizer-grip" />
            </div>
          ) : null}
          <SendPane
            send={settings.send}
            sendText={sendText}
            onChangeText={setSendText}
            onSend={handleSend}
            looping={looping}
            history={history}
            onClearHistory={() => setHistory([])}
            onPickHistory={(id) => {
              const item = history.find((entry) => entry.id === id)
              if (!item) return
              setSendText(item.text)
              update('send.encoding', item.encoding || 'hex')
            }}
            ports={ports}
            portPath={settings.portPath}
            connected={connected}
            connecting={connecting}
            onSelectPort={selectPort}
            onTogglePort={togglePort}
            onRefreshPorts={refreshPorts}
            batchRunning={Boolean(batchState?.running)}
            onFormat={() => {
              if (settingsRef.current.send.encoding !== 'hex') {
                showToast('仅 HEX 模式支持格式化')
                return
              }
              const result = formatHexText(sendTextRef.current)
              if (result.error) {
                showToast(result.error)
                return
              }
              setSendText(result.text)
            }}
            onAddFavorite={handleAddFavorite}
            onOpenLibrary={openLibrary}
            favorites={shelfFavorites}
            onFillFavorite={(item) => fillFavorite(item, false)}
            onSendFavorite={quickSendFavorite}
            height={sendHeight}
            open={showSendPane}
            onToggleOpen={() => setShowSendPane((prev) => !prev)}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={toggleSidebar}
          />
        </main>
      </div>

      <footer className="statusbar">
        <div className={`status-state ${status.kind}`}>
          <span className="status-dot" />
          <span>{status.text}</span>
        </div>
        <div className="status-meta">
          <span className="mono">RX {formatBytes(stats.rx)}</span>
          <span className="status-sep" />
          <span className="mono">TX {formatBytes(stats.tx)}</span>
          <span className="status-sep" />
          <span>{connected ? settings.portPath : '未连接'}</span>
        </div>
      </footer>

      {toast ? (
        <div className={`toast ${toast.kind}`} role="status" aria-live="polite">
          {toast.message}
        </div>
      ) : null}

      <CommandLibrary
        open={libraryOpen}
        favorites={favorites}
        connected={connected}
        onClose={closeLibrary}
        onFill={(item) => fillFavorite(item, false)}
        onSend={quickSendFavorite}
        onEdit={openEditFavorite}
        onDelete={(item) => setFavoriteToDelete(item)}
        onCreate={() => openCreateFavorite('')}
        onReorder={reorderFavorites}
        onMoveTop={moveFavoriteToTop}
        onImport={importFavorites}
        onExport={exportFavorites}
        batchState={batchState}
        onStartBatch={startBatchLoop}
        onStopBatch={() => stopBatchLoop('批量循环已停止')}
      />

      {favoriteEditor ? (
        <FavoriteEditor
          mode={favoriteEditor.mode}
          item={favoriteEditor.item}
          defaultText={favoriteEditor.text}
          currentSend={settings.send}
          onClose={() => setFavoriteEditor(null)}
          onSave={saveFavorite}
        />
      ) : null}

      {favoriteToDelete ? (
        <Modal
          title="删除指令"
          width={400}
          onClose={() => setFavoriteToDelete(null)}
          footer={
            <>
              <button className="soft-btn" onClick={() => setFavoriteToDelete(null)}>
                取消
              </button>
              <button className="danger-btn" onClick={deleteFavorite}>
                删除指令
              </button>
            </>
          }
        >
          <p className="modal-tip">
            确定删除「{favoriteToDelete.name}」吗？此操作不可撤销。
          </p>
        </Modal>
      ) : null}

      {openError ? (
        <Modal
          title="串口打开失败"
          width={540}
          placement="top"
          tone="danger"
          icon={<Icon name="alert" size={16} />}
          onClose={() => setOpenError(null)}
          footer={
            <>
              <button className="soft-btn" onClick={() => setOpenError(null)}>
                关闭
              </button>
              <button
                className="primary-btn"
                onClick={() => {
                  setOpenError(null)
                  togglePort()
                }}
              >
                <Icon name="refresh" size={14} />
                重试打开
              </button>
            </>
          }
        >
          <p className="error-summary">{openError.summary}</p>
          <div className="error-meta">
            <div>
              <span>端口</span>
              <strong>{openError.portPath}</strong>
            </div>
            <div>
              <span>波特率</span>
              <strong>{openError.baudRate}</strong>
            </div>
            <div>
              <span>流控</span>
              <strong>{openError.flowControl || 'none'}</strong>
            </div>
          </div>
          {openError.detail ? <pre className="error-detail">{openError.detail}</pre> : null}
          <div className="error-hints">
            <span className="micro-label">常见原因</span>
            <ul>
              <li>其他串口工具或 IDE 正在占用该端口</li>
              <li>设备已拔出，或端口号已经变化</li>
              <li>驱动、系统权限或串口参数不被支持</li>
            </ul>
          </div>
        </Modal>
      ) : null}

      {modal && modal.type === 'font' ? (
        <Modal
          title="设置字体"
          width={420}
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="soft-btn" onClick={() => setModal(null)}>
                取消
              </button>
              <button className="primary-btn" onClick={confirmModal}>
                应用
              </button>
            </>
          }
        >
          <label className="field-block">
            <span className="micro-label">字体</span>
            <select
              className="modal-input"
              value={fontFamilyDraft}
              onChange={(event) => setFontFamilyDraft(event.target.value)}
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
          </label>
          <label className="field-block">
            <span className="micro-label">字体大小</span>
            <div className="inline-row">
              <input
                className="num-input"
                type="number"
                min="8"
                max="32"
                autoFocus
                value={fontDraft}
                onChange={(event) => setFontDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') confirmModal()
                }}
              />
              <span className="unit">px</span>
            </div>
          </label>
          <div
            className="serial-font-preview"
            style={{
              fontFamily: getTerminalFontFamily(fontFamilyDraft),
              fontSize: `${Math.min(
                32,
                Math.max(8, Number(fontDraft) || 12)
              )}px`
            }}
          >
            接收日志 0123456789 ABC abc
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
