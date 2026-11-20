import GlassButton from './LiquidGlass'

// 顶栏状态胶囊：液态玻璃材质 + 状态灯。
// 已连接时用绿玻璃，未连接时用中性玻璃；作为状态块不可点击。
export default function StatusCapsule({
  active = false,
  label,
  meta,
  title,
  dotTone = 'neutral'
}) {
  return (
    <GlassButton
      as="span"
      size="sm"
      pill
      className={`status-capsule ${active ? 'is-on' : ''} ${
        dotTone === 'accent' ? 'is-accent' : ''
      }`}
      role="status"
      title={title}
    >
      <span className="status-capsule-dot" aria-hidden="true" />
      <span className="status-capsule-label">{label}</span>
      {meta ? <span className="status-capsule-meta">{meta}</span> : null}
    </GlassButton>
  )
}
