const { app, BrowserWindow, Menu, dialog, ipcMain, shell, webContents, net } = require('electron')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const fs = require('fs/promises')
const fsSync = require('fs')
const { spawn, execFile, execFileSync } = require('child_process')
const { pipeline } = require('stream/promises')

const { EventEmitter } = require('events')
const { SerialPort } = require('serialport')
const iconv = require('iconv-lite')
const { getKnownHost, trustKnownHost } = require('./sshKnownHosts')
const {
  bufferToHex,
  compileRules,
  createMessageBuffer,
  matchMessage
} = require('./virtual-rules')

const APP_DISPLAY_NAME = 'Weft Terminal'

// 数据目录：Weft Terminal。
// 旧版本用的是 serial-debug，首次启动时把 localStorage 和 SSH 指纹迁移过来。
const APP_DATA_ROOT = app.getPath('appData')
const LEGACY_USER_DATA = path.join(APP_DATA_ROOT, 'serial-debug')
const USER_DATA_DIR = path.join(APP_DATA_ROOT, 'Weft Terminal')

function migrateLegacyUserData() {
  try {
    if (!fsSync.existsSync(LEGACY_USER_DATA)) return
    const marker = path.join(USER_DATA_DIR, '.migrated-from-serial-debug')
    if (fsSync.existsSync(marker)) return
    fsSync.mkdirSync(USER_DATA_DIR, { recursive: true })
    for (const name of ['Local Storage', 'IndexedDB', 'ssh-known-hosts.json']) {
      const from = path.join(LEGACY_USER_DATA, name)
      if (!fsSync.existsSync(from)) continue
      const to = path.join(USER_DATA_DIR, name)
      if (fsSync.existsSync(to)) continue
      fsSync.cpSync(from, to, { recursive: true })
    }
    fsSync.writeFileSync(
      marker,
      `migrated from ${LEGACY_USER_DATA} at ${new Date().toISOString()}\n`,
      'utf8'
    )
  } catch (error) {
    console.error('[user-data] migration failed:', error)
  }
}

if (process.env.SERIALDEBUG_USER_DATA) {
  app.setPath('userData', process.env.SERIALDEBUG_USER_DATA)
} else {
  migrateLegacyUserData()
  app.setPath('userData', USER_DATA_DIR)
}
app.setName(APP_DISPLAY_NAME)

function cleanupStaleAppBackups() {
  try {
    const exePath = app.getPath('exe')
    const bundlePath = path.resolve(exePath, '../../..')
    if (!bundlePath.endsWith('.app')) return
    const parent = path.dirname(bundlePath)
    const base = path.basename(bundlePath)
    for (const suffix of ['.backup', '.new']) {
      try {
        fsSync.rmSync(path.join(parent, `.${base}${suffix}`), {
          recursive: true,
          force: true
        })
      } catch {
        // 忽略权限或文件占用问题
      }
    }
  } catch {
    // 忽略
  }
}

cleanupStaleAppBackups()

const windows = new Set()
const sessions = new Map()
// 记录本应用内已经占用的串口路径，避免串口工具和虚拟串口页重复打开同一端
const openSerialPaths = new Map()

function serialPathKey(path) {
  const raw = String(path || '')
  const prefix = '\\\\.\\'
  return (raw.startsWith(prefix) ? raw.slice(prefix.length) : raw).toUpperCase()
}

function claimSerialPath(path, owner) {
  const key = serialPathKey(path)
  if (!key) return { ok: false, error: '串口路径为空' }
  const current = openSerialPaths.get(key)
  if (current && current !== owner) {
    return {
      ok: false,
      error: `串口 ${path} 已被本应用的其他会话占用`,
      code: 'EBUSY'
    }
  }
  openSerialPaths.set(key, owner)
  return { ok: true }
}

function releaseSerialPath(path, owner) {
  const key = serialPathKey(path)
  if (!key) return
  if (!owner || openSerialPaths.get(key) === owner) {
    openSerialPaths.delete(key)
  }
}
const terminals = new Map()
// 等待用户确认 SSH 主机密钥的会话。
const hostKeyWaiters = new Map()
let ptyModule
let ptyLoadError
let ssh2Module
let ssh2LoadError

const PARITY_MAP = {
  none: 'none',
  odd: 'odd',
  even: 'even',
  mark: 'mark',
  space: 'space'
}

const ICONV_MAP = {
  ascii: 'ascii',
  utf8: 'utf8',
  gbk: 'gbk'
}

