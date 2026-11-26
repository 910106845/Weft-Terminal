// 终端配色 / 字体预设。
// 配色取自各主题官方仓库与 iTerm2-Color-Schemes 的终端移植版本；
// 只保存 themeId 和用户微调后的显示参数。

const WEFT_DARK = {
  background: '#0b0b0c',
  foreground: '#eef0f2',
  cursor: '#86ffd6',
  cursorAccent: '#0b0b0c',
  selectionBackground: 'rgba(134, 255, 214, 0.24)',
  black: '#101012',
  red: '#ff8096',
  green: '#86ffd6',
  yellow: '#ffe19a',
  blue: '#83d3ff',
  magenta: '#d0b0ff',
  cyan: '#8cf5ff',
  white: '#eef0f2',
  brightBlack: '#8a8a8f',
  brightRed: '#ffabb9',
  brightGreen: '#b7ffe9',
  brightYellow: '#fff0c4',
  brightBlue: '#b1e4ff',
  brightMagenta: '#e6d1ff',
  brightCyan: '#c4fbff',
  brightWhite: '#ffffff'
}

const WEFT_LIGHT = {
  background: '#fbfcfe',
  foreground: '#142842',
  cursor: '#007f68',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(0, 127, 104, 0.2)',
  black: '#1b2b3d',
  red: '#b4233b',
  green: '#007a5e',
  yellow: '#7a5600',
  blue: '#1d4ed8',
  magenta: '#6d28d9',
  cyan: '#007c91',
  white: '#52657a',
  brightBlack: '#687b8f',
  brightRed: '#d92d4d',
  brightGreen: '#059669',
  brightYellow: '#a16207',
  brightBlue: '#1e40af',
  brightMagenta: '#5b21b6',
  brightCyan: '#0e7490',
  brightWhite: '#1f3148'
}

// https://github.com/catppuccin/catppuccin — Mocha
const CATPPUCCIN_MOCHA = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  cursorAccent: '#1e1e2e',
  selectionBackground: 'rgba(88, 91, 112, 0.55)',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#f5c2e7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f7aec2',
  brightGreen: '#c2ecbf',
  brightYellow: '#fcd682',
  brightBlue: '#aeccfc',
  brightMagenta: '#f398da',
  brightCyan: '#b1eae1',
  brightWhite: '#a6adc8'
}

// https://github.com/catppuccin/catppuccin — Latte
const CATPPUCCIN_LATTE = {
  background: '#eff1f5',
  foreground: '#4c4f69',
  cursor: '#dc8a78',
  cursorAccent: '#eff1f5',
  selectionBackground: 'rgba(172, 176, 190, 0.5)',
  black: '#bcc0cc',
  red: '#d20f39',
  green: '#40a02b',
  yellow: '#df8e1d',
  blue: '#1e66f5',
  magenta: '#ea76cb',
  cyan: '#179299',
  white: '#5c5f77',
  brightBlack: '#acb0be',
  brightRed: '#e7103f',
  brightGreen: '#46b02f',
  brightYellow: '#e49931',
  brightBlue: '#3878f6',
  brightMagenta: '#ef95d7',
  brightCyan: '#19a1a8',
  brightWhite: '#6c6f85'
}

// https://github.com/folke/tokyonight.nvim — Night
const TOKYO_NIGHT = {
  background: '#1a1b26',
  foreground: '#a9b1d6',
  cursor: '#c0caf5',
  cursorAccent: '#1a1b26',
  selectionBackground: 'rgba(122, 162, 247, 0.28)',
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5'
}

// https://github.com/rose-pine/rose-pine — Main
const ROSE_PINE = {
  background: '#191724',
  foreground: '#e0def4',
  cursor: '#e0def4',
  cursorAccent: '#191724',
  selectionBackground: 'rgba(64, 61, 82, 0.8)',
  black: '#26233a',
  red: '#eb6f92',
  green: '#31748f',
  yellow: '#f6c177',
  blue: '#9ccfd8',
  magenta: '#c4a7e7',
  cyan: '#ebbcba',
  white: '#e0def4',
  brightBlack: '#6e6a86',
  brightRed: '#eb6f92',
  brightGreen: '#31748f',
  brightYellow: '#f6c177',
  brightBlue: '#9ccfd8',
  brightMagenta: '#c4a7e7',
  brightCyan: '#ebbcba',
  brightWhite: '#e0def4'
}

