import { strFromU8, unzipSync } from 'fflate'
import { parse as parseJsonc } from 'jsonc-parser'

// 从 VS Code 主题 JSON、JetBrains .icls，以及 .vsix / .jar / .zip 插件包中
// 提取适合终端使用的配色。VS Code 主题会优先读取 terminal.* 颜色键，
// 没有时用 editor.* 和 tokenColors 做兜底；JetBrains .icls 没有标准 ANSI
// 调色板，因此用控制台颜色和语法属性做近似映射。

const GENERIC_DARK = {
  black: '#3b4048',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#dcdfe4'
}

const GENERIC_LIGHT = {
  black: '#383a42',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
  white: '#a0a1a7'
}

const ANSI_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white'
]

const BRIGHT_MAP = {
  black: 'brightBlack',
  red: 'brightRed',
  green: 'brightGreen',
  yellow: 'brightYellow',
  blue: 'brightBlue',
  magenta: 'brightMagenta',
  cyan: 'brightCyan',
  white: 'brightWhite'
}

const FALLBACK_DISPLAY = {
  fontFamily: 'system',
  fontSize: 13,
  lineHeight: 1.45,
  cursorStyle: 'bar'
}

function expandHex (value) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (!text.startsWith('#')) return ''
  const hex = text.slice(1)
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
  }
  if (hex.length === 6 || hex.length === 8) return `#${hex}`
  return ''
}