function uniqueWindowId() {
  return `win-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function getDialogWindow() {
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null
}

async function showSaveDialog(options) {
  const parent = getDialogWindow()
  return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options)
}

async function showOpenDialog(options) {
  const parent = getDialogWindow()
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)
}

function sendToOwner(ownerId, channel, payload) {
  const contents = webContents.fromId(ownerId)
  if (contents && !contents.isDestroyed()) {
    contents.send(channel, payload)
  }
}

function closeSession(sessionId) {
  closeVirtual(sessionId)
  return new Promise((resolve) => {
    const session = sessions.get(sessionId)
    sessions.delete(sessionId)
    releaseSerialPath(session?.port?.path, `serial:${sessionId}`)
    if (!session || !session.port || !session.port.isOpen) {
      resolve()
      return
    }
    session.port.close(() => resolve())
  })
}

function closeSessionsForWebContents(ownerId) {
  for (const [sessionId, session] of [...sessions.entries()]) {
    if (session.ownerId === ownerId) {
      closeSession(sessionId)
    }
  }
}

function loadNodePty() {
  if (ptyModule !== undefined) return ptyModule
  try {
    ptyModule = require('node-pty')
    ptyLoadError = null
  } catch (error) {
    ptyModule = null
    ptyLoadError = error
  }
  return ptyModule
}

function loadSsh2() {
  if (ssh2Module !== undefined) return ssh2Module
  try {
    ssh2Module = require('ssh2')
    ssh2LoadError = null
  } catch (error) {
    ssh2Module = null
    ssh2LoadError = error
  }
  return ssh2Module
}

function findOnPath(name) {
  const pathValue = process.env.PATH || process.env.Path || ''
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue
    const candidate = path.join(directory, name)
    try {
      if (fsSync.existsSync(candidate)) return candidate
    } catch {
      // ignore unreadable PATH entries
    }
  }
  return null
}

function localShellOptions() {
  if (process.platform === 'win32') {
    const options = []
    const pwsh = findOnPath('pwsh.exe')
    const powershell = pwsh || findOnPath('powershell.exe')
    if (powershell) {
      options.push({
        id: 'powershell',
        label: pwsh ? 'PowerShell 7' : 'Windows PowerShell',
        path: powershell,
        args: ['-NoLogo']
      })
    }
    const commandPrompt =
      process.env.ComSpec || findOnPath('cmd.exe') || 'cmd.exe'
    options.push({
      id: 'cmd',
      label: '命令提示符',
      path: commandPrompt,
      args: []
    })
    return { options, defaultId: options[0]?.id || 'cmd' }
  }

  const candidates = [
    process.env.SHELL,
    process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash',
    '/bin/bash',
    '/bin/sh'
  ].filter(Boolean)
  const seen = new Set()
  const options = []
  for (const shellPath of candidates) {
    if (seen.has(shellPath)) continue
    try {
      if (!fsSync.existsSync(shellPath)) continue
    } catch {
      continue
    }
    seen.add(shellPath)
    const baseName = path.basename(shellPath)
    options.push({
      id: `local-${options.length + 1}`,
      label: baseName,
      path: shellPath,
      args: ['-l']
    })
  }
  return {
    options:
      options.length > 0
        ? options
        : [{ id: 'sh', label: 'sh', path: '/bin/sh', args: ['-l'] }],
    defaultId: options[0]?.id || 'sh'
  }
}

function getLocalShell(shellId) {
  const { options, defaultId } = localShellOptions()
  return options.find((shell) => shell.id === shellId) ||
    options.find((shell) => shell.id === defaultId) ||
    options[0]
}

function clampTerminalDimension(value, fallback, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(2, Math.trunc(number)))
}

function closeTerminal(terminalId) {
  const session = terminals.get(terminalId)
  terminals.delete(terminalId)
  const hostKeyWaiter = hostKeyWaiters.get(terminalId)
  if (hostKeyWaiter) {
    hostKeyWaiters.delete(terminalId)
    hostKeyWaiter(false, 'SSH 连接已取消')
  }
  if (!session) return
  if (session.kind === 'ssh') {
    try {
      session.sftp?.end()
    } catch {
      // SFTP 会话可能已经关闭
    }
    try {
      session.stream?.close()
    } catch {
      // SSH 通道可能已经关闭
    }
    try {
      session.client?.end()
    } catch {
      // 忽略关闭异常
    }
    return
  }
  try {
    session.terminal.kill()
  } catch {
    // 终端可能已经自行退出
  }
}

function closeTerminalsForWebContents(ownerId) {
  for (const [terminalId, session] of [...terminals.entries()]) {
    if (session.ownerId === ownerId) closeTerminal(terminalId)
  }
}

async function createSshTerminal(event, terminalId, options = {}) {
  const ssh = options.ssh || {}
  const host = String(ssh.host || '').trim()
  const username = String(ssh.username || '').trim()
  if (!host || !username) {
    return { ok: false, error: 'SSH 主机和用户名不能为空' }
  }

  const ssh2 = loadSsh2()
  if (!ssh2) {
    return {
      ok: false,
      error: ssh2LoadError
        ? `SSH 组件加载失败：${ssh2LoadError.message || ssh2LoadError}`
        : 'SSH 组件不可用'
    }
  }

  const authType = ssh.authType || 'password'
  let privateKey
  if (authType === 'key') {
    const keyPath = String(ssh.privateKeyPath || '').trim()
    if (!keyPath) return { ok: false, error: '请选择 SSH 私钥文件' }
    const resolvedPath = keyPath.startsWith('~')
      ? path.join(app.getPath('home'), keyPath.slice(1))
      : keyPath
    try {
      privateKey = await fs.readFile(resolvedPath, 'utf8')
    } catch (error) {
      return {
        ok: false,
        error: `读取私钥失败：${error.message || error}`
      }
    }
  }

  if (authType === 'password' && !ssh.password) {
    return { ok: false, error: '请输入 SSH 密码' }
  }

  const agent =
    authType === 'agent'
      ? process.env.SSH_AUTH_SOCK ||
        (process.platform === 'win32' ? 'pageant' : '')
      : undefined
  if (authType === 'agent' && !agent) {
    return { ok: false, error: '未找到 SSH Agent' }
  }

  closeTerminal(terminalId)

  const ownerId = event.sender.id
  const cols = clampTerminalDimension(options.cols, 80, 500)
  const rows = clampTerminalDimension(options.rows, 24, 200)
  const port = Number(ssh.port) || 22
  const label = String(ssh.name || '').trim() || `${username}@${host}`
  const requestedEncoding = String(ssh.encoding || 'utf8').toLowerCase()
  const streamEncoding = ['gbk', 'gb18030', 'big5'].includes(
    requestedEncoding
  )
    ? requestedEncoding
    : 'utf8'
  const decoder = iconv.getDecoder(streamEncoding)
  const knownHostsFile = path.join(
    app.getPath('userData'),
    'ssh-known-hosts.json'
  )

  return new Promise((resolve) => {
    const client = new ssh2.Client()
    let stream = null
    let ready = false
    let settled = false
    let ended = false
    let fingerprint = ''
    let hostKeyFailure = ''
    let timeout = null

    // 先登记握手中的会话，标签页在连接完成前关闭时可以立即中止。
    terminals.set(terminalId, {
      kind: 'ssh',
      client,
      stream: null,
      ownerId,
      pending: true,
      shell: { id: 'ssh', label, path: host, fingerprint: '' }
    })

    const clearPending = () => {
      const current = terminals.get(terminalId)
      if (current && current.client === client && current.pending) {
        terminals.delete(terminalId)
      }
    }

    const resolveOnce = (value) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      if (!value || !value.ok) {
        const hostKeyWaiter = hostKeyWaiters.get(terminalId)
        if (hostKeyWaiter) hostKeyWaiter(false, 'SSH 连接已取消')
        clearPending()
      }
      resolve(value)
    }

    const finishExit = (message, exitCode = null, network = false) => {
      if (ended) return
      ended = true
      if (!settled) {
        resolveOnce({ ok: false, error: message || 'SSH 连接已关闭' })
        return
      }
      const current = terminals.get(terminalId)
      if (!current || current.client !== client) return
      terminals.delete(terminalId)
      sendToOwner(ownerId, 'terminal:exit', {
        terminalId,
        exitCode,
        signal: 0,
        message: message || '',
        network
      })
    }

    client.on('ready', () => {
      ready = true
      const activeSession = terminals.get(terminalId)
      if (!activeSession || activeSession.client !== client) {
        resolveOnce({ ok: false, error: 'SSH 连接已取消' })
        try {
          client.end()
        } catch {
          // ignore
        }
        return
      }
      const pendingSession = terminals.get(terminalId)
      const shellCols = pendingSession?.pendingWindow?.cols || cols
      const shellRows = pendingSession?.pendingWindow?.rows || rows
      client.shell(
        { term: 'xterm-256color', cols: shellCols, rows: shellRows },
        {
          env: {
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            TERM_PROGRAM: 'Weft',
            TERM_PROGRAM_VERSION: app.getVersion(),
            CLICOLOR: '1',
            CLICOLOR_FORCE: '1',
            FORCE_COLOR: '1'
          }
        },
        (error, sshStream) => {
          if (error) {
            resolveOnce({
              ok: false,
              error: error.message || String(error)
            })
            try {
              client.end()
            } catch {
              // ignore
            }
            return
          }

          const stillActive = terminals.get(terminalId)
          if (!stillActive || stillActive.client !== client) {
            try {
              sshStream.close()
            } catch {
              // ignore
            }
            try {
              client.end()
            } catch {
              // ignore
            }
            resolveOnce({ ok: false, error: 'SSH 连接已取消' })
            return
          }

          stream = sshStream
          const latestPending = terminals.get(terminalId)?.pendingWindow
          terminals.set(terminalId, {
            kind: 'ssh',
            client,
            stream,
            ownerId,
            shell: {
              id: 'ssh',
              label,
              path: host,
              fingerprint
            }
          })
          if (latestPending) {
            try {
              stream.setWindow(latestPending.rows, latestPending.cols, 0, 0)
            } catch {
              // 终端尺寸同步失败时忽略，仍然可以继续使用
            }
          }

          const forward = (data) => {
            const current = terminals.get(terminalId)
            if (!current || current.stream !== stream) return
            const text = decoder.write(data)
            if (!text) return
            sendToOwner(ownerId, 'terminal:data', {
              terminalId,
              data: text
            })
          }
          stream.on('data', forward)
          stream.stderr.on('data', forward)
          stream.on('close', () => {
            // 用户输入 exit 时只有 shell 通道关闭，TCP 连接还在；
            // 断网时 client 的 close/error 会先触发。延迟 300ms 判断更稳。
            setTimeout(() => {
              if (ended) return
              const sock = client._sock
              const socketAlive = Boolean(
                sock && !sock.destroyed && sock.readable !== false
              )
              finishExit('SSH 会话已关闭', 0, !socketAlive)
            }, 300)
          })

          client.on('close', () => {
            finishExit('SSH 连接已关闭', null, true)
          })
          client.on('error', (sshError) => {
            finishExit(sshError.message || 'SSH 连接异常', null, true)
          })

          resolveOnce({
            ok: true,
            transport: 'ssh',
            shell: {
              id: 'ssh',
              label,
              path: host,
              fingerprint
            },
            pid: null,
            cwd: `${username}@${host}`,
            cols: shellCols,
            rows: shellRows
          })
        }
      )
    })

    client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => String(ssh.password || '')))
    })

    client.on('error', (error) => {
      if (!ready) {
        resolveOnce({
          ok: false,
          error: hostKeyFailure || error.message || String(error)
        })
        return
      }
      finishExit(error.message || 'SSH 连接异常', null, true)
    })

    client.on('close', () => {
      if (!ready) {
        resolveOnce({
          ok: false,
          error: hostKeyFailure || 'SSH 连接已关闭'
        })
        return
      }
      finishExit('SSH 连接已关闭', null, true)
    })

    timeout = setTimeout(() => {
      resolveOnce({ ok: false, error: 'SSH 连接超时' })
      try {
        client.end()
      } catch {
        // ignore
      }
    }, 65000)

    const config = {
      host,
      port,
      username,
      readyTimeout: 60000,
      // 更快发现断网：5s 一次心跳，连续 3 次失败判定为断线
      keepaliveInterval: 5000,
      keepaliveCountMax: 3,
      // 终端是纯文本，压缩率很高；弱网/移动网络下能明显减少卡顿
      algorithms: {
        compress: ['zlib@openssh.com', 'zlib', 'none']
      },
      tryKeyboard: true,
      hostVerifier: (key, verify) => {
        let parsedKey
        try {
          parsedKey = ssh2.utils.parseKey(key)
        } catch (error) {
          parsedKey = error
        }
        if (!parsedKey || parsedKey instanceof Error) {
          hostKeyFailure = '无法解析服务器主机密钥，连接已取消'
          verify(false)
          return
        }

        const algo = parsedKey.type
        const digest = crypto
          .createHash('sha256')
          .update(key)
          .digest('base64')
          .replace(/=+$/, '')
        const hostFingerprint = `SHA256:${digest}`
        fingerprint = hostFingerprint

        const current = terminals.get(terminalId)
        if (!current || current.client !== client) {
          verify(false)
          return
        }

        getKnownHost(knownHostsFile, host, port)
          .then((knownHost) => {
            const activeSession = terminals.get(terminalId)
            if (
              settled ||
              !activeSession ||
              activeSession.client !== client
            ) {
              verify(false)
              return
            }

            if (knownHost) {
              if (
                knownHost.algo === algo &&
                knownHost.fingerprint === hostFingerprint
              ) {
                verify(true)
                return
              }
              hostKeyFailure =
                '服务器主机密钥与已保存的指纹不一致，连接已拒绝。如确认服务器已更换密钥，请删除本机 ssh-known-hosts.json 后重试。'
              verify(false)
              return
            }

            let finished = false
            let promptTimer = null
            const finish = (accept, reason = '') => {
              if (finished) return
              finished = true
              if (promptTimer) clearTimeout(promptTimer)
              if (hostKeyWaiters.get(terminalId) === finish) {
                hostKeyWaiters.delete(terminalId)
              }
              if (!accept) {
                hostKeyFailure = reason || '已取消信任 SSH 主机密钥'
                verify(false)
                return
              }
              trustKnownHost(knownHostsFile, host, port, {
                algo,
                fingerprint: hostFingerprint
              })
                .catch(() => {})
                .finally(() => verify(true))
            }

            hostKeyWaiters.set(terminalId, finish)
            promptTimer = setTimeout(() => {
              finish(false, '确认 SSH 主机密钥超时')
            }, 30000)
            sendToOwner(ownerId, 'terminal:host-key', {
              terminalId,
              host,
              port,
              algo,
              fingerprint: hostFingerprint
            })
          })
          .catch(() => {
            hostKeyFailure = '读取主机密钥记录失败，连接已取消'
            verify(false)
          })
      }
    }
    if (authType === 'password') config.password = String(ssh.password)
    if (authType === 'key') {
      config.privateKey = privateKey
      if (ssh.passphrase) config.passphrase = String(ssh.passphrase)
    }
    if (authType === 'agent') config.agent = agent

    try {
      client.connect(config)
      // 关闭 Nagle：否则连续敲键产生的多个小包会被合并/等待 ACK，
      // 交互时明显发涩（本地 PTY 不受影响，所以只有 SSH 终端卡）。
      client.setNoDelay(true)
    } catch (error) {
      resolveOnce({ ok: false, error: error.message || String(error) })
    }
  })
}

function sftpCall(sftp, method, ...args) {
  return new Promise((resolve, reject) => {
    try {
      sftp[method](...args, (error, result) => {
        if (error) reject(error)
        else resolve(result)
      })
    } catch (error) {
      reject(error)
    }
  })
}

function joinRemotePath(base, name) {
  const cleanName = String(name || '').replace(/^[/\\]+/, '')
  if (!base || base === '.' || base === '/') {
    return base === '/' ? `/${cleanName}` : cleanName
  }
  return `${String(base).replace(/[/\\]+$/, '')}/${cleanName}`
}

function remoteBaseName(target) {
  const value = String(target || '').replace(/[/\\]+$/, '')
  const index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  return index >= 0 ? value.slice(index + 1) : value
}

function formatSftpPermissions(mode) {
  const bits = [
    [0o400, 'r'],
    [0o200, 'w'],
    [0o100, 'x'],
    [0o040, 'r'],
    [0o020, 'w'],
    [0o010, 'x'],
    [0o004, 'r'],
    [0o002, 'w'],
    [0o001, 'x']
  ]
  return bits.map(([bit, char]) => (mode & bit ? char : '-')).join('')
}

function getSftpSession(event, terminalId) {
  const session = terminals.get(terminalId)
  if (!session || session.kind !== 'ssh' || !session.client) {
    return Promise.reject(new Error('SSH 会话不可用'))
  }
  if (session.ownerId !== event.sender.id) {
    return Promise.reject(new Error('无权访问该 SSH 会话'))
  }
  if (session.sftp) return Promise.resolve(session.sftp)
  if (session.sftpPromise) return session.sftpPromise

  session.sftpPromise = new Promise((resolve, reject) => {
    session.client.sftp((error, sftp) => {
      session.sftpPromise = null
      if (error) {
        reject(error)
        return
      }
      session.sftp = sftp
      sftp.on('close', () => {
        if (session.sftp === sftp) session.sftp = null
      })
      resolve(sftp)
    })
  })
  return session.sftpPromise
}

async function listRemoteDirectory(sftp, target) {
  const resolved = await sftpCall(sftp, 'realpath', target)
  const list = await sftpCall(sftp, 'readdir', resolved)
  const entries = await Promise.all(
    list.map(async (entry) => {
      const attrs = entry.attrs || {}
      const fullPath = joinRemotePath(resolved, entry.filename)
      const isLink = Boolean(attrs.isSymbolicLink?.())
      let type = attrs.isDirectory?.() ? 'dir' : 'file'
      if (isLink) {
        const targetStats = await new Promise((resolve) => {
          sftp.stat(fullPath, (error, stats) => resolve(error ? null : stats))
        })
        type = targetStats?.isDirectory?.() ? 'dir' : 'file'
      }
      return {
        name: entry.filename,
        path: fullPath,
        type,
        isLink,
        size: Number(attrs.size) || 0,
        mtime: Number(attrs.mtime) ? Number(attrs.mtime) * 1000 : 0,
        permissions: formatSftpPermissions(Number(attrs.mode) || 0)
      }
    })
  )
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return { path: resolved, entries }
}

async function removeRemoteEntry(sftp, target, type, isLink) {
  if (type === 'dir' && !isLink) {
    const list = await sftpCall(sftp, 'readdir', target)
    for (const entry of list) {
      const attrs = entry.attrs || {}
      await removeRemoteEntry(
        sftp,
        joinRemotePath(target, entry.filename),
        attrs.isDirectory?.() ? 'dir' : 'file',
        Boolean(attrs.isSymbolicLink?.())
      )
    }
    await sftpCall(sftp, 'rmdir', target)
    return
  }
  await sftpCall(sftp, 'unlink', target)
}

function getWindowInfo() {
  const ids = []
  for (const win of windows) {
    if (!win.isDestroyed() && win.__windowId) ids.push(win.__windowId)
  }
  return { count: ids.length, ids }
}

function broadcastWindowCount() {
  const info = getWindowInfo()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('app:windows-changed', info)
    }
  }
}

function findWindowById(windowId) {
  for (const win of windows) {
    if (!win.isDestroyed() && win.__windowId === windowId) return win
  }
  return null
}

function createWindow(windowId = 'main') {
  const browserWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 680,
    title: APP_DISPLAY_NAME,
    backgroundColor: '#f4f4f4',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  windows.add(browserWindow)
  browserWindow.__windowId = windowId
  const contentsId = browserWindow.webContents.id
  broadcastWindowCount()

  browserWindow.once('ready-to-show', () => browserWindow.show())

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    const url = new URL(devUrl)
    url.searchParams.set('win', windowId)
    browserWindow.loadURL(url.toString())
  } else {
    browserWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      query: { win: windowId }
    })
  }

  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  browserWindow.webContents.on('before-input-event', (event, input) => {
    const isDevTools =
      input.key === 'F12' ||
      ((input.meta || input.control) && input.alt && input.key.toLowerCase() === 'i')
    if (isDevTools) {
      browserWindow.webContents.toggleDevTools()
      event.preventDefault()
    }

    if (
      process.platform !== 'darwin' &&
      input.control &&
      !input.alt &&
      input.key.toLowerCase() === 'n'
    ) {
      createWindow(uniqueWindowId())
      event.preventDefault()
    }
  })

  browserWindow.webContents.on('destroyed', () => {
    closeSessionsForWebContents(contentsId)
    closeTerminalsForWebContents(contentsId)
  })

  browserWindow.on('closed', () => {
    windows.delete(browserWindow)
    closeSessionsForWebContents(contentsId)
    closeTerminalsForWebContents(contentsId)
    broadcastWindowCount()
  })

  return browserWindow
}

function buildApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }

  const template = [
    {
      label: APP_DISPLAY_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        {
          label: '新建窗口',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow(uniqueWindowId())
        },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'close' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (app.isReady()) {
      createWindow(uniqueWindowId())
    }
  })

  app.whenReady().then(() => {
    if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png'))
    }
    buildApplicationMenu()
    createWindow('main')

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow('main')
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    for (const sessionId of [...sessions.keys()]) {
      closeSession(sessionId)
    }
  })
}


// ---------- 虚拟串口（串口对 + 自动回复） ----------
// macOS/Linux 用一个 PTY：主端留在本进程，从端 /dev/ttysXXX 给第三方程序打开；
// Windows 依赖 com0com 生成的 COM 端口对（驱动级），本端用 serialport 打开其中一端。
// 一个页面可以有多个端口，每个端口用独立的 portId 区分。

const virtualPorts = new Map()
// 管理员脚本一次返回多个空闲端口对，后续新建直接复用，避免每次都弹 UAC
const windowsPairPool = []
const WINDOWS_PAIR_POOL_MAX = 12

function pairKey(pair) {
  return pair ? `${pair.a}|${pair.b}` : ''
}

function addPairToPool(pair) {
  if (!pair?.a || !pair?.b) return
  const key = pairKey(pair)
  if (windowsPairPool.some((item) => pairKey(item) === key)) return
  if (windowsPairPool.length >= WINDOWS_PAIR_POOL_MAX) return
  windowsPairPool.push({ a: pair.a, b: pair.b })
}

function takePairFromPool() {
  while (windowsPairPool.length) {
    const pair = windowsPairPool.shift()
    if (usedComPairKeys().has(pairKey(pair))) continue
    return pair
  }
  return null
}
const VIRTUAL_LOG_LIMIT = 400
// 没有换行结尾的数据，安静这么久后当作一条完整消息
const VIRTUAL_IDLE_MS = 80

function notifySerialPortsChanged() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('serial:ports-changed')
    }
  }
}

function emitVirtual(ownerId, portId, payload) {
  sendToOwner(ownerId, 'virtual:event', { portId, ...payload })
}

function pushVirtualLog(state, entry) {
  state.log.push(entry)
  if (state.log.length > VIRTUAL_LOG_LIMIT) {
    state.log.splice(0, state.log.length - VIRTUAL_LOG_LIMIT)
  }
}

function sendVirtualReply(portId, reply) {
  const current = virtualPorts.get(portId)
  if (!current || !reply.length) return
  try {
    if (current.kind === 'pty') current.proc.write(reply)
    else if (current.kind === 'com') current.port.write(reply, () => {})
  } catch {
    return
  }
  emitVirtual(current.ownerId, portId, {
    type: 'data',
    direction: 'tx',
    bytes: new Uint8Array(reply),
    hex: bufferToHex(reply),
    text: reply.toString('utf8')
  })
  pushVirtualLog(current, { direction: 'tx', hex: bufferToHex(reply), at: Date.now() })
}

// 一段数据里的每条消息都匹配一次；无结束符的消息等空闲后再判定
function dispatchVirtualReplies(portId, messages) {
  const state = virtualPorts.get(portId)
  if (!state || !messages.length) return
  let delay = 30
  for (const message of messages) {
    const replies = matchMessage(message, state.rules, {
      portName: state.externalPath || state.internalPath || ''
    })
    for (const reply of replies) {
      setTimeout(() => sendVirtualReply(portId, reply), delay)
      delay += 30
    }
  }
}

function scheduleVirtualFlush(portId) {
  const state = virtualPorts.get(portId)
  if (!state) return
  if (state.flushTimer) clearTimeout(state.flushTimer)
  state.flushTimer = setTimeout(() => {
    const current = virtualPorts.get(portId)
    if (!current) return
    current.flushTimer = null
    dispatchVirtualReplies(portId, current.matcher.flush())
  }, VIRTUAL_IDLE_MS)
}

function handleVirtualIncoming(portId, chunk) {
  const state = virtualPorts.get(portId)
  if (!state || !chunk || !chunk.length) return
  emitVirtual(state.ownerId, portId, {
    type: 'data',
    direction: 'rx',
    bytes: new Uint8Array(chunk),
    hex: bufferToHex(chunk),
    text: chunk.toString('utf8')
  })
  pushVirtualLog(state, { direction: 'rx', hex: bufferToHex(chunk), at: Date.now() })
  if (!state.rules.length) return
  const splitLines = state.rules.some((rule) => rule.kind === 'text')
  dispatchVirtualReplies(portId, state.matcher.push(chunk, splitLines))
  scheduleVirtualFlush(portId)
}

function closeVirtual(portId, options = {}) {
  const { releasePair = true } = options
  const state = virtualPorts.get(portId)
  if (!state) return
  virtualPorts.delete(portId)
  if (state.kind === 'com' && state.internalPath) {
    releaseSerialPath(state.internalPath, `virtual:${portId}`)
  }
  if (
    releasePair &&
    state.pairKey &&
    state.kind === 'com' &&
    state.internalPath &&
    state.externalPath
  ) {
    addPairToPool({ a: state.internalPath, b: state.externalPath })
  }
  if (state.flushTimer) {
    clearTimeout(state.flushTimer)
    state.flushTimer = null
  }
  try {
    if (state.kind === 'pty') state.proc.kill()
    else if (state.kind === 'com' && state.port?.isOpen) state.port.close(() => {})
  } catch {
    // 忽略关闭异常
  }
}

function createUnixVirtualPort({ portId, ownerId, rules }) {
  const pty = loadNodePty()
  if (!pty) {
    return Promise.resolve({
      ok: false,
      error: '虚拟串口需要 node-pty，当前环境不可用'
    })
  }
  let proc
  try {
    proc = pty.spawn(
      '/bin/sh',
      ['-c', 'stty -echo -icanon raw 2>/dev/null; tty; exec sleep 86400'],
      { name: 'xterm-256color', cols: 160, rows: 24, encoding: null }
    )
  } catch (error) {
    return Promise.resolve({ ok: false, error: error.message || String(error) })
  }
  const state = {
    kind: 'pty',
    proc,
    ownerId,
    externalPath: '',
    rules: compileRules(rules),
    matcher: createMessageBuffer(),
    flushTimer: null,
    log: [],
    pending: ''
  }
  virtualPorts.set(portId, state)
  proc.onExit(() => {
    if (virtualPorts.get(portId) === state) {
      virtualPorts.delete(portId)
      emitVirtual(ownerId, portId, { type: 'status', status: 'closed' })
    }
  })
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const timer = setTimeout(() => {
      finish({ ok: false, error: '创建虚拟串口超时' })
    }, 5000)
    proc.onData((raw) => {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8')
      if (!state.externalPath) {
        state.pending += chunk.toString('utf8')
        const newline = state.pending.indexOf('\n')
        if (newline >= 0) {
          const ttyPath = state.pending.slice(0, newline).trim()
          state.pending = state.pending.slice(newline + 1)
          if (!ttyPath.startsWith('/dev/')) return
          state.externalPath = ttyPath
          clearTimeout(timer)
          finish({ ok: true, externalPath: ttyPath, platform: process.platform })
        }
        return
      }
      handleVirtualIncoming(portId, chunk)
    })
  })
}

function com0comDir() {
  return process.resourcesPath
    ? path.join(process.resourcesPath, 'com0com')
    : ''
}

function com0comLogPath() {
  return path.join(app.getPath('userData'), 'logs', 'com0com.log')
}

async function logCom0com(message, data) {
  try {
    const file = com0comLogPath()
    await fs.mkdir(path.dirname(file), { recursive: true })
    const stat = await fs.stat(file).catch(() => null)
    if (stat && stat.size > 2 * 1024 * 1024) {
      await fs.rename(file, `${file}.1`).catch(() => {})
    }
    const payload =
      data === undefined
        ? ''
        : ` ${typeof data === 'string' ? data : JSON.stringify(data)}`
    await fs.appendFile(
      file,
      `[${new Date().toISOString()}] ${message}${payload}\n`,
      'utf8'
    )
  } catch {
    // 日志写入失败不影响主流程
  }
}

let com0comSetupProbe = { at: 0, value: '' }

// 从卸载注册表里读取 com0com 的实际安装位置，
// 这样即使用户安装到非默认目录也能找到 setupc.exe。
function com0comSetupFromRegistry() {
  const script = [
    "$roots = @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall')",
    'foreach ($root in $roots) {',
    '  if (!(Test-Path $root)) { continue }',
    '  Get-ChildItem $root | ForEach-Object {',
    '    $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue',
    "    if ($p -and $p.DisplayName -like '*com0com*') {",
    '      if ($p.InstallLocation) { Write-Output $p.InstallLocation }',
    '      if ($p.UninstallString) {',
    '        $u = $p.UninstallString.Trim()',
    `        if ($u.StartsWith('"')) { $u = $u.Substring(1, $u.IndexOf('"', 1) - 1) }`,
    "        else { $u = ($u -split ' ')[0] }",
    '        Write-Output (Split-Path -Parent $u)',
    '      }',
    '    }',
    '  }',
    '}'
  ].join('\n')
  try {
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 4000, windowsHide: true }
    )
    for (const line of output.split(/\r?\n/)) {
      const dir = line.trim().replace(/^"|"$/g, '')
      if (!dir) continue
      const setupc = path.join(dir, 'setupc.exe')
      if (fsSync.existsSync(setupc)) return setupc
    }
  } catch {}
  return ''
}

function com0comSetupPath() {
  const now = Date.now()
  if (now - com0comSetupProbe.at < 3000) {
    if (com0comSetupProbe.value && fsSync.existsSync(com0comSetupProbe.value)) {
      return com0comSetupProbe.value
    }
    return ''
  }
  const bundled = com0comDir()
  const programDirs = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramW6432
  ].filter(Boolean)
  const candidates = [
    bundled ? path.join(bundled, 'setupc.exe') : '',
    ...programDirs.map((dir) => path.join(dir, 'com0com', 'setupc.exe')),
    'C:\\Program Files (x86)\\com0com\\setupc.exe',
    'C:\\Program Files\\com0com\\setupc.exe'
  ].filter(Boolean)
  let found = candidates.find((file) => fsSync.existsSync(file)) || ''
  if (!found && process.platform === 'win32') {
    found = com0comSetupFromRegistry()
  }
  com0comSetupProbe = { at: now, value: found }
  return found
}

function com0comInstallerPath() {
  const dir = com0comDir()
  if (!dir) return ''
  const names = ['com0com-setup.exe', 'setup.exe', 'com0com-installer.exe']
  for (const name of names) {
    const file = path.join(dir, name)
    if (fsSync.existsSync(file)) return file
  }
  return ''
}

function parseComPairEntries(output) {
  const ports = new Map()
  output.split(/\r?\n/).forEach((line) => {
    const cnc = /(CNC[AB](\d+))/i.exec(line.trim())
    if (!cnc) return
    const key = cnc[1].toUpperCase()
    const index = Number(cnc[2])
    let name = 'COM#'
    const real = /RealPortName=(COM\d+)/i.exec(line)
    if (real) {
      name = real[1].toUpperCase()
    } else {
      const port = /PortName=(COM#|COM\d+)/i.exec(line)
      if (port) name = port[1].toUpperCase()
    }
    ports.set(key, { name, index })
  })
  const entries = []
  const seen = new Set()
  for (const key of ports.keys()) {
    if (seen.has(key) || !key.startsWith('CNCA')) continue
    const partner = key.replace('CNCA', 'CNCB')
    if (!ports.has(partner)) continue
    seen.add(key)
    seen.add(partner)
    entries.push({
      cncA: key,
      cncB: partner,
      a: ports.get(key).name,
      b: ports.get(partner).name,
      index: ports.get(key).index
    })
  }
  return entries
}

function removePairFromPool(a, b) {
  const key = `${a}|${b}`
  for (let index = windowsPairPool.length - 1; index >= 0; index -= 1) {
    if (pairKey(windowsPairPool[index]) === key) {
      windowsPairPool.splice(index, 1)
    }
  }
}

async function removeCom0comPair(setupc, a, b) {
  const cwd = path.dirname(setupc)
  const listed = await execFileAsync(setupc, ['--silent', 'list'], {
    cwd,
    timeout: 8000
  })
  await logCom0com('remove:list', { a, b, output: listed.stdout, detail: com0comErrorDetail(listed) })
  if (listed.error) {
    return { ok: false, error: com0comErrorDetail(listed) }
  }
  const entries = parseComPairEntries(listed.stdout)
  const entry = entries.find(
    (item) => (item.a === a && item.b === b) || (item.a === b && item.b === a)
  )
  if (!entry) return { ok: true }
  let detail = ''
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const removed = await execFileAsync(
      setupc,
      ['--silent', 'remove', String(entry.index)],
      { cwd, timeout: 15000 }
    )
    if (!removed.error) {
      const check = await execFileAsync(setupc, ['--silent', 'list'], {
        cwd,
        timeout: 8000
      })
      const stillThere =
        !check.error &&
        parseComPairEntries(check.stdout).some(
          (item) => item.index === entry.index
        )
      if (stillThere) {
        detail = 'remove 命令已执行，但端口对仍然存在（可能被占用或不支持）'
        await logCom0com('remove:still-present', { a, b, index: entry.index, output: check.stdout })
        break
      }
      await logCom0com('remove:ok', { a, b, cncA: entry.cncA, cncB: entry.cncB })
      return { ok: true }
    }
    detail = com0comErrorDetail(removed)
    await logCom0com('remove:failed', { a, b, cncA: entry.cncA, cncB: entry.cncB, detail })
    if (!/open|busy|使用|占用/i.test(detail)) break
    await new Promise((resolve) => setTimeout(resolve, 260))
  }
  return {
    ok: false,
    error: '无法删除 com0com 端口对（可能仍被其他程序占用）',
    detail
  }
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { windowsHide: true, ...options },
      (error, stdout, stderr) => {
        resolve({ error, stdout: stdout || '', stderr: stderr || '' })
      }
    )
  })
}

let windowsAdminCache = null

async function isWindowsAdmin() {
  if (process.platform !== 'win32') return false
  if (windowsAdminCache !== null) return windowsAdminCache
  const result = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"
  ])
  windowsAdminCache = !result.error && /true/i.test(result.stdout)
  return windowsAdminCache
}

function com0comErrorDetail(result) {
  if (!result) return ''
  const message = result.error?.message || ''
  const stdout = result.stdout || ''
  const stderr = result.stderr || ''
  return [message, stdout, stderr].filter(Boolean).join(' ').trim()
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function com0comPairScript(setupc, used, output) {
  return `$Setupc = ${quotePowerShell(setupc)}
$Used = ${quotePowerShell(used)}
$Output = ${quotePowerShell(output)}
$ErrorActionPreference = 'Stop'
function Write-Result([string]$text) {
  Set-Content -LiteralPath $Output -Value $text -Encoding UTF8
}
try {
  Set-Location -LiteralPath (Split-Path -Parent $Setupc)
  $listOutput = (& $Setupc --silent list 2>&1 | Out-String)
  $ports = @{}
  $indexes = @{}
  foreach ($line in ($listOutput -split "\\r?\\n")) {
    if ($line -match '(CNC[AB](\\d+))') {
      $key = $matches[1].ToUpper()
      $idx = [int]$matches[2]
      $indexes[$key] = $idx
      if ($line -match 'RealPortName=(COM\\d+)') {
        $ports[$key] = $matches[1].ToUpper()
      } elseif ($line -match 'PortName=(COM#|COM\\d+)') {
        $ports[$key] = $matches[1].ToUpper()
      } else {
        $ports[$key] = 'COM#'
      }
    }
  }

  $usedSet = @{}
  foreach ($u in ($Used -split ',')) {
    if ($u) { $usedSet[$u] = $true }
  }
  $free = @()
  foreach ($key in @($ports.Keys)) {
    if ($key -like 'CNCA*') {
      $partner = $key -replace '^CNCA', 'CNCB'
      if ($ports.ContainsKey($partner)) {
        $a = $ports[$key]
        $b = $ports[$partner]
        if (
          -not $usedSet.ContainsKey("$a|$b") -and
          $a -ne $b -and
          $a -match '^COM\\d+$' -and
          $b -match '^COM\\d+$'
        ) {
          $free += "$a,$b"
        }
      }
    }
  }
  if ($free.Count -gt 0) {
    Write-Result ('PAIRS=' + ($free -join ';'))
    exit 0
  }

  $beforeKeys = @{}
  foreach ($key in @($ports.Keys)) { $beforeKeys[$key] = $true }

  # PortName=COM# 会启用 Windows Ports class，由系统自动分配真实 COM 数字
  $installOutput = (& $Setupc --silent install PortName=COM# PortName=COM# 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) {
    Write-Result ('ERROR=安装端口对失败：' + (($installOutput -replace '\\r?\\n', ' ').Trim()))
    exit 0
  }

  $newKey = $null
  $newPartner = $null
  $newIndex = -1
  $newA = ''
  $newB = ''
  for ($wait = 0; $wait -lt 20 -and -not $newKey; $wait++) {
    Start-Sleep -Milliseconds 300
    $listAfter = (& $Setupc --silent list 2>&1 | Out-String)
    $afterPorts = @{}
    $afterIndexes = @{}
    foreach ($line in ($listAfter -split "\\r?\\n")) {
      if ($line -match '(CNC[AB](\\d+))') {
        $key = $matches[1].ToUpper()
        $idx = [int]$matches[2]
        $afterIndexes[$key] = $idx
        if ($line -match 'RealPortName=(COM\\d+)') {
          $afterPorts[$key] = $matches[1].ToUpper()
        } elseif ($line -match 'PortName=(COM#|COM\\d+)') {
          $afterPorts[$key] = $matches[1].ToUpper()
        } else {
          $afterPorts[$key] = 'COM#'
        }
      }
    }
    foreach ($key in @($afterPorts.Keys)) {
      if ($key -like 'CNCA*' -and -not $beforeKeys.ContainsKey($key)) {
        $partner = $key -replace '^CNCA', 'CNCB'
        if ($afterPorts.ContainsKey($partner)) {
          $newKey = $key
          $newPartner = $partner
          $newIndex = $afterIndexes[$key]
          $newA = $afterPorts[$key]
          $newB = $afterPorts[$partner]
          break
        }
      }
    }
  }

  if (-not $newKey) {
    Write-Result 'ERROR=安装后未找到新端口对，请检查 com0com 驱动状态'
    exit 0
  }

  if (
    $newA -match '^COM\\d+$' -and
    $newB -match '^COM\\d+$' -and
    $newA -ne $newB
  ) {
    Write-Result "PAIRS=$newA,$newB"
    exit 0
  }

  & $Setupc --silent remove $newIndex 2>&1 | Out-Null
  Write-Result ('ERROR=Windows 没有分配有效的 COM 端口：' + (($listAfter -replace '\\r?\\n', ' ').Trim()))
} catch {
  Write-Result ('ERROR=' + (($_.Exception.Message -replace '\\r?\\n', ' ').Trim()))
}
`
}

async function runCom0comPairScript(setupc, usedKeys) {
  const outputPath = path.join(
    app.getPath('temp'),
    `weft-com0com-${process.pid}-${Date.now()}.out`
  )
  const script = com0comPairScript(setupc, usedKeys.join(','), outputPath)
  const encoded = Buffer.from(script, 'utf16le').toString('base64')

  // 应用必须以管理员身份运行；这里不再触发 UAC，直接继承管理员权限执行
  const launched = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encoded
  ], { timeout: 90000 })
  let output = ''
  try {
    output = (await fs.readFile(outputPath, 'utf8')).replace(/^\uFEFF/, '')
  } catch {
    // UAC 被取消或脚本没有写出结果
  }
  fs.unlink(outputPath).catch(() => {})
  await logCom0com('pair-script:result', {
    usedKeys,
    error: launched?.error?.message || '',
    stderr: launched?.stderr || '',
    output: output.trim()
  })

  const pairList = /PAIRS=([^\r\n]+)/i.exec(output)
  if (pairList) {
    const pairs = pairList[1]
      .split(';')
      .map((item) => {
        const [a, b] = item.split(',')
        return a && b
          ? { a: a.trim().toUpperCase(), b: b.trim().toUpperCase() }
          : null
      })
      .filter(Boolean)
    if (pairs.length) return { pairs }
  }
  const pair = /PAIR=(COM\d+),(COM\d+)/i.exec(output)
  if (pair) {
    return { pairs: [{ a: pair[1].toUpperCase(), b: pair[2].toUpperCase() }] }
  }
  const detail = /ERROR=([^\r\n]+)/i.exec(output)
  return {
    error: '创建 com0com 端口对失败',
    detail:
      (detail && detail[1].trim()) ||
      launched?.stderr ||
      launched?.error?.message ||
      'UAC 已取消或 com0com 脚本未执行'
  }
}

function com0comUninstallerPath() {
  const dirs = [
    com0comDir(),
    process.env.ProgramFiles
      ? path.join(process.env.ProgramFiles, 'com0com')
      : '',
    process.env['ProgramFiles(x86)']
      ? path.join(process.env['ProgramFiles(x86)'], 'com0com')
      : '',
    'C:\\Program Files (x86)\\com0com',
    'C:\\Program Files\\com0com'
  ].filter(Boolean)
  const names = ['uninstall.exe', 'unins000.exe', 'uninst.exe']
  for (const dir of dirs) {
    for (const name of names) {
      const file = path.join(dir, name)
      if (fsSync.existsSync(file)) return file
    }
  }
  return ''
}

async function findCom0comUninstallCommand() {
  const script = [
    "$roots = @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')",
    'foreach ($root in $roots) {',
    '  if (!(Test-Path $root)) { continue }',
    '  Get-ChildItem $root | ForEach-Object {',
    '    $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue',
    "    if ($p -and $p.DisplayName -like '*com0com*') {",
    '      if ($p.QuietUninstallString) { $p.QuietUninstallString; exit }',
    '      if ($p.UninstallString) { $p.UninstallString; exit }',
    '    }',
    '  }',
    '}'
  ].join('\n')
  const result = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    script
  ])
  if (result.error) return ''
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || ''
}

async function uninstallCom0com(setupc) {
  const uninstaller = com0comUninstallerPath()
  if (uninstaller) {
    const cwd = path.dirname(uninstaller)
    let result = await execFileAsync(uninstaller, ['/S'], { cwd, timeout: 30000 })
    if (result.error) {
      // 某些卸载程序不支持 /S，回退到可见的图形界面
      result = await execFileAsync(uninstaller, [], { cwd, timeout: 30000 })
    }
    if (!result.error || result.error.code === 3010) {
      // NSIS 卸载程序有时会先退出再在后台删除文件，稍等并检查
      for (let i = 0; i < 12; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        if (!com0comSetupPath() && !fsSync.existsSync(uninstaller)) break
      }
      return { ...result, official: true }
    }
  }
  const command = await findCom0comUninstallCommand()
  if (command) {
    const result = await execFileAsync('cmd.exe', ['/c', command], {
      cwd: path.dirname(setupc),
      timeout: 30000
    })
    if (
      !result.error ||
      result.error.code === 3010 ||
      /3010/.test(result.error.message || '')
    ) {
      return result
    }
  }
  return execFileAsync(setupc, ['--silent', 'uninstall'], {
    cwd: path.dirname(setupc),
    timeout: 30000
  })
}

function usedComPairKeys() {
  const used = new Set()
  for (const state of virtualPorts.values()) {
    if (state.pairKey) used.add(state.pairKey)
  }
  return used
}

// 多个端口同时创建时串行分配 com0com 端口对，避免抢到同一对
let com0comCreateQueue = Promise.resolve()

function withCom0comQueue(task) {
  const run = com0comCreateQueue.then(task, task)
  com0comCreateQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

async function openWindowsComPort(path) {
  let port
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        port = new SerialPort({ path, baudRate: 115200, autoOpen: false })
        await new Promise((resolve, reject) => {
          port.open((error) => (error ? reject(error) : resolve()))
        })
        return { port }
      } catch (error) {
        try {
          port?.close(() => {})
        } catch {
          // 忽略失败端口的清理异常
        }
        if (attempt >= 5) return { error: error.message || String(error) }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
  } catch (error) {
    return { error: error.message || String(error) }
  }
}

async function createWindowsVirtualPort({ portId, ownerId, rules }) {
  const admin = await isWindowsAdmin()
  await logCom0com('create:start', { portId, admin, setupc: com0comSetupPath() })
  if (!admin) {
    return {
      ok: false,
      error: '需要管理员权限',
      hint:
        'Windows 创建虚拟串口需要管理员权限。请关闭应用，右键 Weft Terminal →「以管理员身份运行」，然后重试。',
      needsAdmin: true
    }
  }
  const setupc = com0comSetupPath()
  if (!setupc) {
    return {
      ok: false,
      error: '未安装 com0com',
      hint: com0comInstallerPath()
        ? '请先运行随应用附带的 com0com 安装程序，安装完成后点击「重试」。'
        : 'Windows 虚拟串口依赖 com0com。请安装 com0com 后点击「重试」。',
      installer: Boolean(com0comInstallerPath())
    }
  }

  return withCom0comQueue(async () => {
    let lastError = ''
    let fetched = false

    for (let attempt = 0; attempt < 20; attempt += 1) {
      let pair = takePairFromPool()
      if (!pair) {
        if (fetched) break
        fetched = true
        const used = new Set([
          ...usedComPairKeys(),
          ...windowsPairPool.map((item) => pairKey(item))
        ])
        const result = await runCom0comPairScript(setupc, [...used])
        if (result.pairs?.length) {
          result.pairs.forEach(addPairToPool)
          continue
        }
        return {
          ok: false,
          error: result.error || '创建 com0com 端口对失败',
          hint:
            result.detail ||
            '请确认 UAC 已通过，并检查 com0com 是否安装完成'
        }
      }

      const opened = await openWindowsComPort(pair.a)
      if (opened.error) {
        lastError = opened.error
        continue
      }

      const port = opened.port
      const state = {
        kind: 'com',
        port,
        ownerId,
        externalPath: pair.b,
        internalPath: pair.a,
        pairKey: pairKey(pair),
        rules: compileRules(rules),
        matcher: createMessageBuffer(),
        flushTimer: null,
        log: []
      }
      virtualPorts.set(portId, state)
      port.on('data', (buffer) => handleVirtualIncoming(portId, buffer))
      port.on('close', () => {
        if (virtualPorts.get(portId) !== state) return
        if (state.keepOnClose) {
          emitVirtual(ownerId, portId, { type: 'status', status: 'closed' })
          return
        }
        virtualPorts.delete(portId)
        if (state.pairKey) {
          addPairToPool({ a: state.internalPath, b: state.externalPath })
        }
        emitVirtual(ownerId, portId, { type: 'status', status: 'closed' })
      })
      port.on('error', () => {})
      windowsSerialPortCache.at = 0
      notifySerialPortsChanged()
      return {
        ok: true,
        externalPath: pair.b,
        internalPath: pair.a,
        platform: 'win32'
      }
    }

    return {
      ok: false,
      error: '创建 com0com 端口失败',
      hint: lastError || '端口可能被其他程序占用，请重试或换一对端口'
    }
  })
}

ipcMain.handle('virtual:create', async (event, payload = {}) => {
  const portId = payload.portId
  if (!portId) return { ok: false, error: '缺少端口标识' }
  closeVirtual(portId)
  const options = {
    portId,
    ownerId: event.sender.id,
    rules: payload.rules
  }
  if (process.platform === 'win32') return createWindowsVirtualPort(options)
  return createUnixVirtualPort(options)
})

ipcMain.handle('virtual:install-com0com', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: '只有 Windows 需要 com0com' }
  }
  if (!(await isWindowsAdmin())) {
    return {
      ok: false,
      error: '需要管理员权限',
      hint: '请以管理员身份重新打开 Weft Terminal 后再安装 com0com',
      needsAdmin: true
    }
  }
  const installer = com0comInstallerPath()
  if (!installer) {
    return { ok: false, error: '未找到随应用附带的 com0com 安装程序' }
  }
  const error = await shell.openPath(installer)
  if (error) return { ok: false, error }
  return { ok: true }
})

ipcMain.handle('virtual:uninstall-com0com', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: '只有 Windows 使用 com0com' }
  }
  if (!(await isWindowsAdmin())) {
    return {
      ok: false,
      error: '需要管理员权限',
      hint: '请以管理员身份重新打开 Weft Terminal 后再卸载 com0com',
      needsAdmin: true
    }
  }
  const setupc = com0comSetupPath()
  if (!setupc) {
    return { ok: false, error: '未检测到 com0com' }
  }
  for (const portId of [...virtualPorts.keys()]) closeVirtual(portId)
  windowsPairPool.length = 0
  await logCom0com('uninstall:start', { setupc })
  const result = await uninstallCom0com(setupc)
  await logCom0com('uninstall:result', {
    error: result.error?.message || '',
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    official: Boolean(result.official)
  })
  windowsSerialPortCache.at = 0
  notifySerialPortsChanged()
  if (result.error && result.error.code !== 3010) {
    return {
      ok: false,
      error: com0comErrorDetail(result) || '卸载 com0com 失败'
    }
  }
  return { ok: true, reboot: true }
})

ipcMain.handle('app:is-admin', async () => ({
  admin: await isWindowsAdmin()
}))

ipcMain.handle('virtual:open-com0com-log', async () => {
  const file = com0comLogPath()
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.appendFile(file, '', 'utf8')
    shell.showItemInFolder(file)
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
  return { ok: true, path: file }
})

async function listCom0comPairs() {
  if (process.platform !== 'win32') {
    return { ok: false, error: '只有 Windows 使用 com0com' }
  }
  if (!(await isWindowsAdmin())) {
    return {
      ok: false,
      needsAdmin: true,
      error: '需要管理员权限',
      hint: '请以管理员身份重新打开 Weft Terminal 后再读取 com0com 端口'
    }
  }
  const setupc = com0comSetupPath()
  if (!setupc) return { ok: false, error: '未安装 com0com' }
  const listed = await execFileAsync(setupc, ['--silent', 'list'], {
    cwd: path.dirname(setupc),
    timeout: 8000
  })
  if (listed.error) {
    return { ok: false, error: com0comErrorDetail(listed) }
  }
  const pairs = parseComPairEntries(listed.stdout)
  await logCom0com('list-pairs', { count: pairs.length, output: listed.stdout })
  return { ok: true, pairs }
}

async function createCom0comPair() {
  if (!(await isWindowsAdmin())) {
    return {
      ok: false,
      needsAdmin: true,
      error: '需要管理员权限',
      hint: '请以管理员身份重新打开 Weft Terminal 后再新建虚拟串口'
    }
  }
  const setupc = com0comSetupPath()
  if (!setupc) return { ok: false, error: '未安装 com0com' }
  const cwd = path.dirname(setupc)
  const before = await listCom0comPairs()
  if (!before.ok) return before
  const beforeKeys = new Set(before.pairs.map((item) => item.cncA))
  const install = await execFileAsync(
    setupc,
    ['--silent', 'install', 'PortName=COM#', 'PortName=COM#'],
    { cwd, timeout: 30000 }
  )
  await logCom0com('create-pair:install', {
    error: com0comErrorDetail(install),
    stdout: install.stdout
  })
  if (install.error) {
    return { ok: false, error: '创建端口对失败', detail: com0comErrorDetail(install) }
  }

  let entry = null
  for (let i = 0; i < 20 && !entry; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    const after = await listCom0comPairs()
    if (!after.ok) return after
    entry = after.pairs.find((item) => !beforeKeys.has(item.cncA)) || null
  }
  if (!entry) {
    return { ok: false, error: '安装后未找到新端口对' }
  }
  const valid =
    entry.a !== entry.b &&
    /^COM\d+$/i.test(entry.a) &&
    /^COM\d+$/i.test(entry.b)
  if (!valid) {
    await execFileAsync(
      setupc,
      ['--silent', 'remove', String(entry.index)],
      { cwd, timeout: 15000 }
    )
    await logCom0com('create-pair:invalid', entry)
    return {
      ok: false,
      error: 'Windows 没有分配有效的 COM 端口',
      detail: `${entry.a} / ${entry.b}`
    }
  }
  await logCom0com('create-pair:ok', entry)
  windowsSerialPortCache.at = 0
  notifySerialPortsChanged()
  return { ok: true, pair: entry }
}

ipcMain.handle('virtual:list-com0com', async () => listCom0comPairs())

ipcMain.handle('virtual:create-com0com', async () =>
  withCom0comQueue(() => createCom0comPair())
)

ipcMain.handle('virtual:open-pair', async (_event, payload = {}) => {
  const { portId, a, b, end } = payload
  if (
    !portId ||
    !a ||
    !b ||
    String(a).toUpperCase() === String(b).toUpperCase() ||
    !/^COM\d+$/i.test(String(a)) ||
    !/^COM\d+$/i.test(String(b))
  ) {
    return { ok: false, error: '端口对参数无效' }
  }
  if (process.platform !== 'win32') {
    return { ok: false, error: '只有 Windows 使用 com0com 端口对' }
  }
  const internal = end === 'b' ? b : a
  const external = end === 'b' ? a : b
  closeVirtual(portId)
  const pathOwner = `virtual:${portId}`
  const claim = claimSerialPath(internal, pathOwner)
  if (!claim.ok) return claim
  let port
  try {
    port = new SerialPort({ path: internal, baudRate: 115200, autoOpen: false })
    await new Promise((resolve, reject) => {
      port.open((error) => (error ? reject(error) : resolve()))
    })
  } catch (error) {
    try {
      port?.close(() => {})
    } catch {
      // ignore
    }
    releaseSerialPath(internal, pathOwner)
    return { ok: false, error: error.message || String(error) }
  }
  const state = {
    kind: 'com',
    port,
    ownerId: _event.sender.id,
    externalPath: external,
    internalPath: internal,
    pairKey: `${a}|${b}`,
    rules: compileRules(payload.rules),
    matcher: createMessageBuffer(),
    flushTimer: null,
    log: []
  }
  virtualPorts.set(portId, state)
  port.on('data', (buffer) => handleVirtualIncoming(portId, buffer))
  port.on('close', () => {
    if (virtualPorts.get(portId) !== state) return
    virtualPorts.delete(portId)
    releaseSerialPath(state.internalPath, pathOwner)
    emitVirtual(_event.sender.id, portId, { type: 'status', status: 'closed' })
  })
  port.on('error', () => {})
  await logCom0com('open-pair', { portId, internal, external })
  return { ok: true, internalPath: internal, externalPath: external }
})

ipcMain.handle('virtual:remove-com0com', async (_event, payload = {}) => {
  if (process.platform !== 'win32') {
    return { ok: false, error: '只有 Windows 使用 com0com' }
  }
  if (!(await isWindowsAdmin())) {
    return {
      ok: false,
      needsAdmin: true,
      error: '需要管理员权限',
      hint: '请以管理员身份重新打开 Weft Terminal 后再删除端口对'
    }
  }
  const setupc = com0comSetupPath()
  if (!setupc) return { ok: false, error: '未安装 com0com' }
  const index = Number(payload.index)
  if (!Number.isInteger(index) || index < 0) {
    return { ok: false, error: '端口对序号无效' }
  }
  removePairFromPool(payload.a, payload.b)
  for (const [portId, state] of [...virtualPorts.entries()]) {
    const key = state.pairKey
    if (key && key.split('|').some((name) => name === payload.a || name === payload.b)) {
      closeVirtual(portId)
    }
  }
  const result = await execFileAsync(
    setupc,
    ['--silent', 'remove', String(index)],
    { cwd: path.dirname(setupc), timeout: 15000 }
  )
  if (result.error) {
    return { ok: false, error: '删除端口对失败', detail: com0comErrorDetail(result) }
  }
  const after = await execFileAsync(setupc, ['--silent', 'list'], {
    cwd: path.dirname(setupc),
    timeout: 8000
  })
  if (!after.error) {
    const still = parseComPairEntries(after.stdout).some(
      (item) => item.index === index
    )
    if (still) {
      return { ok: false, error: '端口对仍然存在（可能被占用）' }
    }
  }
  windowsSerialPortCache.at = 0
  notifySerialPortsChanged()
  await logCom0com('remove-pair', { index, a: payload.a, b: payload.b })
  return { ok: true }
})

ipcMain.handle('virtual:com0com-status', async () => {
  if (process.platform !== 'win32') {
    return {
      platform: process.platform,
      installed: false,
      installer: false,
      admin: false,
      pairs: 0
    }
  }
  const installed = Boolean(com0comSetupPath())
  const admin = await isWindowsAdmin()
  let pairs = 0
  if (installed && admin) {
    const setupc = com0comSetupPath()
    const listed = await execFileAsync(setupc, ['--silent', 'list'], {
      cwd: path.dirname(setupc),
      timeout: 8000
    })
    if (!listed.error) {
      pairs = parseComPairEntries(listed.stdout).length
    }
  }
  return {
    platform: 'win32',
    installed,
    installer: Boolean(com0comInstallerPath()),
    admin,
    pairs
  }
})

ipcMain.handle('virtual:clean-com0com', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: '只有 Windows 使用 com0com' }
  }
  if (!(await isWindowsAdmin())) {
    return {
      ok: false,
      needsAdmin: true,
      error: '需要管理员权限',
      hint: '请以管理员身份重新打开 Weft Terminal 后再清理'
    }
  }
  const setupc = com0comSetupPath()
  if (!setupc) return { ok: false, error: '未检测到 com0com' }
  for (const portId of [...virtualPorts.keys()]) closeVirtual(portId)
  windowsPairPool.length = 0
  const cwd = path.dirname(setupc)
  const listed = await execFileAsync(setupc, ['--silent', 'list'], {
    cwd,
    timeout: 8000
  })
  if (listed.error) {
    return { ok: false, error: com0comErrorDetail(listed) }
  }
  const entries = parseComPairEntries(listed.stdout)
  await logCom0com('clean:list', { count: entries.length, output: listed.stdout })
  let removed = 0
  for (const entry of entries) {
    const result = await execFileAsync(
      setupc,
      ['--silent', 'remove', String(entry.index)],
      { cwd, timeout: 15000 }
    )
    if (!result.error) removed += 1
    else await logCom0com('clean:remove-failed', { entry, detail: com0comErrorDetail(result) })
  }
  windowsSerialPortCache.at = 0
  await logCom0com('clean:done', { removed, total: entries.length })
  notifySerialPortsChanged()
  return { ok: true, removed, total: entries.length }
})

ipcMain.handle('virtual:remove', async (_event, payload = {}) => {
  const portId = payload.portId
  const state = virtualPorts.get(portId)
  if (!state) return { ok: true }
  const a = state.internalPath
  const b = state.externalPath

  if (process.platform === 'win32' && a && b) {
    if (!(await isWindowsAdmin())) {
      return {
        ok: false,
        needsAdmin: true,
        error: '需要管理员权限才能同步删除 com0com 端口对',
        hint: '请以管理员身份重新打开 Weft Terminal 后再删除'
      }
    }
    const setupc = com0comSetupPath()
    if (!setupc) return { ok: false, error: '未检测到 com0com' }

    // 先关掉本应用占用的那一端，但保留状态以便删除失败时可以重试
    state.pairKey = ''
    state.keepOnClose = true
    if (state.flushTimer) {
      clearTimeout(state.flushTimer)
      state.flushTimer = null
    }
    try {
      if (state.port?.isOpen) state.port.close(() => {})
    } catch {
      // 端口已经关闭时忽略
    }
    await new Promise((resolve) => setTimeout(resolve, 160))
    removePairFromPool(a, b)
    const result = await removeCom0comPair(setupc, a, b)
    if (!result.ok) return result
    virtualPorts.delete(portId)
    windowsSerialPortCache.at = 0
    notifySerialPortsChanged()
    return { ok: true, pairRemoved: true }
  }

  closeVirtual(portId)
  return { ok: true }
})

ipcMain.handle('virtual:close', async (_event, payload = {}) => {
  if (payload.portId) closeVirtual(payload.portId)
  return { ok: true }
})

ipcMain.handle('virtual:set-rules', async (_event, payload = {}) => {
  const state = virtualPorts.get(payload.portId)
  if (!state) return { ok: false, error: '虚拟串口未创建' }
  state.rules = compileRules(payload.rules)
  state.matcher.reset()
  if (state.flushTimer) {
    clearTimeout(state.flushTimer)
    state.flushTimer = null
  }
  return { ok: true }
})

async function listWindowsRegistryPorts() {
  if (process.platform !== 'win32') return []
  const result = await execFileAsync('reg', [
    'query',
    'HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM'
  ])
  if (result.error) return []
  const ports = []
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^\s*(COM\d+)\s+REG_SZ\s+(.+)$/i.exec(line)
    if (!match) continue
    ports.push({
      path: match[1].toUpperCase(),
      manufacturer: 'com0com',
      serialNumber: '',
      friendlyName: `com0com · ${match[2].trim()}`
    })
  }
  return ports
}

let windowsSerialPortCache = { at: 0, ports: [] }

async function listWindowsSerialPortNames() {
  const now = Date.now()
  if (now - windowsSerialPortCache.at < 8000) {
    return windowsSerialPortCache.ports
  }
  const result = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    '[System.IO.Ports.SerialPort]::GetPortNames()'
  ])
  const ports = []
  if (!result.error) {
    for (const line of result.stdout.split(/\r?\n/)) {
      const match = /^\s*(COM\d+)\s*$/i.exec(line)
      if (match) {
        ports.push({
          path: match[1].toUpperCase(),
          manufacturer: 'com0com',
          serialNumber: '',
          friendlyName: match[1].toUpperCase()
        })
      }
    }
  }
  windowsSerialPortCache = { at: now, ports }
  return ports
}

ipcMain.handle('serial:list', async () => {
  let ports = []
  try {
    ports = (await SerialPort.list()).map((item) => ({
      path: item.path,
      manufacturer: item.manufacturer || '',
      serialNumber: item.serialNumber || '',
      friendlyName: item.friendlyName || item.path
    }))
  } catch {
    ports = []
  }
  if (process.platform === 'win32') {
    const known = new Set(ports.map((port) => port.path.toUpperCase()))
    const extras = [
      ...(await listWindowsRegistryPorts()),
      ...(await listWindowsSerialPortNames())
    ]
    for (const port of extras) {
      if (known.has(port.path)) continue
      known.add(port.path)
      ports.push(port)
    }
  }
  return ports
})

ipcMain.handle('serial:encode', (_event, { text, encoding }) => {
  const name = ICONV_MAP[encoding] || 'utf8'
  return new Uint8Array(iconv.encode(String(text ?? ''), name))
})

ipcMain.handle('serial:open', async (event, options = {}) => {
  const { sessionId } = options
  if (!sessionId) return { ok: false, error: '缺少页面标识' }

  await closeSession(sessionId)

  const flow = options.flowControl || 'none'
  const ownerId = event.sender.id
  const pathOwner = `serial:${sessionId}`
  const claim = claimSerialPath(options.path, pathOwner)
  if (!claim.ok) return claim
  let serialPort

  try {
    serialPort = new SerialPort({
      path: options.path,
      baudRate: Number(options.baudRate) || 115200,
      dataBits: Number(options.dataBits) || 8,
      stopBits: Number(options.stopBits) || 1,
      parity: PARITY_MAP[options.parity] || 'none',
      rtscts: flow === 'hardware',
      xon: flow === 'software',
      xoff: flow === 'software',
      autoOpen: false
    })
  } catch (error) {
    releaseSerialPath(options.path, pathOwner)
    return {
      ok: false,
      error: error.message || String(error),
      code: error.code || ''
    }
  }

  sessions.set(sessionId, { port: serialPort, ownerId, path: options.path })

  serialPort.on('data', (buffer) => {
    const session = sessions.get(sessionId)
    if (!session || session.port !== serialPort) return
    sendToOwner(ownerId, 'serial:data', {
      sessionId,
      data: new Uint8Array(buffer)
    })
  })

  serialPort.on('error', (error) => {
    const session = sessions.get(sessionId)
    if (!session || session.port !== serialPort) return
    // PTY 等伪设备不支持调制解调器控制线，set({rts,dtr}) 会报 ioctl 错误，
    // 这不影响收发，不当作致命错误提示给用户。
    if (
      error?.code === 'EINVAL' ||
      /ioctl/i.test(error?.message || '')
    ) {
      return
    }
    sendToOwner(ownerId, 'serial:status', {
      sessionId,
      type: 'error',
      message: error.message
    })
  })

  serialPort.on('close', (error) => {
    const session = sessions.get(sessionId)
    if (!session || session.port !== serialPort) return
    sessions.delete(sessionId)
    releaseSerialPath(options.path, pathOwner)
    sendToOwner(ownerId, 'serial:status', {
      sessionId,
      type: 'closed',
      message: error && error.disconnected ? '串口设备已断开' : '串口已关闭'
    })
  })

  try {
    await new Promise((resolve, reject) => {
      serialPort.open((error) => (error ? reject(error) : resolve()))
    })

    await new Promise((resolve) => setTimeout(resolve, 120))
    if (!serialPort.isOpen) {
      sessions.delete(sessionId)
      releaseSerialPath(options.path, pathOwner)
      return { ok: false, error: '串口打开后立即断开', code: 'EIO' }
    }

    if (options.rts !== undefined || options.dtr !== undefined) {
      serialPort.set({ rts: Boolean(options.rts), dtr: Boolean(options.dtr) }, () => {})
    }

    return { ok: true }
  } catch (error) {
    const session = sessions.get(sessionId)
    if (session && session.port === serialPort) {
      sessions.delete(sessionId)
    }
    releaseSerialPath(options.path, pathOwner)
    return {
      ok: false,
      error: error.message || String(error),
      code: error.code || ''
    }
  }
})

ipcMain.handle('serial:close', async (_event, { sessionId } = {}) => {
  if (sessionId) await closeSession(sessionId)
  return { ok: true }
})

ipcMain.handle('serial:write', async (_event, payload = {}) => {
  const session = sessions.get(payload.sessionId)
  const activePort = session && session.port
  if (!activePort || !activePort.isOpen) {
    return { ok: false, error: '串口未打开' }
  }

  let buffer
  if (payload.bytes) {
    buffer = Buffer.from(payload.bytes)
  } else {
    const name = ICONV_MAP[payload.encoding] || 'utf8'
    buffer = iconv.encode(String(payload.text ?? ''), name)
  }

  try {
    await new Promise((resolve, reject) => {
      activePort.write(buffer, (writeError) => {
        if (writeError) {
          reject(writeError)
          return
        }
        activePort.drain((drainError) =>
          drainError ? reject(drainError) : resolve()
        )
      })
    })
    return { ok: true, length: buffer.length }
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
})

ipcMain.handle('serial:set-signals', async (_event, signals = {}) => {
  const session = sessions.get(signals.sessionId)
  const activePort = session && session.port
  if (!activePort || !activePort.isOpen) {
    return { ok: false, error: '串口未打开' }
  }
  try {
    await new Promise((resolve, reject) => {
      activePort.set(
        {
          rts: Boolean(signals.rts),
          dtr: Boolean(signals.dtr)
        },
        (error) => (error ? reject(error) : resolve())
      )
    })
    return { ok: true }
  } catch (error) {
    // 伪设备（PTY）不支持 RTS/DTR，忽略这种非致命错误
    if (error?.code === 'EINVAL' || /ioctl/i.test(error?.message || '')) {
      return { ok: true }
    }
    return { ok: false, error: error.message || String(error) }
  }
})


// ---------- 终端历史导入 ----------

// 读取本机 shell 历史文件尾部，取最近 200KB 足够覆盖几百条命令。
async function readLocalShellHistory () {
  const home = os.homedir()
  const files = [
    path.join(home, '.zsh_history'),
    path.join(home, '.bash_history'),
    path.join(home, '.local', 'share', 'fish', 'fish_history')
  ]
  const chunks = []
  for (const file of files) {
    try {
      const stat = await fs.stat(file)
      if (!stat.isFile() || !stat.size) continue
      const size = Math.min(stat.size, 200 * 1024)
      const handle = await fs.open(file, 'r')
      try {
        const buffer = Buffer.alloc(size)
        await handle.read(buffer, 0, size, stat.size - size)
        chunks.push(buffer.toString('utf8'))
      } finally {
        await handle.close()
      }
    } catch {
      // 文件不存在或不可读时跳过
    }
  }
  return chunks.join('\n')
}

// 通过独立 channel 读取远端历史，不打扰正在交互的 shell。
function readRemoteShellHistory (client) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const timer = setTimeout(() => finish(''), 6000)
    const command = [
      'tail -c 200000 ~/.zsh_history 2>/dev/null',
      'tail -c 200000 ~/.bash_history 2>/dev/null',
      'tail -c 100000 ~/.local/share/fish/fish_history 2>/dev/null'
    ].join('; ')
    try {
      client.exec(command, (error, stream) => {
        if (error || !stream) {
          clearTimeout(timer)
          finish('')
          return
        }
        let data = ''
        stream.on('data', (chunk) => {
          data += chunk.toString('utf8')
          if (data.length > 400000) data = data.slice(-400000)
        })
        stream.stderr.on('data', () => {})
        stream.on('close', () => {
          clearTimeout(timer)
          finish(data)
        })
      })
    } catch {
      clearTimeout(timer)
      finish('')
    }
  })
}

// zsh 的 ": 1699999999:0;cmd"、fish 的 "- cmd: cmd"、bash 的 "#1699999999" 都要还原。
function parseShellHistory (text, limit = 400) {
  if (!text) return []
  const lines = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/^: \d+:\d+;/, '')
    if (line.startsWith('- cmd: ')) line = line.slice('- cmd: '.length)
    line = line.trim()
    if (!line || line.startsWith('#')) continue
    if (line.length > 500) continue
    lines.push(line)
  }
  const seen = new Set()
  const unique = []
  // 历史文件是旧→新，倒着去重得到"最近使用在前"
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (seen.has(line)) continue
    seen.add(line)
    unique.push(line)
    if (unique.length >= limit) break
  }
  return unique
}

ipcMain.handle('terminal:history', async (event, payload = {}) => {
  const session = terminals.get(payload.terminalId)
  if (!session || session.ownerId !== event.sender.id) {
    return { ok: false, commands: [] }
  }
  try {
    const text =
      session.kind === 'ssh' && session.client
        ? await readRemoteShellHistory(session.client)
        : await readLocalShellHistory()
    return { ok: true, commands: parseShellHistory(text) }
  } catch (error) {
    return { ok: false, commands: [], error: error.message || String(error) }
  }
})

ipcMain.handle('terminal:shells', () => {
  const { options, defaultId } = localShellOptions()
  return {
    ok: true,
    platform: process.platform,
    shells: options.map(({ id, label, path: shellPath }) => ({
      id,
      label,
      path: shellPath
    })),
    defaultId,
    available: Boolean(loadNodePty()),
    error: ptyLoadError
      ? ptyLoadError.message || String(ptyLoadError)
      : undefined
  }
})

// ---------- 终端系统指标（CPU / 内存 / 磁盘 / 网络） ----------
// 本机用 systeminformation + 各平台网络计数；SSH 通过独立 exec 通道在远端采样。

let systemInfoModule
function loadSystemInformation() {
  if (systemInfoModule !== undefined) return systemInfoModule
  try {
    systemInfoModule = require('systeminformation')
  } catch (error) {
    systemInfoModule = null
    console.warn('[stats] systeminformation unavailable:', error.message)
  }
  return systemInfoModule
}

let localStatsCache = null
let localNetPrev = { at: 0, rx: 0, tx: 0 }

function percentOf(used, total) {
  const t = Number(total) || 0
  if (t <= 0) return 0
  return Math.max(0, Math.min(100, (Number(used) / t) * 100))
}

function round1(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0
}

async function readLocalNetCounters() {
  try {
    if (process.platform === 'win32') {
      const script = [
        "$ErrorActionPreference='SilentlyContinue'",
        '$rx=(Get-NetAdapterStatistics | Measure-Object ReceivedBytes -Sum).Sum',
        '$tx=(Get-NetAdapterStatistics | Measure-Object SentBytes -Sum).Sum',
        'Write-Output "$rx|$tx"'
      ].join('; ')
      const { error, stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        script
      ])
      if (error) return { rate: true, rx: 0, tx: 0 }
      const [rx, tx] = String(stdout).trim().split('|').map(Number)
      return { rate: true, rx: rx || 0, tx: tx || 0 }
    }

    let rx = 0
    let tx = 0
    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('/usr/sbin/netstat', ['-ibn'])
      const seen = new Set()
      String(stdout)
        .split(/\r?\n/)
        .forEach((line) => {
          const parts = line.trim().split(/\s+/)
          if (parts.length < 11) return
          const iface = parts[0]
          if (/^lo/.test(iface) || seen.has(iface)) return
          if (!/^\d+$/.test(parts[6]) || !/^\d+$/.test(parts[9])) return
          seen.add(iface)
          rx += Number(parts[6])
          tx += Number(parts[9])
        })
    } else {
      const raw = await fs.readFile('/proc/net/dev', 'utf8')
      raw.split(/\r?\n/).forEach((line) => {
        const [name, rest] = line.split(':')
        if (!rest) return
        const iface = name.trim()
        if (/^lo/.test(iface)) return
        const fields = rest.trim().split(/\s+/)
        const r = Number(fields[0])
        const t = Number(fields[8])
        if (Number.isFinite(r)) rx += r
        if (Number.isFinite(t)) tx += t
      })
    }
    return { rate: false, rx, tx }
  } catch {
    return { rate: true, rx: 0, tx: 0 }
  }
}

async function getLocalNetRate() {
  const now = Date.now()
  const sample = await readLocalNetCounters()
  if (sample.rate) return { rx: sample.rx, tx: sample.tx }
  const dt = (now - localNetPrev.at) / 1000
  let rx = 0
  let tx = 0
  if (localNetPrev.at && dt > 0.2) {
    rx = Math.max(0, (sample.rx - localNetPrev.rx) / dt)
    tx = Math.max(0, (sample.tx - localNetPrev.tx) / dt)
  }
  localNetPrev = { at: now, rx: sample.rx, tx: sample.tx }
  return { rx, tx }
}

function pickLocalDisk(list) {
  if (!Array.isArray(list) || !list.length) return null
  const preferred =
    process.platform === 'darwin'
      ? '/System/Volumes/Data'
      : process.platform === 'win32'
        ? 'C:'
        : '/'
  return (
    list.find((disk) => disk.mount === preferred) ||
    list.find((disk) => String(disk.mount || '').startsWith(preferred)) ||
    list.find((disk) => disk.mount === '/') ||
    list[0]
  )
}

// 磁盘口径：
// - macOS 用 APFS 容器统计（Finder / 关于本机 / diskutil 的口径），并按十进制 GB 显示
// - Linux 用 df 口径（used / (used + available)，含 root 保留块差异），按二进制 GiB 显示
// - Windows 用资源管理器口径（已用 / 总容量），按十进制 GB 显示
let localDiskCache = null

async function readLocalDisk(fallbackDisk) {
  if (process.platform === 'darwin') {
    const now = Date.now()
    if (localDiskCache && now - localDiskCache.at < 5000) {
      return localDiskCache.data
    }
    // Electron 内置 Node 18.14 还没有 fs.statfsSync，改用 diskutil 的 APFS 容器信息
    const { error, stdout } = await execFileAsync('diskutil', ['info', '-plist', '/'])
    if (!error) {
      const total = Number(
        /<key>APFSContainerSize<\/key>\s*<integer>(\d+)<\/integer>/.exec(stdout)?.[1]
      )
      const free = Number(
        /<key>APFSContainerFree<\/key>\s*<integer>(\d+)<\/integer>/.exec(stdout)?.[1]
      )
      if (total > 0 && Number.isFinite(free)) {
        const used = Math.max(0, total - free)
        const data = {
          used,
          available: free,
          total,
          percent: percentOf(used, used + free),
          base: 1000
        }
        localDiskCache = { at: now, data }
        return data
      }
    }
  }
  const disk = fallbackDisk
  const total = Number(disk?.size) || 0
  const used = Number(disk?.used) || 0
  const available = Number.isFinite(disk?.available)
    ? Number(disk.available)
    : Math.max(0, total - used)
  const isWindows = process.platform === 'win32'
  return {
    used,
    available,
    total,
    percent: isWindows
      ? percentOf(used, total)
      : Number.isFinite(disk?.use)
        ? round1(disk.use)
        : percentOf(used, used + available),
    base: isWindows ? 1000 : 1024
  }
}

async function getLocalSystemStats() {
  const now = Date.now()
  if (localStatsCache && now - localStatsCache.at < 1500) {
    return localStatsCache.data
  }
  const si = loadSystemInformation()
  if (!si) throw new Error('系统信息组件不可用')
  const [load, mem, diskList, net] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    getLocalNetRate()
  ])
  const disk = pickLocalDisk(diskList)
  const memTotal = Number(mem.total) || 0
  const memAvailable = Number.isFinite(mem.available) ? mem.available : mem.free
  const memUsed = Math.max(0, memTotal - (Number(memAvailable) || 0))
  const data = {
    cpu: round1(load.currentLoad),
    mem: {
      used: memUsed,
      total: memTotal,
      percent: percentOf(memUsed, memTotal)
    },
    disk: await readLocalDisk(disk),
    net
  }
  localStatsCache = { at: now, data }
  return data
}

function sshExec(client, command, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    let openedAt = 0
    let settled = false
    let stream = null
    let stdout = ''
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        stream?.close()
      } catch {
        // ignore
      }
      resolve({
        ...result,
        latency: openedAt ? openedAt - startedAt : 0
      })
    }
    const timer = setTimeout(
      () => finish({ ok: false, error: 'timeout', stdout }),
      timeoutMs
    )
    try {
      client.exec(command, (error, nextStream) => {
        openedAt = Date.now()
        if (settled) return
        if (error) {
          finish({ ok: false, error: error.message, stdout })
          return
        }
        stream = nextStream
        stream.on('data', (chunk) => {
          stdout += chunk.toString('utf8')
          if (stdout.length > 64 * 1024) stdout = stdout.slice(-64 * 1024)
        })
        stream.stderr.on('data', () => {})
        stream.on('close', () => finish({ ok: true, stdout }))
      })
    } catch (error) {
      finish({ ok: false, error: error.message, stdout })
    }
  })
}

const LINUX_STATS_SCRIPT = `export LC_ALL=C
read _ u n s i w q sq st _ < /proc/stat
t1=$((u+n+s+i+w+q+sq+st)); i1=$((i+w))
n1=$(awk '{gsub(":"," "); if ($1 ~ /^(eth|en|wl|eno|ens|enp|bond|br)/) {rx+=$2; tx+=$10}} END{printf "%d %d", rx, tx}' /proc/net/dev)
sleep 0.25
read _ u n s i w q sq st _ < /proc/stat
t2=$((u+n+s+i+w+q+sq+st)); i2=$((i+w))
n2=$(awk '{gsub(":"," "); if ($1 ~ /^(eth|en|wl|eno|ens|enp|bond|br)/) {rx+=$2; tx+=$10}} END{printf "%d %d", rx, tx}' /proc/net/dev)
set -- $n1; r1=$1; x1=$2
set -- $n2; r2=$1; x2=$2
cpu=$(awk -v t1=$t1 -v i1=$i1 -v t2=$t2 -v i2=$i2 'BEGIN{d=t2-t1; if (d<=0) {print 0; exit} printf "%.1f", 100*(d-(i2-i1))/d}')
mem=$(awk '/^MemTotal:/{t=$2}/^MemAvailable:/{a=$2}END{printf "%d %d", t*1024, (t-a)*1024}' /proc/meminfo)
disk=$(df -kP / | awk 'NR==2{p=$5; gsub("%","",p); printf "%d %d %d %s", $2*1024, $3*1024, $4*1024, p}')
rx=$(( (r2-r1)*4 )); tx=$(( (x2-x1)*4 ))
[ "$rx" -lt 0 ] && rx=0
[ "$tx" -lt 0 ] && tx=0
echo "$cpu|$mem|$disk|$rx|$tx"`

const DARWIN_STATS_SCRIPT = `export LC_ALL=C
cpu=$(top -l 1 -n 0 | awk '/CPU usage/ {gsub("%",""); print 100-$7; exit}')
mem=$(vm_stat | awk -v ps=$(sysctl -n hw.pagesize) -v total=$(sysctl -n hw.memsize) '
  /Pages active/ {a=$NF}
  /Pages wired down/ {w=$NF}
  /Pages occupied by compressor/ {c=$NF}
  END {gsub(/[^0-9]/,"",a); gsub(/[^0-9]/,"",w); gsub(/[^0-9]/,"",c); printf "%d %d", total, (a+w+c)*ps}')
info=$(diskutil info -plist / 2>/dev/null)
t=$(printf '%s\n' "$info" | awk '/<key>APFSContainerSize<\/key>/{getline; gsub(/[^0-9]/,""); print; exit}')
f=$(printf '%s\n' "$info" | awk '/<key>APFSContainerFree<\/key>/{getline; gsub(/[^0-9]/,""); print; exit}')
disk=''
[ -n "$t" ] && [ -n "$f" ] && disk=$(awk -v t="$t" -v f="$f" 'BEGIN{printf "%d %d %d %.0f", t, t-f, f, (t-f)/t*100}')
[ -z "$disk" ] && disk=$(df -kP /System/Volumes/Data 2>/dev/null | awk 'NR==2{p=$5; gsub("%","",p); printf "%d %d %d %s", $2*1024, $3*1024, $4*1024, p}')
[ -z "$disk" ] && disk=$(df -kP / | awk 'NR==2{p=$5; gsub("%","",p); printf "%d %d %d %s", $2*1024, $3*1024, $4*1024, p}')
n1=$(netstat -ibn | awk '!seen[$1]++ && $1 !~ /^lo/ && $7 ~ /^[0-9]+$/ {rx+=$7; tx+=$10} END{printf "%d %d", rx, tx}')
sleep 0.25
n2=$(netstat -ibn | awk '!seen[$1]++ && $1 !~ /^lo/ && $7 ~ /^[0-9]+$/ {rx+=$7; tx+=$10} END{printf "%d %d", rx, tx}')
set -- $n1; r1=$1; x1=$2
set -- $n2; r2=$1; x2=$2
rx=$(( (r2-r1)*4 )); tx=$(( (x2-x1)*4 ))
[ "$rx" -lt 0 ] && rx=0
[ "$tx" -lt 0 ] && tx=0
echo "$cpu|$mem|$disk|$rx|$tx"`

const WINDOWS_STATS_SCRIPT = `$ErrorActionPreference = 'SilentlyContinue'
$cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
$os = Get-CimInstance Win32_OperatingSystem
$mt = [int64]$os.TotalVisibleMemorySize * 1024
$mu = $mt - ([int64]$os.FreePhysicalMemory * 1024)
$d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
if (-not $d) { $d = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 } | Select-Object -First 1 }
$dt = [int64]$d.Size
$du = $dt - [int64]$d.FreeSpace
$rx = (Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface | Measure-Object BytesReceivedPersec -Sum).Sum
$tx = (Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface | Measure-Object BytesSentPersec -Sum).Sum
Write-Output "$cpu|$mt|$mu|$dt|$du|$rx|$tx"`

function parseRemoteStats(stdout, osType) {
  const diskBase = osType === 'linux' ? 1024 : 1000
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parts = lines[i].split('|').map((part) => part.trim())
    let cpu
    let memTotal
    let memUsed
    let diskTotal
    let diskUsed
    let diskAvailable
    let diskPercent
    let rx
    let tx
    if (parts.length === 5) {
      // POSIX 脚本：cpu|memTotal memUsed|diskTotal diskUsed diskAvailable dfUse%|rx|tx
      const mem = parts[1].split(/\s+/).map((part) => Number(part))
      const disk = parts[2].split(/\s+/)
      if (mem.length !== 2 || disk.length !== 4) continue
      cpu = Number(parts[0])
      ;[memTotal, memUsed] = mem
      diskTotal = Number(disk[0])
      diskUsed = Number(disk[1])
      diskAvailable = Number(disk[2])
      // 直接使用 df 的 Use%，与终端里 `df -h` 显示一致
      diskPercent = Number(disk[3])
      rx = Number(parts[3])
      tx = Number(parts[4])
    } else if (parts.length === 7) {
      // Windows PowerShell：cpu|memTotal|memUsed|diskTotal|diskUsed|rx|tx
      const values = parts.map((part) => Number(part))
      if (values.some((value) => !Number.isFinite(value))) continue
      ;[cpu, memTotal, memUsed, diskTotal, diskUsed, rx, tx] = values
      diskAvailable = Math.max(0, diskTotal - diskUsed)
      diskPercent = percentOf(diskUsed, diskTotal)
    } else {
      continue
    }
    const numbers = [
      cpu,
      memTotal,
      memUsed,
      diskTotal,
      diskUsed,
      diskAvailable,
      rx,
      tx
    ]
    if (numbers.some((value) => !Number.isFinite(value))) continue
    return {
      cpu: round1(cpu),
      mem: {
        used: memUsed,
        total: memTotal,
        percent: percentOf(memUsed, memTotal)
      },
      disk: {
        used: diskUsed,
        available: diskAvailable,
        total: diskTotal,
        base: diskBase,
        percent: Number.isFinite(diskPercent)
          ? diskPercent
          : percentOf(diskUsed, diskUsed + diskAvailable)
      },
      net: { rx: Math.max(0, rx), tx: Math.max(0, tx) }
    }
  }
  return null
}

async function detectRemoteOs(term) {
  if (term.statsOs) return term.statsOs
  const uname = await sshExec(term.client, 'uname -s', 4000)
  const text = String(uname.stdout || '').trim()
  if (/Darwin/i.test(text)) return (term.statsOs = 'darwin')
  if (/Linux/i.test(text)) return (term.statsOs = 'linux')
  if (/MINGW|MSYS|CYGWIN/i.test(text)) return (term.statsOs = 'windows')
  const ps = await sshExec(
    term.client,
    'powershell -NoProfile -Command "$PSVersionTable.PSEdition"',
    5000
  )
  if (ps.ok && /Core|Desktop/i.test(ps.stdout)) return (term.statsOs = 'windows')
  return (term.statsOs = 'unknown')
}

async function getSshSystemStats(term) {
  if (!term.client || term.pending) throw new Error('SSH 尚未就绪')
  const now = Date.now()
  if (term.statsCache && now - term.statsCache.at < 2000) {
    return term.statsCache.data
  }
  if (term.statsPending) return term.statsPending
  term.statsPending = (async () => {
    const osType = await detectRemoteOs(term)
    if (osType === 'unknown') throw new Error('无法识别远端系统')
    let command
    if (osType === 'windows') {
      const encoded = Buffer.from(WINDOWS_STATS_SCRIPT, 'utf16le').toString('base64')
      command = `powershell -NoProfile -EncodedCommand ${encoded}`
    } else {
      const script = osType === 'darwin' ? DARWIN_STATS_SCRIPT : LINUX_STATS_SCRIPT
      const encoded = Buffer.from(script, 'utf8').toString('base64')
      command = `echo ${encoded} | base64 --decode | sh`
    }
    const result = await sshExec(term.client, command, 10000)
    if (!result.ok) throw new Error(result.error || '远端采样失败')
    const data = parseRemoteStats(result.stdout, osType)
    if (!data) throw new Error('远端系统信息格式不支持')
    data.latency = result.latency || 0
    term.statsCache = { at: Date.now(), data }
    return data
  })().finally(() => {
    term.statsPending = null
  })
  return term.statsPending
}

ipcMain.handle('terminal:stats', async (_event, payload = {}) => {
  const term = terminals.get(payload.terminalId)
  if (!term) return { ok: false, error: '终端未运行' }
  try {
    if (term.kind === 'local') {
      return { ok: true, local: true, ...(await getLocalSystemStats()) }
    }
    if (term.kind === 'ssh') {
      const data = await getSshSystemStats(term)
      return { ok: true, local: false, ...data }
    }
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
  return { ok: false, error: '不支持的终端' }
})

ipcMain.handle('terminal:create', async (event, options = {}) => {
  const terminalId = options.terminalId
  if (!terminalId) return { ok: false, error: '缺少终端标识' }

  if (options.transport === 'ssh') {
    return createSshTerminal(event, terminalId, options)
  }

  const nodePty = loadNodePty()
  if (!nodePty) {
    return {
      ok: false,
      error: ptyLoadError
        ? `终端组件加载失败：${ptyLoadError.message || ptyLoadError}`
        : '终端组件不可用'
    }
  }

  closeTerminal(terminalId)

  const shell = getLocalShell(options.shellId)
  if (!shell) return { ok: false, error: '未找到可用的本地 Shell' }

  const cols = clampTerminalDimension(options.cols, 80, 500)
  const rows = clampTerminalDimension(options.rows, 24, 200)
  const cwd = options.cwd || app.getPath('home')
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE'
    )
  )

  let terminal
  try {
    terminal = nodePty.spawn(shell.path, shell.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...environment,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        CLICOLOR: '1',
        CLICOLOR_FORCE: '1',
        FORCE_COLOR: '1',
        TERM_PROGRAM: 'Weft',
        TERM_PROGRAM_VERSION: app.getVersion()
      }
    })
  } catch (error) {
    return {
      ok: false,
      error: error.message || String(error)
    }
  }

  const ownerId = event.sender.id
  terminals.set(terminalId, { kind: 'local', terminal, ownerId, shell })

  terminal.onData((data) => {
    const current = terminals.get(terminalId)
    if (!current || current.terminal !== terminal) return
    sendToOwner(ownerId, 'terminal:data', { terminalId, data })
  })

  terminal.onExit((exitEvent) => {
    const current = terminals.get(terminalId)
    if (!current || current.terminal !== terminal) return
    terminals.delete(terminalId)
    const exitCode =
      typeof exitEvent === 'number' ? exitEvent : exitEvent?.exitCode
    const signal = exitEvent && typeof exitEvent === 'object' ? exitEvent.signal : 0
    sendToOwner(ownerId, 'terminal:exit', {
      terminalId,
      exitCode,
      signal
    })
  })

  return {
    ok: true,
    shell: {
      id: shell.id,
      label: shell.label,
      path: shell.path
    },
    pid: terminal.pid,
    cwd,
    cols,
    rows
  }
})

ipcMain.on('terminal:input', (event, payload = {}) => {
  const session = terminals.get(payload.terminalId)
  if (!session || session.ownerId !== event.sender.id) return
  try {
    if (session.kind === 'ssh') {
      session.stream.write(String(payload.data ?? ''))
    } else {
      session.terminal.write(String(payload.data ?? ''))
    }
  } catch {
    // 终端退出后忽略输入
  }
})

ipcMain.on('terminal:resize', (event, payload = {}) => {
  const session = terminals.get(payload.terminalId)
  if (!session || session.ownerId !== event.sender.id) return
  const cols = clampTerminalDimension(payload.cols, 80, 500)
  const rows = clampTerminalDimension(payload.rows, 24, 200)
  try {
    if (session.kind === 'ssh') {
      if (session.stream) {
        session.stream.setWindow(rows, cols, 0, 0)
      } else {
        // 握手阶段收到的尺寸变化先暂存，Shell 创建后立即应用。
        session.pendingWindow = { cols, rows }
      }
    } else {
      session.terminal.resize(cols, rows)
    }
  } catch {
    // 终端退出后忽略尺寸变化
  }
})

ipcMain.handle('terminal:close', async (event, payload = {}) => {
  const session = terminals.get(payload.terminalId)
  if (session && session.ownerId === event.sender.id) {
    closeTerminal(payload.terminalId)
  }
  return { ok: true }
})

ipcMain.on('terminal:host-key-response', (event, payload = {}) => {
  const session = terminals.get(payload.terminalId)
  if (!session || session.ownerId !== event.sender.id) return
  const hostKeyWaiter = hostKeyWaiters.get(payload.terminalId)
  if (!hostKeyWaiter) return
  hostKeyWaiters.delete(payload.terminalId)
  hostKeyWaiter(Boolean(payload.accept))
})

ipcMain.handle('ssh:sftp-home', async (event, payload = {}) => {
  try {
    const sftp = await getSftpSession(event, payload.terminalId)
    const home = await sftpCall(sftp, 'realpath', '.')
    return { ok: true, path: home }
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
})

ipcMain.handle('ssh:sftp-list', async (event, payload = {}) => {
  try {
    const sftp = await getSftpSession(event, payload.terminalId)
    const target = String(payload.path || '').trim() || '.'
    const result = await listRemoteDirectory(sftp, target)
    return { ok: true, ...result }
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
})

ipcMain.handle('ssh:sftp-download', async (event, payload = {}) => {
  try {
    const sftp = await getSftpSession(event, payload.terminalId)
    const remotePath = String(payload.path || '')
    if (!remotePath) return { ok: false, error: '缺少远程文件路径' }
    const stats = await sftpCall(sftp, 'stat', remotePath)
    if (stats.isDirectory?.()) {
      return { ok: false, error: '暂不支持下载整个文件夹' }
    }
    const saveResult = await showSaveDialog({
      title: '下载远程文件',
      defaultPath: path.join(
        app.getPath('downloads'),
        remoteBaseName(remotePath) || 'remote-file'
      )
    })
    if (saveResult.canceled || !saveResult.filePath) {
      return { ok: false, canceled: true }
    }
    await sftpCall(sftp, 'fastGet', remotePath, saveResult.filePath)
    return { ok: true, filePath: saveResult.filePath }
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
})

ipcMain.handle('ssh:sftp-upload', async (event, payload = {}) => {
  try {
    const sftp = await getSftpSession(event, payload.terminalId)
    const remoteDir = String(payload.remoteDir || '.').trim() || '.'
    const openResult = await showOpenDialog({
      title: '上传文件到远程目录',
      properties: ['openFile', 'multiSelections']
    })
    if (openResult.canceled || !openResult.filePaths?.length) {
      return { ok: false, canceled: true }
    }
    const uploaded = []
    for (const localPath of openResult.filePaths) {
      const fileName = path.basename(localPath)
      await sftpCall(
        sftp,
        'fastPut',
        localPath,
        joinRemotePath(remoteDir, fileName)
      )
      uploaded.push(fileName)
    }
    return { ok: true, uploaded }
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
})

ipcMain.handle('ssh:sftp-mkdir', async (event, payload = {}) => {
  try {
    const sftp = await getSftpSession(event, payload.terminalId)
    const target = String(payload.path || '')
    if (!target) return { ok: false, error: '缺少目录路径' }
    await sftpCall(sftp, 'mkdir', target)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
})

ipcMain.handle('ssh:sftp-delete', async (event, payload = {}) => {
  try {
    const sftp = await getSftpSession(event, payload.terminalId)
    const target = String(payload.path || '')
    if (!target) return { ok: false, error: '缺少删除路径' }
    await removeRemoteEntry(
      sftp,
      target,
      payload.type === 'dir' ? 'dir' : 'file',
      Boolean(payload.isLink)
    )
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
})

ipcMain.handle('app:choose-private-key', async () => {
  const result = await showOpenDialog({
    title: '选择 SSH 私钥',
    properties: ['openFile'],
    filters: [
      { name: '私钥文件', extensions: ['pem', 'key', 'ppk'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true }
  }
  return { ok: true, path: result.filePaths[0] }
})

ipcMain.handle('app:new-window', () => {
  createWindow(uniqueWindowId())
  return { ok: true }
})

ipcMain.handle('app:window-count', () => windows.size)
ipcMain.handle('app:window-info', () => getWindowInfo())
ipcMain.handle('app:focus-window', (_event, windowId) => {
  const target = findWindowById(windowId)
  if (!target) return { ok: false }
  if (target.isMinimized()) target.restore()
  target.show()
  target.focus()
  return { ok: true }
})
ipcMain.handle('app:focus-tab', (_event, payload = {}) => {
  const target = findWindowById(payload.windowId)
  if (!target) return { ok: false }
  if (target.isMinimized()) target.restore()
  target.show()
  target.focus()
  target.webContents.send('app:focus-tab', payload.tabId)
  return { ok: true }
})

// ---------- GitHub 在线升级 ----------

const UPDATE_OWNER = '910106845'
const UPDATE_REPO = 'Weft-Terminal'
const UPDATE_API_URL = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`
const UPDATE_MANIFEST_URL = String(
  process.env.WEFT_UPDATE_MANIFEST ||
    'https://shenzhen-img.oss-cn-shenzhen.aliyuncs.com/zhangfan/Weft-Terminal/latest.json'
).trim()
const UPDATE_CACHE_MS = 10 * 60 * 1000
const UPDATE_MANIFEST_TIMEOUT_MS = 6000
const UPDATE_TRUSTED_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'shenzhen-img.oss-cn-shenzhen.aliyuncs.com'
])
try {
  const manifestHost = new URL(UPDATE_MANIFEST_URL).hostname.toLowerCase()
  if (manifestHost) UPDATE_TRUSTED_HOSTS.add(manifestHost)
} catch {
  // 更新清单地址不可解析时由检查逻辑报错
}
const UPDATE_TOKEN = String(
  process.env.WEFT_UPDATE_TOKEN || process.env.GITHUB_TOKEN || ''
).trim()
let updateReleaseCache = { at: 0, payload: null }
let updateDownloadRequest = null
let updateDownloadWriter = null
let updateDownloadCanceled = false
let lastUpdateFilePath = ''

