import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icons'
import { formatBytes, formatTime } from '../lib/format'
import { parseAnsi, stripAnsi } from '../lib/ansi'
import { findLogHighlights } from '../lib/logHighlight'
import { getTerminalFontFamily } from '../lib/terminalDisplay'

function lineDisplaySegments(line, ansi) {
  if (line.kind === 'tx' || line.hex) {
    return [{ text: line.text || '', color: null }]
  }
  if (ansi) {
    return parseAnsi(line.text || '')
  }
  return [{ text: stripAnsi(line.text || ''), color: null }]
}

function splitMatches(text, query) {
  if (!query) return [{ text, match: false }]
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const parts = []
  let cursor = 0

  while (cursor <= text.length) {
    const index = lowerText.indexOf(lowerQuery, cursor)
    if (index < 0) {
      if (cursor < text.length) {
        parts.push({ text: text.slice(cursor), match: false })
      }
      break
    }
    if (index > cursor) {
      parts.push({ text: text.slice(cursor, index), match: false })
    }
    parts.push({
      text: text.slice(index, index + query.length),
      match: true
    })
    cursor = index + query.length
  }

  return parts
}

function countTextMatches(text, query) {
  if (!query) return 0
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let cursor = 0
  let count = 0

  while (cursor <= text.length) {
    const index = lowerText.indexOf(lowerQuery, cursor)
    if (index < 0) break
    count += 1
    cursor = index + lowerQuery.length
  }

  return count
}

function renderLogText(text, logHighlight) {
  if (!text || !logHighlight) return text
  const highlights = findLogHighlights(text)
  if (!highlights.length) return text

  const parts = []
  let cursor = 0
  highlights.forEach((highlight, index) => {
    if (highlight.start > cursor) {
      parts.push(
        <Fragment key={`text-${index}`}>
          {text.slice(cursor, highlight.start)}
        </Fragment>
      )
    }
    parts.push(
      <span
        key={`log-${index}`}
        className={`log-hl log-hl-${highlight.tone}`}
      >
        {text.slice(highlight.start, highlight.end)}
      </span>
    )
    cursor = highlight.end
  })
  if (cursor < text.length) {
    parts.push(<Fragment key="log-tail">{text.slice(cursor)}</Fragment>)
  }
  return parts
}

function renderMarkedText(
  text,
  query,
  matchStart,
  activeMatch,
  logHighlight
) {
  if (!text) return null
  const parts = splitMatches(text, query)
  let localMatch = 0

  return parts.map((part, index) => {
    if (!part.match) {
      return (
        <Fragment key={index}>
          {renderLogText(part.text, logHighlight)}
        </Fragment>
      )
    }
    const matchIndex = matchStart + localMatch
    localMatch += 1
    return (
      <mark
        key={index}
        className={`console-match ${matchIndex === activeMatch ? 'is-active' : ''}`}
        data-match-index={matchIndex}
      >
        {part.text}
      </mark>
    )
  })
}

function renderLineContent(
  line,
  ansi,
  query,
  matchStart,
  activeMatch,
  logHighlight
) {
  const segments = lineDisplaySegments(line, ansi)
  if (!segments.some((segment) => segment.text)) return '\u00a0'

  let offset = 0
  return segments.map((segment, index) => {
    const count = countTextMatches(segment.text, query)
    const content = renderMarkedText(
      segment.text,
      query,
      matchStart + offset,
      activeMatch,
      logHighlight
    )
    offset += count

    if (segment.color) {
      return (
        <span key={index} style={{ color: segment.color }}>
          {content}
        </span>
      )
    }
    return <Fragment key={index}>{content}</Fragment>
  })
}

