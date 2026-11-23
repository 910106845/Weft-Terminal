import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icons'
import { computePopoverPosition } from '../lib/popoverPosition'

export default function SessionFolders({
  anchorRef,
  tabs,
  folders,
  activeTabId,
  allCollapsed,
  titleOf,
  kindClassOf,
  kindIconOf,
  kindTagOf,
  onClose,
  onSelectTab,
  onToggleAll,
  onCreateFolder,
  onRenameFolder,
  onToggleFolder,
  onDeleteFolder,
  onMoveTab
}) {
  const [position, setPosition] = useState(null)
  const [editing, setEditing] = useState(null)
  const [dragId, setDragId] = useState('')
  const [dropId, setDropId] = useState('')
  const panelRef = useRef(null)
  const cancelEditRef = useRef(false)
  const justDraggedRef = useRef(false)

  useEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    setPosition(
      computePopoverPosition({
        anchorRect: rect,
        preferredWidth: 340,
        minWidth: 320,
        maxWidth: 380,
        minSpace: 260
      })
    )
  }, [anchorRef])

  useEffect(() => {
    const onPointerDown = (event) => {
      if (anchorRef.current?.contains(event.target)) return
      if (panelRef.current?.contains(event.target)) return
      onClose()
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    const onViewportChange = (event) => {
      if (event?.type === 'scroll' && panelRef.current?.contains(event.target)) {
        return
      }
      onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [anchorRef, onClose])

  if (!position) return null

  const unfiledTabs = tabs.filter((tab) => !tab.folderId)

  const startCreate = () => {
    cancelEditRef.current = false
    setEditing({ mode: 'create', id: '', value: '' })
  }

  const startRename = (folder) => {
    cancelEditRef.current = false
    setEditing({ mode: 'rename', id: folder.id, value: folder.name })
  }

  const cancelEdit = () => {
    cancelEditRef.current = true
    setEditing(null)
  }

  const commitEdit = () => {
    if (!editing) return
    const value = editing.value.trim()
    if (value) {
      if (editing.mode === 'create') onCreateFolder(value)
      else onRenameFolder(editing.id, value)
    }
    setEditing(null)
  }

  const handleDragStart = (event, tabId) => {
    justDraggedRef.current = true
    setDragId(tabId)
    setDropId('')
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', tabId)
  }

  const handleDragEnd = () => {
    setDragId('')
    setDropId('')
    setTimeout(() => {
      justDraggedRef.current = false
    }, 0)
  }

  const handleDrop = (folderId) => (event) => {
    event.preventDefault()
    const tabId = event.dataTransfer.getData('text/plain') || dragId
    if (tabId) onMoveTab(tabId, folderId)
    setDragId('')
    setDropId('')
  }

  const allowDrop = (folderId) => (event) => {
    if (!dragId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dropId !== folderId) setDropId(folderId)
  }

  const renderEditRow = () => (
    <div className="folder-row is-editing">
      <span className="folder-row-icon">
        <Icon name="folder" size={13} />
      </span>
      <input
        className="folder-edit-input"
        autoFocus
        value={editing.value || ''}
        placeholder={editing.mode === 'create' ? '文件夹名称' : ''}
        onChange={(event) =>
          setEditing((prev) =>
            prev ? { ...prev, value: event.target.value } : prev
          )
        }
        onBlur={() => {
          if (cancelEditRef.current) {
            cancelEditRef.current = false
            return
          }
          commitEdit()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitEdit()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            cancelEdit()
          }
        }}
      />
      <button
        type="button"
        className="folder-icon-btn"
        title="保存"
        aria-label="保存文件夹名称"
        onMouseDown={(event) => event.preventDefault()}
        onClick={commitEdit}
      >
        <Icon name="check" size={12} />
      </button>
    </div>
  )

  const renderSession = (tab, index) => (
    <button
      key={tab.id}
      type="button"
      draggable
      className={`folder-session ${
        tab.id === activeTabId ? 'is-active' : ''
      }`}
      title={titleOf(tab, index)}
      onClick={() => {
        if (justDraggedRef.current) return
        onSelectTab(tab.id)
      }}
      onDragStart={(event) => handleDragStart(event, tab.id)}
      onDragEnd={handleDragEnd}
    >
      <span className={`tab-kind ${kindClassOf(tab)}`}>
        <Icon name={kindIconOf(tab)} size={11} />
      </span>
      <span className="folder-session-title">{titleOf(tab, index)}</span>
      <span className={`tab-kind-tag ${kindClassOf(tab)}`}>
        {kindTagOf(tab)}
      </span>
    </button>
  )

  return createPortal(
    <div
      className="folder-panel"
      ref={panelRef}
      style={{
        top: position.top,
        bottom: position.bottom,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight
      }}
      role="dialog"
      aria-label="会话文件夹"
    >
      <div className="folder-panel-head">
        <strong>会话文件夹</strong>
        <button type="button" className="folder-new-btn" onClick={startCreate}>
          <Icon name="plus" size={12} />
          新建文件夹
        </button>
      </div>

      <div className="folder-panel-list">
        {editing?.mode === 'create' ? renderEditRow() : null}

        {!folders.length && editing?.mode !== 'create' ? (
          <p className="folder-panel-empty">
            还没有自定义文件夹，新建后可将会话拖入分类。
          </p>
        ) : null}

        {folders.map((folder) => {
          const items = tabs
            .map((tab, index) => ({ tab, index }))
            .filter(({ tab }) => tab.folderId === folder.id)
          const collapsed = Boolean(folder.collapsed)
          return (
            <div className="folder-block" key={folder.id}>
              {editing?.mode === 'rename' && editing.id === folder.id ? (
                renderEditRow()
              ) : (
                <div
                  className={`folder-row ${
                    dropId === folder.id ? 'is-drop' : ''
                  }`}
                  onDragOver={allowDrop(folder.id)}
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget)) return
                    setDropId('')
                  }}
                  onDrop={handleDrop(folder.id)}
                >
                  <button
                    type="button"
                    className="folder-row-main"
                    onClick={() => onToggleFolder(folder.id)}
                    aria-expanded={!collapsed}
                  >
                    <Icon
                      name="chevron-down"
                      size={11}
                      className={`folder-chevron ${
                        collapsed ? 'is-collapsed' : ''
                      }`}
                    />
                    <span className="folder-row-icon">
                      <Icon name="folder" size={13} />
                    </span>
                    <span className="folder-name" title={folder.name}>
                      {folder.name}
                    </span>
                  </button>
                  <span className="folder-count">{items.length}</span>
                  <span className="folder-row-actions">
                    <button
                      type="button"
                      className="folder-icon-btn"
                      title="重命名文件夹"
                      aria-label="重命名文件夹"
                      onClick={() => startRename(folder)}
                    >
                      <Icon name="edit" size={11} />
                    </button>
                    <button
                      type="button"
                      className="folder-icon-btn is-danger"
                      title="删除文件夹"
                      aria-label="删除文件夹"
                      onClick={() => onDeleteFolder(folder)}
                    >
                      <Icon name="trash" size={11} />
                    </button>
                  </span>
                </div>
              )}

              {!collapsed
                ? items.map(({ tab, index }) => renderSession(tab, index))
                : null}
            </div>
          )
        })}

        <div className="folder-all-wrap">
          <div
            className={`folder-row is-all ${
              dropId === '__all__' ? 'is-drop' : ''
            }`}
            onDragOver={allowDrop('__all__')}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget)) return
              setDropId('')
            }}
            onDrop={handleDrop('')}
          >
            <button
              type="button"
              className="folder-row-main"
              onClick={onToggleAll}
              aria-expanded={!allCollapsed}
            >
              <Icon
                name="chevron-down"
                size={11}
                className={`folder-chevron ${
                  allCollapsed ? 'is-collapsed' : ''
                }`}
              />
              <span className="folder-row-icon">
                <Icon name="folder" size={13} />
              </span>
              <span className="folder-name">全部会话</span>
            </button>
            <span className="folder-count">{unfiledTabs.length}</span>
            <span className="folder-row-actions is-label">
              <span className="folder-default">默认</span>
            </span>
          </div>

          {!allCollapsed ? (
            unfiledTabs.length ? (
              unfiledTabs.map((tab) =>
                renderSession(tab, tabs.findIndex((item) => item.id === tab.id))
              )
            ) : (
              <div className="folder-empty">暂无未归类会话</div>
            )
          ) : null}
        </div>
      </div>

      <div className="folder-panel-foot">
        拖动会话到文件夹即可归类；拖到「全部会话」会移出文件夹。
      </div>
    </div>,
    document.body
  )
}