function parseUpdateVersion(value) {
  const match = String(value || '')
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  return match
    ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)]
    : [0, 0, 0]
}

function compareUpdateVersions(a, b) {
  const left = parseUpdateVersion(a)
  const right = parseUpdateVersion(b)
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  }
  return 0
}

function pickUpdateAsset(assets) {
  if (!Array.isArray(assets) || !assets.length) return null
  const platform = process.platform
  const arch = process.arch
  let candidates = []
  if (platform === 'darwin') {
    candidates = assets.filter((item) => /\.dmg$/i.test(item?.name || ''))
    if (!candidates.length) {
      candidates = assets.filter((item) => /\.zip$/i.test(item?.name || ''))
    }
  } else if (platform === 'win32') {
    candidates = assets.filter((item) => /\.exe$/i.test(item?.name || ''))
    if (!candidates.length) {
      candidates = assets.filter((item) => /\.msi$/i.test(item?.name || ''))
    }
  } else {
    candidates = assets.filter((item) => /\.appimage$/i.test(item?.name || ''))
  }
  candidates = candidates.filter((item) => item?.browser_download_url)
  if (!candidates.length) return null
  const archPattern =
    arch === 'arm64' ? /(arm64|aarch64)/i : /(x64|x86_64|amd64)/i
  return (
    candidates.find((item) => archPattern.test(item.name || '')) ||
    candidates.find((item) => /universal/i.test(item.name || '')) ||
    candidates[0]
  )
}