const Line = memo(function Line({
  line,
  recv,
  sendColor,
  searchQuery,
  matchStart,
  activeMatch
}) {
  const isTx = line.kind === 'tx'
  return (
    <div className={`line ${isTx ? 'line-sent' : ''}`}>
      {recv.lineNumbers ? <span className="line-no">{line.no}</span> : null}
      {recv.timestamp ? (
        <span className="line-time" style={{ color: isTx ? sendColor : recv.dataColor }}>
          {formatTime(new Date(line.time))}
        </span>
      ) : null}
      <span
        className="line-content"
        style={{ color: isTx ? sendColor : recv.dataColor }}
      >
        {renderLineContent(
          line,
          recv.ansi,
          searchQuery,
          matchStart,
          activeMatch,
          !isTx && !line.hex && recv.logHighlight !== false
        )}
      </span>
    </div>
  )
})

export default function ReceivePane({
  active = true,
  lines,
  recv,
  sendColor,
  enabled,
  onToggleEnabled,
  onClear,
  onSaveLog,
  onToggleAutoScroll,
  stats,
  connected
}) {
  const bodyRef = useRef(null)
  const searchInputRef = useRef(null)
  const [atBottom, setAtBottom] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeMatch, setActiveMatch] = useState(0)
  const live = enabled && connected
  const normalizedQuery = searchQuery.trim()
  const searching = searchOpen && normalizedQuery !== ''

  const searchInfo = useMemo(() => {
    if (!normalizedQuery) return { starts: new Map(), total: 0 }
    const starts = new Map()
    let total = 0

    for (const line of lines) {
      starts.set(line.id, total)
      const segments = lineDisplaySegments(line, recv.ansi)
      for (const segment of segments) {
        total += countTextMatches(segment.text, normalizedQuery)
      }
    }

    return { starts, total }
  }, [lines, recv.ansi, normalizedQuery])

  const scrollToBottom = () => {
    const element = bodyRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
    setAtBottom(true)
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery('')
    setActiveMatch(0)
  }

  const goMatch = (delta) => {
    if (searchInfo.total === 0) return
    setActiveMatch((prev) => {
      const next = (prev + delta) % searchInfo.total
      return next < 0 ? next + searchInfo.total : next
    })
  }

  useEffect(() => {
    if (!searchOpen) return
    searchInputRef.current?.focus()
    searchInputRef.current?.select()
  }, [searchOpen])

  useEffect(() => {
    setActiveMatch(0)
  }, [searchQuery])

  useEffect(() => {
    if (searchInfo.total === 0) {
      setActiveMatch(0)
      return
    }
    if (activeMatch >= searchInfo.total) setActiveMatch(0)
  }, [activeMatch, searchInfo.total])

  useEffect(() => {
    if (!searching || searchInfo.total === 0) return
    const element = bodyRef.current?.querySelector(
      `[data-match-index="${activeMatch}"]`
    )
    element?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }, [activeMatch, lines, searchInfo.total, searching])

  useEffect(() => {
    const element = bodyRef.current
    if (!element) return
    if (recv.autoScroll && !searching) {
      element.scrollTop = element.scrollHeight
      setAtBottom(true)
    } else {
      setAtBottom(
        element.scrollHeight - element.scrollTop - element.clientHeight < 32
      )
    }
  }, [lines, recv.autoScroll, searching])

  useEffect(() => {
    const handler = (event) => {
      if (!active) return
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

  return (
    <section className="console-card">
      <header className="console-head">
        <div className="console-head-left">
          <button
            className={`live-toggle ${live ? 'is-live' : ''}`}
            onClick={onToggleEnabled}
            title={enabled ? '暂停接收' : '继续接收'}
            aria-pressed={enabled}
          >
            <span className="live-dot" />
            {enabled ? (connected ? '接收中' : '接收就绪') : '已暂停'}
          </button>
          <h2>接收流</h2>
          <span className="console-count">{lines.length} 行</span>
          <div className="console-tags">
            <span className="tag">{recv.encoding.toUpperCase()}</span>
            <span className="tag tag-rx">RX {formatBytes(stats.rx)}</span>
            <span className="tag tag-tx">TX {formatBytes(stats.tx)}</span>
          </div>
        </div>
        <div className="console-actions">
          <button
            className={`icon-btn ${searchOpen ? 'is-active' : ''}`}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            title="搜索接收内容 (⌘F / Ctrl+F)"
            aria-pressed={searchOpen}
          >
            <Icon name="search" size={15} />
          </button>
          <button
            className={`icon-btn ${recv.autoScroll ? 'is-active' : ''}`}
            onClick={onToggleAutoScroll}
            title={recv.autoScroll ? '关闭自动滚屏' : '开启自动滚屏'}
            aria-pressed={recv.autoScroll}
          >
            <Icon name="arrow-down" size={15} />
          </button>
          <button className="icon-btn" onClick={onSaveLog} title="保存接收日志">
            <Icon name="download" size={15} />
          </button>
          <button
            className="icon-btn"
            onClick={onClear}
            title="清空接收区"
            aria-label="清空接收区"
          >
            <Icon name="broom" size={15} />
          </button>
        </div>
      </header>

      {searchOpen ? (
        <div className="console-search" role="search">
          <Icon name="search" size={14} />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索接收内容"
            aria-label="搜索接收内容"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                closeSearch()
              } else if (event.key === 'Enter') {
                event.preventDefault()
                goMatch(event.shiftKey ? -1 : 1)
              }
            }}
          />
          <span className="console-search-count">
            {normalizedQuery
              ? `${searchInfo.total ? activeMatch + 1 : 0}/${searchInfo.total}`
              : ''}
          </span>
          <button
            className="icon-btn mini"
            onClick={() => goMatch(-1)}
            disabled={searchInfo.total === 0}
            title="上一个匹配"
          >
            <Icon name="chevron-down" size={12} className="rotate-180" />
          </button>
          <button
            className="icon-btn mini"
            onClick={() => goMatch(1)}
            disabled={searchInfo.total === 0}
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
        className="console-body"
        ref={bodyRef}
        style={{
          fontSize: recv.fontSize,
          fontFamily: getTerminalFontFamily(recv.fontFamily)
        }}
        onScroll={(event) => {
          const element = event.currentTarget
          setAtBottom(
            element.scrollHeight - element.scrollTop - element.clientHeight < 32
          )
        }}
      >
        {lines.length === 0 ? (
          <div className="console-empty">
            <div className="empty-visual">
              <svg viewBox="0 0 260 84" aria-hidden="true">
                <defs>
                  <linearGradient id="wave-gradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.15" />
                    <stop offset="45%" stopColor="var(--accent)" stopOpacity="0.95" />
                    <stop offset="100%" stopColor="var(--mint)" stopOpacity="0.5" />
                  </linearGradient>
                </defs>
                <path
                  className="empty-wave-line"
                  d="M0 42 H36 L48 18 L62 68 L76 28 L90 54 L102 42 H138 L150 22 L164 62 L178 34 L190 48 L202 42 H260"
                  fill="none"
                  stroke="url(#wave-gradient)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="202" cy="42" r="3.5" fill="var(--mint)" />
              </svg>
            </div>
            <h3>{connected ? '等待数据流入' : '尚未连接串口'}</h3>
            <p>
              {connected
                ? '串口已打开，设备发来的数据会实时出现在这里。'
                : '在左侧选择串口并点击「打开串口」，即可开始接收。'}
            </p>
            <div className="empty-tags">
              <span>{recv.encoding.toUpperCase()}</span>
              <span>{recv.autoNewline ? `自动换行 ${recv.interval} ms` : '手动换行'}</span>
              <span>{recv.lineNumbers ? '显示行号' : '隐藏行号'}</span>
            </div>
          </div>
        ) : (
          lines.map((line) => (
            <Line
              key={line.id}
              line={line}
              recv={recv}
              sendColor={sendColor}
              searchQuery={normalizedQuery}
              matchStart={searchInfo.starts.get(line.id) || 0}
              activeMatch={activeMatch}
            />
          ))
        )}
      </div>

      {!atBottom && lines.length > 0 ? (
        <button className="scroll-bottom" onClick={scrollToBottom}>
          回到底部
          <Icon name="arrow-down" size={13} />
        </button>
      ) : null}
    </section>
  )
}
