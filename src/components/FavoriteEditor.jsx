import { useEffect, useState } from 'react'
import Modal from './Modal'
import { Segmented, Switch } from './Controls'
import Icon from './Icons'
import { ENCODING_OPTIONS, TAIL_OPTIONS } from '../lib/defaults'
import { getChecksumAlgo } from '../lib/checksum'
import { pickFavoriteSend } from '../lib/favorites'

function tailLabel(value) {
  return (
    TAIL_OPTIONS.find((option) => option.value === value)?.label.replace(/\s*\(.*\)/, '') ||
    'CRLF'
  )
}

export default function FavoriteEditor({
  mode,
  item,
  defaultText,
  currentSend,
  onClose,
  onSave
}) {
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [encoding, setEncoding] = useState('hex')
  const [useCurrent, setUseCurrent] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const initialText = mode === 'edit' ? item?.text || '' : defaultText || ''
    const firstLine = initialText.trim().split('\n')[0].slice(0, 24)
    setName(mode === 'edit' ? item?.name || '' : firstLine)
    setText(initialText)
    setEncoding(item?.encoding || currentSend?.encoding || 'hex')
    setUseCurrent(false)
    setError('')
  }, [mode, item, defaultText, currentSend?.encoding])

  const baseSend =
    mode === 'edit' && !useCurrent ? item?.send || {} : pickFavoriteSend(currentSend || {})
  const previewSend = { ...baseSend, encoding }
  const checksum = previewSend.checksum
    ? getChecksumAlgo(previewSend.checksumAlgo).label
    : ''

  const submit = () => {
    if (!name.trim()) {
      setError('请填写指令名称')
      return
    }
    if (!text.trim()) {
      setError('指令内容不能为空')
      return
    }
    onSave({ name: name.trim(), text, encoding, useCurrent })
  }

  return (
    <Modal
      title={mode === 'edit' ? '编辑指令' : '收藏新指令'}
      width={560}
      onClose={onClose}
      footer={
        <>
          <button className="soft-btn" onClick={onClose}>
            取消
          </button>
          <button className="primary-btn" onClick={submit}>
            <Icon name="star" size={14} />
            {mode === 'edit' ? '保存修改' : '保存到指令库'}
          </button>
        </>
      }
    >
      <label className="field-block">
        <span className="micro-label">名称</span>
        <input
          className="modal-input"
          autoFocus
          value={name}
          placeholder="例如：读取设备版本"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
        />
      </label>

      <label className="field-block">
        <span className="micro-label">指令内容</span>
        <textarea
          className="modal-textarea"
          value={text}
          placeholder="HEX：01 03 00 00 00 01&#10;文本：AT+VERSION?"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit()
          }}
        />
      </label>

      <div className="field-block">
        <span className="micro-label">编码</span>
        <Segmented
          options={ENCODING_OPTIONS}
          value={encoding}
          onChange={setEncoding}
        />
      </div>

      {mode === 'edit' ? (
        <div className="editor-sync">
          <Switch
            label="使用当前发送设置（尾部 / 校验）"
            checked={useCurrent}
            onChange={setUseCurrent}
          />
          <p>关闭时保留收藏时保存的发送参数，仅更新名称、内容与编码。</p>
        </div>
      ) : (
        <p className="form-note">将同时保存当前发送设置中的尾部、校验与字节序参数。</p>
      )}

      <div className="favorite-settings">
        <span className="micro-label">随指令保存</span>
        <div className="badge-row">
          <span className="mini-badge is-neutral">{encoding.toUpperCase()}</span>
          {previewSend.appendTail ? (
            <span className="mini-badge is-neutral">
              {tailLabel(previewSend.tail)}
            </span>
          ) : null}
          {checksum ? <span className="mini-badge is-accent">{checksum}</span> : null}
          {previewSend.checksum && previewSend.checksumHex ? (
            <span className="mini-badge is-neutral">HEX 校验</span>
          ) : null}
          {!previewSend.appendTail && !checksum ? (
            <span className="badge-placeholder">未附加尾部或校验</span>
          ) : null}
        </div>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
    </Modal>
  )
}
