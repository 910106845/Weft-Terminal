const HEX_CHARS = '0123456789abcdefABCDEF'

export function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

export function parseHexInput(text) {
  let source = String(text ?? '')
  source = source.replace(/0x/gi, '')
  const cleaned = source.replace(/[\s,;:]+/g, '')

  if (cleaned.length === 0) {
    return { bytes: new Uint8Array(0), error: '' }
  }

  if (/[^0-9a-fA-F]/.test(cleaned)) {
    const bad = cleaned.split('').find((char) => !HEX_CHARS.includes(char))
    return { bytes: null, error: `包含非法的十六进制字符：${bad}` }
  }

  if (cleaned.length % 2 !== 0) {
    return { bytes: null, error: '十六进制字符个数必须为偶数' }
  }

  const bytes = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes[i / 2] = parseInt(cleaned.slice(i, i + 2), 16)
  }

  return { bytes, error: '' }
}

export function formatHexText(text) {
  const { bytes, error } = parseHexInput(text)
  if (error) return { text: String(text ?? ''), error }
  return { text: bytesToHex(bytes), error: '' }
}

export function formatTime(date) {
  const pad = (value, size = 2) => String(value).padStart(size, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

export function formatDateForFile(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function createDecoder(encoding) {
  const label = encoding === 'utf8' ? 'utf-8' : encoding === 'gbk' ? 'gbk' : 'windows-1252'
  return new TextDecoder(label)
}

export function decodeChunk(decoder, bytes) {
  return decoder.decode(bytes, { stream: true })
}

export function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

export function safeLocalStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function loadJSON(key, fallback) {
  const storage = safeLocalStorage()
  if (!storage) return fallback
  try {
    const raw = storage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function saveJSON(key, value) {
  const storage = safeLocalStorage()
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // 忽略存储失败（如容量已满）
  }
}

export function loadString(key, fallback = '') {
  const storage = safeLocalStorage()
  if (!storage) return fallback
  try {
    return storage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function saveString(key, value) {
  const storage = safeLocalStorage()
  if (!storage) return
  try {
    storage.setItem(key, value)
  } catch {
    // 忽略存储失败
  }
}

export function formatBytes(value) {
  const number = Number(value) || 0
  if (number < 1024) return `${number} B`
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KB`
  return `${(number / 1024 / 1024).toFixed(1)} MB`
}

export function formatRelativeTime(timestamp) {
  if (!timestamp) return '未使用'
  const diff = Date.now() - timestamp
  if (diff < 60_000) return '刚刚使用'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const date = new Date(timestamp)
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}
