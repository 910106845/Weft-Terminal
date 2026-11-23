export const TERMINAL_FONT_GROUPS = [
  {
    label: '系统',
    options: [
      {
        value: 'system',
        label: '系统等宽',
        family:
          "'SFMono-Regular', 'SF Mono', Menlo, Monaco, 'Cascadia Code', 'Cascadia Mono', Consolas, 'Liberation Mono', monospace"
      }
    ]
  },
  {
    label: 'macOS',
    options: [
      {
        value: 'sf-mono',
        label: 'SF Mono',
        family: "'SF Mono', SFMono-Regular, Menlo, monospace"
      },
      {
        value: 'menlo',
        label: 'Menlo',
        family: 'Menlo, Monaco, monospace'
      },
      {
        value: 'monaco',
        label: 'Monaco',
        family: 'Monaco, Menlo, monospace'
      },
      {
        value: 'andale-mono',
        label: 'Andale Mono',
        family: "'Andale Mono', Menlo, monospace"
      }
    ]
  },
  {
    label: 'Windows',
    options: [
      {
        value: 'cascadia',
        label: 'Cascadia Code',
        family:
          "'Cascadia Code', 'Cascadia Mono', Consolas, 'Courier New', monospace"
      },
      {
        value: 'consolas',
        label: 'Consolas',
        family: "Consolas, 'Courier New', monospace"
      },
      {
        value: 'lucida-console',
        label: 'Lucida Console',
        family: "'Lucida Console', Consolas, monospace"
      },
      {
        value: 'courier',
        label: 'Courier New',
        family: "'Courier New', Courier, monospace"
      }
    ]
  },
  {
    label: '编程字体',
    options: [
      {
        value: 'jetbrains',
        label: 'JetBrains Mono',
        family: "'JetBrains Mono', 'Fira Code', Menlo, monospace"
      },
      {
        value: 'fira-code',
        label: 'Fira Code',
        family: "'Fira Code', 'Fira Mono', Menlo, monospace"
      },
      {
        value: 'source-code-pro',
        label: 'Source Code Pro',
        family: "'Source Code Pro', 'Source Code Pro Medium', Menlo, monospace"
      },
      {
        value: 'ibm-plex-mono',
        label: 'IBM Plex Mono',
        family: "'IBM Plex Mono', Menlo, monospace"
      },
      {
        value: 'roboto-mono',
        label: 'Roboto Mono',
        family: "'Roboto Mono', Menlo, monospace"
      },
      {
        value: 'hack',
        label: 'Hack',
        family: "'Hack', 'Hack Nerd Font', Menlo, monospace"
      },
      {
        value: 'inconsolata',
        label: 'Inconsolata',
        family: "'Inconsolata', 'Inconsolata-g', Menlo, monospace"
      },
      {
        value: 'victor-mono',
        label: 'Victor Mono',
        family: "'Victor Mono', 'JetBrains Mono', Menlo, monospace"
      },
      {
        value: 'maple-mono',
        label: 'Maple Mono',
        family: "'Maple Mono', 'Maple Mono NF', Menlo, monospace"
      }
    ]
  },
  {
    label: '中文等宽 / 跨平台',
    options: [
      {
        value: 'sarasa-mono-sc',
        label: 'Sarasa Mono SC（更纱黑体）',
        family:
          "'Sarasa Mono SC', 'Sarasa Mono TC', 'Noto Sans Mono CJK SC', Menlo, monospace"
      },
      {
        value: 'noto-sans-mono-cjk',
        label: 'Noto Sans Mono CJK',
        family:
          "'Noto Sans Mono CJK SC', 'Noto Sans Mono', 'Sarasa Mono SC', monospace"
      },
      {
        value: 'lxgw-wenkai-mono',
        label: 'LXGW WenKai Mono（霞鹜文楷）',
        family: "'LXGW WenKai Mono', 'LXGW WenKai', Menlo, monospace"
      },
      {
        value: 'dejavu-sans-mono',
        label: 'DejaVu Sans Mono',
        family: "'DejaVu Sans Mono', Menlo, monospace"
      },
      {
        value: 'liberation-mono',
        label: 'Liberation Mono',
        family: "'Liberation Mono', Menlo, monospace"
      },
      {
        value: 'ubuntu-mono',
        label: 'Ubuntu Mono',
        family: "'Ubuntu Mono', Menlo, monospace"
      }
    ]
  }
]

export const TERMINAL_FONT_OPTIONS = TERMINAL_FONT_GROUPS.flatMap(
  (group) => group.options
)

const FONT_VALUES = new Set(
  TERMINAL_FONT_OPTIONS.map((option) => option.value)
)

export const DEFAULT_TERMINAL_DISPLAY = {
  fontSize: 13,
  lineHeight: 1.45,
  cursorStyle: 'bar',
  enhanced: true,
  logHighlight: true,
  showTimestamps: true,
  fontFamily: 'system'
}

export function getTerminalFontFamily(value) {
  return (
    TERMINAL_FONT_OPTIONS.find((option) => option.value === value)?.family ||
    TERMINAL_FONT_OPTIONS[0].family
  )
}

const CURSOR_STYLES = new Set(['bar', 'block', 'underline'])

function clamp(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

export function normalizeTerminalDisplay(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  return {
    fontSize: clamp(value.fontSize, 10, 22, DEFAULT_TERMINAL_DISPLAY.fontSize),
    lineHeight: clamp(
      value.lineHeight,
      1.2,
      1.8,
      DEFAULT_TERMINAL_DISPLAY.lineHeight
    ),
    cursorStyle: CURSOR_STYLES.has(value.cursorStyle)
      ? value.cursorStyle
      : DEFAULT_TERMINAL_DISPLAY.cursorStyle,
    enhanced: true,
    logHighlight: true,
    showTimestamps: value.showTimestamps !== false,
    fontFamily: FONT_VALUES.has(value.fontFamily)
      ? value.fontFamily
      : DEFAULT_TERMINAL_DISPLAY.fontFamily
  }
}
