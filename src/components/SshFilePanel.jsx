import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icons'
import Modal from './Modal'

function joinRemote(base, name) {
  const cleanName = String(name || '').replace(/^[/\\]+/, '')
  if (!base || base === '.' || base === '/') {
    return base === '/' ? `/${cleanName}` : cleanName
  }
  return `${String(base).replace(/[/\\]+$/, '')}/${cleanName}`
}

function parentRemote(target) {
  const value = String(target || '').replace(/[/\\]+$/, '')
  if (!value || value === '/' || /^[A-Za-z]:$/.test(value)) return '/'
  const index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  if (index <= 0) return value.startsWith('/') ? '/' : ''
  return value.slice(0, index)
}

function formatSize(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = value / 1024
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`
}

function formatTime(value) {
  const date = new Date(Number(value) || 0)
  if (!value || Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export default function SshFilePanel({
  open,
  sessionId,
  hostLabel,
  onClose,
  onNotify
}) {
  const [path, setPath] = useState('')
  const [pathDraft, setPathDraft] = useState('')
  const [entries, setEntries] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const requestIdRef = useRef(0)
  const apiRef = useRef(window.terminalAPI?.sftp)
  const api = apiRef.current

  const load = useCallback(
    async (target) => {
      if (!api) {
        setError('远程文件接口不可用')
        return
      }
      const requestId = ++requestIdRef.current
      setLoading(true)
      setError('')
      try {
        let nextPath = String(target || '').trim()
        if (!nextPath) {
          const home = await api.home(sessionId)
          if (!home?.ok) throw new Error(home?.error || '无法获取远程目录')
          nextPath = home.path
        }
        const result = await api.list(sessionId, nextPath)
        if (requestId !== requestIdRef.current) return
        if (!result?.ok) {
          throw new Error(result?.error || '读取远程目录失败')
        }
        setPath(result.path || nextPath)
        setPathDraft(result.path || nextPath)
        setEntries(result.entries || [])
        setSelected(null)
      } catch (errorValue) {
        if (requestId !== requestIdRef.current) return
        setError(errorValue.message || String(errorValue))
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    },
    [api, sessionId]
  )

  useEffect(() => {
    if (!open) return
    load('')
  }, [load, open])

  useEffect(() => {
    if (!open) setDeleteTarget(null)
  }, [open])

  const downloadEntry = useCallback(
    async (entry) => {
      if (!api || !entry || entry.type === 'dir') return
      setBusy('正在下载远程文件…')
      setError('')
      try {
        const result = await api.download(sessionId, entry.path)
        if (result?.ok) {
          onNotify?.(`已下载到 ${result.filePath}`, 'success')
        } else if (!result?.canceled) {
          setError(result?.error || '下载失败')
        }
      } catch (errorValue) {
        setError(errorValue.message || '下载失败')
      } finally {
        setBusy('')
      }
    },
    [api, onNotify, sessionId]
  )

  const uploadFiles = useCallback(async () => {
    if (!api || !path) return
    setBusy('正在上传文件…')
    setError('')
    try {
      const result = await api.upload(sessionId, path)
      if (result?.ok) {
        onNotify?.(
          `已上传 ${result.uploaded?.length || 0} 个文件`,
          'success'
        )
        await load(path)
      } else if (!result?.canceled) {
        setError(result?.error || '上传失败')
      }
    } catch (errorValue) {
      setError(errorValue.message || '上传失败')
    } finally {
      setBusy('')
    }
  }, [api, load, onNotify, path, sessionId])

  const createFolder = useCallback(async () => {
    if (!api || !path) return
    const name = window.prompt('新建文件夹名称')
    const folderName = String(name || '').trim()
    if (!folderName) return
    if (/[/\\]/.test(folderName)) {
      setError('文件夹名称不能包含 / 或 \\')
      return
    }
    setBusy('正在新建文件夹…')
    setError('')
    try {
      const result = await api.mkdir(
        sessionId,
        joinRemote(path, folderName)
      )
      if (result?.ok) {
        onNotify?.(`已新建文件夹「${folderName}」`, 'success')
        await load(path)
      } else {
        setError(result?.error || '新建文件夹失败')
      }
    } catch (errorValue) {
      setError(errorValue.message || '新建文件夹失败')
    } finally {
      setBusy('')
    }
  }, [api, load, onNotify, path, sessionId])

  const confirmDelete = useCallback(async () => {
    const entry = deleteTarget
    if (!api || !entry) return
    const typeLabel = entry.type === 'dir' ? '文件夹' : '文件'
    setDeleteTarget(null)
    setBusy('正在删除…')
    setError('')
    try {
      const result = await api.remove(
        sessionId,
        entry.path,
        entry.type,
        entry.isLink
      )
      if (result?.ok) {
        onNotify?.(`已删除${typeLabel}「${entry.name}」`, 'success')
        await load(path)
      } else {
        setError(result?.error || '删除失败')
      }
    } catch (errorValue) {
      setError(errorValue.message || '删除失败')
    } finally {
      setBusy('')
    }
  }, [api, deleteTarget, load, onNotify, path, sessionId])

  const disabled = Boolean(busy) || loading

  return (
    <>
      <div
        className={`drawer-layer ${open ? 'is-open' : ''}`}
        aria-hidden={!open}
        data-open={open ? 'true' : 'false'}
      >
        <div className="drawer-backdrop" onClick={onClose} />
        <aside
          className="drawer ssh-file-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="远程文件管理"
        >
        <header className="drawer-head">
          <div>
            <span className="micro-label">REMOTE FILES</span>
            <h2>远程文件</h2>
            <span className="ssh-file-host">{hostLabel}</span>
          </div>
          <div className="drawer-head-actions">
            <button
              type="button"
              className="icon-btn"
              onClick={() => load(path)}
              title="刷新目录"
              disabled={loading}
            >
              <Icon name="refresh" size={15} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              title="关闭"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        </header>

        <div className="ssh-file-pathbar">
          <button
            type="button"
            className="icon-btn mini"
            onClick={() => load(parentRemote(path))}
            disabled={!path || path === '/' || loading}
            title="上级目录"
          >
            <Icon name="chevron-down" size={12} className="rotate-180" />
          </button>
          <input
            value={pathDraft}
            spellCheck={false}
            placeholder="/home/user"
            onChange={(event) => setPathDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              const target = pathDraft.trim() || '/'
              setPathDraft(target)
              load(target)
            }}
          />
          <button
            type="button"
            className="soft-btn"
            onClick={() => load(pathDraft.trim() || '/')}
            disabled={loading}
          >
            前往
          </button>
        </div>

        <div className="drawer-toolbar ssh-file-toolbar">
          <div className="drawer-toolbar-actions">
            <button
              type="button"
              className="soft-btn accent"
              onClick={uploadFiles}
              disabled={disabled || !path}
            >
              <Icon name="upload" size={14} />
              上传
            </button>
            <button
              type="button"
              className="soft-btn"
              onClick={createFolder}
              disabled={disabled || !path}
            >
              <Icon name="plus" size={14} />
              新建文件夹
            </button>
          </div>
          <span className="drawer-hint">双击进入文件夹 / 下载文件</span>
        </div>

        {error ? (
          <div className="ssh-file-error">
            <Icon name="alert" size={14} />
            <span>{error}</span>
            <button
              type="button"
              className="icon-btn mini"
              onClick={() => setError('')}
              title="关闭提示"
            >
              <Icon name="close" size={11} />
            </button>
          </div>
        ) : null}

        <div className="drawer-list ssh-file-list">
          {loading && entries.length === 0 ? (
            <div className="ssh-file-state">
              <span className="terminal-spinner" />
              正在读取远程目录…
            </div>
          ) : !loading && !error && entries.length === 0 ? (
            <div className="drawer-empty">
              <div className="drawer-empty-icon">
                <Icon name="folder" size={22} />
              </div>
              <h3>这个目录是空的</h3>
              <p>可以上传本地文件或新建文件夹。</p>
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.path}
                className={`ssh-file-row ${
                  selected === entry.name ? 'is-selected' : ''
                }`}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(entry.name)}
                onDoubleClick={() =>
                  entry.type === 'dir'
                    ? load(entry.path)
                    : downloadEntry(entry)
                }
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  if (entry.type === 'dir') load(entry.path)
                  else downloadEntry(entry)
                }}
              >
                <span
                  className={`ssh-file-icon ${
                    entry.type === 'dir' ? 'is-dir' : 'is-file'
                  }`}
                >
                  <Icon
                    name={entry.type === 'dir' ? 'folder' : 'file'}
                    size={15}
                  />
                </span>
                <div className="ssh-file-main">
                  <span className="ssh-file-name">
                    {entry.name}
                    {entry.isLink ? (
                      <span className="ssh-file-link">链接</span>
                    ) : null}
                  </span>
                  <span className="ssh-file-meta">
                    {entry.type === 'dir'
                      ? '文件夹'
                      : formatSize(entry.size)}
                    {entry.mtime ? ` · ${formatTime(entry.mtime)}` : ''}
                  </span>
                </div>
                <div className="ssh-file-actions">
                  {entry.type !== 'dir' ? (
                    <button
                      type="button"
                      className="icon-btn mini"
                      title="下载"
                      disabled={disabled}
                      onClick={(event) => {
                        event.stopPropagation()
                        downloadEntry(entry)
                      }}
                    >
                      <Icon name="download" size={12} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="icon-btn mini is-danger"
                    title="删除"
                    disabled={disabled}
                    onClick={(event) => {
                      event.stopPropagation()
                      setDeleteTarget(entry)
                    }}
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="ssh-file-foot">
          <span>{busy || `${entries.length} 个条目`}</span>
          <span className="ssh-file-foot-path" title={path}>
            {path || '/'}
          </span>
        </div>
        </aside>
      </div>

      {deleteTarget ? (
        <Modal
          title={
            deleteTarget.type === 'dir'
              ? '确认删除远程文件夹'
              : '确认删除远程文件'
          }
          width={440}
          tone="danger"
          icon={<Icon name="trash" size={17} />}
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <button
                type="button"
                className="soft-btn ssh-delete-confirm-btn"
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="danger-btn ssh-delete-confirm-btn"
                onClick={confirmDelete}
              >
                确定
              </button>
            </>
          }
        >
          <p className="ssh-delete-message">
            {`确定删除远程服务器上的${
              deleteTarget.type === 'dir' ? '文件夹' : '文件'
            }「`}
            <strong>{deleteTarget.name}</strong>
            {'」吗？'}
          </p>
          <p className="form-note">
            {deleteTarget.type === 'dir'
              ? '文件夹内的内容也会一并删除，此操作不可撤销。'
              : '此操作不可撤销。'}
          </p>
        </Modal>
      ) : null}
    </>
  )
}
