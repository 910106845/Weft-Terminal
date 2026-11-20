import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icons'

export default function HistoryPicker({ history, onPick }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (triggerRef.current?.contains(event.target)) return
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
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width =
      history.length === 0
        ? 300
        : Math.min(Math.max(rect.width, 360), window.innerWidth - 24)
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
    const openUp = window.innerHeight - rect.bottom < 300
    setPosition({
      left,
      width,
      top: openUp ? undefined : rect.bottom + 8,
      bottom: openUp ? window.innerHeight - rect.top + 8 : undefined
    })
    setOpen(true)
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`history-trigger ${open ? 'is-open' : ''}`}
        onClick={() => {
          if (open) setOpen(false)
          else openMenu()
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="发送历史"
      >
        <Icon name="history" size={14} />
        <span className="history-trigger-label">选择发送历史数据</span>
        <Icon
          name="chevron-down"
          size={12}
          className={`history-trigger-chevron ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && position
        ? createPortal(
            <div
              className="history-menu"
              ref={menuRef}
              role="listbox"
              aria-label="发送历史"
              style={{
                left: position.left,
                width: position.width,
                top: position.top,
                bottom: position.bottom
              }}
            >
              {history.length === 0 ? (
                <div className="history-empty">暂无发送历史</div>
              ) : (
                <div className="history-list">
                  {history.map((item) => (
                    <button
                      type="button"
                      role="option"
                      key={item.id}
                      className="history-item"
                      title={item.text}
                      onClick={() => {
                        setOpen(false)
                        onPick(item.id)
                      }}
                    >
                      <span className="history-text">{item.text}</span>
                      <span className="history-encoding">
                        {(item.encoding || 'hex').toUpperCase()}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
