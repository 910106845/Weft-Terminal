export function normalizeTerminalCommands(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item) => item && typeof item.command === 'string')
    .map((item, index) => ({
      id: item.id ?? `terminal-command-${Date.now()}-${index}`,
      name: item.name || '未命名指令',
      command: item.command,
      createdAt: item.createdAt || Date.now(),
      lastUsedAt: item.lastUsedAt || 0
    }))
}

export function createTerminalCommand({ name, command }) {
  return {
    id: `terminal-command-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: (name || '').trim() || '未命名指令',
    command: (command || '').trim(),
    createdAt: Date.now(),
    lastUsedAt: 0
  }
}