// https://github.com/rebelot/kanagawa.nvim — Wave
const KANAGAWA_WAVE = {
  background: '#1f1f28',
  foreground: '#dcd7ba',
  cursor: '#dcd7ba',
  cursorAccent: '#1f1f28',
  selectionBackground: 'rgba(42, 42, 55, 0.85)',
  black: '#090618',
  red: '#c34043',
  green: '#76946a',
  yellow: '#c0a36e',
  blue: '#7e9cd8',
  magenta: '#957fb8',
  cyan: '#6a9589',
  white: '#c8c093',
  brightBlack: '#727169',
  brightRed: '#e82424',
  brightGreen: '#98bb6c',
  brightYellow: '#e6c384',
  brightBlue: '#7fb4ca',
  brightMagenta: '#938aa9',
  brightCyan: '#7aa89f',
  brightWhite: '#dcd7ba'
}

// https://github.com/sainnhe/everforest — Dark Medium
const EVERFOREST_DARK = {
  background: '#232a2e',
  foreground: '#d3c6aa',
  cursor: '#e69875',
  cursorAccent: '#232a2e',
  selectionBackground: 'rgba(84, 58, 72, 0.75)',
  black: '#7a8478',
  red: '#e67e80',
  green: '#a7c080',
  yellow: '#dbbc7f',
  blue: '#7fbbb3',
  magenta: '#d699b6',
  cyan: '#83c092',
  white: '#f2efdf',
  brightBlack: '#a6b0a0',
  brightRed: '#f85552',
  brightGreen: '#8da101',
  brightYellow: '#dfa000',
  brightBlue: '#3a94c5',
  brightMagenta: '#df69ba',
  brightCyan: '#35a77c',
  brightWhite: '#fffbef'
}

// https://github.com/morhetz/gruvbox — Dark
const GRUVBOX_DARK = {
  background: '#282828',
  foreground: '#ebdbb2',
  cursor: '#fabd2f',
  cursorAccent: '#282828',
  selectionBackground: 'rgba(250, 189, 47, 0.26)',
  black: '#282828',
  red: '#fb4934',
  green: '#b8bb26',
  yellow: '#fabd2f',
  blue: '#83a598',
  magenta: '#d3869b',
  cyan: '#8ec07c',
  white: '#ebdbb2',
  brightBlack: '#928374',
  brightRed: '#fb4934',
  brightGreen: '#b8bb26',
  brightYellow: '#fabd2f',
  brightBlue: '#83a598',
  brightMagenta: '#d3869b',
  brightCyan: '#8ec07c',
  brightWhite: '#fbf1c7'
}

// https://www.nordtheme.com
const NORD = {
  background: '#2e3440',
  foreground: '#d8dee9',
  cursor: '#88c0d0',
  cursorAccent: '#2e3440',
  selectionBackground: 'rgba(136, 192, 208, 0.28)',
  black: '#3b4252',
  red: '#bf616a',
  green: '#a3be8c',
  yellow: '#ebcb8b',
  blue: '#81a1c1',
  magenta: '#b48ead',
  cyan: '#88c0d0',
  white: '#e5e9f0',
  brightBlack: '#4c566a',
  brightRed: '#bf616a',
  brightGreen: '#a3be8c',
  brightYellow: '#ebcb8b',
  brightBlue: '#81a1c1',
  brightMagenta: '#b48ead',
  brightCyan: '#8fbcbb',
  brightWhite: '#eceff4'
}

// https://github.com/atom/one-dark-syntax
const ONE_DARK = {
  background: '#282c34',
  foreground: '#abb2bf',
  cursor: '#528bff',
  cursorAccent: '#282c34',
  selectionBackground: 'rgba(82, 139, 255, 0.3)',
  black: '#282c34',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff'
}