function requestUpdateJson(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: 'GET', redirect: 'follow' })
    request.setHeader('Accept', 'application/vnd.github+json')
    request.setHeader('User-Agent', `Weft-Terminal/${app.getVersion()}`)
    if (UPDATE_TOKEN && isGithubHost) {
      request.setHeader('Authorization', `Bearer ${UPDATE_TOKEN}`)
    }
    request.on('response', (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        resolve({
          status: response.statusCode,
          text: Buffer.concat(chunks).toString('utf8')
        })
      })
      response.on('error', reject)
    })
    request.on('error', reject)
    request.end()
  })
}

function requestPublicJson(url, timeoutMs = UPDATE_MANIFEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false
    // 清单必须实时获取，不能使用 Electron 的 HTTP 缓存
    const bustUrl = `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`
    const request = net.request({ url: bustUrl, method: 'GET', redirect: 'follow' })
    request.setHeader('Accept', 'application/json')
    request.setHeader('Cache-Control', 'no-cache, no-store, max-age=0')
    request.setHeader('Pragma', 'no-cache')
    request.setHeader('User-Agent', `Weft-Terminal/${app.getVersion()}`)
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        request.abort()
      } catch {
        // 忽略
      }
      reject(new Error('请求超时'))
    }, timeoutMs)
    const done = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    request.on('response', (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () =>
        done(resolve, {
          status: response.statusCode,
          text: Buffer.concat(chunks).toString('utf8')
        })
      )
      response.on('error', (error) => done(reject, error))
    })
    request.on('error', (error) => done(reject, error))
    request.end()
  })
}

