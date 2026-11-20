const { app, BrowserWindow, Menu, dialog, ipcMain, shell, webContents } = require('electron')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const fs = require('fs/promises')
const fsSync = require('fs')
const { spawn, execFile } = require('child_process')
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

const windows = new Set()
const sessions = new Map()
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

    const finishExit = (message, exitCode = null) => {
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
        message: message || ''
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
            finishExit('SSH 会话已关闭', 0)
          })

          client.on('close', () => {
            finishExit('SSH 连接已关闭')
          })
          client.on('error', (sshError) => {
            finishExit(sshError.message || 'SSH 连接异常')
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
      finishExit(error.message || 'SSH 连接异常')
    })

    client.on('close', () => {
      if (!ready) {
        resolveOnce({
          ok: false,
          error: hostKeyFailure || 'SSH 连接已关闭'
        })
        return
      }
      finishExit('SSH 连接已关闭')
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
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
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
  const contentsId = browserWindow.webContents.id

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
const VIRTUAL_LOG_LIMIT = 400
// 没有换行结尾的数据，安静这么久后当作一条完整消息
const VIRTUAL_IDLE_MS = 80

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

function closeVirtual(portId) {
  const state = virtualPorts.get(portId)
  if (!state) return
  virtualPorts.delete(portId)
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

function com0comSetupPath() {
  const candidates = [
    'C:\\Program Files (x86)\\com0com\\setupc.exe',
    'C:\\Program Files\\com0com\\setupc.exe'
  ]
  return candidates.find((file) => fsSync.existsSync(file)) || ''
}

function parseComPairs(output) {
  const ports = new Map()
  output.split(/\r?\n/).forEach((line) => {
    const match = /^(CNC[AB]\d+)\s+PortName=(COM\d+)/i.exec(line.trim())
    if (match) ports.set(match[1].toUpperCase(), match[2].toUpperCase())
  })
  const pairs = []
  const seen = new Set()
  for (const key of ports.keys()) {
    if (seen.has(key)) continue
    const partner = key.replace('CNCA', 'CNCB')
    if (!ports.has(partner)) continue
    seen.add(key)
    seen.add(partner)
    pairs.push({ a: ports.get(key), b: ports.get(partner) })
  }
  return pairs
}

function execFileAsync(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true }, (error, stdout) => {
      resolve({ error, stdout: stdout || '' })
    })
  })
}

function usedComPairKeys() {
  const used = new Set()
  for (const state of virtualPorts.values()) {
    if (state.pairKey) used.add(state.pairKey)
  }
  return used
}

async function createWindowsVirtualPort({ portId, ownerId, rules }) {
  const setupc = com0comSetupPath()
  if (!setupc) {
    return {
      ok: false,
      error: '未检测到 com0com，Windows 需要它来创建虚拟串口对',
      hint:
        '安装 com0com 后重试：安装时可勾选 "PortName=COM#" 建对，或用 setupc install PortName=COM20 PortName=COM21 创建一对'
    }
  }
  const { stdout } = await execFileAsync(setupc, ['list'])
  const pairs = parseComPairs(stdout)
  if (!pairs.length) {
    return {
      ok: false,
      error: 'com0com 中没有可用的端口对',
      hint: '在 com0com 的 Setup 里新建一对端口（例如 COM10 ↔ COM11）后重试',
      pairs: []
    }
  }
  const used = usedComPairKeys()
  const pair = pairs.find((item) => !used.has(`${item.a}|${item.b}`))
  if (!pair) {
    return {
      ok: false,
      error: 'com0com 的端口对已全部占用',
      hint: '在 com0com 的 Setup 里再新建一对端口，然后重试',
      pairs
    }
  }
  let port
  try {
    port = new SerialPort({ path: pair.a, baudRate: 115200, autoOpen: false })
    await new Promise((resolve, reject) => {
      port.open((error) => (error ? reject(error) : resolve()))
    })
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
  const state = {
    kind: 'com',
    port,
    ownerId,
    externalPath: pair.b,
    internalPath: pair.a,
    pairKey: `${pair.a}|${pair.b}`,
    rules: compileRules(rules),
    matcher: createMessageBuffer(),
    flushTimer: null,
    log: []
  }
  virtualPorts.set(portId, state)
  port.on('data', (buffer) => handleVirtualIncoming(portId, buffer))
  port.on('close', () => {
    if (virtualPorts.get(portId) === state) {
      virtualPorts.delete(portId)
      emitVirtual(ownerId, portId, { type: 'status', status: 'closed' })
    }
  })
  port.on('error', () => {})
  return { ok: true, externalPath: pair.b, internalPath: pair.a, platform: 'win32' }
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

ipcMain.handle('virtual:create-pair', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: '只有 Windows 需要创建端口对' }
  }
  const setupc = com0comSetupPath()
  if (!setupc) {
    return {
      ok: false,
      error: '未检测到 com0com',
      hint: '先安装 com0com（免费），再点一次这个按钮'
    }
  }
  const { stdout } = await execFileAsync(setupc, ['list'])
  let maxPort = 3
  for (const match of stdout.matchAll(/COM(\d+)/gi)) {
    maxPort = Math.max(maxPort, Number(match[1]))
  }
  const nameA = `COM${maxPort + 2}`
  const nameB = `COM${maxPort + 3}`
  const result = await execFileAsync(setupc, [
    'install',
    `PortName=${nameA}`,
    `PortName=${nameB}`
  ])
  if (result.error) {
    return {
      ok: false,
      error: result.error.message || '创建端口对失败',
      hint: '请以管理员身份运行本应用，或手动在 com0com Setup 里建一对端口'
    }
  }
  return { ok: true, pair: { a: nameA, b: nameB }, stdout: result.stdout }
})

ipcMain.handle('serial:list', async () => {
  try {
    const ports = await SerialPort.list()
    return ports.map((item) => ({
      path: item.path,
      manufacturer: item.manufacturer || '',
      serialNumber: item.serialNumber || '',
      friendlyName: item.friendlyName || item.path
    }))
  } catch (error) {
    return { error: error.message }
  }
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
    return {
      ok: false,
      error: error.message || String(error),
      code: error.code || ''
    }
  }

  sessions.set(sessionId, { port: serialPort, ownerId })

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

    if (options.rts !== undefined || options.dtr !== undefined) {
      serialPort.set({ rts: Boolean(options.rts), dtr: Boolean(options.dtr) }, () => {})
    }

    return { ok: true }
  } catch (error) {
    const session = sessions.get(sessionId)
    if (session && session.port === serialPort) {
      sessions.delete(sessionId)
    }
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
