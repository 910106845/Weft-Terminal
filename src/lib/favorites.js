import { DEFAULT_SETTINGS, normalizeChecksumTo } from './defaults'
import { getChecksumAlgo } from './checksum'

export const FAVORITE_SEND_KEYS = [
  'encoding',
  'appendTail',
  'tail',
  'checksum',
  'checksumAlgo',
  'checksumHex',
  'checksumFrom',
  'checksumTo',
  'endian'
]

export function pickFavoriteSend(send = {}) {
  const picked = {}
  for (const key of FAVORITE_SEND_KEYS) {
    if (send[key] !== undefined) picked[key] = send[key]
  }
  return picked
}

function normalizeSend(send) {
  if (!send) return null
  const picked = pickFavoriteSend(send)
  if (picked.checksumTo !== undefined) {
    picked.checksumTo = normalizeChecksumTo(picked.checksumTo)
  }
  if (picked.checksumAlgo) {
    picked.checksumAlgo = getChecksumAlgo(picked.checksumAlgo).value
  }
  return picked
}

export function normalizeFavorites(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item) => item && typeof item.text === 'string')
    .map((item) => ({
      id: item.id ?? Date.now() + Math.random(),
      name: item.name || '未命名指令',
      text: item.text,
      encoding: item.encoding || item.send?.encoding || 'hex',
      send: normalizeSend(item.send),
      useCurrentSend: item.useCurrentSend === true,
      createdAt: item.createdAt || item.time || Date.now(),
      lastUsedAt: item.lastUsedAt || 0
    }))
}

export function favoriteSendSettings(item, base = DEFAULT_SETTINGS.send) {
  // 开启「持续使用当前发送设置」后，每次使用指令都采用当前发送参数
  if (item?.useCurrentSend) {
    return {
      ...base,
      encoding: item.encoding || base.encoding
    }
  }
  const stored = normalizeSend(item.send || {}) || {}
  const checksumAlgo = stored.checksumAlgo || getChecksumAlgo(base.checksumAlgo).value
  return {
    ...base,
    ...stored,
    checksumAlgo,
    checksumTo: normalizeChecksumTo(stored.checksumTo ?? base.checksumTo),
    encoding: item.encoding || stored.encoding || base.encoding
  }
}

export function createFavoriteRecord({ name, text, encoding, send }) {
  const normalized = normalizeSend(send) || {}
  return {
    id: Date.now() + Math.random(),
    name: name.trim() || '未命名指令',
    text,
    encoding: encoding || normalized.encoding || 'hex',
    send: normalized,
    useCurrentSend: false,
    createdAt: Date.now(),
    lastUsedAt: 0
  }
}
