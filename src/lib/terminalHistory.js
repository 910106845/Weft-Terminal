const STORAGE_KEY = 'serialdebug.terminal.history'
const HISTORY_LIMIT = 300

function readAll () {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch {
    return {}
  }
}

function writeAll (value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // 隐私模式或存储已满时忽略，历史只影响补全体验
  }
}

export function terminalHistoryKey ({ transport, shellId, host }) {
  if (transport === 'ssh') return `ssh:${host || 'unknown'}`
  return `local:${shellId || 'default'}`
}

export function loadTerminalHistory (key) {
  const list = readAll()[key]
  if (!Array.isArray(list)) return []
  const seen = new Set()
  return list
    .filter((item) => typeof item === 'string' && item.trim())
    .filter((item) => {
      const text = item.trim()
      if (seen.has(text)) return false
      seen.add(text)
      return true
    })
    .slice(0, HISTORY_LIMIT)
}

export function rememberTerminalCommand (key, command) {
  const text = String(command || '').trim()
  if (!text) return loadTerminalHistory(key)
  const all = readAll()
  const list = Array.isArray(all[key]) ? all[key] : []
  const next = [text, ...list.filter((item) => item !== text)].slice(
    0,
    HISTORY_LIMIT
  )
  all[key] = next
  writeAll(all)
  return next
}

// 合并 shell 自身的历史（已经是"最近使用在前"）。
// 导入的列表更完整，排在前面；应用内记到的额外命令补在后面。
export function mergeTerminalHistory (key, commands) {
  const all = readAll()
  const existing = Array.isArray(all[key]) ? all[key] : []
  const seen = new Set()
  const next = []
  for (const item of [...(commands || []), ...existing]) {
    const text = String(item || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    next.push(text)
    if (next.length >= HISTORY_LIMIT) break
  }
  all[key] = next
  writeAll(all)
  return next
}
