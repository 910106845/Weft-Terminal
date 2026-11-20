const CRC_PARAMS = {
  crc8: {
    width: 8,
    poly: 0x07,
    init: 0x00,
    refin: false,
    refout: false,
    xorout: 0x00,
    check: 0xf4
  },
  crc8itu: {
    width: 8,
    poly: 0x07,
    init: 0x00,
    refin: false,
    refout: false,
    xorout: 0x55,
    check: 0xa1
  },
  crc8maxim: {
    width: 8,
    poly: 0x31,
    init: 0x00,
    refin: true,
    refout: true,
    xorout: 0x00,
    check: 0xa1
  },
  crc8rohc: {
    width: 8,
    poly: 0x07,
    init: 0xff,
    refin: true,
    refout: true,
    xorout: 0x00,
    check: 0xd0
  },
  crc8wcdma: {
    width: 8,
    poly: 0x9b,
    init: 0x00,
    refin: true,
    refout: true,
    xorout: 0x00,
    check: 0x25
  },
  crc8cdma2000: {
    width: 8,
    poly: 0x9b,
    init: 0xff,
    refin: false,
    refout: false,
    xorout: 0x00,
    check: 0xda
  },
  crc8darc: {
    width: 8,
    poly: 0x39,
    init: 0x00,
    refin: true,
    refout: true,
    xorout: 0x00,
    check: 0x15
  },
  crc8dvbs2: {
    width: 8,
    poly: 0xd5,
    init: 0x00,
    refin: false,
    refout: false,
    xorout: 0x00,
    check: 0xbc
  },
  crc8ebu: {
    width: 8,
    poly: 0x1d,
    init: 0xff,
    refin: true,
    refout: true,
    xorout: 0x00,
    check: 0x97
  },
  crc8icode: {
    width: 8,
    poly: 0x1d,
    init: 0xfd,
    refin: false,
    refout: false,
    xorout: 0x00,
    check: 0x7e
  },
  crc16: {
    width: 16,
    poly: 0x8005,
    init: 0x0000,
    refin: true,
    refout: true,
    xorout: 0x0000,
    check: 0xbb3d
  },
  crc16ccittfalse: {
    width: 16,
    poly: 0x1021,
    init: 0xffff,
    refin: false,
    refout: false,
    xorout: 0x0000,
    check: 0x29b1
  },
  crc16augccitt: {
    width: 16,
    poly: 0x1021,
    init: 0x1d0f,
    refin: false,
    refout: false,
    xorout: 0x0000,
    check: 0xe5cc
  },
  crc16buypass: {
    width: 16,
    poly: 0x8005,
    init: 0x0000,
    refin: false,
    refout: false,
    xorout: 0x0000,
    check: 0xfee8
  },
  crc16cdma2000: {
    width: 16,
    poly: 0xc867,
    init: 0xffff,
    refin: false,
    refout: false,
    xorout: 0x0000,
    check: 0x4c06
  },
  crc16dds110: {
    width: 16,
    poly: 0x8005,
    init: 0x800d,
    refin: false,
    refout: false,
    xorout: 0x0000,
    check: 0x9ecf
  },
  crc16dectr: {
    width: 16,
    poly: 0x0589,
    init: 0x0000,
    refin: false,
    refout: false,
    xorout: 0x0001,
    check: 0x007e
  },
  crc16dectx: {
    width: 16,
    poly: 0x0589,
    init: 0x0000,
    refin: false,
    refout: false,
    xorout: 0x0000,
    check: 0x007f
  },
  crc16dnp: {
    width: 16,
    poly: 0x3d65,
    init: 0x0000,
    refin: true,
    refout: true,
    xorout: 0xffff,
    check: 0xea82
  },
  crc16en13757: {
    width: 16,
    poly: 0x3d65,
    init: 0x0000,
    refin: false,
    refout: false,
    xorout: 0xffff,
    check: 0xc2b7
  },
  crc16genibus: {
    width: 16,
    poly: 0x1021,
    init: 0xffff,
    refin: false,
    refout: false,
    xorout: 0xffff,
    check: 0xd64e
  },
  crc16maxim: {
    width: 16,
    poly: 0x8005,
    init: 0x0000,
    refin: true,
    refout: true,
    xorout: 0xffff,
    check: 0x44c2
  },
  crc16mcrf4xx: {
    width: 16,
    poly: 0x1021,
    init: 0xffff,
    refin: true,
    refout: true,
    xorout: 0x0000,
    check: 0x6f91
  },
  crc16riello: {
    width: 16,
    poly: 0x1021,
    init: 0xb2aa,
    refin: true,
    refout: true,
    xorout: 0x0000,
    check: 0x63d0
  },
  crc16t10dif: {
    width: 16,
    poly: 0x8bb7,
    init: 0x0000,
    refin: false,
    refout: false,
    xorout: 0x0000,
    check: 0xd0db
  },
  crc16teledisk: {
    width: 16,
    poly: 0xa097,
    init: 0x0000,
    refin: false,
    refout: false,
    xorout: 0x0000,
    check: 0x0fb3
  },
  crc16tms37157: {
    width: 16,
    poly: 0x1021,
    init: 0x89ec,
    refin: true,
    refout: true,
    xorout: 0x0000,
    check: 0x26b1
  },
  crc16usb: {
    width: 16,
    poly: 0x8005,
    init: 0xffff,
    refin: true,
    refout: true,
    xorout: 0xffff,
    check: 0xb4c8
  },
  crc16a: {
    width: 16,
    poly: 0x1021,
    init: 0xc6c6,
    refin: true,
    refout: true,
    xorout: 0x0000,
    check: 0xbf05
  },
  crc16kermit: {
    width: 16,
    poly: 0x1021,
    init: 0x0000,
    refin: true,
    refout: true,
    xorout: 0x0000,
    check: 0x2189
  },
  crc16modbus: {
    width: 16,
    poly: 0x8005,
    init: 0xffff,
    refin: true,
    refout: true,
    xorout: 0x0000,
    check: 0x4b37
  },
  crc16x25: {
    width: 16,
    poly: 0x1021,
    init: 0xffff,
    refin: true,
    refout: true,
    xorout: 0xffff,
    check: 0x906e
  },
  crc16xmodem: {
    width: 16,
    poly: 0x1021,
    init: 0x0000,
    refin: false,
    refout: false,
    xorout: 0x0000,
    check: 0x31c3
  },
  crc32: {
    width: 32,
    poly: 0x04c11db7,
    init: 0xffffffff,
    refin: true,
    refout: true,
    xorout: 0xffffffff,
    check: 0xcbf43926
  },
  crc32bzip2: {
    width: 32,
    poly: 0x04c11db7,
    init: 0xffffffff,
    refin: false,
    refout: false,
    xorout: 0xffffffff,
    check: 0xfc891918
  },
  crc32c: {
    width: 32,
    poly: 0x1edc6f41,
    init: 0xffffffff,
    refin: true,
    refout: true,
    xorout: 0xffffffff,
    check: 0xe3069283
  },
  crc32d: {
    width: 32,
    poly: 0xa833982b,
    init: 0xffffffff,
    refin: true,
    refout: true,
    xorout: 0xffffffff,
    check: 0x87315576
  },
  crc32jamcrc: {
    width: 32,
    poly: 0x04c11db7,
    init: 0xffffffff,
    refin: true,
    refout: true,
    xorout: 0x00000000,
    check: 0x340bc6d9
  },
  crc32mpeg2: {
    width: 32,
    poly: 0x04c11db7,
    init: 0xffffffff,
    refin: false,
    refout: false,
    xorout: 0x00000000,
    check: 0x0376e6e7
  },
  crc32posix: {
    width: 32,
    poly: 0x04c11db7,
    init: 0x00000000,
    refin: false,
    refout: false,
    xorout: 0xffffffff,
    check: 0x765e7680
  },
  crc32q: {
    width: 32,
    poly: 0x814141ab,
    init: 0x00000000,
    refin: false,
    refout: false,
    xorout: 0x00000000,
    check: 0x3010bf7f
  },
  crc32xfer: {
    width: 32,
    poly: 0x000000af,
    init: 0x00000000,
    refin: false,
    refout: false,
    xorout: 0x00000000,
    check: 0xbd0be338
  }
}