function pickManifestAsset(manifest) {
  const platform =
    process.platform === 'win32'
      ? 'win32'
      : process.platform === 'linux'
        ? 'linux'
        : 'darwin'
  const entry = manifest?.assets?.[platform]
  if (!entry?.url) return null
  let name = String(entry.name || '').trim()
  if (!name) {
    try {
      name = path.basename(new URL(entry.url).pathname) || 'weft-terminal-update'
    } catch {
      name = 'weft-terminal-update'
    }
  }
  return {
    name,
    url: entry.url,
    size: Number(entry.size) || 0,
    sha256: String(entry.sha256 || '').trim().toLowerCase(),
    contentType: entry.contentType || ''
  }
}

async function fetchOssManifest() {
  const currentVersion = app.getVersion()
  let response
  try {
    response = await requestPublicJson(UPDATE_MANIFEST_URL)
  } catch (error) {
    return {
      ok: false,
      error: `国内更新源不可用：${error?.message || String(error)}`
    }
  }
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, error: `国内更新源返回 ${response.status}` }
  }
  let manifest
  try {
    manifest = JSON.parse(response.text)
  } catch {
    return { ok: false, error: '国内更新清单无法解析' }
  }
  const latestVersion = String(manifest.version || '')
    .trim()
    .replace(/^v/i, '')
  if (!latestVersion) {
    return { ok: false, error: '国内更新清单缺少版本号' }
  }
  const available =
    compareUpdateVersions(latestVersion, currentVersion) > 0
  return {
    ok: true,
    available,
    currentVersion,
    latestVersion,
    tag: `v${latestVersion}`,
    releaseName: manifest.title || `Weft Terminal ${latestVersion}`,
    notes: manifest.notes || '',
    publishedAt: manifest.publishedAt || '',
    releaseUrl:
      manifest.releaseUrl ||
      `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases`,
    asset: available ? pickManifestAsset(manifest) : null,
    checkedAt: Date.now(),
    source: 'oss'
  }
}

