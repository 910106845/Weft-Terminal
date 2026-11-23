import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icons'
import { formatRelativeTime } from '../lib/format'

function itemBadges(item) {
  return [{ label: (item.encoding || 'hex').toUpperCase(), tone: 'neutral' }]
}

export default function CommandLibrary({
  open,
  favorites,
  connected,
  onClose,
  onFill,
  onSend,
  onEdit,
  onDelete,
  onCreate,
  onReorder,
  onMoveTop,
  onImport,
  onExport,
  batchState,
  onStartBatch,
  onStopBatch
}) {
  const isMac = window.serialAPI?.platform === 'darwin'
  const [query, setQuery] = useState('')
  const [dragId, setDragId] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [batchInterval, setBatchInterval] = useState(500)
  const [batchCount, setBatchCount] = useState('')
  const searchRef = useRef(null)
  const batchRunning = Boolean(batchState?.running)

  useEffect(() => {
    setSelectedIds((prev) => {
      const ordered = favorites.filter((item) => prev.has(item.id))
      if (ordered.length === 0) return prev.size === 0 ? prev : new Set()
      const encoding = ordered[0].encoding || 'hex'
      const next = new Set(
        ordered
          .filter((item) => (item.encoding || 'hex') === encoding)
          .map((item) => item.id)
      )
      return next.size === prev.size ? prev : next
    })
  }, [favorites])

  useEffect(() => {
    if (!open) return undefined
    setQuery('')
    const timer = setTimeout(() => searchRef.current?.focus(), 120)
    return () => clearTimeout(timer)
  }, [open])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return favorites
    return favorites.filter((item) => {
      const checksum = item.send?.checksum
        ? getChecksumAlgo(item.send.checksumAlgo).label
        : ''
      return [item.name, item.text, item.encoding, checksum]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    })
  }, [favorites, query])

  const batchEncoding = useMemo(() => {
    if (selectedIds.size === 0) return null
    const first = favorites.find((item) => selectedIds.has(item.id))
    return first ? first.encoding || 'hex' : null
  }, [favorites, selectedIds])

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const startBatch = () => {
    if (selectedIds.size === 0) return
    const started = onStartBatch([...selectedIds], batchInterval, batchCount)
    if (started) onClose()
  }

  return (
    <div className={`drawer-layer ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="串口指令库">
        <header className="drawer-head">
          <div>
            <span className="micro-label">SERIAL COMMAND LIBRARY</span>
            <h2>串口指令库</h2>
          </div>
          <div className="drawer-head-actions">
            <span className="count-badge">{favorites.length}</span>
            <button className="icon-btn" onClick={onClose} title="关闭">
              <Icon name="close" size={16} />
            </button>
          </div>
        </header>

        <div className="drawer-search">
          <Icon name="search" size={15} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索指令名称、内容或编码…"
          />
          {query ? (
            <button className="search-clear" onClick={() => setQuery('')} title="清空搜索">
              <Icon name="close" size={12} />
            </button>
          ) : (
            <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          )}
        </div>

        <div className="drawer-toolbar">
          <div className="drawer-toolbar-actions">
            <button className="soft-btn accent" onClick={onCreate}>
              <Icon name="plus" size={14} />
              新建
            </button>
            <button className="soft-btn" onClick={onImport} title="从 JSON 文件导入指令">
              <Icon name="upload" size={14} />
              导入
            </button>
            <button
              className="soft-btn"
              onClick={onExport}
              disabled={favorites.length === 0}
              title="将指令库导出为 JSON 文件"
            >
              <Icon name="download" size={14} />
              导出
            </button>
          </div>
          <span className="drawer-hint">
            {query ? `找到 ${filtered.length} 条` : '拖动排序 · 点击行填入'}
          </span>
        </div>

        <div className="drawer-list">
          {filtered.length === 0 ? (
            <div className="drawer-empty">
              <div className="drawer-empty-icon">
                <Icon name={favorites.length === 0 ? 'star' : 'search'} size={22} />
              </div>
              <h3>{favorites.length === 0 ? '还没有收藏指令' : '没有匹配的指令'}</h3>
              <p>
                {favorites.length === 0
                  ? '把常用命令收藏起来，之后可一键填入或直接发送。'
                  : '换一个关键词试试，或新建一条指令。'}
              </p>
              <button className="soft-btn" onClick={favorites.length === 0 ? onCreate : () => setQuery('')}>
                {favorites.length === 0 ? '新建第一条指令' : '清空搜索'}
              </button>
            </div>
          ) : (
            filtered.map((item) => (
              <div
                className={`command-row ${dragId === item.id ? 'is-dragging' : ''} ${
                  dropTarget?.id === item.id
                    ? `drop-${dropTarget.position}`
                    : ''
                } ${selectedIds.has(item.id) ? 'is-selected' : ''} ${
                  batchState?.currentId === item.id ? 'is-batch-current' : ''
                }`}
                key={item.id}
                role="button"
                tabIndex={0}
                draggable
                onClick={() => onFill(item)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onFill(item)
                }}
                onDragStart={(event) => {
                  setDragId(item.id)
                  setDropTarget(null)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', String(item.id))
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setDropTarget(null)
                }}
                onDragOver={(event) => {
                  if (!dragId || dragId === item.id) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  const rect = event.currentTarget.getBoundingClientRect()
                  const position =
                    event.clientY > rect.top + rect.height / 2 ? 'after' : 'before'
                  if (
                    dropTarget?.id !== item.id ||
                    dropTarget?.position !== position
                  ) {
                    setDropTarget({ id: item.id, position })
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (dragId && dragId !== item.id) {
                    const position =
                      dropTarget?.id === item.id ? dropTarget.position : 'before'
                    onReorder(dragId, item.id, position)
                  }
                  setDragId(null)
                  setDropTarget(null)
                }}
              >
                <span className="command-drag" title="拖动排序" aria-hidden="true">
                  <Icon name="grip" size={14} />
                </span>
                <div className="command-row-main">
                  <div className="command-row-top">
                    <div className="command-title-group">
                      <label
                        className="command-select"
                        title={
                          batchRunning
                            ? '批量循环中无法修改选择'
                            : batchEncoding &&
                                (item.encoding || 'hex') !== batchEncoding
                              ? `批量循环只能选择 ${batchEncoding.toUpperCase()} 编码`
                              : '选择用于批量循环'
                        }
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label={`选择 ${item.name}`}
                          checked={selectedIds.has(item.id)}
                          disabled={
                            batchRunning ||
                            (Boolean(batchEncoding) &&
                              (item.encoding || 'hex') !== batchEncoding)
                          }
                          onChange={() => toggleSelected(item.id)}
                        />
                      </label>
                      <span className="command-name" title={item.name}>
                        {item.name}
                      </span>
                      <div className="badge-row">
                        {itemBadges(item).map((badge) => (
                          <span className={`mini-badge is-${badge.tone}`} key={badge.label}>
                            {badge.label}
                          </span>
                        ))}
                        {batchState?.currentId === item.id ? (
                          <span className="mini-badge is-live">发送中</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="command-actions" onClick={(event) => event.stopPropagation()}>
                      <button
                        className="icon-btn mini command-send-btn"
                        onClick={() => onSend(item)}
                        disabled={!connected || batchRunning}
                        title={
                          batchRunning
                            ? '批量循环中，请先停止'
                            : connected
                              ? '立即发送'
                              : '请先打开串口'
                        }
                        aria-label="立即发送"
                      >
                        <Icon name="send" size={13} />
                      </button>
                      <span className="command-action-sep" aria-hidden="true" />
                      <button
                        className="icon-btn mini"
                        onClick={() => onMoveTop(item.id)}
                        title="移到最顶部"
                      >
                        <Icon name="move-top" size={13} />
                      </button>
                      <button className="icon-btn mini" onClick={() => onEdit(item)} title="编辑">
                        <Icon name="edit" size={13} />
                      </button>
                      <button
                        className="icon-btn mini is-danger"
                        onClick={() => onDelete(item)}
                        title="删除"
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  </div>
                  <pre
                    className="command-preview"
                    title={item.text}
                  >
                    {item.text}
                  </pre>
                  <span className="command-used">{formatRelativeTime(item.lastUsedAt)}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {selectedIds.size > 0 || batchRunning ? (
          <div className={`batch-bar ${batchRunning ? 'is-running' : ''}`}>
            {batchRunning ? (
              <>
                <span className="batch-status">
                  <span className="batch-pulse" />
                  批量循环中
                </span>
                <span className="batch-progress">
                  第 {batchState.cycle} 轮 · {batchState.index + 1}/{batchState.total}
                </span>
                <span className="batch-current">{batchState.currentName}</span>
                <button className="soft-btn batch-stop-btn" onClick={onStopBatch}>
                  <Icon name="stop" size={12} />
                  停止
                </button>
              </>
            ) : (
              <>
                <span
                  className="batch-selected"
                  title={
                    batchEncoding
                      ? `同一批只能发送 ${batchEncoding.toUpperCase()} 编码`
                      : '请选择指令'
                  }
                >
                  已选 {selectedIds.size} 条
                  {batchEncoding ? ` · ${batchEncoding.toUpperCase()}` : ''}
                </span>
                <label className="batch-field">
                  间隔
                  <input
                    type="number"
                    min="20"
                    value={batchInterval}
                    onChange={(event) => setBatchInterval(event.target.value)}
                  />
                  <span>ms</span>
                </label>
                <label className="batch-field">
                  循环
                  <input
                    type="number"
                    min="0"
                    placeholder="空=无限"
                    value={batchCount}
                    onChange={(event) => setBatchCount(event.target.value)}
                  />
                  <span>次</span>
                </label>
                <button
                  className="ghost-btn batch-clear"
                  onClick={() => setSelectedIds(new Set())}
                >
                  清空
                </button>
                <button
                  className="primary-btn batch-start"
                  onClick={startBatch}
                  disabled={selectedIds.size === 0}
                  title={connected ? '按指令库当前顺序循环发送' : '串口未打开，点击会提示先打开串口'}
                >
                  开始循环
                </button>
              </>
            )}
          </div>
        ) : null}

        <footer className="drawer-foot">
          <span>点击外部或右上角 X 关闭</span>
          <span>
            <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd> 打开
          </span>
          <span className="drawer-foot-tip">
            拖动卡片可排序 · 批量循环仅支持同编码
          </span>
        </footer>
      </aside>
    </div>
  )
}
