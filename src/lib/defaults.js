import { getChecksumAlgo } from './checksum'

export const COMMON_BAUD_RATES = [
  110, 300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200,
  128000, 230400, 256000, 460800, 500000, 576000, 921600, 1000000, 1500000, 2000000
]

export const PARITY_OPTIONS = [
  { value: 'none', label: 'None(无)' },
  { value: 'odd', label: 'Odd(奇)' },
  { value: 'even', label: 'Even(偶)' },
  { value: 'mark', label: 'Mark(标记)' },
  { value: 'space', label: 'Space(空格)' }
]

export const STOP_BIT_OPTIONS = [
  { value: 1, label: '1' },
  { value: 2, label: '2' }
]

export const DATA_BIT_OPTIONS = [5, 6, 7, 8]

export const FLOW_CONTROL_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'software', label: 'Software' }
]

export const ENCODING_OPTIONS = [
  { value: 'ascii', label: 'ASCII' },
  { value: 'utf8', label: 'UTF8' },
  { value: 'gbk', label: 'GBK' },
  { value: 'hex', label: 'HEX' }
]

export const TAIL_OPTIONS = [
  { value: 'crlf', label: 'CRLF (\\r\\n)', bytes: [13, 10] },
  { value: 'lf', label: 'LF (\\n)', bytes: [10] },
  { value: 'cr', label: 'CR (\\r)', bytes: [13] }
]

export const CHECKSUM_TARGET_OPTIONS = [
  { value: 0, label: '末尾 (无帧尾字节)' },
  { value: 1, label: '第 1 (最后1个字节是帧尾，校验插在帧尾前)' },
  { value: 2, label: '第 2 (最后2个字节是帧尾，校验插在帧尾前)' },
  { value: 3, label: '第 3 (最后3个字节是帧尾，校验插在帧尾前)' },
  { value: 4, label: '第 4 (最后4个字节是帧尾，校验插在帧尾前)' }
]

export function normalizeChecksumTo(value) {
  if (value === 'end' || value === null || value === undefined || value === '') return 0
  if (value === 'before-last') return 1
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(4, Math.max(0, Math.trunc(number)))
}

export const DEFAULT_SETTINGS = {
  portPath: '',
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
  rts: false,
  dtr: false,
  recv: {
    encoding: 'hex',
    autoNewline: true,
    interval: 200,
    lineNumbers: true,
    timestamp: false,
    logHighlight: true,
    dataColor: '#c00000',
    autoScroll: true,
    ansi: false,
    fontSize: 12,
    fontFamily: 'system'
  },
  send: {
    encoding: 'hex',
    loop: false,
    loopInterval: 500,
    loopCount: '',
    showSend: true,
    sendColor: '#000080',
    appendTail: false,
    tail: 'crlf',
    checksum: false,
    checksumAlgo: 'crc8',
    checksumHex: false,
    checksumFrom: 1,
    checksumTo: 0,
    endian: 'big'
  }
}

export function mergeSettings(saved) {
  const base = structuredClone(DEFAULT_SETTINGS)
  if (!saved || typeof saved !== 'object') {
    return base
  }

  const result = {
    ...base,
    portPath: typeof saved.portPath === 'string' ? saved.portPath : base.portPath,
    baudRate: saved.baudRate ?? base.baudRate,
    dataBits: saved.dataBits ?? base.dataBits,
    stopBits: saved.stopBits ?? base.stopBits,
    parity: saved.parity ?? base.parity,
    flowControl: saved.flowControl ?? base.flowControl,
    rts: saved.rts ?? base.rts,
    dtr: saved.dtr ?? base.dtr,
    recv: { ...base.recv, ...(saved.recv || {}) },
    send: { ...base.send, ...(saved.send || {}) }
  }

  if (saved.recv && saved.recv.timeColor && !saved.recv.dataColor) {
    result.recv.dataColor = saved.recv.timeColor
  }
  delete result.recv.timeColor
  result.send.checksumTo = normalizeChecksumTo(result.send.checksumTo)
  result.send.checksumAlgo = getChecksumAlgo(result.send.checksumAlgo).value
  return result
}
