'use client';

import MetallicPaint from './MetallicPaint';

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 32 32"><path d="M4 16h5l3-8 5 16 3-8h8" fill="none" stroke="#ffffff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const LOGO_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(LOGO_SVG)}`;

// 品牌图标：用金属漆（Metallic Paint）渲染同一个波形 logo。
// active=false 时退化成静态 SVG，避免每个隐藏标签页各建一个 WebGL 上下文。
export default function BrandMark({ active = true, size = 38 }) {
  return (
    <div
      className="brand-mark is-metallic"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg className="brand-mark-fallback" viewBox="0 0 32 32">
        <path
          d="M4 16h5l3-8 5 16 3-8h8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {active ? (
        <MetallicPaint
          imageSrc={LOGO_URL}
          className="brand-mark-paint"
          scale={0.68}
          density={2.2}
          softness={0.12}
          dispersion={0.26}
          distortion={0.05}
          edgeBend={0.65}
          angle={70}
          speed={1.1}
          mouseTilt={0.4}
          intro
        />
      ) : null}
    </div>
  );
}
