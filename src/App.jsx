import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import HomePage from './components/HomePage'
import { LiquidGlassFilter } from './components/LiquidGlass'
import SessionPage from './components/SessionPage'
import TerminalPage from './components/TerminalPage'
import VirtualPortPage from './components/VirtualPortPage'
import WindowsVirtualPage from './components/WindowsVirtualPage'
import SessionFolders from './components/SessionFolders'
import SshConnectDialog from './components/SshConnectDialog'
import Modal from './components/Modal'
import FastTooltip from './components/FastTooltip'
import Icon from './components/Icons'
import { normalizeFavorites } from './lib/favorites'
import { normalizeTerminalCommands } from './lib/terminalCommands'
import { normalizeSshProfiles, sshProfileLabel } from './lib/sshProfiles'
import {
  DEFAULT_TERMINAL_DISPLAY,
  normalizeTerminalDisplay
} from './lib/terminalDisplay'
import { loadJSON, loadString, saveJSON, saveString } from './lib/format'
import { useSharedJSON, useSharedString } from './hooks/useSharedState'

const TABS_PREFIX = 'serialdebug.tabs.'
const ACTIVE_PREFIX = 'serialdebug.tabs.active.'
const FOLDERS_PREFIX = 'serialdebug.folders.'
const WORKSPACE_TABS_KEY = 'serialdebug.workspace.tabs'
const WORKSPACE_FOLDERS_KEY = 'serialdebug.workspace.folders'
const WORKSPACE_ALL_COLLAPSED_KEY = 'serialdebug.workspace.allCollapsed'
const WORKSPACE_FOLDERS_INIT_KEY = 'serialdebug.workspace.folders-collapsed-init'
const WINDOW_VIEW_PREFIX = 'serialdebug.window.'

const MAX_SPLIT_PANES = 4
const MIN_SPLIT_PANE_WIDTH = 520
const MIN_SPLIT_PANE_HEIGHT = 300

const SPLIT_LAYOUT_OPTIONS = [
  { id: 'row', label: '左右 2 格', count: 2 },
  { id: 'column', label: '上下 2 格', count: 2 },
  { id: 'top1', label: '上 1 下 2', count: 3 },
  { id: 'top2', label: '上 2 下 1', count: 3 },
  { id: 'grid', label: '四宫格', count: 4 }
]

const windowId =
  new URLSearchParams(window.location.search).get('win') || 'main'
const tabsKey = `${TABS_PREFIX}${windowId}`
const activeKey = `${ACTIVE_PREFIX}${windowId}`
const foldersKey = `${FOLDERS_PREFIX}${windowId}`

function createTabId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID()
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function createFolderId() {
  if (window.crypto?.randomUUID) return `folder-${window.crypto.randomUUID()}`
  return `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeFolders(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      id:
        typeof item.id === 'string' && item.id ? item.id : createFolderId(),
      name:
        typeof item.name === 'string' && item.name.trim()
          ? item.name.trim()
          : `文件夹 ${index + 1}`,
      collapsed: item.collapsed !== false
    }))
    .filter((folder) => {
      if (seen.has(folder.id)) return false
      seen.add(folder.id)
      return true
    })
}

function clearTabData(tabId) {
  try {
    localStorage.removeItem(`serialdebug.settings.${tabId}`)
    localStorage.removeItem(`serialdebug.ui.${tabId}`)
    localStorage.removeItem(`serialdebug.terminal.${tabId}`)
    localStorage.removeItem(`serialdebug.virtual.ports.${tabId}`)
    localStorage.removeItem(`serialdebug.virtual.rules.${tabId}`)
  } catch {
    // localStorage 不可用时忽略
  }
}

function normalizeBauds(value) {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((rate) => Number(rate))
        .filter((rate) => Number.isFinite(rate) && rate > 0)
    )
  ).sort((a, b) => a - b)
}

const TAB_COLOR_SCHEMES = [
  { id: 'default', label: '默认', swatch: '#8d9aab', swatchDark: '#8a8a8f' },
  { id: 'ocean', label: '海蓝', swatch: '#2563eb', swatchDark: '#60a5fa' },
  { id: 'forest', label: '森绿', swatch: '#0f9d78', swatchDark: '#34d399' },
  { id: 'amber', label: '琥珀', swatch: '#b7791f', swatchDark: '#e0a84a' },
  { id: 'rose', label: '玫红', swatch: '#d1436b', swatchDark: '#fb7185' },
  { id: 'violet', label: '紫罗兰', swatch: '#7c3aed', swatchDark: '#a78bfa' },
  { id: 'slate', label: '石墨', swatch: '#64748b', swatchDark: '#94a3b8' }
]

const TAB_SCHEME_IDS = new Set(TAB_COLOR_SCHEMES.map((item) => item.id))

function normalizeTabColor(value) {
  const color = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : ''
}

function normalizeTabScheme(value) {
  return TAB_SCHEME_IDS.has(value) ? value : 'default'
}

function tabContrastVars(value) {
  const match = /^#([0-9a-fA-F]{6})$/.exec(String(value || ''))
  if (!match) return {}
  const number = Number.parseInt(match[1], 16)
  const red = (number >> 16) & 255
  const green = (number >> 8) & 255
  const blue = number & 255
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255
  return luminance > 0.58
    ? {
        '--tab-fg': '#182230',
        '--tab-soft': 'rgba(17, 35, 61, 0.08)'
      }
    : {
        '--tab-fg': '#f7fbff',
        '--tab-soft': 'rgba(255, 255, 255, 0.16)'
      }
}

function hexToRgba(hex, alpha) {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex || '')
  if (!match) return ''
  const value = parseInt(match[1], 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${
    value & 255
  }, ${alpha})`
}

function tabCardStyle(tab) {
  const style = {}
  if (tab?.tabBackground) {
    style['--tab-bg'] = tab.tabBackground
    Object.assign(style, tabContrastVars(tab.tabBackground))
  }
  if (tab?.tabAccent) {
    style['--tab-accent'] = tab.tabAccent
    if (!tab.tabBackground) {
      style['--tab-soft'] = hexToRgba(tab.tabAccent, 0.12)
    }
  }
  return style
}

function tabSchemeClass(tab) {
  return tab?.tabColorScheme && tab.tabColorScheme !== 'default'
    ? `tab-scheme-${tab.tabColorScheme}`
    : ''
}


const TAB_SCHEME_ACCENTS = {
  ocean: '#2563eb',
  forest: '#0f9d78',
  amber: '#b7791f',
  rose: '#d1436b',
  violet: '#7c3aed',
  slate: '#64748b'
}

// 当前卡片配色：自定义强调色 > 配色方案 > 按类型默认色
export function tabTagAccent(tab) {
  if (!tab) return ''
  if (tab.tabAccent) return tab.tabAccent
  if (
    tab.tabColorScheme !== 'default' &&
    TAB_SCHEME_ACCENTS[tab.tabColorScheme]
  ) {
    return TAB_SCHEME_ACCENTS[tab.tabColorScheme]
  }
  return ''
}

const TAB_SCHEME_DARK_ACCENTS = {
  ocean: '#60a5fa',
  forest: '#34d399',
  amber: '#e0a84a',
  rose: '#fb7185',
  violet: '#a78bfa',
  slate: '#94a3b8'
}

// 主题模式：跟随系统 / 浅色 / 深色，循环切换
const THEME_MODE_LABEL = { light: '浅色', dark: '深色', system: '跟随系统' }
const THEME_MODES = ['system', 'light', 'dark']

function nextThemeMode(mode) {
  const index = THEME_MODES.indexOf(mode)
  return THEME_MODES[(index + 1) % THEME_MODES.length]
}

function themeIconName(mode) {
  if (mode === 'light') return 'sun'
  if (mode === 'dark') return 'moon'
  return 'monitor'
}

// 状态胶囊跟随标签左侧强调色（含深浅主题差异）
function tabStatusAccent(tab, theme) {
  const dark = theme === 'dark'
  if (!tab) return dark ? '#4d9bff' : '#2563eb'
  if (tab.tabAccent) return tab.tabAccent
  const scheme = tab.tabColorScheme
  if (scheme && TAB_SCHEME_DARK_ACCENTS[scheme]) {
    return dark ? TAB_SCHEME_DARK_ACCENTS[scheme] : TAB_SCHEME_ACCENTS[scheme]
  }
  if (tab.kind === 'virtual') return dark ? '#a78bfa' : '#7c3aed'
  if (tab.kind === 'serial') return dark ? '#4d9bff' : '#2563eb'
  if (tab.terminalType === 'ssh') return dark ? '#c0c0c3' : '#2f343c'
  return dark ? '#34d399' : '#0f9d78'
}

export function tabAccentOf(tab) {
  if (!tab) return '#2563eb'
  if (tab.tabAccent) return tab.tabAccent
  if (TAB_SCHEME_ACCENTS[tab.tabColorScheme]) {
    return TAB_SCHEME_ACCENTS[tab.tabColorScheme]
  }
  if (tab.kind === 'virtual') return '#7c3aed'
  if (tab.kind === 'serial') return '#2563eb'
  return tab.terminalType === 'ssh' ? '#3a3f47' : '#0f9d78'
}


function groupTabs(tabs) {
  const groups = [
    { id: 'serial', label: '串口工具', items: [] },
    { id: 'local', label: '本地终端', items: [] },
    { id: 'ssh', label: 'SSH 终端', items: [] },
    { id: 'virtual', label: '虚拟串口', items: [] }
  ]
  const map = new Map(groups.map((group) => [group.id, group]))
  tabs.forEach((tab, index) => {
    const key =
      tab.kind === 'virtual'
        ? 'virtual'
        : tab.kind === 'serial'
          ? 'serial'
          : tab.terminalType === 'ssh'
            ? 'ssh'
            : 'local'
    map.get(key).items.push({ tab, index })
  })
  return groups.filter((group) => group.items.length)
}

function tabKindClass(tab) {
  if (tab?.kind === 'virtual') return 'is-virtual'
  if (tab?.kind === 'serial') return 'is-serial'
  return tab?.terminalType === 'ssh' ? 'is-ssh' : 'is-local'
}

function tabKindTag(tab) {
  if (tab?.kind === 'virtual') return 'VIRTUAL'
  if (tab?.kind === 'serial') return 'SERIAL'
  return tab?.terminalType === 'ssh' ? 'SSH' : 'LOCAL'
}

function tabKindIcon(tab) {
  if (tab?.kind === 'virtual') return 'bolt'
  if (tab?.kind === 'serial') return 'plug'
  return tab?.terminalType === 'ssh' ? 'server' : 'terminal'
}

function tabTitle(tab, index) {
  if (tab.customName) return tab.customName
  if (tab.kind === 'virtual') {
    return tab.fallbackTitle || '虚拟串口'
  }
  if (tab.kind === 'terminal') {
    if (tab.terminalType === 'ssh') {
      return tab.fallbackTitle || sshProfileLabel(tab.sshProfile)
    }
    return tab.fallbackTitle || `本地终端 ${index + 1}`
  }
  if (tab.portPath) {
    const base = tab.portPath.split(/[\\/]/).pop() || tab.portPath
    return base.replace(/^tty\./, '').replace(/^cu\./, '')
  }
  return tab.fallbackTitle || `串口工具 ${index + 1}`
}

function createTab(kind, index, overrides = {}) {
  const tabKind =
    kind === 'virtual' ? 'virtual' : kind === 'terminal' ? 'terminal' : 'serial'
  return {
    id: createTabId(),
    kind: tabKind,
    terminalType: 'local',
    shellId: '',
    sshProfile: null,
    sshRevision: 0,
    portPath: '',
    connected: false,
    batchRunning: false,
    fallbackTitle:
      tabKind === 'virtual'
        ? `虚拟串口 ${index}`
        : tabKind === 'terminal'
          ? `本地终端 ${index}`
          : `串口工具 ${index}`,
    customName: '',
    tabColorScheme: 'default',
    tabBackground: '',
    tabAccent: '',
    folderId: '',
    ownerWindowId: '',
    migrateLegacy: false,
    ...overrides
  }
}

function normalizeWorkspaceTabs(value) {
  if (!Array.isArray(value)) return []
  const counts = { serial: 0, terminal: 0, virtual: 0 }
  const seen = new Set()
  const tabs = []
  value.forEach((item) => {
    if (!item || typeof item !== 'object') return
    const id =
      typeof item.id === 'string' && item.id ? item.id : createTabId()
    if (seen.has(id)) return
    seen.add(id)
    const kind =
      item.kind === 'terminal'
        ? 'terminal'
        : item.kind === 'virtual'
          ? 'virtual'
          : 'serial'
    counts[kind] += 1
    const overrides = {
      id,
      portPath: typeof item.portPath === 'string' ? item.portPath : '',
      terminalType: item.terminalType === 'ssh' ? 'ssh' : 'local',
      shellId: typeof item.shellId === 'string' ? item.shellId : '',
      sshProfile: item.sshProfile || null,
      sshRevision: Number.isInteger(item.sshRevision) ? item.sshRevision : 0,
      customName: typeof item.customName === 'string' ? item.customName : '',
      tabColorScheme: normalizeTabScheme(item.tabColorScheme),
      tabBackground: normalizeTabColor(item.tabBackground),
      tabAccent: normalizeTabColor(item.tabAccent),
      folderId: typeof item.folderId === 'string' ? item.folderId : '',
      ownerWindowId:
        typeof item.ownerWindowId === 'string' ? item.ownerWindowId : '',
      connected: Boolean(item.connected),
      batchRunning: Boolean(item.batchRunning),
      migrateLegacy: Boolean(item.migrateLegacy)
    }
    if (typeof item.fallbackTitle === 'string' && item.fallbackTitle) {
      overrides.fallbackTitle =
        item.terminalType !== 'ssh' && /^终端\s+\d+$/.test(item.fallbackTitle)
          ? item.fallbackTitle.replace(/^终端/, '本地终端')
          : item.fallbackTitle
    } else if (item.terminalType === 'ssh') {
      overrides.fallbackTitle = ''
    }
    tabs.push(createTab(kind, counts[kind], overrides))
  })
  return tabs
}