async function fetchGithubLatestRelease() {
  const currentVersion = app.getVersion()
  let response
  try {
    response = await requestUpdateJson(UPDATE_API_URL)
  } catch (error) {
    return {
      ok: false,
      error: `无法连接 GitHub：${error?.message || String(error)}`
    }
  }

  const releasesUrl = `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases`
  if (response.status === 404) {
    const payload = {
      ok: true,
      available: false,
      currentVersion,
      latestVersion: null,
      tag: '',
      releaseName: '暂无发布版本',
      notes: '',
      publishedAt: '',
      releaseUrl: releasesUrl,
      asset: null,
      checkedAt: Date.now(),
      source: 'github'
    }
    return payload
  }

  if (response.status < 200 || response.status >= 300) {
    return {
      ok: false,
      error: `GitHub 接口返回 ${response.status}${
        response.text ? `：${response.text.slice(0, 200)}` : ''
      }`
    }
  }

  let release
  try {
    release = JSON.parse(response.text)
  } catch {
    return { ok: false, error: 'GitHub 返回的数据无法解析' }
  }

  const tag = String(release.tag_name || release.name || '').trim()
  const latestVersion = tag.replace(/^v/i, '')
  const available = Boolean(
    latestVersion && compareUpdateVersions(latestVersion, currentVersion) > 0
  )
  const asset = pickUpdateAsset(release.assets)

  const payload = {
    ok: true,
    available,
    currentVersion,
    latestVersion,
    tag,
    releaseName: release.name || tag,
    notes: release.body || '',
    publishedAt: release.published_at || '',
    releaseUrl: release.html_url || releasesUrl,
    asset: asset
      ? {
          name: asset.name,
          url: asset.browser_download_url,
          apiUrl: asset.url,
          id: asset.id,
          size: Number(asset.size) || 0,
          contentType: asset.content_type || ''
        }
      : null,
    checkedAt: Date.now(),
    source: 'github'
  }
  return payload
}

