'use client';

import SpecularButton from './SpecularButton';

const BASE_STYLE = {
  height: '30px',
  padding: '0 14px',
  gap: '7px',
  borderRadius: '999px',
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.01em'
};

// 顶栏状态胶囊：用官方的玻璃/高光材质，做成不可点击的状态块。
// enabled=false 时（非当前标签页）退化成纯 CSS 胶囊，避免为隐藏页面各建一个 WebGL 上下文。
export default function StatusCapsule({
  active = false,
  enabled = true,
  label,
  meta,
  title,
  dotTone = 'neutral',
  theme = 'dark'
}) {
  const light = theme === 'light';
  const className = `status-capsule ${active ? 'is-on' : ''} ${
    dotTone === 'accent' ? 'is-accent' : ''
  }`;
  const content = (
    <>
      <span className="status-capsule-dot" aria-hidden="true" />
      <span className="status-capsule-label">{label}</span>
      {meta ? <span className="status-capsule-meta">{meta}</span> : null}
    </>
  );

  const surface = light
    ? {
        background: '#ffffff',
        boxShadow: '0 6px 16px -12px rgba(8, 20, 38, 0.42), 0 0 0 1px rgba(17, 35, 61, 0.06)'
      }
    : {
        background: 'var(--capsule-bg, #191a1e)',
        boxShadow: '0 8px 18px -14px rgba(6, 12, 24, 0.65)'
      };

  if (!enabled) {
    return (
      <span
        className={`${className} is-static`}
        role="status"
        title={title}
        style={{ ...BASE_STYLE, ...surface, display: 'inline-flex', alignItems: 'center' }}
      >
        {content}
      </span>
    );
  }

  return (
    <SpecularButton
      as="span"
      size="sm"
      radius={999}
      tint="#ffffff"
      tintOpacity={light ? 0.9 : 0.04}
      textColor={light ? '#1f2a37' : '#f2f4f7'}
      lineColor={light ? '#ffffff' : '#ffffff'}
      baseColor={light ? '#93a3b8' : '#525252'}
      intensity={light ? 0.8 : 0.9}
      idleIntensity={light ? 0.26 : 0.3}
      shineSize={9}
      shineFade={28}
      thickness={1.1}
      glow={light ? 0.5 : 0.8}
      proximity={170}
      role="status"
      className={className}
      title={title}
      style={{ ...BASE_STYLE, ...surface, background: light ? '#ffffff' : surface.background }}
    >
      {content}
    </SpecularButton>
  );
}
