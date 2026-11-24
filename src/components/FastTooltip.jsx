import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// 全局快速提示：接管带 title 的元素，避免原生 title 约 1 秒的延迟。
// 鼠标进入时先移除 title（阻止原生提示），离开时再还原。
const SHOW_DELAY = 100
const GAP = 8
const SCREEN_MARGIN = 12

export default function FastTooltip () {
  const [tip, setTip] = useState(null)
  const stateRef = useRef({ host: null, title: '', timer: 0 })
  const tipRef = useRef(null)

  // 显示后按实际宽度把气泡收回窗口内，避免贴边时被挤成竖排文字
  useLayoutEffect(() => {
    const el = tipRef.current
    if (!tip || !el) return
    const half = el.offsetWidth / 2
    const minX = half + SCREEN_MARGIN
    const maxX = Math.max(minX, window.innerWidth - half - SCREEN_MARGIN)
    const x = Math.min(Math.max(tip.x, minX), maxX)
    if (x !== tip.x) setTip((prev) => (prev ? { ...prev, x } : prev))
  }, [tip])

  useEffect(() => {
    const hide = () => {
      const state = stateRef.current
      if (state.timer) {
        window.clearTimeout(state.timer)
        state.timer = 0
      }
      if (state.host && state.title && state.host.isConnected) {
        // 只在 React 没有重新写入 title 时还原，避免覆盖更新的值
        if (!state.host.hasAttribute('title')) {
          state.host.setAttribute('title', state.title)
        }
      }
      state.host = null
      state.title = ''
      setTip(null)
    }

    const show = (host, text) => {
      if (!host.isConnected) return
      const rect = host.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      const below = rect.bottom + 52 < window.innerHeight
      const x = Math.min(
        Math.max(rect.left + rect.width / 2, SCREEN_MARGIN),
        window.innerWidth - SCREEN_MARGIN
      )
      setTip({
        text,
        x,
        y: below ? rect.bottom + GAP : rect.top - GAP,
        placement: below ? 'bottom' : 'top'
      })
    }

    const onPointerOver = (event) => {
      const node = event.target
      if (!(node instanceof Element)) return
      const host = node.closest('[title], [data-fast-tooltip]')
      if (!host) return
      // 已经有自定义提示（如更新按钮）的元素交给它们自己处理
      if (host.closest('[data-tooltip]')) return
      if (stateRef.current.host === host) return
      const text = (
        host.getAttribute('data-fast-tooltip') ||
        host.getAttribute('title') ||
        ''
      ).trim()
      if (!text) return

      hide()
      stateRef.current.host = host
      stateRef.current.title = host.getAttribute('title') || ''
      if (stateRef.current.title) host.removeAttribute('title')
      stateRef.current.timer = window.setTimeout(() => {
        stateRef.current.timer = 0
        if (!host.isConnected) return
        show(host, text)
      }, SHOW_DELAY)
    }

    const onPointerOut = (event) => {
      const host = stateRef.current.host
      if (!host) return
      const related = event.relatedTarget
      if (related instanceof Node && host.contains(related)) return
      hide()
    }

    const onFocusIn = (event) => {
      const node = event.target
      if (!(node instanceof Element)) return
      const host = node.closest('[title], [data-fast-tooltip]')
      if (!host || host.closest('[data-tooltip]')) return
      if (stateRef.current.host === host) return
      const text = (
        host.getAttribute('data-fast-tooltip') ||
        host.getAttribute('title') ||
        ''
      ).trim()
      if (!text) return
      if (!host.matches(':focus-visible')) return
      hide()
      stateRef.current.host = host
      stateRef.current.title = host.getAttribute('title') || ''
      if (stateRef.current.title) host.removeAttribute('title')
      show(host, text)
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') hide()
    }

    document.addEventListener('pointerover', onPointerOver, true)
    document.addEventListener('pointerout', onPointerOut, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      hide()
      document.removeEventListener('pointerover', onPointerOver, true)
      document.removeEventListener('pointerout', onPointerOut, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  if (!tip) return null
  return (
    <div
      ref={tipRef}
      className={`fast-tooltip is-${tip.placement}`}
      style={{ left: `${tip.x}px`, top: `${tip.y}px` }}
      role="tooltip"
    >
      {tip.text}
    </div>
  )
}
