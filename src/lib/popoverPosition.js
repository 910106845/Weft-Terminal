const MARGIN = 12
const GAP = 8
const MIN_HEIGHT = 120

/**
 * 计算弹出层的可用位置，自动选择向上或向下展开，
 * 并限制宽度与高度，避免超出窗口或贴边被遮挡。
 */
export function computePopoverPosition({
  anchorRect,
  preferredWidth = 0,
  minWidth = 0,
  maxWidth = Infinity,
  minSpace = 240,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight
}) {
  const usableWidth = Math.max(160, viewportWidth - MARGIN * 2)
  const width = Math.min(
    Math.max(preferredWidth, minWidth),
    maxWidth,
    usableWidth
  )
  const left = Math.max(
    MARGIN,
    Math.min(anchorRect.left, viewportWidth - width - MARGIN)
  )

  const spaceBelow = viewportHeight - anchorRect.bottom - GAP - MARGIN
  const spaceAbove = anchorRect.top - GAP - MARGIN
  const openUp = spaceBelow < minSpace && spaceAbove > spaceBelow
  const available = Math.max(openUp ? spaceAbove : spaceBelow, MIN_HEIGHT)
  const maxHeight = Math.min(available, viewportHeight - MARGIN * 2)

  return {
    left,
    width,
    maxHeight,
    openUp,
    top: openUp ? undefined : anchorRect.bottom + GAP,
    bottom: openUp ? viewportHeight - anchorRect.top + GAP : undefined
  }
}
