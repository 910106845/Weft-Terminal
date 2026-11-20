import { useEffect, useState } from 'react'
import Modal from './Modal'
import Icon from './Icons'
import { Segmented } from './Controls'
import { SSH_ENCODINGS, createSshProfile } from '../lib/sshProfiles'

const AUTH_OPTIONS = [
  { value: 'password', label: '密码' },
  { value: 'key', label: '私钥' },
  { value: 'agent', label: 'SSH Agent' }
]

export default function SshConnectDialog({
  mode = 'new',
  profile = null,
  profiles = [],
  onClose,
  onConnect,
  onDeleteProfile
}) {
  const [selectedProfileId, setSelectedProfileId] = useState(profile?.id || '')
  const [name, setName] = useState(profile?.name || '')
  const [host, setHost] = useState(profile?.host || '')
  const [port, setPort] = useState(String(profile?.port || 22))
  const [username, setUsername] = useState(profile?.username || '')
  const [authType, setAuthType] = useState(profile?.authType || 'password')
  const [privateKeyPath, setPrivateKeyPath] = useState(
    profile?.privateKeyPath || ''
  )
  const [encoding, setEncoding] = useState(profile?.encoding || 'utf8')
  const [password, setPassword] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!profile) return
    setSelectedProfileId(profile.id || '')
    setName(profile.name || '')
    setHost(profile.host || '')
    setPort(String(profile.port || 22))
    setUsername(profile.username || '')
    setAuthType(profile.authType || 'password')
    setPrivateKeyPath(profile.privateKeyPath || '')
    setEncoding(profile.encoding || 'utf8')
    setPassword('')
    setPassphrase('')
    setError('')
  }, [profile])

  useEffect(() => {
    if (!selectedProfileId) return
    if (!profiles.some((item) => item.id === selectedProfileId)) {
      setSelectedProfileId('')
    }
  }, [profiles, selectedProfileId])

  const selectProfile = (event) => {
    const id = event.target.value
    setSelectedProfileId(id)
    setError('')
    setPassword('')
    setPassphrase('')
    if (!id) {
      setName('')
      setHost('')
      setPort('22')
      setUsername('')
      setAuthType('password')
      setPrivateKeyPath('')
      return
    }
    const selected = profiles.find((item) => item.id === id)
    if (!selected) return
    setName(selected.name || '')
    setHost(selected.host || '')
    setPort(String(selected.port || 22))
    setUsername(selected.username || '')
    setAuthType(selected.authType || 'password')
    setPrivateKeyPath(selected.privateKeyPath || '')
    setEncoding(selected.encoding || 'utf8')
  }

  const choosePrivateKey = async () => {
    const api = window.terminalAPI
    if (!api?.choosePrivateKey) {
      setError('当前环境不支持选择私钥文件')
      return
    }
    try {
      const result = await api.choosePrivateKey()
      if (result?.ok && result.path) {
        setPrivateKeyPath(result.path)
        setError('')
      } else if (result?.error) {
        setError(result.error)
      }
    } catch (errorValue) {
      setError(errorValue.message || '选择私钥失败')
    }
  }

  const submit = () => {
    const nextHost = host.trim()
    const nextUser = username.trim()
    if (!nextHost) {
      setError('请填写 SSH 主机')
      return
    }
    if (!nextUser) {
      setError('请填写 SSH 用户名')
      return
    }
    if (authType === 'password' && !password) {
      setError('请填写 SSH 密码')
      return
    }
    if (authType === 'key' && !privateKeyPath.trim()) {
      setError('请选择 SSH 私钥文件')
      return
    }

    const nextProfile = createSshProfile({
      id: selectedProfileId || undefined,
      name,
      host: nextHost,
      port,
      username: nextUser,
      authType,
      privateKeyPath,
      encoding
    })
    onConnect({
      profile: nextProfile,
      credentials: {
        password,
        passphrase
      }
    })
  }

  return (
    <Modal
      title={mode === 'edit' ? '编辑 SSH 连接' : '新建 SSH 终端'}
      width={640}
      tone="ssh"
      icon={<Icon name="terminal" size={17} />}
      onClose={onClose}
      footer={
        <>
          <button className="soft-btn" onClick={onClose}>
            取消
          </button>
          <button className="primary-btn" onClick={submit}>
            <Icon name="plug" size={14} />
            {mode === 'edit' ? '编辑连接' : '连接'}
          </button>
        </>
      }
    >
      <div className="ssh-saved-row">
        <label className="field-block ssh-saved-profile">
          <span className="micro-label">已保存会话</span>
          <select
            className="modal-input"
            value={selectedProfileId}
            onChange={selectProfile}
          >
            <option value="" disabled hidden />
            {profiles.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name} · {item.username}@{item.host}:{item.port}
              </option>
            ))}
          </select>
        </label>
        {selectedProfileId ? (
          <button
            type="button"
            className="soft-btn ssh-profile-delete"
            title="删除已保存的 SSH 会话"
            onClick={() => {
              const selected = profiles.find(
                (item) => item.id === selectedProfileId
              )
              if (!selected) return
              if (
                !window.confirm(
                  `确定删除已保存的 SSH 会话「${selected.name}」吗？\n\n已经打开的关联 SSH 标签页也会被关闭。`
                )
              ) {
                return
              }
              onDeleteProfile?.(selectedProfileId)
              setSelectedProfileId('')
              setPassword('')
              setPassphrase('')
              setError('')
            }}
          >
            删除会话
          </button>
        ) : null}
      </div>

      <div className="ssh-form-grid">
        <label className="field-block">
          <span className="micro-label">名称</span>
          <input
            className="modal-input"
            value={name}
            placeholder="例如：生产服务器"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="field-block">
          <span className="micro-label">主机</span>
          <input
            className="modal-input"
            autoFocus
            value={host}
            placeholder="服务器地址或 IP"
            spellCheck={false}
            onChange={(event) => setHost(event.target.value)}
          />
        </label>

        <label className="field-block ssh-port-field">
          <span className="micro-label">端口</span>
          <input
            className="modal-input"
            value={port}
            inputMode="numeric"
            spellCheck={false}
            onChange={(event) => setPort(event.target.value.replace(/[^0-9]/g, ''))}
          />
        </label>

        <label className="field-block">
          <span className="micro-label">用户名</span>
          <input
            className="modal-input"
            value={username}
            placeholder="root"
            spellCheck={false}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
      </div>

      <label className="field-block">
        <span className="micro-label">终端编码</span>
        <select
          className="modal-input ssh-encoding-select"
          value={encoding}
          onChange={(event) => setEncoding(event.target.value)}
        >
          {SSH_ENCODINGS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="ssh-auth-note">
          远端输出中文乱码时，按服务器实际编码选择 GBK / GB18030 等。
        </span>
      </label>

      <div className="field-block ssh-auth-block">
        <span className="micro-label">认证方式</span>
        <Segmented
          options={AUTH_OPTIONS}
          value={authType}
          onChange={(value) => {
            setAuthType(value)
            setError('')
          }}
        />
      </div>

      {authType === 'password' ? (
        <label className="field-block">
          <span className="micro-label">密码</span>
          <input
            className="modal-input"
            type="password"
            autoComplete="current-password"
            value={password}
            placeholder="仅用于本次连接，不会保存"
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
          />
        </label>
      ) : null}

      {authType === 'key' ? (
        <>
          <label className="field-block">
            <span className="micro-label">私钥文件</span>
            <div className="ssh-key-row">
              <input
                className="modal-input"
                value={privateKeyPath}
                placeholder="~/.ssh/id_ed25519"
                spellCheck={false}
                onChange={(event) => setPrivateKeyPath(event.target.value)}
              />
              <button className="soft-btn" type="button" onClick={choosePrivateKey}>
                <Icon name="folder" size={14} />
                选择
              </button>
            </div>
          </label>
          <label className="field-block">
            <span className="micro-label">私钥口令（可选）</span>
            <input
              className="modal-input"
              type="password"
              autoComplete="off"
              value={passphrase}
              placeholder="仅用于本次连接，不会保存"
              onChange={(event) => setPassphrase(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
              }}
            />
          </label>
        </>
      ) : null}

      {authType === 'agent' ? (
        <p className="ssh-auth-note">
          使用系统 SSH Agent（SSH_AUTH_SOCK / Pageant）中的私钥进行认证。
        </p>
      ) : null}

      <p className="form-note">
        会话配置会保存到本机，密码和私钥口令只用于本次连接，不会持久化。
      </p>

      {error ? <p className="form-error">{error}</p> : null}
    </Modal>
  )
}
