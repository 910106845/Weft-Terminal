const hexToRgba = (hex, alpha) => {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex || '')
  if (!match) return ''
  const value = parseInt(match[1], 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${
    value & 255
  }, ${alpha})`
}

export default function PageTag({ kind, label, accent }) {
  const border = hexToRgba(accent, 0.24)
  const style =
    accent && border
      ? {
          '--page-tag-color': accent,
          borderColor: border,
          background: hexToRgba(accent, 0.1)
        }
      : undefined
  return (
    <span className={`page-tag is-${kind}`} style={style}>
      {label}
    </span>
  )
}
