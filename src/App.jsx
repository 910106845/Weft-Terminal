import { useCallback, useEffect, useRef, useState } from 'react'
import SessionPage from './components/SessionPage'
import TerminalPage from './components/TerminalPage'
import VirtualPortPage from './components/VirtualPortPage'
import SshConnectDialog from './components/SshConnectDialog'
import Modal from './components/Modal'
import Icon from './components/Icons'
import { normalizeFavorites } from './lib/favorites'
import { normalizeTerminalCommands } from './lib/terminalCommands'
import { normalizeSshProfiles, sshProfileLabel } from './lib/sshProfiles'
import {
  DEFAULT_TERMINAL_DISPLAY,
  normalizeTerminalDisplay
} from './lib/terminalDisplay'
import {
  loadJSON,
  loadString,
  saveJSON,
  saveString
} from './lib/format'
import { useSharedJSON, useSharedString } from './hooks/useSharedState'

const TABS_PREFIX = 'serialdebug.tabs.'
const ACTIVE_PREFIX = 'serialdebug.tabs.active.'

const windowId =
  new URLSearchParams(window.location.search).get('win') || 'main'
const tabsKey = `${TABS_PREFIX}${windowId}`
const activeKey = `${ACTIVE_PREFIX}${windowId}`

function createTabId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID()
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function clearTabData(tabId) {
  try {
    localStorage.removeItem(`serialdebug.settings.${tabId}`)
    localStorage.removeItem(`serialdebug.ui.${tabId}`)
    localStorage.removeItem(`serialdebug.terminal.${tabId}`)
    localStorage.removeItem(`serialdebug.virtual.ports.${tabId}`)
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
  { id: 'default', label: '默认', swatch: '#8d9aab', swatchDark: '#71839a' },
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
    migrateLegacy: false,
    ...overrides
  }
}

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
  const [resolvedTheme, setResolvedTheme] = useState('light')

  const [initialSession] = useState(() => {
    const saved = loadJSON(tabsKey, null)
    const savedActive = loadString(activeKey, '')

    if (Array.isArray(saved) && saved.length > 0) {
      const counts = { serial: 0, terminal: 0, virtual: 0 }
      const tabs = saved.map((item) => {
        const kind =
          item.kind === 'terminal'
            ? 'terminal'
            : item.kind === 'virtual'
              ? 'virtual'
              : 'serial'
        counts[kind] += 1
        const overrides = {
          id: item.id,
          portPath: item.portPath || '',
          terminalType: item.terminalType || 'local',
          shellId: item.shellId || '',
          sshProfile: item.sshProfile || null,
          sshRevision: 0,
          customName: item.customName || '',
          tabColorScheme: normalizeTabScheme(item.tabColorScheme),
          tabBackground: normalizeTabColor(item.tabBackground),
          tabAccent: normalizeTabColor(item.tabAccent),
          migrateLegacy:
            kind === 'serial' &&
            windowId === 'main' &&
            item.id === 'main' &&
            !loadJSON(`serialdebug.settings.${item.id}`, null)
        }
        if (item.fallbackTitle) {
          overrides.fallbackTitle =
            item.terminalType !== 'ssh' &&
            /^终端\s+\d+$/.test(item.fallbackTitle)
              ? item.fallbackTitle.replace(/^终端/, '本地终端')
              : item.fallbackTitle
        } else if (item.terminalType === 'ssh') {
          overrides.fallbackTitle = ''
        }
        return createTab(kind, counts[kind], overrides)
      })
      const activeId = tabs.some((tab) => tab.id === savedActive)
        ? savedActive
        : tabs[0].id
      return { tabs, activeId }
    }

    const id = windowId === 'main' ? 'main' : createTabId()
    return {
      tabs: [
        createTab('serial', 1, {
          id,
          migrateLegacy: windowId === 'main'
        })
      ],
      activeId: id
    }
  })

  const [tabs, setTabs] = useState(initialSession.tabs)
  const [activeTabId, setActiveTabId] = useState(initialSession.activeId)
  const [menuOpen, setMenuOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [tabListOpen, setTabListOpen] = useState(false)
  const [addMenuAlign, setAddMenuAlign] = useState('left')
  const [renameTabId, setRenameTabId] = useState(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [tabStyleDraft, setTabStyleDraft] = useState({
    scheme: 'default',
    background: '',
    accent: ''
  })
  const [dragTabId, setDragTabId] = useState(null)
  const [tabDropTarget, setTabDropTarget] = useState(null)
  const [sshCredentials, setSshCredentials] = useState({})
  const [sshDialog, setSshDialog] = useState(null)
  const menuWrapRef = useRef(null)
  const addMenuWrapRef = useRef(null)
  const tabListWrapRef = useRef(null)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolved =
        themePref === 'system' ? (media.matches ? 'dark' : 'light') : themePref
      setResolvedTheme(resolved)
      document.documentElement.dataset.theme = resolved
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [themePref])

  const onToggleTheme = useCallback(() => {
    setThemePref(resolvedTheme === 'dark' ? 'light' : 'dark')
  }, [resolvedTheme, setThemePref])

  useEffect(() => {
    saveJSON(
      tabsKey,
      tabs.map((tab) => ({
        id: tab.id,
        kind: tab.kind,
        terminalType: tab.terminalType || 'local',
        shellId: tab.shellId || '',
        sshProfile: tab.sshProfile || null,
        portPath: tab.portPath || '',
        fallbackTitle: tab.fallbackTitle || '',
        customName: tab.customName || '',
        tabColorScheme: tab.tabColorScheme || 'default',
        tabBackground: tab.tabBackground || '',
        tabAccent: tab.tabAccent || ''
      }))
    )
  }, [tabs])

  useEffect(() => {
    saveString(activeKey, activeTabId)
  }, [activeTabId])

  useEffect(() => {
    if (!menuOpen) return undefined
    const onPointerDown = (event) => {
      if (!menuWrapRef.current?.contains(event.target)) setMenuOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

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
    setMenuOpen(false)
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

  const addTab = useCallback((kind = 'serial') => {
    const id = createTabId()
    setTabs((prev) => {
      const tabKind =
        kind === 'virtual' ? 'virtual' : kind === 'terminal' ? 'terminal' : 'serial'
      const index = prev.filter((tab) => tab.kind === tabKind).length + 1
      return [...prev, createTab(tabKind, index, { id })]
    })
    setActiveTabId(id)
    setAddMenuOpen(false)
  }, [])

  const addTerminalTab = useCallback(() => addTab('terminal'), [addTab])
  const addSerialTab = useCallback(() => addTab('serial'), [addTab])

  const reorderTabs = useCallback((fromId, toId, position = 'before') => {
    setTabs((prev) => {
      const fromIndex = prev.findIndex((tab) => tab.id === fromId)
      const targetIndex = prev.findIndex((tab) => tab.id === toId)
      if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) {
        return prev
      }
      const next = prev.slice()
      const [moved] = next.splice(fromIndex, 1)
      const insertIndex = next.findIndex((tab) => tab.id === toId)
      if (insertIndex < 0) return prev
      next.splice(position === 'after' ? insertIndex + 1 : insertIndex, 0, moved)
      return next
    })
  }, [])

  const closeTab = useCallback(
    (id) => {
      const index = tabs.findIndex((tab) => tab.id === id)
      const closedTab = tabs[index]
      const next = tabs.filter((tab) => tab.id !== id)

      clearTabData(id)
      setSshCredentials((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
      if (sshDialog?.tabId === id) setSshDialog(null)
      if (renameTabId === id) setRenameTabId(null)

      if (next.length === 0) {
        const kind = closedTab?.kind === 'terminal' ? 'terminal' : 'serial'
        const replacement = createTab(kind, 1)
        setTabs([replacement])
        setActiveTabId(replacement.id)
        return
      }

      setTabs(next)
      if (activeTabId === id) {
        const fallback = next[Math.min(Math.max(index - 1, 0), next.length - 1)]
        setActiveTabId(fallback.id)
      }
    },
    [activeTabId, renameTabId, sshDialog?.tabId, tabs]
  )

  const startRename = useCallback((tab, index) => {
    setActiveTabId(tab.id)
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

      const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId)
      const nextTabs = tabs.filter((tab) => !closedIds.has(tab.id))
      let nextActiveId = activeTabId
      if (closedIds.has(activeTabId)) {
        nextActiveId =
          tabs
            .slice(activeIndex + 1)
            .find((tab) => !closedIds.has(tab.id))?.id ||
          tabs
            .slice(0, activeIndex)
            .reverse()
            .find((tab) => !closedIds.has(tab.id))?.id ||
          ''
      }

      if (nextTabs.length === 0) {
        const kind =
          closedTabs[closedTabs.length - 1]?.kind === 'terminal'
            ? 'terminal'
            : 'serial'
        const replacement = createTab(kind, 1)
        setTabs([replacement])
        setActiveTabId(replacement.id)
        return
      }

      setTabs(nextTabs)
      if (nextActiveId) setActiveTabId(nextActiveId)
    },
    [activeTabId, renameTabId, sshDialog?.tabId, tabs]
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
        return [
          ...prev,
          createTab('terminal', index, {
            id,
            terminalType: 'ssh',
            sshProfile: profile,
            fallbackTitle: sshProfileLabel(profile)
          })
        ]
      })
      setSshCredentials((prev) => ({ ...prev, [id]: credentials }))
      setActiveTabId(id)
      setSshDialog(null)
    },
    [setSshProfiles, sshDialog]
  )

  const openNewWindow = useCallback(() => {
    window.serialAPI?.newWindow?.()
    setMenuOpen(false)
  }, [])

  const handleUninstall = useCallback(async () => {
    setMenuOpen(false)
    if (!window.serialAPI?.uninstall) return
    if (
      !window.confirm(
        '确定卸载 Weft Terminal 吗？\n\n本地缓存、串口配置和指令收藏都会保留。'
      )
    ) {
      return
    }
    const result = await window.serialAPI.uninstall()
    if (!result || !result.ok) {
      window.alert((result && result.error) || '卸载失败')
    }
  }, [])

  const platform = window.serialAPI?.platform || ''
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

  return (
    <div className="app-shell">
      <div className="tab-strip">
        <div className="tab-list-wrap" ref={tabListWrapRef}>
          <button
            type="button"
            className={`tab-list-trigger ${tabListOpen ? 'is-active' : ''}`}
            onClick={() => setTabListOpen((prev) => !prev)}
            title="全部页面列表"
            aria-haspopup="listbox"
            aria-expanded={tabListOpen}
            aria-label="全部页面列表"
          >
            <Icon name="list" size={14} />
            <span className="tab-list-count">{tabs.length}</span>
          </button>
          {tabListOpen ? (
            <div className="tab-list-menu" role="listbox" aria-label="页面列表">
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
                        setActiveTabId(tab.id)
                        setTabListOpen(false)
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

        <div className="tab-cards" role="tablist" aria-label="会话页面">
          {tabs.map((tab, index) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === activeTabId}
              className={`tab-card ${tabKindClass(tab)} ${tabSchemeClass(
                tab
              )} ${tab.id === activeTabId ? 'is-active' : ''} ${
                dragTabId === tab.id ? 'is-dragging' : ''
              } ${
                tabDropTarget?.id === tab.id
                  ? `drop-${tabDropTarget.position}`
                  : ''
              }`}
              style={tabCardStyle(tab)}
              draggable
              onClick={() => setActiveTabId(tab.id)}
              onDragStart={(event) => {
                if (event.target.closest('button')) {
                  event.preventDefault()
                  return
                }
                setDragTabId(tab.id)
                setTabDropTarget(null)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', tab.id)
              }}
              onDragEnd={() => {
                setDragTabId(null)
                setTabDropTarget(null)
              }}
              onDragOver={(event) => {
                if (!dragTabId || dragTabId === tab.id) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                const rect = event.currentTarget.getBoundingClientRect()
                const position =
                  event.clientX > rect.left + rect.width / 2
                    ? 'after'
                    : 'before'
                if (
                  tabDropTarget?.id !== tab.id ||
                  tabDropTarget?.position !== position
                ) {
                  setTabDropTarget({ id: tab.id, position })
                }
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (dragTabId && dragTabId !== tab.id) {
                  const rect = event.currentTarget.getBoundingClientRect()
                  const position =
                    event.clientX > rect.left + rect.width / 2
                      ? 'after'
                      : 'before'
                  reorderTabs(dragTabId, tab.id, position)
                }
                setDragTabId(null)
                setTabDropTarget(null)
              }}
              onDoubleClick={(event) => {
                event.stopPropagation()
                startRename(tab, index)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setActiveTabId(tab.id)
                } else if (event.key === 'F2') {
                  event.preventDefault()
                  startRename(tab, index)
                }
              }}
              tabIndex={0}
              title={`${tabTitle(tab, index)}${
                tab.kind === 'serial' && tab.portPath ? ` · ${tab.portPath}` : ''
              } · 拖动排序 · 双击编辑`}
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
              <button
                type="button"
                className="tab-rename"
                title="编辑标签名称与配色"
                onClick={(event) => {
                  event.stopPropagation()
                  startRename(tab, index)
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <Icon name="edit" size={11} />
              </button>
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
            </div>
          ))}
        </div>

        <div className="tab-add-wrap" ref={addMenuWrapRef}>
          <button
            type="button"
            className={`tab-add ${addMenuOpen ? 'is-active' : ''}`}
            onClick={toggleAddMenu}
            title="新建会话"
            aria-haspopup="menu"
            aria-expanded={addMenuOpen}
          >
            <Icon name="plus" size={14} />
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

        <div className="tab-strip-actions">
          <button
            type="button"
            className="tab-action"
            onClick={openNewWindow}
            title="新建窗口 (⌘N / Ctrl+N)"
          >
            <Icon name="window-plus" size={14} />
            <span>新建窗口</span>
          </button>
          {platform === 'win32' ? (
            <div className="app-menu-wrap" ref={menuWrapRef}>
              <button
                type="button"
                className={`tab-action ${menuOpen ? 'is-active' : ''}`}
                onClick={() => {
                  setMenuOpen((prev) => !prev)
                  setAddMenuOpen(false)
                }}
                title="更多"
              >
                <Icon name="more" size={15} />
              </button>
              {menuOpen ? (
                <div className="app-menu">
                  <button type="button" onClick={openNewWindow}>
                    <Icon name="window-plus" size={13} />
                    新建窗口
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    onClick={handleUninstall}
                  >
                    <Icon name="trash" size={13} />
                    卸载应用
                  </button>
                  <div className="app-menu-note">
                    卸载不会删除本地配置和指令收藏
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="session-stack">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`session-host ${tab.id === activeTabId ? 'is-active' : ''}`}
          >
            {tab.kind === 'virtual' ? (
              <VirtualPortPage
                sessionId={tab.id}
                active={tab.id === activeTabId}
                accent={tabAccentOf(tab)}
                tagAccent={tabTagAccent(tab)}
                resolvedTheme={resolvedTheme}
                onToggleTheme={onToggleTheme}
              />
            ) : tab.kind === 'terminal' ? (
              <TerminalPage
                key={`${tab.id}:${tab.sshRevision || 0}`}
                sessionId={tab.id}
                accent={tabAccentOf(tab)}
                tagAccent={tabTagAccent(tab)}
                active={tab.id === activeTabId}
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
              />
            ) : (
              <SessionPage
                sessionId={tab.id}
                accent={tabAccentOf(tab)}
                tagAccent={tabTagAccent(tab)}
                active={tab.id === activeTabId}
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
              />
            )}
          </div>
        ))}
      </div>

      {renameTarget ? (
        <Modal
          title="编辑标签"
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
                    (resolvedTheme === 'dark' ? '#0b1624' : '#ffffff')
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
    </div>
  )
}