async function fetchLatestRelease(force = false) {
  if (
    !force &&
    updateReleaseCache.payload &&
    Date.now() - updateReleaseCache.at < UPDATE_CACHE_MS
  ) {
    return updateReleaseCache.payload
  }

  const ossPayload = await fetchOssManifest()
  if (ossPayload.ok) {
    updateReleaseCache = { at: Date.now(), payload: ossPayload }
    return ossPayload
  }

  const githubPayload = await fetchGithubLatestRelease()
  if (githubPayload.ok) {
    updateReleaseCache = { at: Date.now(), payload: githubPayload }
    return githubPayload
  }

  return {
    ok: false,
    error: `检查更新失败：${ossPayload.error}；GitHub 备用源不可用：${
      githubPayload.error || '未知错误'
    }`
  }
}

function uniqueUpdatePath(dir, fileName) {
  const safeName = String(fileName || 'weft-terminal-update').replace(
    /[\\/:*?"<>|]/g,
    '_'
  )
  const ext = path.extname(safeName)
  const base = path.basename(safeName, ext)
  let candidate = path.join(dir, safeName)
  let index = 1
  while (fsSync.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${index})${ext}`)
    index += 1
  }
  return candidate
}

async function downloadUpdateAsset(event, asset) {
  // 放在应用数据目录，避免 macOS 对 Downloads 的目录权限弹窗
  const updatesDir = path.join(app.getPath('userData'), 'updates')
  await fs.mkdir(updatesDir, { recursive: true })
  const destination = uniqueUpdatePath(updatesDir, asset.name)

  const downloadUrl = UPDATE_TOKEN && asset.apiUrl ? asset.apiUrl : asset.url
  let parsed
  try {
    parsed = new URL(downloadUrl)
  } catch {
    return { ok: false, error: '更新包地址无效' }
  }
  const downloadHost = parsed.hostname.toLowerCase()
  const isGithubHost =
    /(^|\.)github\.com$|(^|\.)githubusercontent\.com$/i.test(downloadHost)
  if (
    parsed.protocol !== 'https:' ||
    !UPDATE_TRUSTED_HOSTS.has(downloadHost)
  ) {
    return { ok: false, error: '更新包地址不受信任' }
  }

  if (updateDownloadRequest) {
    updateDownloadCanceled = true
    updateDownloadRequest.abort()
    updateDownloadRequest = null
  }
  updateDownloadCanceled = false

  let received = 0
  let total = Number(asset.size) || 0
  let lastNotified = 0
  const digest = asset.sha256 ? crypto.createHash('sha256') : null

  const notify = (extra = {}) => {
    if (event.sender.isDestroyed()) return
    event.sender.send('update:progress', {
      received,
      total,
      percent: total > 0 ? Math.min(100, (received / total) * 100) : null,
      fileName: path.basename(destination),
      ...extra
    })
  }

  return new Promise((resolve) => {
    let settled = false
    const request = net.request({
      url: downloadUrl,
      method: 'GET',
      redirect: 'follow'
    })
    updateDownloadRequest = request
    request.setHeader('User-Agent', `Weft-Terminal/${app.getVersion()}`)
    request.setHeader('Accept', 'application/octet-stream')
    if (UPDATE_TOKEN) {
      request.setHeader('Authorization', `Bearer ${UPDATE_TOKEN}`)
    }

    const finish = async (result) => {
      if (settled) return
      settled = true
      if (updateDownloadRequest === request) updateDownloadRequest = null
      updateDownloadWriter = null
      if (!result.ok) {
        try {
          await fs.unlink(destination)
        } catch {
          // 忽略删除失败
        }
      }
      resolve(result)
    }

    request.on('error', (error) => {
      finish(
        updateDownloadCanceled
          ? { ok: false, canceled: true }
          : { ok: false, error: error?.message || String(error) }
      )
    })

    request.on('response', (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume()
        finish({ ok: false, error: `下载失败（HTTP ${response.statusCode}）` })
        return
      }
      const lengthHeader = response.headers['content-length']
      total =
        Number(Array.isArray(lengthHeader) ? lengthHeader[0] : lengthHeader) ||
        total
      notify()

      const writer = fsSync.createWriteStream(destination)
      updateDownloadWriter = writer
      response.on('data', (chunk) => {
        received += chunk.length
        if (digest) digest.update(chunk)
        const now = Date.now()
        if (now - lastNotified > 120) {
          lastNotified = now
          notify()
        }
      })
      pipeline(response, writer)
        .then(() => {
          const actualSha256 = digest ? digest.digest('hex') : ''
          if (asset.sha256 && actualSha256 !== asset.sha256) {
            finish({ ok: false, error: '安装包校验失败，请重试' })
            return
          }
          notify({ done: true })
          lastUpdateFilePath = destination
          finish({
            ok: true,
            filePath: destination,
            fileName: path.basename(destination),
            size: received,
            sha256: actualSha256
          })
        })
        .catch((error) => {
          try {
            writer.destroy()
          } catch {
            // 忽略
          }
          finish(
            updateDownloadCanceled
              ? { ok: false, canceled: true }
              : { ok: false, error: error?.message || String(error) }
          )
        })
    })

    request.end()
  })
}

function runCommand(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
        return
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' })
    })
  })
}

async function installMacUpdate(dmgPath) {
  const exePath = app.getPath('exe')
  const bundlePath = path.resolve(exePath, '../../..')
  if (!bundlePath.endsWith('.app')) {
    return { ok: false, error: '当前应用不在 .app 包内，无法自动安装' }
  }
  const mountPoint = await fs.mkdtemp(path.join(os.tmpdir(), 'weft-update-'))
  const cleanup = async () => {
    try {
      await runCommand('hdiutil', ['detach', mountPoint, '-force'])
    } catch {
      // 忽略卸载失败
    }
    try {
      await fs.rm(mountPoint, { recursive: true, force: true })
    } catch {
      // 忽略清理失败
    }
  }
  try {
    await runCommand(
      'hdiutil',
      ['attach', '-nobrowse', '-noautoopen', '-mountpoint', mountPoint, dmgPath],
      { timeout: 120000 }
    )
    const entries = await fs.readdir(mountPoint)
    const appName = entries.find((name) => name.endsWith('.app'))
    if (!appName) {
      throw new Error('安装包中未找到应用程序')
    }
    const sourceApp = path.join(mountPoint, appName)
    const destinationParent = path.dirname(bundlePath)
    const tempPath = path.join(
      destinationParent,
      `.${path.basename(bundlePath)}.new`
    )
    const backupPath = path.join(
      destinationParent,
      `.${path.basename(bundlePath)}.backup`
    )
    await fs.rm(tempPath, { recursive: true, force: true })
    await fs.rm(backupPath, { recursive: true, force: true })
    await runCommand('ditto', [sourceApp, tempPath], { timeout: 180000 })
    try {
      await runCommand('xattr', [
        '-dr',
        'com.apple.quarantine',
        tempPath
      ])
    } catch {
      // 忽略扩展属性清理失败
    }

    try {
      await fs.rename(bundlePath, backupPath)
      await fs.rename(tempPath, bundlePath)
      try {
        // 升级成功后删除旧版本备份，避免 Spotlight / Finder 里出现两个应用
        await fs.rm(backupPath, { recursive: true, force: true })
      } catch {
        // 备份清理失败不影响升级
      }
    } catch {
      const quote = (value) =>
        `'${String(value).replace(/'/g, `'\\''`)}'`
      const scriptPath = path.join(
        os.tmpdir(),
        `weft-update-${Date.now()}.sh`
      )
      const script = `#!/bin/sh
set -e
rm -rf ${quote(tempPath)}
ditto ${quote(sourceApp)} ${quote(tempPath)}
xattr -dr com.apple.quarantine ${quote(tempPath)} || true
rm -rf ${quote(backupPath)}
mv ${quote(bundlePath)} ${quote(backupPath)}
mv ${quote(tempPath)} ${quote(bundlePath)}
rm -rf ${quote(backupPath)}
`
      await fs.writeFile(scriptPath, script, { mode: 0o755 })
      try {
        await runCommand(
          'osascript',
          [
            '-e',
            `do shell script "sh ${quote(scriptPath)}" with administrator privileges`
          ],
          { timeout: 0 }
        )
      } finally {
        try {
          await fs.rm(scriptPath, { force: true })
        } catch {
          // 忽略清理失败
        }
      }
    }

    await cleanup()
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 400)
    return { ok: true }
  } catch (error) {
    await cleanup()
    return { ok: false, error: error?.message || String(error) }
  }
}

