const NORMAL_COLORS = [
  '#000000', '#c0392b', '#27ae60', '#b8860b',
  '#2c6fd6', '#8e44ad', '#008b8b', '#d0d0d0'
]

const BRIGHT_COLORS = [
  '#555555', '#ff5f5f', '#4ade80', '#f5c542',
  '#5b9dff', '#c084fc', '#22d3ee', '#ffffff'
]

function xtermColor(index) {
  if (index < 16) {
    return index < 8 ? NORMAL_COLORS[index] : BRIGHT_COLORS[index - 8]
  }
  if (index < 232) {
    const value = index - 16
    const r = Math.floor(value / 36)
    const g = Math.floor((value % 36) / 6)
    const b = value % 6
    const channel = (n) => (n === 0 ? 0 : 55 + n * 40)
    return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`
  }
  const gray = 8 + (index - 232) * 10
  return `rgb(${gray}, ${gray}, ${gray})`
}

export function parseAnsi(text) {
  const segments = []
  const pattern = /\x1b\[([0-9;]*)m/g
  let color = null
  let lastIndex = 0
  let match = pattern.exec(text)

  while (match) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), color })
    }

    const codes = match[1] === '' ? [0] : match[1].split(';').map(Number)
    for (let i = 0; i < codes.length; i += 1) {
      const code = codes[i]
      if (code === 0) color = null
      else if (code === 39) color = null
      else if (code >= 30 && code <= 37) color = NORMAL_COLORS[code - 30]
      else if (code >= 90 && code <= 97) color = BRIGHT_COLORS[code - 90]
      else if (code === 38 && codes[i + 1] === 5) {
        color = xtermColor(codes[i + 2])
        i += 2
      } else if (code === 38 && codes[i + 1] === 2) {
        color = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`
        i += 4
      }
    }

    lastIndex = pattern.lastIndex
    match = pattern.exec(text)
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), color })
  }

  return segments
}

export function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
}
