import { forwardRef } from 'react'

// 与给定的 LiquidButton / GlassFilter 一致的液态玻璃按钮。
// 结构：玻璃边缘阴影层 + 背景折射层 + 内容层。
export function LiquidGlassFilter() {
  return (
    <svg className="liquid-glass-defs" aria-hidden="true" focusable="false">
      <defs>
        <filter
          id="container-glass"
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.05 0.05"
            numOctaves="1"
            seed="1"
            result="turbulence"
          />
          <feGaussianBlur
            in="turbulence"
            stdDeviation="2"
            result="blurredNoise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="blurredNoise"
            scale="70"
            xChannelSelector="R"
            yChannelSelector="B"
            result="displaced"
          />
          <feGaussianBlur in="displaced" stdDeviation="4" result="finalBlur" />
          <feComposite in="finalBlur" in2="finalBlur" operator="over" />
        </filter>
      </defs>
    </svg>
  )
}

const LiquidGlassButton = forwardRef(function LiquidGlassButton(
  {
    as: Component = 'button',
    size = 'md',
    pill = false,
    className = '',
    children,
    ...props
  },
  ref
) {
  const classes = [
    'liquid-btn',
    `is-${size}`,
    pill ? 'is-pill' : '',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Component ref={ref} className={classes} {...props}>
      <span className="liquid-btn-rim" aria-hidden="true" />
      <span className="liquid-btn-backdrop" aria-hidden="true" />
      <span className="liquid-btn-content">{children}</span>
    </Component>
  )
})

export default LiquidGlassButton
