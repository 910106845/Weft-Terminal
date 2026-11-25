import { useEffect, useState } from 'react'

// 特效级别：
// - full：完整效果（macOS 默认）
// - lite：关闭 WebGL 流体光标、背景模糊、持续金属漆动画（Windows 默认）
// - minimal：在 lite 基础上再关闭首页 3D 机器人场景
export const EFFECT_LEVELS = [
  { id: 'full', label: '完整效果', desc: '全部动画与毛玻璃' },
  { id: 'lite', label: '低特效', desc: '关闭流体光标与模糊' },
  { id: 'minimal', label: '极致性能', desc: '再关闭首页 3D 场景' }
]

const STORAGE_KEY = 'serialdebug.effects'
const VALID = new Set(EFFECT_LEVELS.map((item) => item.id))
const IS_WINDOWS =
  typeof window !== 'undefined' && window.terminalAPI?.platform === 'win32'

function readLevel () {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (VALID.has(saved)) return saved
  } catch {
    // 忽略隐私模式下读取失败
  }
  return IS_WINDOWS ? 'lite' : 'full'
}

let currentLevel = readLevel()
const listeners = new Set()

function applyAttribute () {
  try {
    document.documentElement.dataset.effects = currentLevel
  } catch {
    // 忽略
  }
}

applyAttribute()

export function getEffectsLevel () {
  return currentLevel
}

export function setEffectsLevel (level) {
  if (!VALID.has(level) || level === currentLevel) return
  currentLevel = level
  try {
    window.localStorage.setItem(STORAGE_KEY, level)
  } catch {
    // 忽略写入失败，本次运行仍然生效
  }
  applyAttribute()
  listeners.forEach((listener) => listener(currentLevel))
}

export function isLiteLevel (level) {
  return level === 'lite' || level === 'minimal'
}

export function isMinimalLevel (level) {
  return level === 'minimal'
}

// 订阅当前级别，切换后相关组件会立即重渲染，无需重启
export function useEffectsLevel () {
  const [level, setLevel] = useState(currentLevel)
  useEffect(() => {
    listeners.add(setLevel)
    return () => listeners.delete(setLevel)
  }, [])
  return level
}
