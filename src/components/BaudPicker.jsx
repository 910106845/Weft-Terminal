import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icons'

export default function BaudPicker({
  value,
  commonRates,
  customRates,
  disabled,
  onChange,
  onRemoveCustom
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(value === '' || value === undefined ? '' : String(value))
  const [position, setPosition] = useState(null)
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)
  const inputRef = useRef(null)
  const focusedRef = useRef(false)

  useEffect(() => {
    if (!focusedRef.current) {
      setText(value === '' || value === undefined ? '' : String(value))
    }
  }, [value])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (triggerRef.current?.contains(event.target)) return
      if (popoverRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onViewportChange = (event) => {
      if (
        event.type === 'scroll' &&
        popoverRef.current?.contains(event.target)
      ) {
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

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(380, Math.max(rect.width, 300))
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
    setPosition({ top: rect.bottom + 8, left, width })
  }

  const openPicker = () => {
    if (disabled) return
    updatePosition()
    setOpen(true)
  }

  const commit = (nextText) => {
    const trimmed = String(nextText ?? '').trim()
    const rate = Number(trimmed)
    if (trimmed === '' || !Number.isFinite(rate) || rate <= 0) {
      setText('')
      onChange('')
      return
    }
    setText(String(rate))
    onChange(rate)
  }

  const selectRate = (rate) => {
    setText(String(rate))
    onChange(rate)
    setOpen(false)
    inputRef.current?.focus()
  }

  const customOptions = customRates.filter(
    (rate) => !commonRates.includes(rate)
  )

  return (
    <div className={`baud-picker ${open ? 'is-open' : ''}`} ref={triggerRef}>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        spellCheck={false}
        value={text}
        disabled={disabled}
        placeholder="输入或选择波特率"
        aria-label="波特率"
        onChange={(event) => {
          const next = event.target.value.replace(/[^0-9]/g, '')
          setText(next)
          commit(next)
          if (!open) openPicker()
        }}
        onFocus={() => {
          focusedRef.current = true
          openPicker()
        }}
        onClick={openPicker}
        onBlur={() => {
          focusedRef.current = false
          commit(text)
          setOpen(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
            setOpen(false)
          }
          if (event.key === 'Escape') {
            setOpen(false)
            event.currentTarget.blur()
          }
        }}
      />
      <button
        type="button"
        className="baud-chevron"
        tabIndex={-1}
        disabled={disabled}
        title="选择常用波特率"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (open) {
            setOpen(false)
          } else {
            inputRef.current?.focus()
            openPicker()
          }
        }}
      >
        <Icon
          name="chevron-down"
          size={12}
          className={open ? 'rotate-180' : ''}
        />
      </button>

      {open && position
        ? createPortal(
            <div
              className="baud-popover"
              ref={popoverRef}
              style={{
                top: position.top,
                left: position.left,
                width: position.width
              }}
              onMouseDown={(event) => event.preventDefault()}
            >
              <div className="baud-popover-head">
                <span>常用波特率</span>
                <span className="baud-hint">点击选择</span>
              </div>
              <div className="baud-grid">
                {commonRates.map((rate) => (
                  <button
                    type="button"
                    key={rate}
                    className={`baud-option ${Number(value) === rate ? 'is-selected' : ''}`}
                    onClick={() => selectRate(rate)}
                  >
                    {rate}
                  </button>
                ))}
              </div>

              {customOptions.length > 0 ? (
                <>
                  <div className="baud-popover-head sub">
                    <span>自定义</span>
                    <span className="baud-hint">连接成功后自动保存</span>
                  </div>
                  <div className="baud-custom-list">
                    {customOptions.map((rate) => (
                      <div
                        className={`baud-custom-row ${Number(value) === rate ? 'is-selected' : ''}`}
                        key={rate}
                      >
                        <button
                          type="button"
                          className="baud-custom-select"
                          onClick={() => selectRate(rate)}
                        >
                          {rate}
                        </button>
                        <button
                          type="button"
                          className="icon-btn mini is-danger"
                          title="从缓存中移除"
                          onClick={() => onRemoveCustom(rate)}
                        >
                          <Icon name="trash" size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              <div className="baud-popover-foot">
                输入自定义波特率后成功连接，会自动保存到自定义列表。
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
