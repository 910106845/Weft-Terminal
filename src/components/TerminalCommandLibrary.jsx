import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icons'

export default function TerminalCommandLibrary({
  open,
  scope = 'local',
  commands,
  onClose,
  onInsert,
  onRun,
  onCreate,
  onEdit,
  onDelete,
  onImport,
  onExport,
  onReorder,
  onMoveTop
}) {
  const [query, setQuery] = useState('')
  const [dragId, setDragId] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const searchRef = useRef(null)
  const isMac = window.terminalAPI?.platform === 'darwin'
  const isSsh = scope === 'ssh'
  const scopeLabel = isSsh ? 'SSH 指令' : '本地终端指令'
  const libraryLabel = isSsh ? 'SSH 指令库' : '本地终端指令库'

  useEffect(() => {
    if (!open) return undefined
    const frame = requestAnimationFrame(() => searchRef.current?.focus())
    const handler = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', handler)
    }
  }, [onClose, open])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return commands
    return commands.filter(
      (item) =>
        item.name.toLowerCase().includes(keyword) ||
        item.command.toLowerCase().includes(keyword)
    )
  }, [commands, query])

  return (
    <div className={`drawer-layer ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside
        className={`drawer command-drawer ${isSsh ? 'is-ssh' : 'is-local'}`}
        role="dialog"
        aria-modal="true"
        aria-label={libraryLabel}
      >
        <header className="drawer-head">
          <div>
            <span className="micro-label">
              {isSsh ? 'SSH TERMINAL LIBRARY' : 'LOCAL TERMINAL LIBRARY'}
            </span>
            <h2>{libraryLabel}</h2>
          </div>
          <div className="drawer-head-actions">
            <span className={`drawer-scope-chip ${isSsh ? 'is-ssh' : 'is-local'}`}>
              {isSsh ? 'SSH' : '本地'}
            </span>
            <span className="count-badge">{commands.length}</span>
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
            placeholder="搜索名称或命令…"
          />
          {query ? (
            <button
              className="search-clear"
              onClick={() => setQuery('')}
              title="清空搜索"
            >
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
              新增
            </button>
            <button
              className="soft-btn"
              onClick={onImport}
              title={`从 JSON 文件导入${scopeLabel}`}
            >
              <Icon name="upload" size={14} />
              导入
            </button>
            <button
              className="soft-btn"
              onClick={onExport}
              disabled={commands.length === 0}
              title={`将${libraryLabel}导出为 JSON 文件`}
            >
              <Icon name="download" size={14} />
              导出
            </button>
          </div>
          <span className="drawer-hint">
            {query ? `找到 ${filtered.length} 条` : '拖动排序 · 点击填入 · 播放键运行'}
          </span>
        </div>

        <div className="drawer-list terminal-command-list">
          {filtered.length === 0 ? (
            <div className="drawer-empty">
              <div className="drawer-empty-icon">
                <Icon name={commands.length === 0 ? 'plus' : 'search'} size={22} />
              </div>
              <h3>
                {commands.length === 0
                  ? `还没有${scopeLabel}`
                  : '没有匹配的指令'}
              </h3>
              <p>
                {commands.length === 0
                  ? isSsh
                    ? '把远程服务器常用的命令新增到这里，之后可以填入 SSH 终端或直接运行。'
                    : '把本机常用的命令新增到这里，之后可以填入本地终端或直接运行。'
                  : '换一个关键词试试，或新增一条指令。'}
              </p>
              <button
                className="soft-btn"
                onClick={commands.length === 0 ? onCreate : () => setQuery('')}
              >
                {commands.length === 0 ? '新增第一条指令' : '清空搜索'}
              </button>
            </div>
          ) : (
            filtered.map((item) => (
              <div
                className={`terminal-command-row ${
                  dragId === item.id ? 'is-dragging' : ''
                } ${
                  dropTarget?.id === item.id
                    ? `drop-${dropTarget.position}`
                    : ''
                }`}
                key={item.id}
                role="button"
                tabIndex={0}
                draggable
                onClick={() => onInsert(item)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onInsert(item)
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
                    event.clientY > rect.top + rect.height / 2
                      ? 'after'
                      : 'before'
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
                    const rect = event.currentTarget.getBoundingClientRect()
                    const position =
                      event.clientY > rect.top + rect.height / 2
                        ? 'after'
                        : 'before'
                    onReorder(dragId, item.id, position)
                  }
                  setDragId(null)
                  setDropTarget(null)
                }}
              >
                <span className="command-drag terminal-command-drag" title="拖动排序" aria-hidden="true">
                  <Icon name="grip" size={14} />
                </span>
                <span className="terminal-command-icon">
                  <Icon name="terminal" size={14} />
                </span>
                <div className="terminal-command-main">
                  <div className="terminal-command-top">
                    <strong title={item.name}>{item.name}</strong>
                    {item.lastUsedAt ? (
                      <span className="terminal-command-used">已使用</span>
                    ) : null}
                  </div>
                  <code title={item.command}>{item.command}</code>
                </div>
                <div className="terminal-command-actions">
                  <button
                    type="button"
                    className="icon-btn mini"
                    title="运行"
                    onClick={(event) => {
                      event.stopPropagation()
                      onRun(item)
                    }}
                  >
                    <Icon name="play" size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn mini"
                    title="移到最顶部"
                    onClick={(event) => {
                      event.stopPropagation()
                      onMoveTop(item.id)
                    }}
                  >
                    <Icon name="move-top" size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn mini"
                    title="编辑"
                    onClick={(event) => {
                      event.stopPropagation()
                      onEdit(item)
                    }}
                  >
                    <Icon name="edit" size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn mini is-danger"
                    title="删除"
                    onClick={(event) => {
                      event.stopPropagation()
                      onDelete(item)
                    }}
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="terminal-library-foot">
          <span>点击指令填入{isSsh ? ' SSH ' : '本地'}终端，不会自动执行</span>
          <span>{isSsh ? 'SSH' : '本地'}指令库独立保存 · 多窗口共享</span>
        </div>
      </aside>
    </div>
  )
}