// https://github.com/dracula/dracula-theme
const DRACULA = {
  background: '#282a36',
  foreground: '#f8f8f2',
  cursor: '#f8f8f2',
  cursorAccent: '#282a36',
  selectionBackground: 'rgba(189, 147, 249, 0.3)',
  black: '#21222c',
  red: '#ff5555',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#bd93f9',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#f8f8f2',
  brightBlack: '#6272a4',
  brightRed: '#ff6e6e',
  brightGreen: '#69ff94',
  brightYellow: '#ffffa5',
  brightBlue: '#d6acff',
  brightMagenta: '#ff92df',
  brightCyan: '#a4ffff',
  brightWhite: '#ffffff'
}

// https://github.com/primer/github-vscode-theme — Light Default
const GITHUB_LIGHT = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#0969da',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(9, 105, 218, 0.18)',
  black: '#24292f',
  red: '#cf222e',
  green: '#116329',
  yellow: '#4d2d00',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#633c01',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#8c959f'
}

// https://ethanschoonover.com/solarized — Light
const SOLARIZED_LIGHT = {
  background: '#fdf6e3',
  foreground: '#657b83',
  cursor: '#586e75',
  cursorAccent: '#fdf6e3',
  selectionBackground: 'rgba(38, 139, 210, 0.2)',
  black: '#073642',
  red: '#dc322f',
  green: '#859900',
  yellow: '#b58900',
  blue: '#268bd2',
  magenta: '#d33682',
  cyan: '#2aa198',
  white: '#eee8d5',
  brightBlack: '#93a1a1',
  brightRed: '#cb4b16',
  brightGreen: '#586e75',
  brightYellow: '#657b83',
  brightBlue: '#839496',
  brightMagenta: '#6c71c4',
  brightCyan: '#2aa198',
  brightWhite: '#fdf6e3'
}

// Windows 10/11 经典控制台配色
const WINDOWS_CONSOLE = {
  background: '#012456',
  foreground: '#cccccc',
  cursor: '#ffffff',
  cursorAccent: '#012456',
  selectionBackground: 'rgba(255, 255, 255, 0.25)',
  black: '#0c0c0c',
  red: '#c50f1f',
  green: '#13a10e',
  yellow: '#c19c00',
  blue: '#0037da',
  magenta: '#881798',
  cyan: '#3a96dd',
  white: '#cccccc',
  brightBlack: '#767676',
  brightRed: '#e74856',
  brightGreen: '#16c60c',
  brightYellow: '#f9f1a5',
  brightBlue: '#3b78ff',
  brightMagenta: '#b4009e',
  brightCyan: '#61d6d6',
  brightWhite: '#f2f2f2'
}

