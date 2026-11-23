import { useEffect } from 'react'
import Icon from './Icons'

export default function Modal({
  title,
  width = 440,
  placement = 'center',
  tone = '',
  icon,
  children,
  footer,
  onClose
}) {
  useEffect(() => {
    const handler = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className={`modal-overlay ${placement === 'top' ? 'is-top' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={`modal ${tone ? `is-${tone}` : ''}`}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <div className="modal-head-main">
            {icon ? <span className="modal-head-icon">{icon}</span> : null}
            <h3>{title}</h3>
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  )
}
