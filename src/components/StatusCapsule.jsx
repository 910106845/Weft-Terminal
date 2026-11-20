// 顶栏状态胶囊：常规扁平胶囊 + 状态灯。
// 已连接时用浅薄荷底，未连接时用中性表面；作为状态块不可点击。
export default function StatusCapsule({
  active = false,
  label,
  meta,
  title,
  dotTone = 'neutral'
}) {
  return (
    <span
      className={`status-capsule ${active ? 'is-on' : ''} ${
        dotTone === 'accent' ? 'is-accent' : ''
      }`}
      role="status"
      title={title}
    >
      <span className="status-capsule-dot" aria-hidden="true" />
      <span className="status-capsule-label">{label}</span>
      {meta ? <span className="status-capsule-meta">{meta}</span> : null}
    </span>
  )
}