function migrateWorkspace() {
  try {
    if (localStorage.getItem(WORKSPACE_TABS_KEY) !== null) return
    const tabKeys = []
    const folderKeys = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key) continue
      if (key.startsWith(TABS_PREFIX) && !key.startsWith(ACTIVE_PREFIX)) {
        tabKeys.push(key)
      } else if (
        key.startsWith(FOLDERS_PREFIX) &&
        !key.startsWith('serialdebug.folders.all.') &&
        !key.includes('collapsed-init')
      ) {
        folderKeys.push(key)
      }
    }
    const mainTabsKey = `${TABS_PREFIX}main`
    const mainFoldersKey = `${FOLDERS_PREFIX}main`
    tabKeys.sort((a, b) =>
      a === mainTabsKey ? -1 : b === mainTabsKey ? 1 : 0
    )
    folderKeys.sort((a, b) =>
      a === mainFoldersKey ? -1 : b === mainFoldersKey ? 1 : 0
    )
    const legacyTabs = []
    const legacyFolders = []
    tabKeys.forEach((key) => {
      const value = loadJSON(key, null)
      if (Array.isArray(value)) legacyTabs.push(...value)
    })
    folderKeys.forEach((key) => {
      const value = loadJSON(key, null)
      if (Array.isArray(value)) legacyFolders.push(...value)
    })
    const tabs = normalizeWorkspaceTabs(legacyTabs)
    const activeMain = loadString(`${ACTIVE_PREFIX}main`, '')
    tabs.forEach((tab) => {
      tab.ownerWindowId = tab.id === activeMain ? 'main' : ''
      if (
        tab.kind === 'serial' &&
        tab.id === 'main' &&
        !loadJSON('serialdebug.settings.main', null)
      ) {
        tab.migrateLegacy = true
      }
    })
    saveJSON(WORKSPACE_TABS_KEY, tabs)
    saveJSON(WORKSPACE_FOLDERS_KEY, normalizeFolders(legacyFolders))
    if (!loadJSON(`${WINDOW_VIEW_PREFIX}main`, null)) {
      saveJSON(`${WINDOW_VIEW_PREFIX}main`, {
        panes: tabs.some((tab) => tab.id === activeMain) ? [activeMain] : [],
        layout: 'single',
        focusedPane: 0,
        ratio: 0.5,
        ratio2: 0.5,
        ratio3: 0.5
      })
    }
    if (localStorage.getItem(WORKSPACE_ALL_COLLAPSED_KEY) == null) {
      localStorage.setItem(
        WORKSPACE_ALL_COLLAPSED_KEY,
        localStorage.getItem('serialdebug.folders.all.main') || '1'
      )
    }
  } catch {
    // localStorage 不可用时交给正常运行时的空状态
  }
}

function layoutPaneCount(layout) {
  if (layout === 'row' || layout === 'column') return 2
  if (layout === 'top1' || layout === 'top2') return 3
  if (layout === 'grid') return 4
  return 1
}

function normalizeLayout(layout, count) {
  if (count <= 1) return 'single'
  if (count === 2) return layout === 'column' ? 'column' : 'row'
  if (count === 3) return layout === 'top2' ? 'top2' : 'top1'
  return 'grid'
}

function uniquePaneIds(ids) {
  const out = []
  for (const id of ids) {
    if (typeof id !== 'string' || !id) continue
    if (!out.includes(id)) out.push(id)
  }
  return out.slice(0, MAX_SPLIT_PANES)
}

function normalizeWindowView(value) {
  const view = value && typeof value === 'object' ? value : {}
  const legacyPanes = [
    typeof view.primaryTabId === 'string' ? view.primaryTabId : '',
    typeof view.secondaryTabId === 'string' ? view.secondaryTabId : ''
  ]
  const panes = uniquePaneIds(
    Array.isArray(view.panes) ? view.panes : legacyPanes
  )
  let layout =
    typeof view.layout === 'string'
      ? view.layout
      : panes.length > 1
        ? view.direction === 'column'
          ? 'column'
          : 'row'
        : 'single'
  layout = normalizeLayout(layout, panes.length)
  let focusedPane = Number.isInteger(view.focusedPane)
    ? view.focusedPane
    : view.focusedPane === 'secondary'
      ? 1
      : 0
  focusedPane = Math.max(
    0,
    Math.min(focusedPane, Math.max(0, panes.length - 1))
  )
  const ratio =
    Number.isFinite(Number(view.ratio)) &&
    Number(view.ratio) >= 0.2 &&
    Number(view.ratio) <= 0.8
      ? Number(view.ratio)
      : 0.5
  const ratio2 =
    Number.isFinite(Number(view.ratio2)) &&
    Number(view.ratio2) >= 0.2 &&
    Number(view.ratio2) <= 0.8
      ? Number(view.ratio2)
      : 0.5
  const ratio3 =
    Number.isFinite(Number(view.ratio3)) &&
    Number(view.ratio3) >= 0.2 &&
    Number(view.ratio3) <= 0.8
      ? Number(view.ratio3)
      : 0.5
  return { panes, layout, focusedPane, ratio, ratio2, ratio3 }
}

function clampSplitRatio(ratio, direction, width, height) {
  const size = direction === 'column' ? height : width
  const minPane =
    direction === 'column' ? MIN_SPLIT_PANE_HEIGHT : MIN_SPLIT_PANE_WIDTH
  if (!Number.isFinite(size) || size <= 0) return 0.5
  const min = minPane / size
  if (min >= 0.5) return 0.5
  return Math.min(1 - min, Math.max(min, ratio))
}

function removeTabsFromView(view, removedIds, fallbackId = '') {
  const focusedId = view.panes[view.focusedPane]
  const panes = view.panes.filter((id) => !removedIds.has(id))
  if (!panes.length && fallbackId) panes.push(fallbackId)
  const count = panes.length
  let layout = view.layout
  if (count <= 1) {
    layout = 'single'
  } else if (count === 2) {
    layout = view.panes.length === 2 ? view.layout : 'row'
  } else if (count === 3) {
    if (view.layout === 'grid') {
      const removedTop =
        removedIds.has(view.panes[0]) || removedIds.has(view.panes[1])
      layout = removedTop ? 'top1' : 'top2'
    } else {
      layout = normalizeLayout(view.layout, 3)
    }
  } else {
    layout = 'grid'
  }
  layout = normalizeLayout(layout, count)
  let focusedPane =
    focusedId && !removedIds.has(focusedId) ? panes.indexOf(focusedId) : -1
  if (focusedPane < 0) {
    focusedPane = Math.min(view.focusedPane, Math.max(0, count - 1))
  }
  focusedPane = Math.max(
    0,
    Math.min(focusedPane, Math.max(0, count - 1))
  )
  return { ...view, panes, layout, focusedPane }
}

function paneIndexAt(view, x, y) {
  const { layout, ratio, ratio2 = 0.5, ratio3 = 0.5 } = view
  if (layout === 'row') return x < ratio ? 0 : 1
  if (layout === 'column') return y < ratio ? 0 : 1
  if (layout === 'top1') {
    if (y < ratio) return 0
    return x < ratio2 ? 1 : 2
  }
  if (layout === 'top2') {
    if (y >= ratio) return 2
    return x < ratio2 ? 0 : 1
  }
  if (layout === 'grid') {
    if (y < ratio) return x < ratio2 ? 0 : 1
    return x < ratio3 ? 2 : 3
  }
  return 0
}

function replacePaneTab(panes, index, tabId) {
  const existing = panes.indexOf(tabId)
  if (existing === index) return { panes, focusedPane: index }
  if (existing >= 0) {
    const next = panes.slice()
    const current = next[index]
    next[index] = tabId
    next[existing] = current
    return { panes: next, focusedPane: index }
  }
  const next = panes.slice()
  next[index] = tabId
  return { panes: next, focusedPane: index }
}

function loadWindowView(windowId) {
  const saved = loadJSON(`${WINDOW_VIEW_PREFIX}${windowId}`, null)
  if (saved) return normalizeWindowView(saved)
  const legacyActive = loadString(`${ACTIVE_PREFIX}${windowId}`, '')
  return normalizeWindowView({
    panes: windowId === 'main' && legacyActive ? [legacyActive] : [],
    layout: 'single',
    focusedPane: 0,
    ratio: 0.5,
    ratio2: 0.5,
    ratio3: 0.5
  })
}

function formatUpdateSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`
  if (value >= 1024) return `${Math.round(value / 1024)} KB`
  return `${Math.round(value)} B`
}

function formatUpdateDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN')
}

migrateWorkspace()

export default function App() {
  const [favorites, setFavorites] = useSharedJSON(
    'serialdebug.favorites',
    [],
    normalizeFavorites
  )
  const [history, setHistory] = useSharedJSON('serialdebug.history', [])
  const [customBauds, setCustomBauds] = useSharedJSON(
    'serialdebug.bauds',
    [],
    normalizeBauds
  )
  const [localTerminalCommands, setLocalTerminalCommands] = useSharedJSON(
    'serialdebug.terminal.commands',
    [],
    normalizeTerminalCommands
  )
  const [sshTerminalCommands, setSshTerminalCommands] = useSharedJSON(
    'serialdebug.ssh.commands',
    [],
    normalizeTerminalCommands
  )
  const [terminalDisplay, setTerminalDisplay] = useSharedJSON(
    'serialdebug.terminal.display',
    DEFAULT_TERMINAL_DISPLAY,
    normalizeTerminalDisplay
  )
  const [sshProfiles, setSshProfiles] = useSharedJSON(
    'serialdebug.ssh.profiles',
    [],
    normalizeSshProfiles
  )
  const [themePref, setThemePref] = useSharedString('serialdebug.theme', 'system')
  // 首帧就按偏好/系统算出实际主题，避免深色环境下先闪一下浅色
  const [resolvedTheme, setResolvedTheme] = useState(() => {
    if (themePref === 'system') {
      return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches
        ? 'dark'
        : 'light'
    }
    return themePref === 'light' ? 'light' : 'dark'
  })

  const [tabs, setTabs] = useSharedJSON(
    WORKSPACE_TABS_KEY,
    [],
    normalizeWorkspaceTabs
  )
  const [folders, setFolders] = useSharedJSON(
    WORKSPACE_FOLDERS_KEY,
    [],
    normalizeFolders
  )
  const [view, setView] = useState(() => loadWindowView(windowId))
  const [homeOpen, setHomeOpen] = useState(() => !view.panes.length)
  const activeTabId = view.panes[view.focusedPane] || view.panes[0] || ''
  const [windowInfo, setWindowInfo] = useState(() => ({
    count: windowId === 'main' ? 1 : 2,
    ids: Array.from(new Set(['main', windowId]))
  }))
  const windowCount = windowInfo.count
  const [allFolderCollapsed, setAllFolderCollapsed] = useSharedString(
    WORKSPACE_ALL_COLLAPSED_KEY,
    '1'
  )
  const [openedTabIds, setOpenedTabIds] = useState([])
  const [closeAllOpen, setCloseAllOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [tabListOpen, setTabListOpen] = useState(false)
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const layoutMenuRef = useRef(null)
  const [folderPanelOpen, setFolderPanelOpen] = useState(false)
  const [folderDeleteTarget, setFolderDeleteTarget] = useState(null)
  const [addMenuAlign, setAddMenuAlign] = useState('left')
  const [renameTabId, setRenameTabId] = useState(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [tabStyleDraft, setTabStyleDraft] = useState({
    scheme: 'default',
    background: '',
    accent: ''
  })
  const [dragTabId, setDragTabId] = useState(null)
  const [splitPreview, setSplitPreview] = useState(null)
  const [sshCredentials, setSshCredentials] = useState({})
  const [sshDialog, setSshDialog] = useState(null)
  const [tabMenu, setTabMenu] = useState(null)
  const [updateInfo, setUpdateInfo] = useState(null)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updateStatus, setUpdateStatus] = useState('idle')
  const [updateProgress, setUpdateProgress] = useState(null)
  const [updateError, setUpdateError] = useState('')
  const [updateFile, setUpdateFile] = useState('')
  const updateDownloadingRef = useRef(false)
  const [appToast, setAppToast] = useState(null)
  const tabCardsRef = useRef(null)
  const tabPositionsRef = useRef(new Map())
  const dragTabIdRef = useRef(null)
  const appToastTimerRef = useRef(null)
  const addMenuWrapRef = useRef(null)
  const tabListWrapRef = useRef(null)
  const folderBtnRef = useRef(null)
  const splitRef = useRef(null)
  const themeTransitionRef = useRef(false)

  dragTabIdRef.current = dragTabId

  const showAppToast = useCallback((message, kind = 'success') => {
    setAppToast({ message, kind })
    if (appToastTimerRef.current) clearTimeout(appToastTimerRef.current)
    appToastTimerRef.current = setTimeout(() => setAppToast(null), 2400)
  }, [])

  useEffect(() => {
    return () => {
      if (appToastTimerRef.current) clearTimeout(appToastTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const off = window.updateAPI?.onProgress?.((payload) => {
      if (payload) setUpdateProgress(payload)
    })
    return () => {
      off?.()
    }
  }, [])

  const beginUpdateDownload = useCallback(
    async (info) => {
      if (
        !info?.available ||
        !info.asset ||
        updateDownloadingRef.current
      ) {
        return
      }
      updateDownloadingRef.current = true
      setUpdateInfo(info)
      setUpdateStatus('downloading')
      setUpdateError('')
      setUpdateProgress({
        percent: 0,
        received: 0,
        total: info.asset.size || 0,
        fileName: info.asset.name || ''
      })
      try {
        const result = await window.updateAPI.download()
        if (!result?.ok) {
          if (result?.canceled) {
            setUpdateStatus('idle')
            setUpdateProgress(null)
          } else {
            setUpdateStatus('error')
            setUpdateError(result?.error || '下载失败')
          }
          return
        }
        setUpdateFile(result.filePath || '')
        setUpdateProgress((prev) => ({
          ...(prev || {}),
          percent: 100,
          done: true
        }))
        setUpdateStatus('downloaded')
        showAppToast(`新版本 v${info.latestVersion} 已下载，点击右上角更新`)
      } catch (error) {
        setUpdateStatus('error')
        setUpdateError(error?.message || '下载失败')
      } finally {
        updateDownloadingRef.current = false
      }
    },
    [showAppToast]
  )

  const runUpdateCheck = useCallback(
    async (silent = false) => {
      if (!window.updateAPI?.check) return
      setUpdateStatus('checking')
      setUpdateError('')
      try {
        const result = await window.updateAPI.check(true)
        if (!result?.ok) {
          setUpdateStatus('idle')
          if (!silent) {
            showAppToast(result?.error || '检查更新失败', 'error')
          }
          return
        }
        setUpdateInfo(result)
        if (result.available) {
          if (result.asset) {
            void beginUpdateDownload(result)
          } else {
            setUpdateStatus('idle')
            setUpdateOpen(true)
          }
        } else {
          setUpdateStatus('idle')
          if (!silent) {
            showAppToast(`当前已是最新版本 v${result.currentVersion}`)
          }
        }
      } catch (error) {
        setUpdateStatus('idle')
        if (!silent) {
          showAppToast(error?.message || '检查更新失败', 'error')
        }
      }
    },
    [beginUpdateDownload, showAppToast]
  )

  const handleUpdateClick = useCallback(() => {
    if (
      updateStatus === 'checking' ||
      updateStatus === 'downloading' ||
      updateStatus === 'installing'
    ) {
      return
    }
    if (updateStatus === 'downloaded') {
      void installUpdate()
      return
    }
    if (updateInfo?.available) {
      if (updateInfo.asset) {
        void beginUpdateDownload(updateInfo)
      } else {
        setUpdateOpen(true)
      }
      return
    }
    runUpdateCheck(false)
  }, [beginUpdateDownload, runUpdateCheck, updateInfo, updateStatus])

  const installUpdate = useCallback(async () => {
    if (!window.updateAPI?.install) {
      showAppToast('当前版本不支持自动安装，请打开安装包手动安装', 'error')
      return
    }
    setUpdateStatus('installing')
    setUpdateError('')
    setUpdateOpen(false)
    try {
      const result = await window.updateAPI.install()
      if (result && !result.ok) {
        setUpdateStatus('error')
        setUpdateError(result.error || '安装失败')
        setUpdateOpen(true)
        showAppToast(result.error || '安装失败', 'error')
      }
    } catch (error) {
      setUpdateStatus('error')
      setUpdateError(error?.message || '安装失败')
      setUpdateOpen(true)
      showAppToast(error?.message || '安装失败', 'error')
    }
  }, [showAppToast])

  const cancelUpdateDownload = useCallback(async () => {
    try {
      await window.updateAPI?.cancel?.()
    } catch {
      // 忽略取消失败
    }
    setUpdateStatus('idle')
    setUpdateProgress(null)
  }, [])

  const closeUpdateModal = useCallback(() => {
    if (updateStatus === 'installing') return
    if (updateStatus === 'downloading') {
      cancelUpdateDownload()
    }
    setUpdateOpen(false)
    if (updateStatus === 'error') {
      setUpdateStatus('idle')
      setUpdateError('')
    }
  }, [cancelUpdateDownload, updateStatus])

  const openUpdateInstaller = useCallback(async () => {
    const result = await window.updateAPI?.open?.()
    if (result && !result.ok) {
      showAppToast(result.error || '无法打开安装包', 'error')
    }
  }, [showAppToast])

  const showUpdateFolder = useCallback(async () => {
    const result = await window.updateAPI?.show?.()
    if (result && !result.ok) {
      showAppToast(result.error || '无法打开下载目录', 'error')
    }
  }, [showAppToast])

  const openUpdateRelease = useCallback(async () => {
    const result = await window.updateAPI?.openRelease?.()
    if (result && !result.ok) {
      showAppToast(result.error || '无法打开发布页', 'error')
    }
  }, [showAppToast])

  useEffect(() => {
    if (!window.updateAPI?.check) return undefined
    let alive = true
    const timer = setTimeout(async () => {
      try {
        const result = await window.updateAPI.check(false)
        if (!alive || !result?.ok) return
        setUpdateInfo(result)
        if (result.available && result.asset) {
          void beginUpdateDownload(result)
        }
      } catch {
        // 启动时静默忽略更新检查失败
      }
    }, 2000)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [beginUpdateDownload])

  useEffect(() => {
    if (!activeTabId) return
    setOpenedTabIds((prev) =>
      prev.includes(activeTabId) ? prev : [...prev, activeTabId]
    )
  }, [activeTabId])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const systemTheme = () => (media.matches ? 'dark' : 'light')
    const apply = () => {
      const resolved = themePref === 'system' ? systemTheme() : themePref
      setResolvedTheme(resolved)
      document.documentElement.dataset.theme = resolved
    }
    apply()
    // 检测到系统主题变化时，无论用户之前是否手动切换过，都重新跟随系统。
    // 之后用户仍可再次点击按钮手动切换深浅。
    const onChange = () => {
      const resolved = systemTheme()
      setThemePref('system')
      setResolvedTheme(resolved)
      document.documentElement.dataset.theme = resolved
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [themePref, setThemePref])

  const applyThemeMode = useCallback(
    (mode, event) => {
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      const nextResolved =
        mode === 'system' ? (media.matches ? 'dark' : 'light') : mode
      // 目标外观与当前一致时只切换选中状态，不播放过渡
      if (nextResolved === resolvedTheme) {
        setThemePref(mode)
        return
      }
      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches
      if (
        reduceMotion ||
        typeof document.startViewTransition !== 'function'
      ) {
        setThemePref(mode)
        return
      }
      if (themeTransitionRef.current) return

      const rect = event?.currentTarget?.getBoundingClientRect?.()
      const x = rect ? rect.left + rect.width / 2 : window.innerWidth - 44
      const y = rect ? rect.top + rect.height / 2 : 40
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      )
      const root = document.documentElement
      // 浅色 -> 深色：深色从按钮向外扩散
      // 深色 -> 浅色：旧深色向按钮收拢，露出浅色
      const contract = nextResolved === 'light'
      const startRadius = contract
        ? 0
        : Math.max(12, rect ? rect.width / 2 : 16)
      root.style.setProperty('--theme-x', `${x}px`)
      root.style.setProperty('--theme-y', `${y}px`)
      root.style.setProperty('--theme-r0', `${startRadius}px`)
      root.style.setProperty('--theme-radius', `${radius * 1.16}px`)
      root.style.setProperty('--theme-old-z', contract ? '2' : '1')
      root.style.setProperty('--theme-new-z', contract ? '1' : '2')
      root.style.setProperty(
        '--theme-old-anim',
        contract ? 'theme-contract' : 'none'
      )
      root.style.setProperty(
        '--theme-new-anim',
        contract ? 'none' : 'theme-expand'
      )

      themeTransitionRef.current = true
      try {
        const transition = document.startViewTransition(() => {
          root.dataset.theme = nextResolved
          flushSync(() => {
            setThemePref(mode)
            setResolvedTheme(nextResolved)
          })
        })
        transition.finished.finally(() => {
          themeTransitionRef.current = false
        })
      } catch {
        themeTransitionRef.current = false
        setThemePref(mode)
      }
    },
    [resolvedTheme, setThemePref]
  )

  const onToggleTheme = useCallback(
    (event) => {
      // 保留外部组件的切换入口：始终在深浅之间切换
      applyThemeMode(resolvedTheme === 'dark' ? 'light' : 'dark', event)
    },
    [applyThemeMode, resolvedTheme]
  )

  // 单个按钮循环：跟随系统 -> 浅色 -> 深色 -> 跟随系统
  const onCycleTheme = useCallback(
    (event) => {
      applyThemeMode(nextThemeMode(themePref), event)
    },
    [applyThemeMode, themePref]
  )

  useEffect(() => {
    saveJSON(`${WINDOW_VIEW_PREFIX}${windowId}`, view)
  }, [view, windowId])

  useEffect(() => {
    let alive = true
    const update = (value) => {
      if (!alive) return
      if (typeof value === 'number') {
        setWindowInfo((prev) => ({ ...prev, count: value }))
        return
      }
      if (value && Array.isArray(value.ids)) {
        setWindowInfo({
          count: Number(value.count) || value.ids.length,
          ids: value.ids
        })
      }
    }
    window.serialAPI
      ?.windowInfo?.()
      ?.then(update)
      ?.catch?.(() => {})
    const off = window.serialAPI?.onWindowsChanged?.(update)
    return () => {
      alive = false
      off?.()
    }
  }, [])

  useEffect(() => {
    const marker = WORKSPACE_FOLDERS_INIT_KEY
    if (loadString(marker, '') === '1') return
    saveString(marker, '1')
    setFolders((prev) =>
      prev.some((folder) => !folder.collapsed)
        ? prev.map((folder) => ({ ...folder, collapsed: true }))
        : prev
    )
  }, [setFolders])

  useEffect(() => {
    const ids = new Set(folders.map((folder) => folder.id))
    setTabs((prev) => {
      let changed = false
      const next = prev.map((tab) => {
        if (tab.folderId && !ids.has(tab.folderId)) {
          changed = true
          return { ...tab, folderId: '' }
        }
        return tab
      })
      return changed ? next : prev
    })
  }, [folders])

  useEffect(() => {
    const ids = view.panes.filter(Boolean)
    if (!ids.length) return
    setTabs((prev) => {
      let changed = false
      const next = prev.map((tab) => {
        if (!ids.includes(tab.id) || tab.ownerWindowId === windowId) return tab
        if (tab.ownerWindowId && windowInfo.ids.includes(tab.ownerWindowId)) {
          return tab
        }
        changed = true
        return { ...tab, ownerWindowId: windowId }
      })
      return changed ? next : prev
    })
    setOpenedTabIds((prev) => {
      const missing = ids.filter((id) => !prev.includes(id))
      return missing.length ? [...prev, ...missing] : prev
    })
  }, [
    view.panes,
    windowId,
    windowInfo.ids,
    setTabs
  ])

  useEffect(() => {
    setTabs((prev) => {
      let changed = false
      const next = prev.map((tab) => {
        if (
          tab.ownerWindowId === windowId &&
          (tab.connected || tab.batchRunning)
        ) {
          changed = true
          return { ...tab, connected: false, batchRunning: false }
        }
        return tab
      })
      return changed ? next : prev
    })
  }, [])

  useEffect(() => {
    setView((prev) => {
      const map = new Map(tabs.map((tab) => [tab.id, tab]))
      const available = (id) => {
        const tab = map.get(id)
        if (!tab) return false
        if (tab.ownerWindowId === windowId) return true
        if (!tab.ownerWindowId) return true
        return !windowInfo.ids.includes(tab.ownerWindowId)
      }
      const panes = []
      for (const id of prev.panes) {
        if (!id || panes.includes(id) || !available(id)) continue
        panes.push(id)
      }
      const layout = normalizeLayout(prev.layout, panes.length)
      const focusedId = prev.panes[prev.focusedPane]
      let focusedPane = focusedId ? panes.indexOf(focusedId) : -1
      if (focusedPane < 0) {
        focusedPane = Math.min(prev.focusedPane, Math.max(0, panes.length - 1))
      }
      if (
        panes.length === prev.panes.length &&
        panes.every((id, index) => id === prev.panes[index]) &&
        layout === prev.layout &&
        focusedPane === prev.focusedPane
      ) {
        return prev
      }
      return { ...prev, panes, layout, focusedPane }
    })
  }, [tabs, windowId, windowInfo.ids])

  useEffect(() => {
    setOpenedTabIds((prev) => {
      const valid = new Set(
        tabs
          .filter((tab) => tab.ownerWindowId === windowId)
          .map((tab) => tab.id)
      )
      const next = prev.filter((id) => valid.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [tabs, windowId])

  const claimTab = useCallback(
    (tabId) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tabId && tab.ownerWindowId !== windowId
            ? { ...tab, ownerWindowId: windowId }
            : tab
        )
      )
    },
    [setTabs, windowId]
  )

  const setActiveTabId = useCallback(
    (id, { collapseSplit = false } = {}) => {
      if (id) setHomeOpen(false)
      setView((prev) => {
        if (!id) {
          return {
            ...prev,
            panes: [],
            layout: 'single',
            focusedPane: 0
          }
        }
        if (collapseSplit) {
          return {
            ...prev,
            panes: [id],
            layout: 'single',
            focusedPane: 0
          }
        }
        const existing = prev.panes.indexOf(id)
        if (existing >= 0) {
          return { ...prev, focusedPane: existing }
        }
        if (prev.panes.length > 1) {
          const focusedPane = Math.min(
            prev.focusedPane,
            prev.panes.length - 1
          )
          const panes = prev.panes.slice()
          panes[focusedPane] = id
          return { ...prev, panes, focusedPane }
        }
        return { ...prev, panes: [id], layout: 'single', focusedPane: 0 }
      })
      if (!id) return
      setOpenedTabIds((prev) =>
        prev.includes(id) ? prev : [...prev, id]
      )
      claimTab(id)
    },
    [claimTab]
  )

  const openTab = useCallback(
    (id) => {
      const tab = tabs.find((item) => item.id === id)
      if (!tab) return
      setHomeOpen(false)
      if (
        tab.ownerWindowId &&
        tab.ownerWindowId !== windowId &&
        windowInfo.ids.includes(tab.ownerWindowId)
      ) {
        window.serialAPI?.focusTab?.(tab.ownerWindowId, id)
        return
      }
      if (tab.ownerWindowId !== windowId) claimTab(id)
      setView((prev) => {
        const existing = prev.panes.indexOf(id)
        if (existing >= 0) {
          return { ...prev, focusedPane: existing }
        }
        if (prev.panes.length > 1) {
          const focusedPane = Math.min(
            prev.focusedPane,
            prev.panes.length - 1
          )
          const panes = prev.panes.slice()
          panes[focusedPane] = id
          return { ...prev, panes, focusedPane }
        }
        return { ...prev, panes: [id], layout: 'single', focusedPane: 0 }
      })
      setOpenedTabIds((prev) =>
        prev.includes(id) ? prev : [...prev, id]
      )
    },
    [claimTab, tabs, windowId, windowInfo.ids]
  )

  const claimTabHere = useCallback(
    (tabId) => {
      const tab = tabs.find((item) => item.id === tabId)
      if (!tab) return
      setTabs((prev) =>
        prev.map((item) =>
          item.id === tabId
            ? { ...item, ownerWindowId: windowId }
            : item
        )
      )
      setOpenedTabIds((prev) =>
        prev.includes(tabId) ? prev : [...prev, tabId]
      )
      setView((prev) => {
        const existing = prev.panes.indexOf(tabId)
        if (existing >= 0) {
          return { ...prev, focusedPane: existing }
        }
        if (prev.panes.length > 1) {
          const focusedPane = Math.min(
            prev.focusedPane,
            prev.panes.length - 1
          )
          const panes = prev.panes.slice()
          panes[focusedPane] = tabId
          return { ...prev, panes, focusedPane }
        }
        return { ...prev, panes: [tabId], layout: 'single', focusedPane: 0 }
      })
      setTabMenu(null)
      showAppToast('已移到当前窗口')
    },
    [setTabs, showAppToast, tabs, windowId]
  )

  useEffect(() => {
    const off = window.serialAPI?.onFocusTab?.((tabId) => {
      if (!tabId) return
      openTab(tabId)
    })
    return off
  }, [openTab])

  const updateAddMenuAlignment = useCallback(() => {
    const rect = addMenuWrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const menuWidth = 302
    const edge = 12
    setAddMenuAlign(
      rect.left + menuWidth > window.innerWidth - edge ? 'right' : 'left'
    )
  }, [])

  const toggleAddMenu = useCallback(() => {
    setAddMenuOpen((prev) => {
      if (!prev) updateAddMenuAlignment()
      return !prev
    })
  }, [updateAddMenuAlignment])

  useEffect(() => {
    if (!addMenuOpen) return undefined
    const onPointerDown = (event) => {
      if (!addMenuWrapRef.current?.contains(event.target)) setAddMenuOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setAddMenuOpen(false)
    }
    window.addEventListener('resize', updateAddMenuAlignment)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('resize', updateAddMenuAlignment)
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [addMenuOpen, updateAddMenuAlignment])

  useEffect(() => {
    if (!tabMenu) return undefined
    const onPointerDown = (event) => {
      if (!event.target.closest?.('.tab-context-menu')) setTabMenu(null)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setTabMenu(null)
    }
    const onResize = () => setTabMenu(null)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
    }
  }, [tabMenu])

  useEffect(() => {
    if (!tabs.length) setTabListOpen(false)
  }, [tabs.length])

  useEffect(() => {
    if (!tabListOpen) return undefined
    const onPointerDown = (event) => {
      if (!tabListWrapRef.current?.contains(event.target)) setTabListOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setTabListOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [tabListOpen])

  useEffect(() => {
    if (!layoutMenuOpen) return undefined
    const onPointerDown = (event) => {
      if (!layoutMenuRef.current?.contains(event.target)) {
        setLayoutMenuOpen(false)
      }
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setLayoutMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [layoutMenuOpen])

  const updateTabMeta = useCallback((id, meta) => {
    setTabs((prev) => {
      let changed = false
      const next = prev.map((tab) => {
        if (tab.id !== id) return tab
        const hasChange = Object.entries(meta).some(
          ([key, value]) => tab[key] !== value
        )
        if (!hasChange) return tab
        changed = true
        return { ...tab, ...meta }
      })
      return changed ? next : prev
    })
  }, [])

  const addTab = useCallback(
    (kind = 'serial') => {
      const id = createTabId()
      setTabs((prev) => {
        const tabKind =
          kind === 'virtual'
            ? 'virtual'
            : kind === 'terminal'
              ? 'terminal'
              : 'serial'
        const index = prev.filter((tab) => tab.kind === tabKind).length + 1
        const folderId =
          prev.find((tab) => tab.id === activeTabId)?.folderId || ''
        const tab = createTab(tabKind, index, {
          id,
          folderId,
          ownerWindowId: windowId
        })
        const activeIndex = activeTabId
          ? prev.findIndex((item) => item.id === activeTabId)
          : -1
        if (activeIndex < 0) return [...prev, tab]
        const next = prev.slice()
        next.splice(activeIndex + 1, 0, tab)
        return next
      })
      if (view.panes.length < 2) {
        setActiveTabId(id, { collapseSplit: true })
      }
      setAddMenuOpen(false)
    },
    [activeTabId, view.panes.length, windowId]
  )

  const addTerminalTab = useCallback(() => addTab('terminal'), [addTab])
  const addSerialTab = useCallback(() => addTab('serial'), [addTab])

  const closeTab = useCallback(
    (id) => {
      const next = tabs.filter((tab) => tab.id !== id)

      clearTabData(id)
      setSshCredentials((prev) => {
        if (!(id in prev)) return prev
        const copy = { ...prev }
        delete copy[id]
        return copy
      })
      if (sshDialog?.tabId === id) setSshDialog(null)
      if (renameTabId === id) setRenameTabId(null)

      setTabs(next)
      setOpenedTabIds((prev) => prev.filter((tabId) => tabId !== id))
      const remainingOwned = next.filter(
        (tab) => tab.ownerWindowId === windowId
      )
      setView((prev) => {
        if (!prev.panes.includes(id)) return prev
        return removeTabsFromView(
          prev,
          new Set([id]),
          remainingOwned[0]?.id || ''
        )
      })
      if (next.length === 0) setOpenedTabIds([])
    },
    [renameTabId, sshDialog?.tabId, tabs, windowId]
  )

  const closeTabsByIds = useCallback(
    (ids, keepId) => {
      const unique = Array.from(new Set(ids)).filter(Boolean)
      if (unique.length === 0) return

      unique.forEach((id) => clearTabData(id))
      setSshCredentials((prev) => {
        let changed = false
        const next = { ...prev }
        for (const id of unique) {
          if (id in next) {
            delete next[id]
            changed = true
          }
        }
        return changed ? next : prev
      })
      if (sshDialog?.tabId && unique.includes(sshDialog.tabId)) {
        setSshDialog(null)
      }
      if (renameTabId && unique.includes(renameTabId)) {
        setRenameTabId(null)
      }

      const removed = new Set(unique)
      const next = tabs.filter((tab) => !removed.has(tab.id))
      setOpenedTabIds((prev) => prev.filter((id) => !removed.has(id)))
      setTabMenu(null)

      setTabs(next)
      const remainingOwned = next.filter(
        (tab) => tab.ownerWindowId === windowId
      )
      setView((prev) => {
        if (!prev.panes.some((id) => removed.has(id))) return prev
        const fallback =
          keepId && next.some((tab) => tab.id === keepId)
            ? keepId
            : remainingOwned[0]?.id || ''
        return removeTabsFromView(prev, removed, fallback)
      })
    },
    [renameTabId, sshDialog?.tabId, tabs, windowId]
  )

  const duplicateTab = useCallback(
    (tab, index) => {
      if (!tab) return
      const id = createTabId()
      const title = tabTitle(tab, index)
      const copy = {
        ...tab,
        id,
        connected: false,
        batchRunning: false,
        sshRevision: 0,
        migrateLegacy: false,
        ownerWindowId: windowId,
        customName: `${title} 副本`
      }

      try {
        for (const prefix of [
          'serialdebug.settings.',
          'serialdebug.ui.',
          'serialdebug.virtual.ports.',
          'serialdebug.virtual.rules.'
        ]) {
          const value = localStorage.getItem(`${prefix}${tab.id}`)
          if (value !== null) localStorage.setItem(`${prefix}${id}`, value)
        }
      } catch {
        // localStorage 不可用时只复制卡片本身
      }

      setTabs((prev) => {
        const sourceIndex = prev.findIndex((item) => item.id === tab.id)
        const next = prev.slice()
        next.splice(
          sourceIndex >= 0 ? sourceIndex + 1 : next.length,
          0,
          copy
        )
        return next
      })
      if (tab.kind === 'terminal' && sshCredentials[tab.id]) {
        setSshCredentials((prev) => ({
          ...prev,
          [id]: sshCredentials[tab.id]
        }))
      }
      setActiveTabId(id)
      setTabMenu(null)
      showAppToast('已复制卡片')
    },
    [setSshCredentials, showAppToast, sshCredentials]
  )

  const createFolder = useCallback((name) => {
    const folder = {
      id: createFolderId(),
      name: String(name || '').trim() || '新建文件夹',
      collapsed: true
    }
    setFolders((prev) => [...prev, folder])
  }, [setFolders])

  const renameFolder = useCallback(
    (id, name) => {
      const nextName = String(name || '').trim()
      if (!nextName) return
      setFolders((prev) =>
        prev.map((folder) =>
          folder.id === id ? { ...folder, name: nextName } : folder
        )
      )
    },
    [setFolders]
  )

  const toggleFolder = useCallback(
    (id) => {
      setFolders((prev) =>
        prev.map((folder) =>
          folder.id === id
            ? { ...folder, collapsed: !folder.collapsed }
            : folder
        )
      )
    },
    [setFolders]
  )

  const moveTabToFolder = useCallback(
    (tabId, folderId) => {
      const target =
        folderId && folders.some((folder) => folder.id === folderId)
          ? folderId
          : ''
      setTabs((prev) => {
        let changed = false
        const next = prev.map((tab) => {
          if (tab.id !== tabId || (tab.folderId || '') === target) return tab
          changed = true
          return { ...tab, folderId: target }
        })
        return changed ? next : prev
      })
    },
    [folders, setFolders]
  )

  const closeFolderPanel = useCallback(() => {
    setFolderPanelOpen(false)
  }, [])

  const requestDeleteFolder = useCallback((folder) => {
    setFolderPanelOpen(false)
    setFolderDeleteTarget(folder)
  }, [])

  const confirmFolderMoveToAll = useCallback(() => {
    if (!folderDeleteTarget) return
    const id = folderDeleteTarget.id
    setTabs((prev) =>
      prev.map((tab) =>
        tab.folderId === id ? { ...tab, folderId: '' } : tab
      )
    )
    setFolders((prev) => prev.filter((folder) => folder.id !== id))
    setFolderDeleteTarget(null)
  }, [folderDeleteTarget, setFolders])

  const confirmFolderDeleteAll = useCallback(() => {
    if (!folderDeleteTarget) return
    const id = folderDeleteTarget.id
    const ids = tabs
      .filter((tab) => tab.folderId === id)
      .map((tab) => tab.id)
    closeTabsByIds(ids)
    setFolders((prev) => prev.filter((folder) => folder.id !== id))
    setFolderDeleteTarget(null)
  }, [closeTabsByIds, folderDeleteTarget, setFolders, tabs])

  const scrollTabIntoView = useCallback((id) => {
    const container = tabCardsRef.current
    if (!container || !id) return
    const card = container.querySelector(
      `[data-tab-id="${window.CSS?.escape ? window.CSS.escape(id) : id}"]`
    )
    card?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center'
    })
  }, [])

  useEffect(() => {
    if (!activeTabId) return undefined
    const frame = requestAnimationFrame(() => scrollTabIntoView(activeTabId))
    return () => cancelAnimationFrame(frame)
  }, [activeTabId, scrollTabIntoView])

  // 拖动排序：悬停到另一个标签时立即重排，其余标签用 FLIP 平滑让位
  const moveTabLive = useCallback(
    (fromId, toId, after) => {
      setTabs((prev) => {
        const from = prev.findIndex((tab) => tab.id === fromId)
        const to = prev.findIndex((tab) => tab.id === toId)
        if (from < 0 || to < 0 || from === to) return prev
        // 只在拖动方向上移动，避免在中线附近来回抖动
        if (after ? from > to : from < to) return prev
        const next = prev.slice()
        const [moved] = next.splice(from, 1)
        const target = next.findIndex((tab) => tab.id === toId)
        if (target < 0) return prev
        next.splice(after ? target + 1 : target, 0, moved)
        return next
      })
    },
    [setTabs]
  )

  useLayoutEffect(() => {
    const container = tabCardsRef.current
    if (!container) return
    const previous = tabPositionsRef.current
    const next = new Map()
    const draggingId = dragTabIdRef.current
    container.querySelectorAll('[data-tab-id]').forEach((el) => {
      const id = el.getAttribute('data-tab-id')
      const left = el.offsetLeft
      next.set(id, left)
      // 被拖动的标签跟着指针走，不参与让位动画
      if (id === draggingId) return
      const before = previous.get(id)
      if (before == null) return
      const delta = before - left
      if (Math.abs(delta) < 1) return
      el.animate(
        [
          { transform: `translateX(${delta}px)` },
          { transform: 'translateX(0)' }
        ],
        { duration: 165, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
      )
    })
    tabPositionsRef.current = next
  }, [tabs])

  const startRename = useCallback((tab, index) => {
    setRenameTabId(tab.id)
    setRenameDraft(tab.customName || tabTitle(tab, index))
    setTabStyleDraft({
      scheme: normalizeTabScheme(tab.tabColorScheme),
      background: normalizeTabColor(tab.tabBackground),
      accent: normalizeTabColor(tab.tabAccent)
    })
  }, [])

  const saveRename = useCallback(() => {
    if (!renameTabId) return
    const scheme = normalizeTabScheme(tabStyleDraft.scheme)
    const background = normalizeTabColor(tabStyleDraft.background)
    const accent = normalizeTabColor(tabStyleDraft.accent)
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === renameTabId
          ? {
              ...tab,
              customName: renameDraft.trim(),
              tabColorScheme: scheme,
              tabBackground: background,
              tabAccent: accent
            }
          : tab
      )
    )
    setRenameTabId(null)
    setRenameDraft('')
  }, [renameDraft, renameTabId, tabStyleDraft])

  const openNewSsh = useCallback(() => {
    setAddMenuOpen(false)
    setSshDialog({ mode: 'new', profile: null, tabId: null })
  }, [])

  const closeTabsForProfile = useCallback(
    (profileId) => {
      const closedTabs = tabs.filter(
        (tab) =>
          tab.kind === 'terminal' &&
          tab.terminalType === 'ssh' &&
          tab.sshProfile?.id === profileId
      )
      if (closedTabs.length === 0) return

      const closedIds = new Set(closedTabs.map((tab) => tab.id))
      closedIds.forEach((id) => clearTabData(id))
      setSshCredentials((prev) => {
        let changed = false
        const next = { ...prev }
        for (const id of closedIds) {
          if (id in next) {
            delete next[id]
            changed = true
          }
        }
        return changed ? next : prev
      })
      if (sshDialog?.tabId && closedIds.has(sshDialog.tabId)) {
        setSshDialog(null)
      }
      if (renameTabId && closedIds.has(renameTabId)) {
        setRenameTabId(null)
      }

      const nextTabs = tabs.filter((tab) => !closedIds.has(tab.id))
      setTabs(nextTabs)
      setOpenedTabIds((prev) => prev.filter((id) => !closedIds.has(id)))
      setView((prev) => {
        if (!prev.panes.some((id) => closedIds.has(id))) return prev
        const fallback =
          nextTabs.find((tab) => tab.ownerWindowId === windowId)?.id || ''
        return removeTabsFromView(prev, closedIds, fallback)
      })
      if (nextTabs.length === 0) setOpenedTabIds([])
    },
    [renameTabId, sshDialog?.tabId, tabs, windowId]
  )

  const deleteSshProfile = useCallback(
    (profileId) => {
      setSshProfiles((prev) =>
        prev.filter((item) => item.id !== profileId)
      )
      closeTabsForProfile(profileId)
      try {
        localStorage.setItem(
          'serialdebug.ssh.profile.deleted',
          JSON.stringify({ id: profileId, at: Date.now() })
        )
      } catch {
        // 多窗口同步失败时，至少关闭当前窗口中的关联标签页
      }
    },
    [closeTabsForProfile, setSshProfiles]
  )

  useEffect(() => {
    const onStorage = (event) => {
      if (
        event.key !== 'serialdebug.ssh.profile.deleted' ||
        !event.newValue
      ) {
        return
      }
      try {
        const payload = JSON.parse(event.newValue)
        if (payload?.id) closeTabsForProfile(payload.id)
      } catch {
        // 忽略无法解析的跨窗口事件
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [closeTabsForProfile])

  const openEditSsh = useCallback((tab) => {
    setSshDialog({
      mode: 'edit',
      tabId: tab.id,
      profile: tab.sshProfile || null
    })
  }, [])

  const handleSshConnect = useCallback(
    ({ profile, credentials }) => {
      setSshProfiles((prev) => {
        const index = prev.findIndex((item) => item.id === profile.id)
        if (index < 0) return [...prev, profile]
        const next = prev.slice()
        next[index] = profile
        return next
      })

      if (sshDialog?.mode === 'edit' && sshDialog.tabId) {
        const tabId = sshDialog.tabId
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === tabId
              ? {
                  ...tab,
                  terminalType: 'ssh',
                  sshProfile: profile,
                  sshRevision: (tab.sshRevision || 0) + 1,
                  fallbackTitle: sshProfileLabel(profile)
                }
              : tab
          )
        )
        setSshCredentials((prev) => ({ ...prev, [tabId]: credentials }))
        setActiveTabId(tabId)
        setSshDialog(null)
        return
      }

      const id = createTabId()
      setTabs((prev) => {
        const index = prev.filter((tab) => tab.kind === 'terminal').length + 1
        const tab = createTab('terminal', index, {
          id,
          terminalType: 'ssh',
          sshProfile: profile,
          fallbackTitle: sshProfileLabel(profile),
          ownerWindowId: windowId
        })
        const activeIndex = activeTabId
          ? prev.findIndex((item) => item.id === activeTabId)
          : -1
        if (activeIndex < 0) return [...prev, tab]
        const next = prev.slice()
        next.splice(activeIndex + 1, 0, tab)
        return next
      })
      setSshCredentials((prev) => ({ ...prev, [id]: credentials }))
      if (view.panes.length < 2) setActiveTabId(id)
      setSshDialog(null)
    },
    [activeTabId, setSshProfiles, sshDialog, view.panes.length]
  )

  const requestCloseAll = useCallback(() => {
    if (!tabs.some((tab) => tab.ownerWindowId === windowId)) return
    setCloseAllOpen(true)
  }, [tabs, windowId])

  const confirmCloseAll = useCallback(() => {
    const owned = tabs.filter((tab) => tab.ownerWindowId === windowId)
    const ownedIds = new Set(owned.map((tab) => tab.id))
    owned.forEach((tab) => clearTabData(tab.id))
    setSshCredentials((prev) => {
      let changed = false
      const copy = { ...prev }
      ownedIds.forEach((id) => {
        if (id in copy) {
          delete copy[id]
          changed = true
        }
      })
      return changed ? copy : prev
    })
    setSshDialog(null)
    setRenameTabId(null)
    setTabs((prev) => prev.filter((tab) => !ownedIds.has(tab.id)))
    setView((prev) => ({
      ...prev,
      panes: [],
      layout: 'single',
      focusedPane: 0
    }))
    setOpenedTabIds([])
    setHomeOpen(true)
    setCloseAllOpen(false)
    setTabListOpen(false)
    setAddMenuOpen(false)
  }, [tabs, windowId])

  const goHome = useCallback(() => {
    setHomeOpen(true)
    setRenameTabId(null)
    setTabListOpen(false)
    setAddMenuOpen(false)
  }, [])

  const openNewWindow = useCallback(() => {
    window.serialAPI?.newWindow?.()
  }, [])

  const ownedTabs = tabs.filter((tab) => tab.ownerWindowId === windowId)
  const paneTabs = view.panes.map(
    (id) => ownedTabs.find((tab) => tab.id === id) || null
  )
  const primaryTab = paneTabs[0] || null
  const splitPaneCount = view.panes.length
  const activeTab = paneTabs[view.focusedPane] || primaryTab
  const connectedTabCount = tabs.filter((tab) => tab.connected).length
  const menuTab = tabMenu
    ? tabs.find((tab) => tab.id === tabMenu.tabId) || null
    : null
  const menuIndex = menuTab
    ? tabs.findIndex((tab) => tab.id === menuTab.id)
    : -1
  const isRemoteTab = (tab) =>
    Boolean(
      tab?.ownerWindowId &&
        tab.ownerWindowId !== windowId &&
        windowInfo.ids.includes(tab.ownerWindowId)
    )
  const menuRemote = menuTab ? isRemoteTab(menuTab) : false
  const renameTarget = tabs.find((tab) => tab.id === renameTabId) || null
  const renameTabKind = renameTarget ? tabKindClass(renameTarget) : 'is-serial'
  const previewTab = renameTarget
    ? {
        ...renameTarget,
        tabColorScheme: tabStyleDraft.scheme,
        tabBackground: tabStyleDraft.background,
        tabAccent: tabStyleDraft.accent
      }
    : null
  const defaultTabAccent =
    renameTabKind === 'is-ssh'
      ? '#2f343c'
      : renameTabKind === 'is-local'
        ? '#0f9d78'
        : '#2563eb'
  const folderDeleteCount = folderDeleteTarget
    ? tabs.filter((tab) => tab.folderId === folderDeleteTarget.id).length
    : 0

  const applySplitLayout = useCallback(
    (layout) => {
      const count = layoutPaneCount(layout)
      setView((prev) => {
        const candidates = []
        const push = (id) => {
          if (id && !candidates.includes(id)) candidates.push(id)
        }
        prev.panes.forEach(push)
        ownedTabs.forEach((tab) => push(tab.id))
        if (candidates.length < count) return prev
        const panes = candidates.slice(0, count)
        const focusedId = prev.panes[prev.focusedPane]
        let focusedPane = focusedId ? panes.indexOf(focusedId) : -1
        if (focusedPane < 0) focusedPane = 0
        return {
          ...prev,
          panes,
          layout,
          focusedPane,
          ratio: 0.5,
          ratio2: 0.5,
          ratio3: 0.5
        }
      })
      setHomeOpen(false)
      setLayoutMenuOpen(false)
    },
    [ownedTabs]
  )

  const closeSplit = useCallback(() => {
    setView((prev) => {
      const current = prev.panes[prev.focusedPane] || prev.panes[0] || ''
      return {
        ...prev,
        panes: current ? [current] : [],
        layout: 'single',
        focusedPane: 0
      }
    })
    setTabMenu(null)
  }, [])

  const handleSessionDragOver = useCallback(
    (event) => {
      if (!dragTabId) return
      if (homeOpen) {
        setSplitPreview(null)
        return
      }
      const tab = tabs.find((item) => item.id === dragTabId)
      if (!tab) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const x = (event.clientX - rect.left) / rect.width
      const y = (event.clientY - rect.top) / rect.height
      const count = view.panes.length
      let next = null
      if (!count) {
        setSplitPreview(null)
        return
      }
      const inPanes = view.panes.includes(dragTabId)
      if (
        count === 2 &&
        view.layout === 'row' &&
        !inPanes &&
        (y < 0.12 || y > 0.88)
      ) {
        const top = y < 0.12
        next = {
          kind: 'grow3',
          zone: top ? 'top' : 'bottom',
          layout: top ? 'top1' : 'top2',
          direction: 'column',
          label: top ? '上方新分屏' : '下方新分屏'
        }
      } else if (count > 1) {
        const paneIndex = paneIndexAt(view, x, y)
        const paneTab = paneTabs[paneIndex]
        if (paneTab?.id !== dragTabId) {
          const host = event.currentTarget.querySelector(
            `.session-host[data-pane-index="${paneIndex}"]`
          )
          let paneRect = null
          if (host) {
            const hostRect = host.getBoundingClientRect()
            paneRect = {
              left: hostRect.left - rect.left + 4,
              top: hostRect.top - rect.top + 4,
              width: Math.max(0, hostRect.width - 8),
              height: Math.max(0, hostRect.height - 8)
            }
          }
          next = {
            kind: 'pane',
            paneIndex,
            paneRect,
            label: inPanes ? '松开交换位置' : '松开替换'
          }
        }
      } else if (!inPanes) {
        const dx = x - 0.5
        const dy = y - 0.5
        if (Math.abs(dx) < 0.04 && Math.abs(dy) < 0.04) {
          setSplitPreview(null)
          return
        }
        const side =
          Math.abs(dx) >= Math.abs(dy)
            ? dx < 0
              ? 'left'
              : 'right'
            : dy < 0
              ? 'top'
              : 'bottom'
        next = {
          kind: 'split',
          zone: side,
          direction: side === 'left' || side === 'right' ? 'row' : 'column',
          label: '松开分屏'
        }
      }
      if (!next) {
        setSplitPreview(null)
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setSplitPreview((prev) => {
        if (
          prev &&
          prev.kind === next.kind &&
          prev.zone === next.zone &&
          prev.paneIndex === next.paneIndex &&
          prev.direction === next.direction &&
          prev.layout === next.layout
        ) {
          return prev
        }
        return next
      })
    },
    [dragTabId, homeOpen, paneTabs, tabs, view.layout, view.panes, view.ratio]
  )

  const handleSessionDragLeave = useCallback((event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setSplitPreview(null)
  }, [])

  const handleSessionDrop = useCallback(
    (event) => {
      const preview = splitPreview
      const tabId = dragTabId || event.dataTransfer.getData('text/plain')
      setSplitPreview(null)
      setDragTabId(null)
      if (!preview || !tabId) return
      event.preventDefault()
      const tab = tabs.find((item) => item.id === tabId)
      if (!tab) return
      if (tab.ownerWindowId !== windowId) claimTab(tab.id)
      setOpenedTabIds((prev) =>
        prev.includes(tab.id) ? prev : [...prev, tab.id]
      )
      if (preview.kind === 'pane') {
        setView((prev) => {
          if (!prev.panes[preview.paneIndex]) return prev
          const result = replacePaneTab(
            prev.panes,
            preview.paneIndex,
            tab.id
          )
          return {
            ...prev,
            panes: result.panes,
            focusedPane: result.focusedPane
          }
        })
        return
      }
      if (preview.kind === 'grow3') {
        setView((prev) => {
          if (prev.panes.length !== 2 || prev.panes.includes(tab.id)) {
            return prev
          }
          const panes =
            preview.layout === 'top1'
              ? [tab.id, ...prev.panes]
              : [...prev.panes, tab.id]
          return {
            ...prev,
            panes: panes.slice(0, MAX_SPLIT_PANES),
            layout: preview.layout,
            focusedPane: preview.layout === 'top1' ? 0 : 2,
            ratio: 0.5,
            ratio2: 0.5,
            ratio3: 0.5
          }
        })
        return
      }
      setView((prev) => {
        if (!prev.panes.length || prev.panes[0] === tab.id) return prev
        const first = prev.panes[0]
        if (preview.zone === 'left' || preview.zone === 'top') {
          return {
            ...prev,
            panes: [tab.id, first],
            layout: preview.direction === 'row' ? 'row' : 'column',
            focusedPane: 0,
            ratio: 0.5,
            ratio2: 0.5,
            ratio3: 0.5
          }
        }
        return {
          ...prev,
          panes: [first, tab.id],
          layout: preview.direction === 'row' ? 'row' : 'column',
          focusedPane: 1,
          ratio: 0.5,
          ratio2: 0.5,
          ratio3: 0.5
        }
      })
    },
    [claimTab, dragTabId, splitPreview, tabs, windowId]
  )

  const startSplitDrag = useCallback(
    (event, axis = 'primary') => {
      event.preventDefault()
      const container = splitRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const key = axis === 'primary' || axis === 'secondary'
        ? axis === 'secondary' ? 'ratio2' : 'ratio'
        : axis
      const direction =
        key === 'ratio' && view.layout !== 'row' ? 'column' : 'row'
      const onMove = (moveEvent) => {
        const ratio =
          direction === 'column'
            ? (moveEvent.clientY - rect.top) / rect.height
            : (moveEvent.clientX - rect.left) / rect.width
        const next = clampSplitRatio(
          ratio,
          direction,
          rect.width,
          rect.height
        )
        setView((prev) =>
          prev.layout === view.layout
            ? { ...prev, [key]: next }
            : prev
        )
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.classList.remove(
          'is-resizing-split',
          'is-resizing-split-column',
          'is-resizing-split-row',
          `is-resizing-split-${key}`
        )
      }
      document.body.classList.add('is-resizing-split')
      document.body.classList.add(
        direction === 'column'
          ? 'is-resizing-split-column'
          : 'is-resizing-split-row'
      )
      document.body.classList.add(`is-resizing-split-${key}`)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [view.layout]
  )

  useEffect(() => {
    if (view.panes.length < 2) return undefined
    const el = splitRef.current
    if (!el) return undefined
    const apply = () => {
      const rect = el.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      setView((prev) => {
        if (prev.panes.length < 2) return prev
        const direction = prev.layout === 'row' ? 'row' : 'column'
        const next = clampSplitRatio(
          prev.ratio,
          direction,
          rect.width,
          rect.height
        )
        const hasSecondAxis =
          prev.layout === 'top1' ||
          prev.layout === 'top2' ||
          prev.layout === 'grid'
        const next2 = hasSecondAxis
          ? clampSplitRatio(
              prev.ratio2,
              'row',
              rect.width,
              rect.height
            )
          : prev.ratio2
        const current3 = prev.ratio3 ?? 0.5
        const next3 =
          prev.layout === 'grid'
            ? clampSplitRatio(
                current3,
                'row',
                rect.width,
                rect.height
              )
            : current3
        return Math.abs(next - prev.ratio) < 0.002 &&
          Math.abs(next2 - prev.ratio2) < 0.002 &&
          Math.abs(next3 - current3) < 0.002
          ? prev
          : { ...prev, ratio: next, ratio2: next2, ratio3: next3 }
      })
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    return () => observer.disconnect()
  }, [view.panes.length, view.layout])

  const handlePaneDragStart = useCallback(
    (tabId, event) => {
      if (!tabId || view.panes.length < 2 || !view.panes.includes(tabId)) {
        return
      }
      setDragTabId(tabId)
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', tabId)
    },
    [view.panes]
  )

  const handlePaneDragEnd = useCallback(() => {
    setDragTabId(null)
    setSplitPreview(null)
  }, [])

  const renderTabPage = (tab, active, visible) => {
    if (!tab) return null
    const tabIndex = tabs.findIndex((item) => item.id === tab.id)
    const paneTitle = tabTitle(tab, tabIndex)
    const paneTag = tabKindTag(tab)
    const paneTagClass = tabKindClass(tab)
    if (tab.kind === 'virtual') {
      return window.serialAPI?.platform === 'win32' ? (
        <WindowsVirtualPage
          sessionId={tab.id}
          active={active}
          accent={tabAccentOf(tab)}
          statusAccent={tabStatusAccent(tab, resolvedTheme)}
          tagAccent={tabTagAccent(tab)}
          resolvedTheme={resolvedTheme}
          split={splitPaneCount > 1}
          onPaneDragStart={handlePaneDragStart}
          onPaneDragEnd={handlePaneDragEnd}
          paneTitle={paneTitle}
          paneTag={paneTag}
          paneTagClass={paneTagClass}
        />
      ) : (
        <VirtualPortPage
          sessionId={tab.id}
          active={active}
          accent={tabAccentOf(tab)}
          statusAccent={tabStatusAccent(tab, resolvedTheme)}
          tagAccent={tabTagAccent(tab)}
          resolvedTheme={resolvedTheme}
          onToggleTheme={onToggleTheme}
          split={splitPaneCount > 1}
          onPaneDragStart={handlePaneDragStart}
          onPaneDragEnd={handlePaneDragEnd}
          paneTitle={paneTitle}
          paneTag={paneTag}
          paneTagClass={paneTagClass}
        />
      )
    }
    if (tab.kind === 'terminal') {
      return (
        <TerminalPage
          key={`${tab.id}:${tab.sshRevision || 0}`}
          sessionId={tab.id}
          accent={tabAccentOf(tab)}
          statusAccent={tabStatusAccent(tab, resolvedTheme)}
          tagAccent={tabTagAccent(tab)}
          active={active}
          visible={visible}
          transport={tab.terminalType || 'local'}
          initialShellId={tab.shellId || ''}
          sshProfile={tab.sshProfile}
          sshCredentials={sshCredentials[tab.id]}
          onEditSsh={() => openEditSsh(tab)}
          resolvedTheme={resolvedTheme}
          onToggleTheme={onToggleTheme}
          onMetaChange={updateTabMeta}
          onNewTerminal={addTerminalTab}
          onNewSsh={openNewSsh}
          commands={
            tab.terminalType === 'ssh'
              ? sshTerminalCommands
              : localTerminalCommands
          }
          setCommands={
            tab.terminalType === 'ssh'
              ? setSshTerminalCommands
              : setLocalTerminalCommands
          }
          display={terminalDisplay}
          setDisplay={setTerminalDisplay}
          split={splitPaneCount > 1}
          onPaneDragStart={handlePaneDragStart}
          onPaneDragEnd={handlePaneDragEnd}
          paneTitle={paneTitle}
          paneTag={paneTag}
          paneTagClass={paneTagClass}
        />
      )
    }
    return (
      <SessionPage
        sessionId={tab.id}
        accent={tabAccentOf(tab)}
        statusAccent={tabStatusAccent(tab, resolvedTheme)}
        tagAccent={tabTagAccent(tab)}
        active={active}
        migrateLegacy={Boolean(tab.migrateLegacy)}
        favorites={favorites}
        setFavorites={setFavorites}
        history={history}
        setHistory={setHistory}
        customBauds={customBauds}
        setCustomBauds={setCustomBauds}
        resolvedTheme={resolvedTheme}
        onToggleTheme={onToggleTheme}
        onMetaChange={updateTabMeta}
        onNewSerial={addSerialTab}
        split={splitPaneCount > 1}
        onPaneDragStart={handlePaneDragStart}
        onPaneDragEnd={handlePaneDragEnd}
          paneTitle={paneTitle}
          paneTag={paneTag}
          paneTagClass={paneTagClass}
      />
    )
  }

  const splitPreviewStyle = splitPreview
    ? (() => {
        if (splitPreview.kind === 'pane') {
          return splitPreview.paneRect || { inset: 4 }
        }
        if (splitPreview.zone === 'left') {
          return { left: 4, top: 4, bottom: 4, width: 'calc(50% - 8px)' }
        }
        if (splitPreview.zone === 'right') {
          return { left: '50%', right: 4, top: 4, bottom: 4 }
        }
        if (splitPreview.zone === 'top') {
          return { left: 4, right: 4, top: 4, height: 'calc(50% - 8px)' }
        }
        if (splitPreview.zone === 'bottom') {
          return { left: 4, right: 4, top: '50%', bottom: 4 }
        }
        return { inset: 4 }
      })()
    : null

  const updatePercent = Math.max(
    0,
    Math.min(100, Math.round(Number(updateProgress?.percent) || 0))
  )
  const updateTotal =
    Number(updateProgress?.total) || Number(updateInfo?.asset?.size) || 0
  const updateReceived = Number(updateProgress?.received) || 0

  return (
    <div className="app-shell">
      <FastTooltip />
      <LiquidGlassFilter />
      <div className="tab-strip">
        <button
          type="button"
          className={`tab-home ${
            homeOpen || !activeTab ? 'is-active' : ''
          }`}
          onClick={goHome}
          title="首页"
          aria-label="返回首页"
        >
          <Icon name="home" size={15} />
        </button>

        <div className="tab-add-wrap" ref={addMenuWrapRef}>
          <button
            type="button"
            className={`tab-add ${addMenuOpen ? 'is-active' : ''}`}
            onClick={toggleAddMenu}
            title="新建会话"
            aria-haspopup="menu"
            aria-expanded={addMenuOpen}
          >
            <Icon name="terminal-plus" size={16} />
          </button>

          {addMenuOpen ? (
            <div
              className={`new-session-menu ${
                addMenuAlign === 'right' ? 'align-right' : ''
              }`}
              role="menu"
            >
              <div className="new-session-head">新建会话</div>
              <button
                type="button"
                className="new-session-option is-serial"
                onClick={() => addTab('serial')}
                role="menuitem"
              >
                <span className="new-session-icon is-serial">
                  <Icon name="plug" size={15} />
                </span>
                <span className="new-session-copy">
                  <strong>串口工具</strong>
                  <small>串口连接、收发与日志</small>
                </span>
              </button>
              <button
                type="button"
                className="new-session-option is-local"
                onClick={() => addTab('terminal')}
                role="menuitem"
              >
                <span className="new-session-icon is-terminal">
                  <Icon name="terminal" size={15} />
                </span>
                <span className="new-session-copy">
                  <strong>本地终端</strong>
                  <small>本机 Shell，命令与脚本</small>
                </span>
              </button>
              <button
                type="button"
                className="new-session-option is-ssh"
                onClick={openNewSsh}
                role="menuitem"
              >
                <span className="new-session-icon is-ssh">
                  <Icon name="server" size={15} />
                </span>
                <span className="new-session-copy">
                  <strong>SSH 终端</strong>
                  <small>远程 Shell 与文件管理</small>
                </span>
              </button>
              <button
                type="button"
                className="new-session-option is-virtual"
                onClick={() => addTab('virtual')}
                role="menuitem"
              >
                <span className="new-session-icon is-virtual">
                  <Icon name="bolt" size={15} />
                </span>
                <span className="new-session-copy">
                  <strong>虚拟串口</strong>
                  <small>创建串口对，供第三方程序互通</small>
                </span>
              </button>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="tab-new-window"
          onClick={openNewWindow}
          title="新建窗口 (⌘N / Ctrl+N)"
          aria-label="新建窗口"
        >
          <Icon name="window-plus" size={14} />
          <span className="tab-list-count">{windowCount}</span>
        </button>

        <div className="tab-list-wrap" ref={tabListWrapRef}>
          <button
            type="button"
            className={`tab-list-trigger ${tabListOpen ? 'is-active' : ''}`}
            disabled={!tabs.length}
            onClick={() => {
              if (!tabs.length) return
              setTabListOpen((prev) => !prev)
              setFolderPanelOpen(false)
            }}
            title={tabs.length ? '会话列表' : '暂无会话'}
            aria-haspopup="listbox"
            aria-expanded={tabListOpen}
            aria-label="会话列表"
          >
            <Icon name="list" size={14} />
            <span className="tab-list-count">{tabs.length}</span>
          </button>
          {tabListOpen ? (
            <div className="tab-list-menu" role="listbox" aria-label="会话列表">
              {groupTabs(tabs).map((group) => (
                <div className="tab-list-group" key={group.id}>
                  <div className="tab-list-group-head">
                    <span>{group.label}</span>
                    <span className="tab-list-group-count">
                      {group.items.length}
                    </span>
                  </div>
                  {group.items.map(({ tab, index }) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="option"
                      aria-selected={tab.id === activeTabId}
                      className={`tab-list-item ${
                        tab.id === activeTabId ? 'is-active' : ''
                      }`}
                      onClick={() => {
                        openTab(tab.id)
                        setTabListOpen(false)
                        scrollTabIntoView(tab.id)
                      }}
                    >
                      <span className={`tab-kind ${tabKindClass(tab)}`}>
                        <Icon name={tabKindIcon(tab)} size={12} />
                      </span>
                      <span className="tab-list-title">
                        {tabTitle(tab, index)}
                      </span>
                      <span className={`tab-kind-tag ${tabKindClass(tab)}`}>
                        {tabKindTag(tab)}
                      </span>
                      {tab.id === activeTabId ? (
                        <Icon name="check" size={12} className="tab-list-check" />
                      ) : null}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="tab-list-wrap">
          <button
            ref={folderBtnRef}
            type="button"
            className={`tab-list-trigger folder-trigger ${
              folderPanelOpen ? 'is-active' : ''
            }`}
            onClick={() => {
              setFolderPanelOpen((prev) => !prev)
              setTabListOpen(false)
            }}
            title="会话文件夹"
            aria-haspopup="dialog"
            aria-expanded={folderPanelOpen}
            aria-label="会话文件夹"
          >
            <Icon name="folder" size={14} />
            {folders.length ? (
              <span className="tab-list-count">{folders.length}</span>
            ) : null}
          </button>
          {folderPanelOpen ? (
            <SessionFolders
              anchorRef={folderBtnRef}
              tabs={tabs}
              folders={folders}
              activeTabId={activeTabId}
              allCollapsed={allFolderCollapsed === '1'}
              titleOf={tabTitle}
              kindClassOf={tabKindClass}
              kindIconOf={tabKindIcon}
              kindTagOf={tabKindTag}
              onClose={closeFolderPanel}
              onSelectTab={(id) => {
                openTab(id)
                setFolderPanelOpen(false)
                scrollTabIntoView(id)
              }}
              onToggleAll={() =>
                setAllFolderCollapsed((prev) => (prev === '1' ? '0' : '1'))
              }
              onCreateFolder={createFolder}
              onRenameFolder={renameFolder}
              onToggleFolder={toggleFolder}
              onDeleteFolder={requestDeleteFolder}
              onMoveTab={moveTabToFolder}
            />
          ) : null}
        </div>

        <div
          className="tab-cards"
          role="tablist"
          aria-label="会话页面"
          ref={tabCardsRef}
          onDragOver={(event) => {
            if (!dragTabId) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            // 拖到两端时自动横向滚动，和 opencode 的排序手感一致
            const el = event.currentTarget
            const rect = el.getBoundingClientRect()
            const edge = 48
            if (event.clientX < rect.left + edge) {
              el.scrollLeft -= 14
            } else if (event.clientX > rect.right - edge) {
              el.scrollLeft += 14
            }
          }}
        >
          {tabs.map((tab, index) => (
            <div
              key={tab.id}
              role="tab"
              data-tab-id={tab.id}
              aria-selected={tab.id === activeTabId}
              className={`tab-card ${tabKindClass(tab)} ${tabSchemeClass(
                tab
              )} ${tab.id === activeTabId ? 'is-active' : ''} ${
                view.panes.length > 1 && view.panes.includes(tab.id)
                  ? 'is-pane'
                  : ''
              } ${isRemoteTab(tab) ? 'is-remote' : ''} ${
                dragTabId === tab.id ? 'is-dragging' : ''
              }`}
              style={tabCardStyle(tab)}
              draggable
              onClick={() => openTab(tab.id)}
              onDragStart={(event) => {
                if (event.target.closest('button')) {
                  event.preventDefault()
                  return
                }
                setDragTabId(tab.id)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', tab.id)
                // 用完整不透明的卡片快照作为拖动影像，源卡片随后淡出
                const card = event.currentTarget
                const rect = card.getBoundingClientRect()
                const ghost = card.cloneNode(true)
                ghost.style.cssText += `position:fixed;top:-9999px;left:-9999px;width:${rect.width}px;height:${rect.height}px;opacity:0.98;pointer-events:none;filter:drop-shadow(0 10px 18px rgba(8,20,38,0.35));`
                document.body.appendChild(ghost)
                event.dataTransfer.setDragImage(
                  ghost,
                  event.clientX - rect.left,
                  event.clientY - rect.top
                )
                window.setTimeout(() => ghost.remove(), 0)
              }}
              onDragEnd={() => {
                setDragTabId(null)
                setSplitPreview(null)
              }}
              onDragOver={(event) => {
                if (!dragTabId) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                if (dragTabId === tab.id) return
                const rect = event.currentTarget.getBoundingClientRect()
                moveTabLive(
                  dragTabId,
                  tab.id,
                  event.clientX > rect.left + rect.width / 2
                )
              }}
              onDrop={(event) => {
                event.preventDefault()
                setDragTabId(null)
                setSplitPreview(null)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setTabMenu({
                  tabId: tab.id,
                  x: event.clientX,
                  y: event.clientY
                })
              }}
              onDoubleClick={(event) => {
                event.stopPropagation()
                startRename(tab, index)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openTab(tab.id)
                } else if (event.key === 'F2') {
                  event.preventDefault()
                  startRename(tab, index)
                }
              }}
              tabIndex={0}
              title={`${tabTitle(tab, index)}${
                tab.kind === 'serial' && tab.portPath ? ` · ${tab.portPath}` : ''
              } · 拖动排序 · 拖到会话区域可分屏 · 拖到窗格可交换位置 · 右键菜单${
                isRemoteTab(tab) ? ' · 已在其他窗口打开' : ''
              }`}
            >
              <span className={`tab-kind ${tabKindClass(tab)}`}>
                <Icon name={tabKindIcon(tab)} size={12} />
              </span>
              <span className={`tab-status ${tab.connected ? 'is-on' : ''}`} />
              <span className="tab-title">{tabTitle(tab, index)}</span>
              <span className={`tab-kind-tag ${tabKindClass(tab)}`}>
                {tabKindTag(tab)}
              </span>
              {tab.batchRunning ? <span className="tab-batch">循环</span> : null}
              {!isRemoteTab(tab) ? (
                <button
                  type="button"
                  className="tab-close"
                  onDoubleClick={(event) => event.stopPropagation()}
                  title="关闭页面"
                  onClick={(event) => {
                    event.stopPropagation()
                    closeTab(tab.id)
                  }}
                >
                  <Icon name="close" size={11} />
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <div className="tab-strip-actions">
          <div className="tab-layout-wrap" ref={layoutMenuRef}>
            <button
              type="button"
              className={`tab-action is-icon tab-layout ${
                layoutMenuOpen ? 'is-active' : ''
              }`}
              onClick={() => setLayoutMenuOpen((prev) => !prev)}
              disabled={!activeTab}
              title="分屏布局"
              aria-label="分屏布局"
              aria-haspopup="menu"
              aria-expanded={layoutMenuOpen}
            >
              <Icon name="layout" size={15} />
            </button>
            {layoutMenuOpen ? (
              <div className="split-layout-menu" role="menu" aria-label="分屏布局">
                <div className="split-layout-menu-head">分屏布局</div>
                <div className="split-layout-row">
                  {SPLIT_LAYOUT_OPTIONS.map((option) => {
                    const disabled = ownedTabs.length < option.count
                    const active =
                      splitPaneCount === option.count &&
                      view.layout === option.id
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        aria-label={option.label}
                        className={active ? 'is-active' : ''}
                        disabled={disabled}
                        title={
                          disabled
                            ? `至少需要 ${option.count} 个标签`
                            : option.label
                        }
                        onClick={() => applySplitLayout(option.id)}
                      >
                        <Icon name={`layout-${option.id}`} size={18} />
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>
          {splitPaneCount > 1 ? (
            <button
              type="button"
              className="tab-action is-icon tab-exit-split"
              onClick={closeSplit}
              title="退出分屏"
              aria-label="退出分屏"
            >
              <Icon name="exit-split" size={15} />
            </button>
          ) : null}
          <button
            type="button"
            className={`tab-action is-icon update-trigger ${
              updateStatus === 'downloaded' ? 'has-update' : ''
            } ${updateStatus === 'checking' ? 'is-checking' : ''} ${
              updateStatus === 'downloading' ? 'is-downloading' : ''
            }`}
            onClick={handleUpdateClick}
            disabled={
              updateStatus === 'checking' ||
              updateStatus === 'downloading' ||
              updateStatus === 'installing'
            }
            data-tooltip={
              updateStatus === 'checking'
                ? '正在检查更新…'
                : updateStatus === 'downloading'
                  ? `正在后台下载新版本${
                      updateProgress?.percent != null
                        ? ` ${Math.round(updateProgress.percent)}%`
                        : '…'
                    }`
                  : updateStatus === 'downloaded'
                    ? `新版本 v${updateInfo?.latestVersion} 已下载，点击更新并重启`
                    : updateStatus === 'installing'
                      ? '正在安装并重启…'
                      : updateStatus === 'error'
                        ? '更新准备失败，点击重试'
                        : '检查更新'
            }
            aria-label={
              updateStatus === 'downloaded' ? '安装新版本' : '检查更新'
            }
          >
            <Icon name="download" size={16} />
            {updateStatus === 'downloaded' ? (
              <span className="update-dot" aria-hidden="true" />
            ) : null}
          </button>
          <button
            type="button"
            className="tab-action is-icon tab-theme-toggle"
            onClick={onCycleTheme}
            title={THEME_MODE_LABEL[themePref] || '跟随系统'}
            aria-label={`切换主题（${
              THEME_MODE_LABEL[themePref] || '跟随系统'
            }）`}
          >
            <Icon name={themeIconName(themePref)} size={15} />
          </button>
        </div>
      </div>

      <div
        className={`session-stack ${homeOpen ? 'is-home' : ''}`}
        ref={splitRef}
        onDragOver={handleSessionDragOver}
        onDragLeave={handleSessionDragLeave}
        onDrop={handleSessionDrop}
      >
        {homeOpen || !primaryTab ? (
          <div className="session-host is-active">
            <HomePage
              tabsCount={tabs.length}
              connectedCount={connectedTabCount}
              resolvedTheme={resolvedTheme}
              onToggleTheme={onToggleTheme}
              onNewSerial={addSerialTab}
              onNewLocal={addTerminalTab}
              onNewSsh={openNewSsh}
              onNewVirtual={() => addTab('virtual')}
            />
          </div>
        ) : null}
        {ownedTabs
          .filter(
            (tab) =>
              openedTabIds.includes(tab.id) ||
              view.panes.includes(tab.id)
          )
          .map((tab) => {
            const paneIndex = view.panes.indexOf(tab.id)
            const visible = paneIndex >= 0
            const focused = visible && paneIndex === view.focusedPane
            let style
            if (visible) {
              const ratio = view.ratio
              if (splitPaneCount === 1) {
                style = { inset: 0 }
              } else if (view.layout === 'row') {
                style =
                  paneIndex === 0
                    ? {
                        top: 0,
                        bottom: 0,
                        left: 0,
                        width: `${ratio * 100}%`
                      }
                    : {
                        top: 0,
                        bottom: 0,
                        left: `${ratio * 100}%`,
                        width: `${(1 - ratio) * 100}%`
                      }
              } else if (view.layout === 'column') {
                style =
                  paneIndex === 0
                    ? {
                        left: 0,
                        right: 0,
                        top: 0,
                        height: `${ratio * 100}%`
                      }
                    : {
                        left: 0,
                        right: 0,
                        top: `${ratio * 100}%`,
                        height: `${(1 - ratio) * 100}%`
                      }
              } else if (view.layout === 'top1') {
                style =
                  paneIndex === 0
                    ? {
                        left: 0,
                        right: 0,
                        top: 0,
                        height: `${ratio * 100}%`
                      }
                    : paneIndex === 1
                      ? {
                          left: 0,
                          width: `${view.ratio2 * 100}%`,
                          top: `${ratio * 100}%`,
                          bottom: 0
                        }
                      : {
                          left: `${view.ratio2 * 100}%`,
                          right: 0,
                          top: `${ratio * 100}%`,
                          bottom: 0
                        }
              } else if (view.layout === 'top2') {
                style =
                  paneIndex === 0
                    ? {
                        left: 0,
                        width: `${view.ratio2 * 100}%`,
                        top: 0,
                        height: `${ratio * 100}%`
                      }
                    : paneIndex === 1
                      ? {
                          left: `${view.ratio2 * 100}%`,
                          right: 0,
                          top: 0,
                          height: `${ratio * 100}%`
                        }
                      : {
                          left: 0,
                          right: 0,
                          top: `${ratio * 100}%`,
                          bottom: 0
                        }
              } else if (view.layout === 'grid') {
                const columnRatio =
                  paneIndex < 2
                    ? view.ratio2
                    : view.ratio3 ?? 0.5
                style = {
                  left:
                    paneIndex % 2 === 0
                      ? 0
                      : `${columnRatio * 100}%`,
                  width:
                    paneIndex % 2 === 0
                      ? `${columnRatio * 100}%`
                      : undefined,
                  right:
                    paneIndex % 2 === 0 ? undefined : 0,
                  top: paneIndex < 2 ? 0 : `${ratio * 100}%`,
                  height:
                    paneIndex < 2 ? `${ratio * 100}%` : undefined,
                  bottom: paneIndex < 2 ? undefined : 0
                }
              } else {
                style = { inset: 0 }
              }
            }
            if (visible && style) {
              style = { ...style, '--pane-accent': tabAccentOf(tab) }
            }
            const pairPane = splitPaneCount === 2
            return (
              <div
                key={tab.id}
                data-pane-index={visible ? paneIndex : undefined}
                className={`session-host ${visible ? 'is-visible' : ''} ${
                  splitPaneCount > 1 && visible
                    ? `is-split-pane is-split-${view.layout} ${
                        splitPaneCount > 2 ? 'is-split-multi' : ''
                      }`
                    : ''
                } ${focused ? 'is-focused-pane' : ''} ${
                  pairPane && paneIndex === 0 ? 'is-primary-pane' : ''
                } ${pairPane && paneIndex === 1 ? 'is-secondary-pane' : ''}`}
                style={style}
                aria-hidden={!visible}
                onMouseDownCapture={
                  visible
                    ? () =>
                        setView((prev) =>
                          prev.focusedPane === paneIndex
                            ? prev
                            : { ...prev, focusedPane: paneIndex }
                        )
                    : undefined
                }
              >
                {renderTabPage(tab, focused, visible)}
              </div>
            )
          })}
        {!homeOpen && splitPaneCount === 2 ? (
          <div
            className={`split-divider is-overlay is-${view.layout}`}
            data-split-key="ratio"
            role="separator"
            aria-orientation={
              view.layout === 'column' ? 'horizontal' : 'vertical'
            }
            style={
              view.layout === 'column'
                ? {
                    left: 0,
                    right: 0,
                    top: `calc(${view.ratio * 100}% - 4.5px)`,
                    height: 9
                  }
                : {
                    top: 0,
                    bottom: 0,
                    left: `calc(${view.ratio * 100}% - 6.5px)`,
                    width: 13
                  }
            }
            onPointerDown={startSplitDrag}
          >
            <span />
          </div>
        ) : null}
        {!homeOpen &&
        splitPaneCount > 2 &&
        (view.layout === 'top1' ||
          view.layout === 'top2' ||
          view.layout === 'grid') ? (
          <div
            className="split-divider is-overlay is-column"
            data-split-key="ratio"
            role="separator"
            aria-orientation="horizontal"
            style={{
              left: 0,
              right: 0,
              top: `calc(${view.ratio * 100}% - 4.5px)`,
              height: 9,
              zIndex: 61
            }}
            onPointerDown={(event) => startSplitDrag(event, 'primary')}
          >
            <span />
          </div>
        ) : null}
        {!homeOpen && splitPaneCount > 2 && view.layout === 'grid' ? (
          <>
            <div
              className="split-divider is-overlay is-row"
              data-split-key="ratio2"
              role="separator"
              aria-orientation="vertical"
              style={{
                left: `calc(${view.ratio2 * 100}% - 6.5px)`,
                width: 13,
                top: 0,
                height: `${view.ratio * 100}%`
              }}
              onPointerDown={(event) => startSplitDrag(event, 'ratio2')}
            >
              <span />
            </div>
            <div
              className="split-divider is-overlay is-row"
              data-split-key="ratio3"
              role="separator"
              aria-orientation="vertical"
              style={{
                left: `calc(${(view.ratio3 ?? 0.5) * 100}% - 6.5px)`,
                width: 13,
                top: `${view.ratio * 100}%`,
                bottom: 0
              }}
              onPointerDown={(event) => startSplitDrag(event, 'ratio3')}
            >
              <span />
            </div>
          </>
        ) : null}
        {!homeOpen &&
        splitPaneCount > 2 &&
        (view.layout === 'top1' || view.layout === 'top2') ? (
          <div
            className="split-divider is-overlay is-row"
            data-split-key="ratio2"
            role="separator"
            aria-orientation="vertical"
            style={{
              left: `calc(${view.ratio2 * 100}% - 6.5px)`,
              width: 13,
              top:
                view.layout === 'top1'
                  ? `${view.ratio * 100}%`
                  : 0,
              ...(view.layout === 'top2'
                ? { height: `${view.ratio * 100}%` }
                : { bottom: 0 })
            }}
            onPointerDown={(event) => startSplitDrag(event, 'secondary')}
          >
            <span />
          </div>
        ) : null}
        {!homeOpen && splitPreview ? (
          <div
            className="split-drop-preview"
            style={splitPreviewStyle}
            aria-hidden="true"
          >
            <span>{splitPreview.label}</span>
          </div>
        ) : null}
      </div>

      {menuTab && menuIndex >= 0 ? (
        <div
          className="tab-context-menu"
          role="menu"
          style={{
            left: Math.min(tabMenu.x, Math.max(8, window.innerWidth - 224)),
            top: Math.min(tabMenu.y, Math.max(8, window.innerHeight - 460))
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="tab-context-head">
            <span className={`tab-kind ${tabKindClass(menuTab)}`}>
              <Icon name={tabKindIcon(menuTab)} size={12} />
            </span>
            <span className="tab-context-title">
              {tabTitle(menuTab, menuIndex)}
            </span>
            <span className={`tab-kind-tag ${tabKindClass(menuTab)}`}>
              {tabKindTag(menuTab)}
            </span>
          </div>

          <div className="tab-context-items">
            <button
              type="button"
              role="menuitem"
              disabled={menuRemote || menuIndex >= tabs.length - 1}
              onClick={() =>
                closeTabsByIds(
                  tabs
                    .slice(menuIndex + 1)
                    .filter(
                      (tab) =>
                        tab.ownerWindowId === windowId || !tab.ownerWindowId
                    )
                    .map((tab) => tab.id),
                  menuTab.id
                )
              }
            >
              <Icon name="arrow-right" size={14} />
              <span>关闭右侧</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={menuRemote || menuIndex <= 0}
              onClick={() =>
                closeTabsByIds(
                  tabs
                    .slice(0, menuIndex)
                    .filter(
                      (tab) =>
                        tab.ownerWindowId === windowId || !tab.ownerWindowId
                    )
                    .map((tab) => tab.id),
                  menuTab.id
                )
              }
            >
              <Icon name="arrow-left" size={14} />
              <span>关闭左侧</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={menuRemote || tabs.length <= 1}
              onClick={() =>
                closeTabsByIds(
                  tabs
                    .filter(
                      (tab, index) =>
                        index !== menuIndex &&
                        (tab.ownerWindowId === windowId || !tab.ownerWindowId)
                    )
                    .map((tab) => tab.id),
                  menuTab.id
                )
              }
            >
              <Icon name="close" size={14} />
              <span>关闭其他</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              disabled={menuRemote}
              onClick={() => {
                setTabMenu(null)
                requestCloseAll()
              }}
            >
              <Icon name="close-all" size={14} />
              <span>关闭全部</span>
            </button>

            <span className="tab-context-sep" aria-hidden="true" />

            <button
              type="button"
              role="menuitem"
              disabled={!menuRemote || menuTab?.terminalType === 'ssh'}
              title={
                menuTab?.terminalType === 'ssh'
                  ? 'SSH 会话暂不支持跨窗口移动'
                  : undefined
              }
              onClick={() => claimTabHere(menuTab.id)}
            >
              <Icon name="window-plus" size={14} />
              <span>在当前窗口打开</span>
            </button>

            <span className="tab-context-sep" aria-hidden="true" />

            <button
              type="button"
              role="menuitem"
              disabled={menuRemote}
              title={menuRemote ? '请到会话所在窗口复制' : undefined}
              onClick={() => duplicateTab(menuTab, menuIndex)}
            >
              <Icon name="copy" size={14} />
              <span>复制卡片</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                startRename(menuTab, menuIndex)
                setTabMenu(null)
              }}
            >
              <Icon name="edit" size={14} />
              <span>卡片设置</span>
            </button>
          </div>
        </div>
      ) : null}

      {renameTarget ? (
        <Modal
          title="卡片设置"
          width={520}
          icon={<Icon name="edit" size={17} />}
          onClose={() => setRenameTabId(null)}
          footer={
            <>
              <button className="soft-btn" onClick={() => setRenameTabId(null)}>
                取消
              </button>
              <button className="primary-btn" onClick={saveRename}>
                保存
              </button>
            </>
          }
        >
          <div className="tab-style-preview">
            <div
              className={`tab-card ${renameTabKind} ${tabSchemeClass(previewTab)}`}
              style={tabCardStyle(previewTab)}
            >
              <span className={`tab-kind ${renameTabKind}`}>
                <Icon name={tabKindIcon(renameTarget)} size={12} />
              </span>
              <span className="tab-title">
                {renameDraft.trim() || '标签名称'}
              </span>
              <span className={`tab-kind-tag ${renameTabKind}`}>
                {tabKindTag(renameTarget)}
              </span>
            </div>
          </div>

          <label className="field-block">
            <span className="micro-label">标签名称</span>
            <input
              className="modal-input"
              autoFocus
              value={renameDraft}
              placeholder="输入自定义名称"
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveRename()
              }}
            />
          </label>

          <div className="field-block">
            <span className="micro-label">配色样式</span>
            <div className="tab-scheme-grid">
              {TAB_COLOR_SCHEMES.map((scheme) => (
                <button
                  type="button"
                  key={scheme.id}
                  className={`tab-scheme-option ${
                    tabStyleDraft.scheme === scheme.id ? 'is-active' : ''
                  }`}
                  aria-pressed={tabStyleDraft.scheme === scheme.id}
                  onClick={() =>
                    setTabStyleDraft((prev) => ({
                      ...prev,
                      scheme: scheme.id,
                      background: '',
                      accent: ''
                    }))
                  }
                >
                  <span
                    className="tab-scheme-swatch"
                    style={{
                      background:
                        resolvedTheme === 'dark'
                          ? scheme.swatchDark
                          : scheme.swatch
                    }}
                  />
                  {scheme.label}
                </button>
              ))}
            </div>
          </div>

          <div className="tab-color-row">
            <label className="field-block">
              <span className="micro-label">卡片背景色</span>
              <div className="tab-color-control">
                <input
                  type="color"
                  className="tab-color-input"
                  value={
                    tabStyleDraft.background ||
                    (resolvedTheme === 'dark' ? '#0c0c0d' : '#ffffff')
                  }
                  onChange={(event) =>
                    setTabStyleDraft((prev) => ({
                      ...prev,
                      background: event.target.value
                    }))
                  }
                  title="选择卡片背景色"
                />
                <span className="tab-color-value">
                  {tabStyleDraft.background || '跟随配色样式'}
                </span>
                {tabStyleDraft.background ? (
                  <button
                    type="button"
                    className="tab-color-clear"
                    onClick={() =>
                      setTabStyleDraft((prev) => ({
                        ...prev,
                        background: ''
                      }))
                    }
                  >
                    清除
                  </button>
                ) : null}
              </div>
            </label>

            <label className="field-block">
              <span className="micro-label">左边框颜色</span>
              <div className="tab-color-control">
                <input
                  type="color"
                  className="tab-color-input"
                  value={tabStyleDraft.accent || defaultTabAccent}
                  onChange={(event) =>
                    setTabStyleDraft((prev) => ({
                      ...prev,
                      accent: event.target.value
                    }))
                  }
                  title="选择卡片左边框颜色"
                />
                <span className="tab-color-value">
                  {tabStyleDraft.accent || '跟随配色样式'}
                </span>
                {tabStyleDraft.accent ? (
                  <button
                    type="button"
                    className="tab-color-clear"
                    onClick={() =>
                      setTabStyleDraft((prev) => ({
                        ...prev,
                        accent: ''
                      }))
                    }
                  >
                    清除
                  </button>
                ) : null}
              </div>
            </label>
          </div>

          <p className="form-note">
            配色会随标签保存；选择预设样式会清除自定义背景和左边框。自定义背景会自动调整文字对比色。
          </p>
        </Modal>
      ) : null}

      {folderDeleteTarget ? (
        <Modal
          title={
            folderDeleteCount
              ? `删除文件夹「${folderDeleteTarget.name}」`
              : '删除文件夹'
          }
          width={470}
          tone="danger"
          icon={<Icon name="folder" size={15} />}
          onClose={() => setFolderDeleteTarget(null)}
          footer={
            folderDeleteCount ? (
              <>
                <button
                  className="soft-btn"
                  onClick={() => setFolderDeleteTarget(null)}
                >
                  取消
                </button>
                <button className="soft-btn" onClick={confirmFolderMoveToAll}>
                  移到「全部会话」
                </button>
                <button className="danger-btn" onClick={confirmFolderDeleteAll}>
                  删除所有会话
                </button>
              </>
            ) : (
              <>
                <button
                  className="soft-btn"
                  onClick={() => setFolderDeleteTarget(null)}
                >
                  取消
                </button>
                <button className="danger-btn" onClick={confirmFolderDeleteAll}>
                  删除文件夹
                </button>
              </>
            )
          }
        >
          {folderDeleteCount ? (
            <>
              <p className="modal-copy">
                文件夹内有 <strong>{folderDeleteCount}</strong>{' '}
                个会话，请选择处理方式：
              </p>
              <p className="modal-copy is-muted">
                选择「移到全部会话」会自动解除归类，会话继续保留；选择「删除所有会话」会关闭并清除这些会话的数据，不可撤销。
              </p>
            </>
          ) : (
            <p className="modal-copy">文件夹为空，删除后不可恢复。</p>
          )}
        </Modal>
      ) : null}

      {closeAllOpen ? (
        <Modal
          title="关闭全部会话"
          width={460}
          icon={<Icon name="close-all" size={17} />}
          onClose={() => setCloseAllOpen(false)}
          footer={
            <>
              <button className="soft-btn" onClick={() => setCloseAllOpen(false)}>
                取消
              </button>
              <button className="danger-btn" onClick={confirmCloseAll}>
                全部关闭
              </button>
            </>
          }
        >
          <p className="modal-copy">
            将关闭当前窗口的 <strong>{ownedTabs.length}</strong>{' '}
            个标签页，正在运行的串口、终端和 SSH 会话都会断开。
          </p>
          <p className="modal-copy is-muted">
            其他窗口中的会话不受影响。关闭后回到首页，此操作不可撤销。
          </p>
        </Modal>
      ) : null}

      {sshDialog ? (
        <SshConnectDialog
          mode={sshDialog.mode}
          profile={sshDialog.profile}
          profiles={sshProfiles}
          onClose={() => setSshDialog(null)}
          onConnect={handleSshConnect}
          onDeleteProfile={deleteSshProfile}
        />
      ) : null}

      {updateOpen && updateInfo ? (
        <Modal
          title={
            updateStatus === 'error'
              ? '更新安装失败'
              : updateStatus === 'downloaded' || updateStatus === 'installing'
                ? `安装新版本 v${updateInfo.latestVersion}`
                : updateInfo.available
                  ? `发现新版本 v${updateInfo.latestVersion}`
                  : '检查更新'
          }
          width={560}
          tone="update"
          icon={<Icon name="download" size={17} />}
          onClose={closeUpdateModal}
          footer={
            updateStatus === 'installing' ? (
              <span className="update-downloading-label">
                正在安装并重启…
              </span>
            ) : updateStatus === 'downloaded' ? (
              <>
                <button className="soft-btn" onClick={closeUpdateModal}>
                  稍后
                </button>
                <button className="primary-btn" onClick={installUpdate}>
                  <Icon name="refresh" size={14} />
                  立即安装并重启
                </button>
              </>
            ) : updateStatus === 'error' ? (
              <>
                <button className="soft-btn" onClick={closeUpdateModal}>
                  关闭
                </button>
                <button className="soft-btn" onClick={showUpdateFolder}>
                  打开文件夹
                </button>
                {updateFile ? (
                  <button
                    className="soft-btn"
                    onClick={openUpdateInstaller}
                  >
                    打开安装包
                  </button>
                ) : null}
                {updateFile ? (
                  <button
                    className="primary-btn"
                    onClick={installUpdate}
                  >
                    重试安装
                  </button>
                ) : (
                  <button
                    className="primary-btn"
                    onClick={() => beginUpdateDownload(updateInfo)}
                  >
                    重新下载
                  </button>
                )}
              </>
            ) : (
              <>
                <button className="soft-btn" onClick={closeUpdateModal}>
                  稍后
                </button>
                {updateInfo.asset ? (
                  <button
                    className="primary-btn"
                    onClick={() => beginUpdateDownload(updateInfo)}
                  >
                    <Icon name="download" size={14} />
                    下载并安装
                  </button>
                ) : (
                  <button className="primary-btn" onClick={openUpdateRelease}>
                    打开发布页
                  </button>
                )}
              </>
            )
          }
        >
          <div className="update-panel">
            <div className="update-version-row">
              <span>
                当前版本 <strong>v{updateInfo.currentVersion}</strong>
              </span>
              <Icon name="arrow-right" size={14} />
              <span>
                最新版本{' '}
                <strong>v{updateInfo.latestVersion || '—'}</strong>
              </span>
            </div>
            {updateInfo.publishedAt ? (
              <span className="update-published">
                发布于 {formatUpdateDate(updateInfo.publishedAt)}
              </span>
            ) : null}
            {updateInfo.notes ? (
              <div className="update-notes">{updateInfo.notes}</div>
            ) : (
              <p className="update-empty">该版本未提供更新说明。</p>
            )}
            {updateInfo.asset ? (
              <div className="update-asset">
                {updateInfo.asset.name}
                {updateInfo.asset.size
                  ? ` · ${formatUpdateSize(updateInfo.asset.size)}`
                  : ''}
              </div>
            ) : (
              <p className="update-empty">
                当前平台暂未找到安装包，请打开发布页手动下载。
              </p>
            )}
            {updateStatus === 'downloaded' ? (
              <p className="update-done">
                新版本安装包已下载完成。安装会关闭当前应用并自动重启。
              </p>
            ) : null}
            {updateStatus === 'installing' ? (
              <p className="update-done">正在安装并重启，请稍候…</p>
            ) : null}
            {updateStatus === 'error' && updateError ? (
              <p className="update-error">{updateError}</p>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {appToast ? (
        <div className={`toast ${appToast.kind}`}>{appToast.message}</div>
      ) : null}
    </div>
  )
}
