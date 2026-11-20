'use strict'

// 虚拟串口的自动回复规则：编译 + 整条消息匹配。
// 一条消息 = 以 \n 结束的一行（忽略行尾 \r/\n），或者空闲一段时间后剩余的整段数据。
// 只有“整条消息”和规则完全一致才会回复，避免 AT 命中 AT2222 这类前缀误判。

const CR = 0x0d
const LF = 0x0a
const DEFAULT_LIMIT = 64 * 1024

function hexToBuffer(text) {
  const clean = String(text || '').replace(/[^0-9a-fA-F]/g, '')
  if (clean.length < 2) return null
  const pairs = clean.match(/.{1,2}/g) || []
  return Buffer.from(pairs.map((pair) => parseInt(pair.padEnd(2, '0'), 16)))
}

function bufferToHex(buffer) {
  return [...buffer]
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(' ')
}

function unescapeText(text) {
  return String(text ?? '')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\0/g, '\0')
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

// 去掉行尾的 \r 和 \n
function stripBreaks(buffer) {
  let end = buffer.length
  while (end > 0 && (buffer[end - 1] === CR || buffer[end - 1] === LF)) end -= 1
  return end === buffer.length ? buffer : buffer.slice(0, end)
}

function compileRules(rules) {
  if (!Array.isArray(rules)) return []
  return rules
    .filter((rule) => rule && rule.enabled !== false)
    .map((rule) => {
      const kind = rule.hex ? 'hex' : 'text'
      const raw = rule.hex
        ? hexToBuffer(rule.match)
        : (() => {
            const text = unescapeText(rule.match)
            return text ? Buffer.from(text, 'utf8') : null
          })()
      if (!raw) return null
      const match = stripBreaks(raw)
      if (!match.length) return null
      const replyTemplate = rule.hex ? '' : unescapeText(rule.reply)
      const reply = rule.hex
        ? hexToBuffer(rule.reply) || Buffer.alloc(0)
        : Buffer.from(replyTemplate, 'utf8')
      return { kind, match, reply, replyTemplate }
    })
    .filter(Boolean)
}

// 回复里的 {串口名} / {消息} 在发送时替换
function renderReply(rule, message, vars = {}) {
  const template = rule.replyTemplate
  if (rule.kind !== 'text' || !template || !template.includes('{')) {
    return Buffer.from(rule.reply)
  }
  const text = template
    .replace(/\{串口名\}/g, vars.portName || '')
    .replace(/\{消息\}/g, message.toString('utf8'))
  return Buffer.from(text, 'utf8')
}

// 一条消息命中的回复（最多第一条规则生效）
function matchMessage(message, rules, vars = {}) {
  const normalized = stripBreaks(message)
  if (!normalized.length) return []
  for (const rule of rules) {
    if (normalized.equals(rule.match)) {
      const reply = renderReply(rule, normalized, vars)
      return reply.length ? [reply] : []
    }
  }
  return []
}

// 把数据流切成“消息”：按 \n 切行，剩下的留到空闲时整段处理
function createMessageBuffer(limit = DEFAULT_LIMIT) {
  let buffer = Buffer.alloc(0)

  return {
    reset() {
      buffer = Buffer.alloc(0)
    },
    push(chunk, splitLines) {
      if (!chunk || !chunk.length) return []
      buffer = buffer.length
        ? Buffer.concat([buffer, chunk])
        : Buffer.from(chunk)
      if (buffer.length > limit) {
        buffer = buffer.slice(buffer.length - limit)
      }
      if (!splitLines) return []

      const messages = []
      let start = 0
      let index = buffer.indexOf(LF)
      while (index !== -1) {
        messages.push(buffer.slice(start, index + 1))
        start = index + 1
        index = buffer.indexOf(LF, start)
      }
      if (start > 0) buffer = buffer.slice(start)
      return messages
    },
    flush() {
      if (!buffer.length) return []
      const rest = buffer
      buffer = Buffer.alloc(0)
      return [rest]
    }
  }
}

module.exports = {
  hexToBuffer,
  bufferToHex,
  unescapeText,
  stripBreaks,
  compileRules,
  renderReply,
  matchMessage,
  createMessageBuffer
}