const SPECIAL_CHECKS = {
  xor8: (bytes) => {
    let value = 0
    for (const byte of bytes) value ^= byte
    return value & 0xff
  },
  checksum8: (bytes) => {
    let value = 0
    for (const byte of bytes) value = (value + byte) & 0xff
    return value
  },
  checksum8lrc: (bytes) => {
    let value = 0
    for (const byte of bytes) value = (value + byte) & 0xff
    return (0x100 - value) & 0xff
  },
  checksum8reverse: (bytes) => {
    let value = 0
    for (const byte of bytes) value = (value + byte) & 0xff
    return (~value) & 0xff
  }
}

const ALGORITHM_LIST = [
  ['xor8', 'XOR-8', 1],
  ['checksum8', 'CHECKSUM-8', 1],
  ['checksum8lrc', 'CHECKSUM-8/LRC', 1],
  ['checksum8reverse', 'CHECKSUM-8/REVERSE', 1],
  ['crc8', 'CRC-8', 8],
  ['crc8itu', 'CRC-8/ITU', 8],
  ['crc8maxim', 'CRC-8/MAXIM', 8],
  ['crc8rohc', 'CRC-8/ROHC', 8],
  ['crc8wcdma', 'CRC-8/WCDMA', 8],
  ['crc8cdma2000', 'CRC-8/CDMA2000', 8],
  ['crc8darc', 'CRC-8/DARC', 8],
  ['crc8dvbs2', 'CRC-8/DVB-S2', 8],
  ['crc8ebu', 'CRC-8/EBU', 8],
  ['crc8icode', 'CRC-8/I-CODE', 8],
  ['crc16', 'CRC-16', 16],
  ['crc16ccittfalse', 'CRC-16/CCITT-FALSE', 16],
  ['crc16augccitt', 'CRC-16/AUG-CCITT', 16],
  ['crc16buypass', 'CRC-16/BUYPASS', 16],
  ['crc16cdma2000', 'CRC-16/CDMA2000', 16],
  ['crc16dds110', 'CRC-16/DDS-110', 16],
  ['crc16dectr', 'CRC-16/DECT-R', 16],
  ['crc16dectx', 'CRC-16/DECT-X', 16],
  ['crc16dnp', 'CRC-16/DNP', 16],
  ['crc16en13757', 'CRC-16/EN-13757', 16],
  ['crc16genibus', 'CRC-16/GENIBUS', 16],
  ['crc16maxim', 'CRC-16/MAXIM', 16],
  ['crc16mcrf4xx', 'CRC-16/MCRF4XX', 16],
  ['crc16riello', 'CRC-16/RIELLO', 16],
  ['crc16t10dif', 'CRC-16/T10-DIF', 16],
  ['crc16teledisk', 'CRC-16/TELEDISK', 16],
  ['crc16tms37157', 'CRC-16/TMS37157', 16],
  ['crc16usb', 'CRC-16/USB', 16],
  ['crc16a', 'CRC-16A', 16],
  ['crc16kermit', 'CRC-16/KERMIT', 16],
  ['crc16modbus', 'CRC-16/MODBUS', 16],
  ['crc16x25', 'CRC-16/X-25', 16],
  ['crc16xmodem', 'CRC-16/XMODEM', 16],
  ['crc32', 'CRC-32', 32],
  ['crc32bzip2', 'CRC-32/BZIP2', 32],
  ['crc32c', 'CRC-32C', 32],
  ['crc32d', 'CRC-32D', 32],
  ['crc32jamcrc', 'CRC-32/JAMCRC', 32],
  ['crc32mpeg2', 'CRC-32/MPEG-2', 32],
  ['crc32posix', 'CRC-32/POSIX', 32],
  ['crc32q', 'CRC-32Q', 32],
  ['crc32xfer', 'CRC-32/XFER', 32]
]