export const TERMINAL_THEMES = [
  {
    id: 'weft',
    label: 'Weft',
    mode: 'auto',
    dark: WEFT_DARK,
    light: WEFT_LIGHT,
    display: {
      fontFamily: 'noto-sans-mono-cjk',
      fontSize: 12,
      lineHeight: 1.45,
      cursorStyle: 'bar'
    }
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    mode: 'dark',
    colors: CATPPUCCIN_MOCHA,
    display: {
      fontFamily: 'jetbrains',
      fontSize: 13,
      lineHeight: 1.4,
      cursorStyle: 'bar'
    }
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    mode: 'dark',
    colors: TOKYO_NIGHT,
    display: {
      fontFamily: 'maple-mono',
      fontSize: 13,
      lineHeight: 1.4,
      cursorStyle: 'bar'
    }
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox Dark',
    mode: 'dark',
    colors: GRUVBOX_DARK,
    display: {
      fontFamily: 'jetbrains',
      fontSize: 13,
      lineHeight: 1.4,
      cursorStyle: 'block'
    }
  },
  {
    id: 'rose-pine',
    label: 'Rosé Pine',
    mode: 'dark',
    colors: ROSE_PINE,
    display: {
      fontFamily: 'fira-code',
      fontSize: 13,
      lineHeight: 1.5,
      cursorStyle: 'bar'
    }
  },
  {
    id: 'kanagawa',
    label: 'Kanagawa Wave',
    mode: 'dark',
    colors: KANAGAWA_WAVE,
    display: {
      fontFamily: 'ibm-plex-mono',
      fontSize: 13,
      lineHeight: 1.5,
      cursorStyle: 'bar'
    }
  },
  {
    id: 'everforest',
    label: 'Everforest Dark',
    mode: 'dark',
    colors: EVERFOREST_DARK,
    display: {
      fontFamily: 'source-code-pro',
      fontSize: 13,
      lineHeight: 1.45,
      cursorStyle: 'bar'
    }
  },
  {
    id: 'nord',
    label: 'Nord',
    mode: 'dark',
    colors: NORD,
    display: {
      fontFamily: 'source-code-pro',
      fontSize: 13,
      lineHeight: 1.45,
      cursorStyle: 'bar'
    }
  },
  {
    id: 'one-dark',
    label: 'One Dark',
    mode: 'dark',
    colors: ONE_DARK,
    display: {
      fontFamily: 'jetbrains',
      fontSize: 13,
      lineHeight: 1.4,
      cursorStyle: 'bar'
    }
  },
  {
    id: 'dracula',
    label: 'Dracula',
    mode: 'dark',
    colors: DRACULA,
    display: {
      fontFamily: 'fira-code',
      fontSize: 13,
      lineHeight: 1.4,
      cursorStyle: 'bar'
    }
  },
  {
    id: 'catppuccin-latte',
    label: 'Catppuccin Latte',
    mode: 'light',
    colors: CATPPUCCIN_LATTE,
    display: {
      fontFamily: 'jetbrains',
      fontSize: 13,
      lineHeight: 1.45,
      cursorStyle: 'bar'
    }
  },
  {
    id: 'github-light',
    label: 'GitHub Light',
    mode: 'light',
    colors: GITHUB_LIGHT,
    display: {
      fontFamily: 'system',
      fontSize: 13,
      lineHeight: 1.45,
      cursorStyle: 'bar'
    }
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    mode: 'light',
    colors: SOLARIZED_LIGHT,
    display: {
      fontFamily: 'ibm-plex-mono',
      fontSize: 13,
      lineHeight: 1.5,
      cursorStyle: 'bar'
    }
  },
  {
    id: 'windows-console',
    label: 'Windows Console',
    mode: 'dark',
    colors: WINDOWS_CONSOLE,
    display: {
      fontFamily: 'cascadia',
      fontSize: 14,
      lineHeight: 1.4,
      cursorStyle: 'block'
    }
  }
]

export const TERMINAL_THEME_IDS = new Set(
  TERMINAL_THEMES.map((theme) => theme.id)
)

const THEME_MAP = new Map(TERMINAL_THEMES.map((theme) => [theme.id, theme]))
export function isKnownTerminalTheme (themeId) {
  return THEME_MAP.has(themeId)
}

export function getTerminalThemeDefinition (themeId) {
  return THEME_MAP.get(themeId) || TERMINAL_THEMES[0]
}

export function getTerminalTheme(themeId, resolvedTheme) {
  const theme = getTerminalThemeDefinition(themeId)
  if (theme.dark || theme.light) {
    return resolvedTheme === 'dark' ? theme.dark : theme.light
  }
  return theme.colors
}

export function isDarkTerminalTheme(themeId, resolvedTheme) {
  const theme = getTerminalThemeDefinition(themeId)
  if (theme.mode === 'light') return false
  if (theme.mode === 'dark') return true
  return resolvedTheme === 'dark'
}

export function terminalThemePreset(themeId) {
  const theme = getTerminalThemeDefinition(themeId)
  return { themeId: theme.id, ...theme.display }
}

export function terminalThemeSwatch(themeId, resolvedTheme) {
  const colors = getTerminalTheme(themeId, resolvedTheme)
  return [
    colors.background,
    colors.foreground,
    colors.green,
    colors.blue,
    colors.red
  ]
}

// TUI / alternate screen 统一使用黑底，避免全屏程序出现亮背景
export const TUI_TERM_THEME = {
  ...WEFT_DARK,
  background: '#000000',
  cursorAccent: '#000000'
}
