export const SSH_AUTH_TYPES = ['password', 'key', 'agent']

export const SSH_ENCODINGS = [
  { value: 'utf8', label: 'UTF-8' },
  { value: 'gbk', label: 'GBK' },
  { value: 'gb18030', label: 'GB18030' },
  { value: 'big5', label: 'Big5' }
]

const SSH_ENCODING_VALUES = new Set(
  SSH_ENCODINGS.map((option) => option.value)
)

export function normalizeSshProfiles(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (item) =>
        item &&
        typeof item.host === 'string' &&
        item.host.trim() &&
        typeof item.username === 'string' &&
        item.username.trim()
    )
    .map((item, index) => ({
      id:
        item.id ||
        `ssh-profile-${Date.now()}-${index}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
      name: String(item.name || '').trim() || `${item.username}@${item.host}`,
      host: item.host.trim(),
      port: Math.min(65535, Math.max(1, Number(item.port) || 22)),
      username: item.username.trim(),
      authType: SSH_AUTH_TYPES.includes(item.authType)
        ? item.authType
        : 'password',
      privateKeyPath: String(item.privateKeyPath || ''),
      encoding: SSH_ENCODING_VALUES.has(item.encoding)
        ? item.encoding
        : 'utf8'
    }))
}

export function createSshProfile({
  id,
  name,
  host,
  port,
  username,
  authType,
  privateKeyPath,
  encoding
}) {
  return {
    id:
      id ||
      `ssh-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(name || '').trim() || `${username}@${host}`,
    host: String(host || '').trim(),
    port: Math.min(65535, Math.max(1, Number(port) || 22)),
    username: String(username || '').trim(),
    authType: SSH_AUTH_TYPES.includes(authType) ? authType : 'password',
    privateKeyPath: String(privateKeyPath || ''),
    encoding: SSH_ENCODING_VALUES.has(encoding) ? encoding : 'utf8'
  }
}

export function sshProfileLabel(profile) {
  if (!profile) return 'SSH'
  return (
    String(profile.name || '').trim() ||
    `${profile.username || ''}@${profile.host || ''}`
  )
}
