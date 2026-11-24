const RULES = [
  {
    id: 'url',
    tone: 'url',
    re: /https?:\/\/[^\s"'<>`]+/g
  },
  {
    id: 'email',
    tone: 'id',
    re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g
  },
  {
    id: 'ipv4',
    tone: 'ip',
    re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
  },
  {
    id: 'uuid',
    tone: 'id',
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
  },
  {
    id: 'datetime',
    tone: 'date',
    re: /\b\d{4}[-/]\d{2}[-/]\d{2}(?:[T ]\d{2}:\d{2}:\d{2})?\b/g
  },
  {
    id: 'timestamp',
    tone: 'time',
    re: /\b\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?\b/g
  },
  {
    id: 'error',
    tone: 'error',
    re: /\b(?:CRITICAL|FATAL|SEVERE|ERROR|FAIL(?:ED|URE)?)\b/gi
  },
  {
    id: 'warn',
    tone: 'warn',
    re: /\bWARN(?:ING)?\b/gi
  },
  {
    id: 'info',
    tone: 'info',
    re: /\b(?:INFO|NOTICE|SUCCESS)\b/gi
  },
  {
    id: 'debug',
    tone: 'debug',
    re: /\b(?:DEBUG|TRACE)\b/gi
  },
  {
    id: 'method',
    tone: 'method',
    re: /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g
  },
  {
    id: 'duration',
    tone: 'duration',
    re: /\b\d+(?:\.\d+)?(?:ms|us|µs|ns|s|KB|MB|GB|TB|B|%)\b/gi
  }
]

const LIGHT_TERMINAL_COLORS = {
  url: { fg: '#1d4ed8' },
  ip: { fg: '#7c3aed' },
  id: { fg: '#6d28d9' },
  date: { fg: '#0e7490' },
  time: { fg: '#0e7490' },
  error: { fg: '#a61b1b' },
  warn: { fg: '#8a4b00' },
  info: { fg: '#075985' },
  debug: { fg: '#475569' },
  method: { fg: '#1e40af' },
  duration: { fg: '#b45309' }
}

const DARK_TERMINAL_COLORS = {
  url: { fg: '#7dd3fc' },
  ip: { fg: '#c4b5fd' },
  id: { fg: '#ddd6fe' },
  date: { fg: '#7dd3fc' },
  time: { fg: '#7dd3fc' },
  error: { fg: '#ffb4ab' },
  warn: { fg: '#fcd34d' },
  info: { fg: '#bae6fd' },
  debug: { fg: '#d4d4d6' },
  method: { fg: '#bfdbfe' },
  duration: { fg: '#fcd34d' }
}

export function findLogHighlights(text) {
  if (!text) return []
  const matches = []
  for (const rule of RULES) {
    const re = rule.re
    re.lastIndex = 0
    let match
    while ((match = re.exec(text))) {
      if (!match[0]) {
        re.lastIndex += 1
        continue
      }
      const start = match.index
      const end = start + match[0].length
      let overlaps = false
      for (const item of matches) {
        if (start < item.end && end > item.start) {
          overlaps = true
          break
        }
      }
      if (!overlaps) {
        matches.push({ start, end, tone: rule.tone })
      }
    }
  }
  return matches.sort((a, b) => a.start - b.start)
}

export function getLogHighlightTerminalColors(theme) {
  return theme === 'dark' ? DARK_TERMINAL_COLORS : LIGHT_TERMINAL_COLORS
}