export const CHECKSUM_ALGOS = ALGORITHM_LIST.map(([value, label, width]) => {
  const params = CRC_PARAMS[value]
  return {
    value,
    label,
    width: params ? params.width / 8 : 1,
    check: params?.check ?? null
  }
})

const ALIASES = {
  sum8: 'checksum8',
  crc16ccitt: 'crc16ccittfalse'
}

const ALGORITHM_MAP = new Map(CHECKSUM_ALGOS.map((item) => [item.value, item]))

export function getChecksumAlgo(value) {
  return ALGORITHM_MAP.get(ALIASES[value] || value) || CHECKSUM_ALGOS[0]
}

function reflectBits(value, width) {
  let result = 0
  let source = value >>> 0
  for (let index = 0; index < width; index += 1) {
    result = (result << 1) | (source & 1)
    source >>>= 1
  }
  return result >>> 0
}

function crcValue(bytes, params) {
  const { width, poly, init, refin, refout, xorout } = params
  const mask = width === 32 ? 0xffffffff : (1 << width) - 1
  const topbit = width === 32 ? 0x80000000 : 1 << (width - 1)
  let crc = init >>> 0

  for (const sourceByte of bytes) {
    const byte = refin ? reflectBits(sourceByte, 8) : sourceByte
    crc = (crc ^ (byte << (width - 8))) >>> 0
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & topbit ? ((crc << 1) ^ poly) >>> 0 : (crc << 1) >>> 0
      crc &= mask
      crc >>>= 0
    }
  }

  if (refout) crc = reflectBits(crc, width)
  crc = (crc ^ xorout) >>> 0
  return (crc & mask) >>> 0
}

export function calculateChecksum(bytes, algoValue, endian = 'big') {
  const algo = getChecksumAlgo(algoValue)
  const params = CRC_PARAMS[algo.value]
  const value = params
    ? crcValue(bytes, params)
    : SPECIAL_CHECKS[algo.value](bytes)
  const width = algo.width
  const output = []

  for (let index = 0; index < width; index += 1) {
    const shift = (width - 1 - index) * 8
    output.push((value >>> shift) & 0xff)
  }

  if (endian === 'little' && width > 1) output.reverse()
  return { bytes: output, width }
}

export function checksumToHex(bytes, uppercase = true) {
  return Array.from(bytes, (byte) => {
    const text = byte.toString(16).padStart(2, '0')
    return uppercase ? text.toUpperCase() : text
  }).join('')
}
