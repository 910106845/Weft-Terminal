const { contextBridge, ipcRenderer, clipboard } = require('electron')

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('serialAPI', {
  platform: process.platform,
  listPorts: () => ipcRenderer.invoke('serial:list'),
  encode: (text, encoding) => ipcRenderer.invoke('serial:encode', { text, encoding }),
  open: (sessionId, options) =>
    ipcRenderer.invoke('serial:open', { ...options, sessionId }),
  close: (sessionId) => ipcRenderer.invoke('serial:close', { sessionId }),
  write: (sessionId, payload) =>
    ipcRenderer.invoke('serial:write', { ...payload, sessionId }),
  setSignals: (sessionId, signals) =>
    ipcRenderer.invoke('serial:set-signals', { ...signals, sessionId }),
  newWindow: () => ipcRenderer.invoke('app:new-window'),
  uninstall: () => ipcRenderer.invoke('app:uninstall'),
  saveLog: (content, name) => ipcRenderer.invoke('app:save-log', { content, name }),
  exportFavorites: (content, name) =>
    ipcRenderer.invoke('app:export-favorites', { content, name }),
  importFavorites: () => ipcRenderer.invoke('app:import-favorites'),
  onData: (callback) => subscribe('serial:data', callback),
  onStatus: (callback) => subscribe('serial:status', callback)
})

contextBridge.exposeInMainWorld('terminalAPI', {
  platform: process.platform,
  isAdmin: () => ipcRenderer.invoke('app:is-admin'),
  shells: () => ipcRenderer.invoke('terminal:shells'),
  create: (terminalId, options = {}) =>
    ipcRenderer.invoke('terminal:create', { ...options, terminalId }),
  write: (terminalId, data) =>
    ipcRenderer.send('terminal:input', { terminalId, data }),
  resize: (terminalId, cols, rows) =>
    ipcRenderer.send('terminal:resize', { terminalId, cols, rows }),
  close: (terminalId) =>
    ipcRenderer.invoke('terminal:close', { terminalId }),
  choosePrivateKey: () => ipcRenderer.invoke('app:choose-private-key'),
  history: (terminalId) => ipcRenderer.invoke('terminal:history', { terminalId }),
    stats: (terminalId) => ipcRenderer.invoke('terminal:stats', { terminalId }),
  respondHostKey: (terminalId, accept) =>
    ipcRenderer.send('terminal:host-key-response', { terminalId, accept }),
  virtual: {
    create: (payload) => ipcRenderer.invoke('virtual:create', payload),
    close: (portId) => ipcRenderer.invoke('virtual:close', { portId }),
    remove: (portId) => ipcRenderer.invoke('virtual:remove', { portId }),
    installCom0com: () => ipcRenderer.invoke('virtual:install-com0com'),
    uninstallCom0com: () => ipcRenderer.invoke('virtual:uninstall-com0com'),
    com0comStatus: () => ipcRenderer.invoke('virtual:com0com-status'),
    cleanCom0com: () => ipcRenderer.invoke('virtual:clean-com0com'),
    setRules: (portId, rules) =>
      ipcRenderer.invoke('virtual:set-rules', { portId, rules }),
    onEvent: (callback) => subscribe('virtual:event', callback)
  },
  onData: (callback) => subscribe('terminal:data', callback),
  onExit: (callback) => subscribe('terminal:exit', callback),
  onHostKey: (callback) => subscribe('terminal:host-key', callback),
  sftp: {
    home: (terminalId) =>
      ipcRenderer.invoke('ssh:sftp-home', { terminalId }),
    list: (terminalId, remotePath) =>
      ipcRenderer.invoke('ssh:sftp-list', { terminalId, path: remotePath }),
    download: (terminalId, remotePath) =>
      ipcRenderer.invoke('ssh:sftp-download', { terminalId, path: remotePath }),
    upload: (terminalId, remoteDir) =>
      ipcRenderer.invoke('ssh:sftp-upload', { terminalId, remoteDir }),
    mkdir: (terminalId, remotePath) =>
      ipcRenderer.invoke('ssh:sftp-mkdir', { terminalId, path: remotePath }),
    remove: (terminalId, remotePath, type, isLink) =>
      ipcRenderer.invoke('ssh:sftp-delete', {
        terminalId,
        path: remotePath,
        type,
        isLink
      })
  },
  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(String(text ?? ''))
  }
})
