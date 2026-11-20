const fs = require('fs/promises')
const path = require('path')

let cachePath = ''
let cache = null
let writeQueue = Promise.resolve()

function hostKeyId(host, port) {
  return `${String(host).trim().toLowerCase()}:${Number(port) || 22}`
}

async function loadKnownHosts(filePath) {
  if (cache && cachePath === filePath) return cache
  cachePath = filePath
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    cache =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {}
  } catch {
    cache = {}
  }
  return cache
}

async function getKnownHost(filePath, host, port) {
  const hosts = await loadKnownHosts(filePath)
  return hosts[hostKeyId(host, port)] || null
}

async function trustKnownHost(filePath, host, port, entry) {
  const hosts = await loadKnownHosts(filePath)
  const id = hostKeyId(host, port)
  if (
    hosts[id] &&
    hosts[id].algo === entry.algo &&
    hosts[id].fingerprint === entry.fingerprint
  ) {
    return
  }
  hosts[id] = { ...entry, trustedAt: new Date().toISOString() }
  const snapshot = JSON.stringify(hosts, null, 2)
  writeQueue = writeQueue
    .then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, snapshot, 'utf8')
    })
    .catch(() => {
      // 无法写入时仍允许本次连接，下次会再次要求确认。
    })
  await writeQueue
}

module.exports = { getKnownHost, trustKnownHost }
