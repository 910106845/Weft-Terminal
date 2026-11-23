import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icons'
import { computePopoverPosition } from '../lib/popoverPosition'

export default function BaudPicker({
  value,
  commonRates,
  customRates,
  disabled,
  onChange,
  onRemoveCustom
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState(null)
  const rootRef = useRef(null)
  const popoverRef = useRef(null)
  const searchRef = useRef(null)

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) return
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

  useEffect(() => {
    if (!open) return undefined
    const timer = setTimeout(() => searchRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open])

  const updatePosition = () => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    setPosition(
      computePopoverPosition({
        anchorRect: rect,
        preferredWidth: rect.width,
        minWidth: 260,
        maxWidth: 320,
        minSpace: 220
      })
    )
  }

  const openPicker = () => {
    if (disabled) return
    setQuery('')
    updatePosition()
    setOpen(true)
  }

  const normalizedCommon = commonRates.map(Number)
  const normalizedCustom = customRates.map(Number)
  const allRates = [
    ...normalizedCommon,
    ...normalizedCustom.filter((rate) => !normalizedCommon.includes(rate))
  ]

  const trimmed = query.trim()
  const numericQuery = /^\d+$/.test(trimmed) ? Number(trimmed) : null
  const filtered = trimmed
    ? allRates.filter((rate) => String(rate).includes(trimmed))
    : allRates
  const canCreate =
    numericQuery !== null && numericQuery > 0 && !allRates.includes(numericQuery)

  const choose = (rate) => {
    const next = Number(rate)
    if (!Number.isFinite(next) || next <= 0) return
    onChange(next)
    setOpen(false)
  }

  const submitQuery = () => {
    if (trimmed === '' || numericQuery === null || numericQuery <= 0) return
    choose(numericQuery)
  }

  return (
    <div className="baud-picker" ref={rootRef}>
      <button
        type="button"
        className={`baud-trigger ${open ? 'is-open' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={disabled ? '连接中不可切换波特率' : '选择波特率'}
        onClick={() => {
          if (open) setOpen(false)
          else openPicker()
        }}
      >
        <span>{value || '选择波特率'}</span>
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
                bottom: position.bottom,
                left: position.left,
                width: position.width,
                maxHeight: position.maxHeight
              }}
            >
              <div className="baud-search">
                <Icon name="search" size={13} />
                <input
                  ref={searchRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  value={query}
                  placeholder="搜索或输入波特率"
                  aria-label="搜索或输入波特率"
                  onChange={(event) =>
                    setQuery(event.target.value.replace(/[^0-9]/g, ''))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      submitQuery()
                    }
                    if (event.key === 'Escape') setOpen(false)
                  }}
                />
              </div>

              <div className="baud-list" role="listbox" aria-label="波特率列表">
                {canCreate ? (
                  <button
                    type="button"
                    className="baud-list-create"
                    onClick={() => choose(numericQuery)}
                  >
                    <Icon name="plus" size={12} />
                    <span>使用自定义波特率</span>
                    <strong>{numericQuery}</strong>
                  </button>
                ) : null}

                {filtered.length ? (
                  filtered.map((rate) => {
                    const custom = normalizedCustom.includes(rate)
                    const selected = Number(value) === rate
                    return (
                      <div
                        className={`baud-list-row ${
                          selected ? 'is-selected' : ''
                        }`}
                        key={rate}
                      >
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className="baud-list-item"
                          onClick={() => choose(rate)}
                        >
                          <span className="baud-list-value">{rate}</span>
                          {custom ? (
                            <span className="baud-list-tag">自定义</span>
                          ) : null}
                          {selected ? (
                            <Icon
                              name="check"
                              size={13}
                              className="baud-list-check"
                            />
                          ) : null}
                        </button>
                        {custom ? (
                          <button
                            type="button"
                            className="baud-list-remove"
                            onClick={() => onRemoveCustom?.(rate)}
                            title={`移除自定义波特率 ${rate}`}
                            aria-label={`移除自定义波特率 ${rate}`}
                          >
                            <Icon name="trash" size={12} />
                          </button>
                        ) : null}
                      </div>
                    )
                  })
                ) : canCreate ? null : (
                  <div className="baud-list-empty">没有匹配的波特率</div>
                )}
              </div>

              <div className="baud-popover-foot">
                输入自定义波特率后会自动保存，下次可直接选择。
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