async function installUpdateFile(filePath) {
  if (!app.isPackaged) {
    return { ok: false, error: '开发模式不支持自动安装，请使用安装包更新' }
  }
  if (process.platform === 'darwin') {
    if (!/\.dmg$/i.test(filePath)) {
      return { ok: false, error: '当前安装包不是 dmg 格式' }
    }
    return installMacUpdate(filePath)
  }
  if (process.platform === 'win32') {
    const isMsi = /\.msi$/i.test(filePath)
    if (isMsi) {
      const quotePs = (value) =>
        `'${String(value).replace(/'/g, "''")}'`
      const script =
        `Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i',${quotePs(
          filePath
        )},'/qn' -Wait; ` +
        `Start-Process -FilePath ${quotePs(app.getPath('exe'))}`
      spawn(
        'powershell.exe',
        ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script],
        { detached: true, stdio: 'ignore', windowsHide: true }
      ).unref()
    } else {
      // NSIS 静默升级：安装器的 customInstall 会结束旧进程并启动新版本
      spawn(filePath, ['/S', '--updated'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }).unref()
    }
    setTimeout(() => app.exit(0), 500)
    return { ok: true }
  }
  const message = await shell.openPath(filePath)
  return message ? { ok: false, error: message } : { ok: true }
}

ipcMain.handle('update:check', async (_event, { force = false } = {}) =>
  fetchLatestRelease(Boolean(force))
)

ipcMain.handle('update:download', async (event) => {
  try {
    let payload = updateReleaseCache.payload
    if (!payload?.available || !payload?.asset) {
      payload = await fetchLatestRelease(true)
    }
    if (!payload?.ok) {
      return { ok: false, error: payload?.error || '检查更新失败' }
    }
    if (!payload.available) {
      return { ok: false, error: '当前已是最新版本' }
    }
    if (!payload.asset) {
      return { ok: false, error: '当前平台暂无可下载的安装包' }
    }
    return await downloadUpdateAsset(event, payload.asset)
  } catch (error) {
    return { ok: false, error: error?.message || String(error) }
  }
})

ipcMain.handle('update:install', async () => {
  if (!lastUpdateFilePath || !fsSync.existsSync(lastUpdateFilePath)) {
    return { ok: false, error: '安装包不存在，请重新下载' }
  }
  try {
    return await installUpdateFile(lastUpdateFilePath)
  } catch (error) {
    return { ok: false, error: error?.message || String(error) }
  }
})

ipcMain.handle('update:cancel', () => {
  updateDownloadCanceled = true
  updateDownloadRequest?.abort()
  updateDownloadWriter?.destroy(new Error('canceled'))
  return { ok: true }
})

ipcMain.handle('update:open', async () => {
  if (!lastUpdateFilePath || !fsSync.existsSync(lastUpdateFilePath)) {
    return { ok: false, error: '安装包不存在，请重新下载' }
  }
  const message = await shell.openPath(lastUpdateFilePath)
  return message ? { ok: false, error: message } : { ok: true }
})

ipcMain.handle('update:show', () => {
  if (lastUpdateFilePath && fsSync.existsSync(lastUpdateFilePath)) {
    shell.showItemInFolder(lastUpdateFilePath)
    return { ok: true }
  }
  return { ok: false, error: '安装包不存在，请重新下载' }
})

ipcMain.handle('update:release', async () => {
  const url = updateReleaseCache.payload?.releaseUrl
  if (!url || !/^https:\/\/github\.com\//i.test(url)) {
    return { ok: false, error: '发布页地址不可用' }
  }
  await shell.openExternal(url)
  return { ok: true }
})

ipcMain.handle('app:uninstall', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: '仅 Windows 安装版支持应用内卸载' }
  }

  const installDir = path.dirname(process.execPath)
  let uninstallerName

  try {
    const files = await fs.readdir(installDir)
    uninstallerName = files.find((name) => /^uninstall.*\.exe$/i.test(name))
  } catch {
    uninstallerName = null
  }

  if (!uninstallerName) {
    return {
      ok: false,
      error: '未找到卸载程序；便携版请直接删除程序目录'
    }
  }

  try {
    const uninstallerPath = path.join(installDir, uninstallerName)
    const command = `ping 127.0.0.1 -n 3 >nul & "${uninstallerPath}" /S`
    const child = spawn('cmd.exe', ['/d', '/s', '/c', command], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
    setTimeout(() => app.quit(), 600)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
})

ipcMain.handle('app:export-favorites', async (_event, { content = '', name = 'serial-commands.json' } = {}) => {
  const result = await showSaveDialog({
    title: '导出指令库',
    defaultPath: path.join(app.getPath('documents'), name),
    filters: [
      { name: 'JSON 文件', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })

  if (result.canceled || !result.filePath) return { ok: false, canceled: true }

  try {
    await fs.writeFile(result.filePath, content, 'utf8')
    return { ok: true, filePath: result.filePath }
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
})

ipcMain.handle('app:import-favorites', async () => {
  const result = await showOpenDialog({
    title: '导入指令库',
    properties: ['openFile'],
    filters: [
      { name: 'JSON 文件', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { ok: false, canceled: true }
  }

  try {
    const content = await fs.readFile(result.filePaths[0], 'utf8')
    return { ok: true, content, filePath: result.filePaths[0] }
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
})

ipcMain.handle('app:save-log', async (_event, { content = '', name = 'serial.log' } = {}) => {
  const result = await showSaveDialog({
    title: '保存接收日志',
    defaultPath: path.join(app.getPath('documents'), name),
    filters: [
      { name: '日志文件', extensions: ['log', 'txt'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })

  if (result.canceled || !result.filePath) return { ok: false, canceled: true }

  try {
    await fs.writeFile(result.filePath, content, 'utf8')
    return { ok: true, filePath: result.filePath }
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
})