function toRgb (value) {
  const hex = expandHex(value)
  if (!hex) return null
  const n = parseInt(hex.slice(1, 7), 16)
  if (!Number.isFinite(n)) return null
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbToHex ({ r, g, b }) {
  return (
    '#' +
    [r, g, b]
      .map((channel) =>
        Math.max(0, Math.min(255, Math.round(channel)))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}

function mix (value, target, amount) {
  const source = toRgb(value)
  const goal = toRgb(target)
  if (!source || !goal) return value
  return rgbToHex({
    r: source.r + (goal.r - source.r) * amount,
    g: source.g + (goal.g - source.g) * amount,
    b: source.b + (goal.b - source.b) * amount
  })
}

function lighten (value, amount) {
  return mix(value, '#ffffff', amount)
}

function darken (value, amount) {
  return mix(value, '#000000', amount)
}

function withAlpha (value, alpha) {
  const rgb = toRgb(value)
  if (!rgb) return `rgba(128, 128, 128, ${alpha})`
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

function luminance (value) {
  const rgb = toRgb(value)
  if (!rgb) return 0
  const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function isDarkColor (value) {
  return luminance(value) < 0.5
}

function pickColor (source, keys, fallback) {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && expandHex(value)) return value
  }
  return fallback
}

function findTokenColor (theme, scopes) {
  const tokens = Array.isArray(theme.tokenColors) ? theme.tokenColors : []
  for (const scope of scopes) {
    for (const token of tokens) {
      const list = Array.isArray(token?.scope) ? token.scope : [token?.scope]
      if (!list.some((item) => typeof item === 'string' && item.includes(scope))) {
        continue
      }
      const foreground = token?.settings?.foreground
      if (typeof foreground === 'string' && expandHex(foreground)) return foreground
    }
  }
  return ''
}

function buildAnsi (theme, background, foreground, terminalColors) {
  const dark = isDarkColor(background)
  const generic = dark ? GENERIC_DARK : GENERIC_LIGHT
  const token = (scopes) => findTokenColor(theme, scopes)

  const normal = {
    black: pickColor(terminalColors, ['terminal.ansiBlack'], darken(background, 0.28)),
    red: pickColor(
      terminalColors,
      ['terminal.ansiRed'],
      token(['invalid', 'regexp']) || generic.red
    ),
    green: pickColor(
      terminalColors,
      ['terminal.ansiGreen'],
      token(['string']) || generic.green
    ),
    yellow: pickColor(
      terminalColors,
      ['terminal.ansiYellow'],
      token(['number', 'constant']) || generic.yellow
    ),
    blue: pickColor(
      terminalColors,
      ['terminal.ansiBlue'],
      token(['keyword', 'storage']) || generic.blue
    ),
    magenta: pickColor(
      terminalColors,
      ['terminal.ansiMagenta'],
      token(['function', 'entity.name.function']) || generic.magenta
    ),
    cyan: pickColor(
      terminalColors,
      ['terminal.ansiCyan'],
      token(['type', 'support.class']) || generic.cyan
    ),
    white: pickColor(terminalColors, ['terminal.ansiWhite'], foreground)
  }

  const colors = {
    background,
    foreground,
    cursor: pickColor(
      terminalColors,
      ['terminalCursor.foreground', 'terminal.foreground'],
      foreground
    ),
    cursorAccent: background,
    selectionBackground:
      pickColor(
        terminalColors,
        ['terminal.selectionBackground', 'editor.selectionBackground'],
        ''
      ) || withAlpha(foreground, 0.22)
  }

  for (const key of ANSI_KEYS) {
    const brightKey = BRIGHT_MAP[key]
    const brightFallback = dark
      ? lighten(normal[key], 0.12)
      : darken(normal[key], 0.12)
    colors[key] = normal[key]
    colors[brightKey] = pickColor(
      terminalColors,
      [`terminal.ansi${brightKey[0].toUpperCase()}${brightKey.slice(1)}`],
      brightFallback
    )
  }

  return colors
}

export function parseVSCodeTheme (json, fallbackName = 'VS Code 主题') {
  if (!json || typeof json !== 'object') {
    throw new Error('不是有效的主题 JSON')
  }
  const colors =
    json.colors && typeof json.colors === 'object' ? json.colors : {}
  const hasVSCodeMarker =
    Boolean(json.tokenColors) ||
    Object.keys(colors).some(
      (key) => key.startsWith('terminal.') || key.startsWith('editor.')
    )
  if (!hasVSCodeMarker) {
    throw new Error('未找到 VS Code 主题颜色字段')
  }
  const themeType = String(json.type || '').toLowerCase()
  const looksLight =
    themeType === 'light' || themeType === 'vs' || themeType === 'hc-light'
  const background =
    pickColor(colors, ['terminal.background', 'editor.background'], '') ||
    (looksLight ? '#ffffff' : '#1e1e1e')
  const foreground =
    pickColor(colors, ['terminal.foreground', 'editor.foreground'], '') ||
    (isDarkColor(background) ? '#d4d4d4' : '#24292f')
  const mode = looksLight
    ? 'light'
    : themeType.includes('dark') || themeType === 'hc-black'
      ? 'dark'
      : isDarkColor(background)
        ? 'dark'
        : 'light'
  return {
    label:
      typeof json.name === 'string' && json.name.trim()
        ? json.name.trim()
        : fallbackName,
    mode,
    colors: buildAnsi(json, background, foreground, colors),
    display: { ...FALLBACK_DISPLAY }
  }
}

function readIclsAttributes (doc) {
  const attributes = {}
  doc.querySelectorAll('attributes > option').forEach((option) => {
    const name = option.getAttribute('name')
    if (!name) return
    const foreground = option
      .querySelector('value > option[name="FOREGROUND"]')
      ?.getAttribute('value')
    const background = option
      .querySelector('value > option[name="BACKGROUND"]')
      ?.getAttribute('value')
    attributes[name] = {
      foreground: foreground ? expandHex(`#${foreground.replace(/^#/, '')}`) : '',
      background: background ? expandHex(`#${background.replace(/^#/, '')}`) : ''
    }
  })
  return attributes
}

function parseSchemeXml (xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) return null
  const scheme = doc.querySelector('scheme')
  if (!scheme) return null
  const palette = {}
  doc.querySelectorAll('colors > option').forEach((option) => {
    const name = option.getAttribute('name')
    const value = option.getAttribute('value')
    if (name && value) {
      palette[name] = expandHex(
        value.startsWith('#') ? value : `#${value.replace(/^#/, '')}`
      )
    }
  })
  return {
    scheme,
    palette,
    attributes: readIclsAttributes(doc)
  }
}

function buildJetBrainsColors ({
  dark,
  background,
  foreground,
  cursor,
  selection,
  attributes = {},
  accentColor,
  secondaryAccentColor
}) {
  const attr = (...names) =>
    names.map((name) => attributes[name]?.foreground).find(Boolean) || ''
  const fallback = dark ? GENERIC_DARK : GENERIC_LIGHT
  const normal = {
    black: dark ? darken(background, 0.3) : lighten(background, 0.15),
    red: attr('DEFAULT_INVALID', 'LOG_ERROR', 'ERRORS_ATTRIBUTES') || fallback.red,
    green: attr('DEFAULT_STRING') || fallback.green,
    yellow: attr('DEFAULT_NUMBER', 'DEFAULT_KEYWORD') || fallback.yellow,
    blue:
      attr(
        'DEFAULT_FUNCTION_DECLARATION',
        'DEFAULT_CLASS_REFERENCE',
        'DEFAULT_STATIC_FIELD'
      ) ||
      secondaryAccentColor ||
      fallback.blue,
    magenta:
      attr('DEFAULT_METADATA', 'DEFAULT_INSTANCE_FIELD') ||
      accentColor ||
      fallback.magenta,
    cyan: attr('DEFAULT_PARAMETER', 'DEFAULT_CLASS_NAME') || fallback.cyan,
    white: foreground
  }
  const colors = {
    background,
    foreground,
    cursor: cursor || foreground,
    cursorAccent: background,
    selectionBackground: selection || withAlpha(foreground, 0.24)
  }
  for (const key of ANSI_KEYS) {
    colors[key] = normal[key]
    colors[BRIGHT_MAP[key]] = dark
      ? lighten(normal[key], 0.14)
      : darken(normal[key], 0.14)
  }
  return colors
}

export function parseJetBrainsIcls (xml, fallbackName = 'JetBrains 主题') {
  if (typeof xml !== 'string' || !xml.trim()) {
    throw new Error('不是有效的 JetBrains 主题文件')
  }
  const parsed = parseSchemeXml(xml)
  if (!parsed) throw new Error('JetBrains 主题 XML 解析失败')

  const { scheme, palette, attributes } = parsed
  const parentScheme = scheme.getAttribute('parent_scheme') || ''
  const parentDark = !/light|default/i.test(parentScheme)
  const background =
    palette.CONSOLE_BACKGROUND_KEY ||
    palette.CONSOLE_BACKGROUND ||
    (parentDark ? '#2b2b2b' : '#ffffff')
  const dark = isDarkColor(background)
  const foreground =
    palette.CONSOLE_NORMAL_OUTPUT ||
    attributes.TEXT?.foreground ||
    (dark ? '#a9b7c6' : '#000000')
  const colors = buildJetBrainsColors({
    dark,
    background,
    foreground,
    cursor: palette.CARET_COLOR || foreground,
    selection:
      palette.SELECTION_BACKGROUND ||
      palette.SELECTED_TEXT_BACKGROUND ||
      withAlpha(foreground, 0.24),
    attributes
  })

  return {
    label: scheme.getAttribute('name') || fallbackName,
    mode: dark ? 'dark' : 'light',
    colors,
    display: { ...FALLBACK_DISPLAY }
  }
}

// IntelliJ 2022.2+ 的 .theme.json 只包含 UI 颜色，语法色在 editorScheme XML 中。
export function parseJetBrainsThemeJson (
  json,
  editorSchemeXml = '',
  fallbackName = 'JetBrains 主题'
) {
  if (!json || typeof json !== 'object' || !json.colors) {
    throw new Error('不是有效的 JetBrains .theme.json')
  }
  const palette = json.colors
  const background =
    palette.editorBackground ||
    palette.primaryBackground ||
    (json.dark === false ? '#ffffff' : '#2b2b2b')
  const dark = json.dark === true || isDarkColor(background)
  const foreground =
    palette.primaryForeground ||
    palette.editorForeground ||
    (dark ? '#a9b7c6' : '#000000')
  const scheme = editorSchemeXml ? parseSchemeXml(editorSchemeXml) : null
  const colors = buildJetBrainsColors({
    dark,
    background,
    foreground,
    cursor: palette.primaryForeground || foreground,
    selection:
      palette.selectionBackground ||
      (dark ? withAlpha(foreground, 0.24) : withAlpha(foreground, 0.18)),
    attributes: scheme?.attributes || {},
    accentColor: palette.accentColor,
    secondaryAccentColor: palette.secondaryAccentColor
  })

  return {
    label:
      typeof json.name === 'string' && json.name.trim()
        ? json.name.trim()
        : fallbackName,
    mode: dark ? 'dark' : 'light',
    colors,
    display: { ...FALLBACK_DISPLAY }
  }
}

function parseJsonThemeText (text) {
  const errors = []
  const value = parseJsonc(text, errors, {
    allowTrailingComma: true,
    disallowComments: false
  })
  if (!value || typeof value !== 'object') {
    throw new Error('JSON 解析失败，请确认主题文件格式')
  }
  return value
}

function normalizeEntryName (name) {
  return name.replace(/\\/g, '/').replace(/^\.\//, '')
}

function findEntry (files, target) {
  const normalized = normalizeEntryName(target)
  const exact = Object.keys(files).find(
    (name) => normalizeEntryName(name) === normalized
  )
  if (exact) return exact
  return Object.keys(files).find((name) =>
    normalizeEntryName(name).endsWith(`/${normalized}`)
  )
}

function collectFromZip (buffer, fileName) {
  const themes = []
  const warnings = []
  let files
  try {
    files = unzipSync(new Uint8Array(buffer))
  } catch (error) {
    throw new Error(`无法解压 ${fileName}：${error.message || error}`)
  }
  const names = Object.keys(files)

  const vsixPackage = names.find((name) =>
    /(^|\/)extension\/package\.json$/i.test(name)
  ) || names.find((name) => /(^|\/)package\.json$/i.test(name))

  if (vsixPackage) {
    try {
      const pkg = parseJsonThemeText(strFromU8(files[vsixPackage]))
      const declared = Array.isArray(pkg?.contributes?.themes)
        ? pkg.contributes.themes
        : []
      for (const entry of declared) {
        if (!entry?.path) continue
        const found = findEntry(files, entry.path)
        if (!found) {
          warnings.push(`未找到主题文件：${entry.path}`)
          continue
        }
        try {
          const json = parseJsonThemeText(strFromU8(files[found]))
          themes.push(parseVSCodeTheme(json, entry.label || fileName))
        } catch (error) {
          warnings.push(`${entry.label || entry.path}：${error.message}`)
        }
      }
    } catch (error) {
      warnings.push(`读取插件清单失败：${error.message}`)
    }
  }

  // 未声明清单时，扫描常见主题文件
  for (const name of names) {
    const lower = name.toLowerCase()
    if (lower.endsWith('.theme.json')) {
      try {
        const json = parseJsonThemeText(strFromU8(files[name]))
        const schemePath =
          typeof json.editorScheme === 'string' ? json.editorScheme : ''
        let schemeXml = ''
        if (schemePath) {
          const normalizedPath = schemePath.replace(/^\/+/, '')
          const entry =
            findEntry(files, normalizedPath) ||
            names.find((item) =>
              item.toLowerCase().endsWith(
                `/${normalizedPath.split('/').pop().toLowerCase()}`
              )
            )
          if (entry) schemeXml = strFromU8(files[entry])
        }
        themes.push(parseJetBrainsThemeJson(json, schemeXml, fileName))
      } catch (error) {
        warnings.push(`${name}：${error.message}`)
      }
      continue
    }
    if (lower.endsWith('.icls')) {
      try {
        themes.push(
          parseJetBrainsIcls(strFromU8(files[name]), fileName)
        )
      } catch (error) {
        warnings.push(`${name}：${error.message}`)
      }
      continue
    }
    if (lower.endsWith('.json') && /(^|\/)(themes?|colors)\//i.test(name)) {
      try {
        const json = parseJsonThemeText(strFromU8(files[name]))
        themes.push(parseVSCodeTheme(json, fileName))
      } catch {
        // 不是 VS Code 主题的 JSON，忽略
      }
    }
  }

  const seen = new Set()
  const unique = themes.filter((theme) => {
    const key = `${theme.label}|${theme.colors.background}|${theme.colors.foreground}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { themes: unique.slice(0, 24), warnings }
}

async function parseFile (file) {
  const name = file.name || '主题文件'
  const buffer = await file.arrayBuffer()
  const lower = name.toLowerCase()
  if (lower.endsWith('.icls') || lower.endsWith('.xml')) {
    return {
      themes: [parseJetBrainsIcls(new TextDecoder().decode(buffer), name)],
      warnings: []
    }
  }
  if (lower.endsWith('.theme.json')) {
    const json = parseJsonThemeText(new TextDecoder().decode(buffer))
    return {
      themes: [parseJetBrainsThemeJson(json, '', name)],
      warnings: []
    }
  }
  if (lower.endsWith('.json')) {
    const json = parseJsonThemeText(new TextDecoder().decode(buffer))
    return { themes: [parseVSCodeTheme(json, name)], warnings: [] }
  }
  if (
    lower.endsWith('.vsix') ||
    lower.endsWith('.jar') ||
    lower.endsWith('.zip')
  ) {
    return collectFromZip(buffer, name)
  }
  throw new Error('仅支持 .json、.icls、.xml、.vsix、.jar、.zip')
}

export async function importThemeFiles (files) {
  const list = Array.from(files || [])
  const themes = []
  const warnings = []
  for (const file of list) {
    try {
      const result = await parseFile(file)
      themes.push(...result.themes)
      warnings.push(...result.warnings)
    } catch (error) {
      warnings.push(`${file.name || '主题文件'}：${error.message || error}`)
    }
  }
  return { themes: themes.slice(0, 24), warnings }
}
