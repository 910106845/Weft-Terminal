import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icons'
import { computePopoverPosition } from '../lib/popoverPosition'

export default function PortPicker({ ports, value, connected, onChange, onRefresh }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const [customPath, setCustomPath] = useState('')
  const rootRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) return
      if (menuRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onViewportChange = (event) => {
      if (event.type === 'scroll' && menuRef.current?.contains(event.target)) {
        return
      }
      setOpen(false)
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
  }, [open])

  const openMenu = () => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const known = ports.some((port) => port.path === value)
    setCustomPath(value && !known ? value : '')
    setPosition(
      computePopoverPosition({
        anchorRect: rect,
        preferredWidth: rect.width,
        minWidth: 340,
        maxWidth: 400,
        minSpace: 260
      })
    )
    setOpen(true)
    onRefresh?.()
  }

  const current = ports.find((port) => port.path === value)
  const label = current?.friendlyName || value || '选择串口'

  return (
    <div className="port-picker" ref={rootRef}>
      <button
        type="button"
        className={`port-trigger ${open ? 'is-open' : ''}`}
        onClick={() => {
          if (open) setOpen(false)
          else openMenu()
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={connected ? '切换串口会先关闭当前串口' : '选择串口'}
      >
        <Icon name="plug" size={14} />
        <span className="port-trigger-label">{label}</span>
        <Icon
          name="chevron-down"
          size={12}
          className={`port-trigger-chevron ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && position
        ? createPortal(
            <div
              className="port-menu"
              ref={menuRef}
              role="listbox"
              aria-label="串口列表"
              style={{
                left: position.left,
                width: position.width,
                maxHeight: position.maxHeight,
                top: position.top,
                bottom: position.bottom
              }}
            >
              <div className="port-menu-head">
                <span>串口列表</span>
                <span className="port-menu-head-actions">
                  <span className="port-count">{ports.length}</span>
                  <button
                    type="button"
                    className="port-refresh"
                    onClick={onRefresh}
                    title="刷新串口列表"
                    aria-label="刷新串口列表"
                  >
                    <Icon name="refresh" size={12} />
                  </button>
                </span>
              </div>

              <div className="port-menu-list">
                {ports.length === 0 ? (
                  <div className="port-empty">未发现串口，请检查连接后刷新</div>
                ) : (
                  ports.map((port) => {
                    const selected = port.path === value
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        key={port.path}
                        className={`port-option ${selected ? 'is-selected' : ''}`}
                        onClick={() => {
                          setOpen(false)
                          if (!selected) onChange(port.path)
                        }}
                      >
                        <span className="port-option-main">
                          <span className="port-option-name">
                            {port.friendlyName || port.path}
                          </span>
                          <span className="port-option-sub">
                            {port.path}
                            {port.manufacturer ? ` · ${port.manufacturer}` : ''}
                          </span>
                        </span>
                        {selected ? <Icon name="check" size={14} /> : null}
                      </button>
                    )
                  })
                )}
              </div>

              <div className="port-custom">
                <span className="port-custom-label">自定义串口路径</span>
                <div className="port-custom-row">
                  <input
                    value={customPath}
                    onChange={(event) => setCustomPath(event.target.value)}
                    placeholder={navigator.platform?.startsWith('Win') ? 'COM12' : '/dev/ttys012'}
                    spellCheck={false}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      const next = customPath.trim()
                      if (!next) return
                      setOpen(false)
                      onChange(next)
                    }}
                  />
                  <button
                    type="button"
                    className="soft-btn"
                    disabled={!customPath.trim()}
                    onClick={() => {
                      const next = customPath.trim()
                      if (!next) return
                      setOpen(false)
                      onChange(next)
                    }}
                  >
                    使用
                  </button>
                </div>
              </div>

              {connected ? (
                <div className="port-menu-foot">
                  <span>切换串口会关闭当前串口</span>
                </div>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
