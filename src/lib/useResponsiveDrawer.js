import { useCallback, useLayoutEffect, useRef, useState } from 'react'

// 分屏时按窗格宽度自动收起侧栏：窄了收进左侧抽屉，宽了不自动弹出。
// 用户手动展开后保持展开，除非窗格再次变窄触发自动收起。
export default function useResponsiveDrawer({
  ref,
  enabled,
  threshold,
  collapsed,
  setCollapsed
}) {
  const [drawerMode, setDrawerMode] = useState(false)
  const collapsedRef = useRef(collapsed)
  const prevNarrowRef = useRef(null)
  collapsedRef.current = collapsed

  useLayoutEffect(() => {
    if (!enabled) {
      prevNarrowRef.current = null
      setDrawerMode(false)
      return undefined
    }
    const element = ref.current
    if (!element) return undefined
    const apply = () => {
      const width = element.clientWidth
      if (!width) return
      const narrow = width < threshold
      setDrawerMode(narrow)
      if (prevNarrowRef.current === narrow) return
      prevNarrowRef.current = narrow
      if (narrow) {
        if (!collapsedRef.current) setCollapsed(true)
      }
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(element)
    return () => observer.disconnect()
  }, [enabled, threshold, ref, setCollapsed])

  const toggle = useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [setCollapsed])

  return { drawerMode, toggle }
}
