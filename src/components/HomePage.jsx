import { Component, Suspense, lazy, useEffect, useState } from 'react'
import BrandMark from './BrandMark'
import GridScan from './GridScan'
import Icon from './Icons'
import MetallicPaint from './MetallicPaint'
import PageTag from './PageTag'

const Spline = lazy(() => import('@splinetool/react-spline'))

const SCENE_URL =
  'https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode'

const WORDMARK_FONT =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"

const SESSION_ENTRIES = [
  {
    id: 'serial',
    icon: 'plug',
    title: '串口工具',
    tag: 'SERIAL',
    description: '连接本机串口设备，HEX / ASCII 收发与日志记录',
    onSelect: 'onNewSerial'
  },
  {
    id: 'local',
    icon: 'terminal',
    title: '本地终端',
    tag: 'LOCAL',
    description: '打开本机 Shell，执行命令、脚本与构建任务',
    onSelect: 'onNewLocal'
  },
  {
    id: 'ssh',
    icon: 'server',
    title: 'SSH 终端',
    tag: 'SSH',
    description: '连接远程服务器，支持密钥登录与 SFTP 文件管理',
    onSelect: 'onNewSsh'
  },
  {
    id: 'virtual',
    icon: 'bolt',
    title: '虚拟串口',
    tag: 'VIRTUAL',
    description: '创建虚拟串口对，让两个程序通过串口互相通信',
    onSelect: 'onNewVirtual'
  }
]

class SceneBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    // 3D 场景不可用时保留网格背景，不影响首页功能
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

function SceneBackdrop() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (ready) return undefined
    const timer = setTimeout(() => setReady(true), 12000)
    return () => clearTimeout(timer)
  }, [ready])

  return (
    <div
      className={`home-spline ${ready ? 'is-ready' : ''}`}
      aria-hidden="true"
    >
      <SceneBoundary>
        <Suspense fallback={null}>
          <Spline
            scene={SCENE_URL}
            htmlContentMode="none"
            onLoad={(app) => {
              // 让机器人自带动画略微加快；运行时没有公开 speed，mixer 是可用的
              try {
                const mixer = app?._animationControls?.mixer
                if (mixer && Number.isFinite(mixer.timeScale)) {
                  mixer.timeScale = 1.3
                }
              } catch {
                // 场景结构变化时保持原速
              }
              setReady(true)
            }}
          />
        </Suspense>
      </SceneBoundary>
    </div>
  )
}

export default function HomePage({
  tabsCount = 0,
  connectedCount = 0,
  onNewSerial,
  onNewLocal,
  onNewSsh,
  onNewVirtual,
  resolvedTheme,
  onToggleTheme
}) {
  const handlers = {
    onNewSerial,
    onNewLocal,
    onNewSsh,
    onNewVirtual
  }
  const dark = resolvedTheme === 'dark'

  return (
    <div className="app home-page">
      <header className="topbar home-topbar">
        <div className="brand">
          <BrandMark active />
          <div className="brand-text">
            <span className="brand-line">
              <span className="brand-title">Weft Terminal</span>
              <PageTag kind="home" label="首页" accent="#0f9d78" />
            </span>
            <span className="brand-sub">WEAVE EVERY CONNECTION</span>
          </div>
        </div>

        <div className="topbar-actions home-topbar-actions">
          <span className="home-session-count">
            <span
              className={`home-session-dot ${
                connectedCount > 0 ? 'is-on' : ''
              }`}
            />
            {connectedCount > 0
              ? `${connectedCount} 个会话运行中`
              : tabsCount > 0
                ? `${tabsCount} 个标签页`
                : '未打开会话'}
          </span>
          <span className="topbar-sep" aria-hidden="true" />
          <button
            type="button"
            className="topbar-btn is-icon theme-toggle"
            onClick={onToggleTheme}
            title={resolvedTheme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          >
            <Icon name={resolvedTheme === 'dark' ? 'sun' : 'moon'} size={16} />
          </button>
        </div>
      </header>

      <div className="home-stage">
        <section className="home-hero" aria-label="Weft Terminal 首页">
          <div className="home-scan" aria-hidden="true">
            <GridScan
              className="home-gridscan"
              linesColor={dark ? '#30445c' : '#d3dce8'}
              scanColor={dark ? '#5fc8ff' : '#2563eb'}
              cells={10}
              lineThickness={1}
              depth={3}
              depthFade={0.72}
              parallax={0.8}
              reflection={0.28}
              shading={0.65}
              scanDuration={2.6}
              scanDelay={1.1}
              trail={0.5}
              glow={dark ? 0.7 : 0.42}
              autoScan
              interactive
              clickEffect="ping"
              intro
              lightMode={!dark}
              dpr={Math.min(window.devicePixelRatio || 1, 1.75)}
            />
          </div>

          <SceneBackdrop />
          <div className="home-scrim" aria-hidden="true" />

          <span className="home-reg home-reg-tl" aria-hidden="true" />
          <span className="home-reg home-reg-tr" aria-hidden="true" />
          <span className="home-reg home-reg-bl" aria-hidden="true" />
          <span className="home-reg home-reg-br" aria-hidden="true" />

          <div className="home-content">
            <div className="home-masthead">
              <div className="home-wordmark" aria-hidden="true">
                <MetallicPaint
                  text="Weft Terminal"
                  fontFamily={WORDMARK_FONT}
                  fontWeight={800}
                  lightMode={!dark}
                  density={3.2}
                  softness={0.1}
                  dispersion={0.32}
                  distortion={0.045}
                  edgeBend={0.72}
                  angle={70}
                  speed={0.9}
                  scale={0.78}
                  mouseTilt={0.35}
                  intro
                />
              </div>
              <span className="home-tagline">WEAVE EVERY CONNECTION</span>
            </div>

            <span className="home-rule" aria-hidden="true" />

            <div className="home-head">
              <span className="home-eyebrow">
                <span className="home-eyebrow-dot" />
                NEW SESSION
              </span>
              <h1 className="home-title">新建会话</h1>
            </div>

            <div className="home-actions">
              {SESSION_ENTRIES.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`home-action is-${entry.id}`}
                  onClick={handlers[entry.onSelect]}
                >
                  <span className="home-action-icon">
                    <Icon name={entry.icon} size={18} />
                  </span>
                  <span className="home-action-copy">
                    <span className="home-action-top">
                      <span className="home-action-title">{entry.title}</span>
                      <span className="home-action-tag">{entry.tag}</span>
                    </span>
                    <span className="home-action-desc">
                      {entry.description}
                    </span>
                  </span>
                  <span className="home-action-end">
                    <span className="home-action-index">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <Icon name="arrow-right" size={14} />
                  </span>
                </button>
              ))}
            </div>

            <p className="home-foot">
              {tabsCount > 0
                ? '已有标签页，点击上方标签即可继续。'
                : '所有会话已关闭，从上面选择一个入口开始。'}
            </p>
          </div>

          <div className="home-meta" aria-hidden="true">
            <span>SERIAL · LOCAL · SSH · VIRTUAL</span>
            <span className="home-meta-sep" />
            <span>WEFT / HOME</span>
          </div>
        </section>
      </div>
    </div>
  )
}
