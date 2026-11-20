import { useEffect, useState } from 'react'
import Modal from './Modal'
import Icon from './Icons'

export default function TerminalCommandEditor({
  mode = 'create',
  scope = 'local',
  item,
  defaultCommand = '',
  onClose,
  onSave
}) {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [error, setError] = useState('')
  const isSsh = scope === 'ssh'
  const scopeLabel = isSsh ? 'SSH 指令' : '本地终端指令'

  useEffect(() => {
    const initialCommand =
      mode === 'edit' ? item?.command || '' : defaultCommand || ''
    const firstLine = initialCommand.trim().split('\n')[0].slice(0, 28)
    setName(mode === 'edit' ? item?.name || '' : firstLine)
    setCommand(initialCommand)
    setError('')
  }, [defaultCommand, item, mode])

  const submit = () => {
    if (!name.trim()) {
      setError('请填写指令名称')
      return
    }
    if (!command.trim()) {
      setError('指令内容不能为空')
      return
    }
    onSave({ name: name.trim(), command })
  }

  return (
    <Modal
      title={`${mode === 'edit' ? '编辑' : '新增'}${scopeLabel}`}
      width={600}
      tone={isSsh ? 'ssh' : ''}
      icon={<Icon name={isSsh ? 'server' : 'terminal'} size={17} />}
      onClose={onClose}
      footer={
        <>
          <button className="soft-btn" onClick={onClose}>
            取消
          </button>
          <button className="primary-btn" onClick={submit}>
            <Icon name="plus" size={14} />
            {mode === 'edit' ? '保存修改' : '保存指令'}
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
          placeholder={isSsh ? '例如：查看服务状态' : '例如：启动开发服务'}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
        />
      </label>

      <label className="field-block">
        <span className="micro-label">命令</span>
        <textarea
          className="modal-textarea terminal-command-textarea"
          value={command}
          placeholder={
            isSsh
              ? '例如：systemctl status nginx\n支持多行命令，运行时会逐行执行'
              : '例如：npm run dev\n支持多行命令，运行时会逐行执行'
          }
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              submit()
            }
          }}
        />
      </label>

      <p className="form-note">
        新增后可点击填入当前终端，或直接运行。命令会发送到当前终端的工作目录。
      </p>

      {error ? <p className="form-error">{error}</p> : null}
    </Modal>
  )
}
