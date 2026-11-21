import { useState } from 'react'
import Icon from './Icons'
import BaudPicker from './BaudPicker'
import { Segmented, Switch } from './Controls'
import {
  CHECKSUM_TARGET_OPTIONS,
  COMMON_BAUD_RATES,
  DATA_BIT_OPTIONS,
  ENCODING_OPTIONS,
  FLOW_CONTROL_OPTIONS,
  PARITY_OPTIONS,
  STOP_BIT_OPTIONS,
  TAIL_OPTIONS,
  normalizeChecksumTo
} from '../lib/defaults'
import { CHECKSUM_ALGOS, getChecksumAlgo } from '../lib/checksum'

function Card({ icon, title, meta, collapsed, onToggle, children }) {
  return (
    <section className={`side-card ${collapsed ? 'is-collapsed' : ''}`}>
      <button
        type="button"
        className="side-card-head"
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <span className="side-card-icon">
          <Icon name={icon} size={14} />
        </span>
        <h2>{title}</h2>
        {meta ? <span className="side-card-meta">{meta}</span> : null}
        <span className={`collapse-icon ${collapsed ? 'is-collapsed' : ''}`}>
          <Icon name="chevron-down" size={13} />
        </span>
      </button>
      {collapsed ? null : <div className="side-card-body">{children}</div>}
    </section>
  )
}

const ENDIAN_OPTIONS = [
  { value: 'big', label: '大端' },
  { value: 'little', label: '小端' }
]

export default function Sidebar({
  settings,
  update,
  connected,
  onOpenFont,
  onSaveLog,
  customBauds,
  onRemoveBaud
}) {
  const recv = settings.recv
  const send = settings.send
  const checksumAlgo = getChecksumAlgo(send.checksumAlgo)
  const [collapsed, setCollapsed] = useState({})
  const isMac = window.serialAPI?.platform === 'darwin'
  const toggleCard = (id) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))

  return (
    <aside className="sidebar">
      <Card
        icon="plug"
        title="连接参数"
        meta={connected ? '在线' : '离线'}
        collapsed={collapsed.device}
        onToggle={() => toggleCard('device')}
      >
        <div className="field-block">
          <span className="micro-label">波特率</span>
          <BaudPicker
            value={settings.baudRate}
            commonRates={COMMON_BAUD_RATES}
            customRates={customBauds}
            disabled={connected}
            onChange={(value) => update('baudRate', value)}
            onRemoveCustom={onRemoveBaud}
          />
        </div>

        <div className="form-grid two">
          <label className="field-block">
            <span className="micro-label">校验位</span>
            <select
              value={settings.parity}
              onChange={(event) => update('parity', event.target.value)}
              disabled={connected}
            >
              {PARITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field-block">
            <span className="micro-label">停止位</span>
            <select
              value={settings.stopBits}
              onChange={(event) => update('stopBits', Number(event.target.value))}
              disabled={connected}
            >
              {STOP_BIT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field-block">
            <span className="micro-label">数据位</span>
            <select
              value={settings.dataBits}
              onChange={(event) => update('dataBits', Number(event.target.value))}
              disabled={connected}
            >
              {DATA_BIT_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="field-block">
            <span className="micro-label">流控制</span>
            <select
              value={settings.flowControl}
              onChange={(event) => update('flowControl', event.target.value)}
              disabled={connected}
            >
              {FLOW_CONTROL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="signal-strip">
          <button
            type="button"
            className={`signal-btn ${settings.rts ? 'is-on' : ''}`}
            onClick={() => update('rts', !settings.rts)}
            title="切换 RTS"
          >
            <span className="signal-led" />
            RTS
          </button>
          <button
            type="button"
            className={`signal-btn ${settings.dtr ? 'is-on' : ''}`}
            onClick={() => update('dtr', !settings.dtr)}
            title="切换 DTR"
          >
            <span className="signal-led" />
            DTR
          </button>
          <span className="signal-divider" />
          {['CTS', 'DSR', 'DCD'].map((name) => (
            <span className="signal-passive" key={name}>
              <span className="signal-led" />
              {name}
            </span>
          ))}
        </div>
      </Card>

      <Card
        icon="wave"
        title="接收设置"
        meta={recv.encoding.toUpperCase()}
        collapsed={collapsed.recv}
        onToggle={() => toggleCard('recv')}
      >
        <Segmented
          options={ENCODING_OPTIONS}
          value={recv.encoding}
          onChange={(value) => update('recv.encoding', value)}
        />

        <div className="option-grid">
          <Switch
            label="自动换行"
            checked={recv.autoNewline}
            onChange={(value) => update('recv.autoNewline', value)}
          />
          <Switch
            label="显示行号"
            checked={recv.lineNumbers}
            onChange={(value) => update('recv.lineNumbers', value)}
          />
          <Switch
            label="显示时间"
            checked={recv.timestamp}
            onChange={(value) => update('recv.timestamp', value)}
          />
          <Switch
            label="自动滚屏"
            checked={recv.autoScroll}
            onChange={(value) => update('recv.autoScroll', value)}
          />
          <Switch
            label="ANSI 颜色"
            checked={recv.ansi}
            hint="识别接收文本中的 ANSI 颜色转义序列（例如 ESC[31m）"
            onChange={(value) => update('recv.ansi', value)}
          />
          <Switch
            label="日志高亮"
            checked={recv.logHighlight !== false}
            hint="自动识别时间戳、日志级别、URL、IP、耗时等内容并着色"
            onChange={(value) => update('recv.logHighlight', value)}
          />
        </div>

        <div className="inline-controls">
          <div className="mini-field">
            <span className="micro-label">间隔时间</span>
            <div className="unit-input">
              <input
                type="number"
                min="1"
                max="10000"
                value={recv.interval}
                onChange={(event) => update('recv.interval', event.target.value)}
              />
              <span>ms</span>
            </div>
          </div>
          <div className="mini-field">
            <span className="micro-label">接收数据颜色</span>
            <input
              className="color-input"
              type="color"
              value={recv.dataColor}
              onChange={(event) => update('recv.dataColor', event.target.value)}
              title="接收数据颜色"
            />
          </div>
        </div>

        <div className="button-row">
          <button className="soft-btn grow" onClick={onOpenFont}>
            <Icon name="terminal" size={14} />
            字体 {recv.fontSize}px
          </button>
          <button className="soft-btn grow" onClick={onSaveLog}>
            <Icon name="download" size={14} />
            保存日志
          </button>
        </div>
      </Card>

      <Card
        icon="send"
        title="发送设置"
        meta={send.encoding.toUpperCase()}
        collapsed={collapsed.send}
        onToggle={() => toggleCard('send')}
      >
        <Segmented
          options={ENCODING_OPTIONS}
          value={send.encoding}
          onChange={(value) => update('send.encoding', value)}
        />

        <div className="setting-block">
          <Switch
            label="循环发送"
            checked={send.loop}
            onChange={(value) => update('send.loop', value)}
          />
          {send.loop ? (
            <div className="inline-controls">
              <div className="mini-field">
                <span className="micro-label">间隔</span>
                <div className="unit-input">
                  <input
                    type="number"
                    min="20"
                    value={send.loopInterval}
                    onChange={(event) => update('send.loopInterval', event.target.value)}
                  />
                  <span>ms</span>
                </div>
              </div>
              <div className="mini-field">
                <span className="micro-label">次数</span>
                <div className="unit-input">
                  <input
                    type="number"
                    min="0"
                    placeholder="∞"
                    value={send.loopCount}
                    onChange={(event) => update('send.loopCount', event.target.value)}
                  />
                  <span>次</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="inline-row between">
          <Switch
            label="显示发送"
            checked={send.showSend}
            onChange={(value) => update('send.showSend', value)}
          />
          <input
            className="color-input"
            type="color"
            value={send.sendColor}
            onChange={(event) => update('send.sendColor', event.target.value)}
            title="发送数据颜色"
          />
        </div>

        <div className="inline-row between">
          <Switch
            label="尾部自动加上"
            checked={send.appendTail}
            onChange={(value) => update('send.appendTail', value)}
          />
          <select
            className="compact-select"
            value={send.tail}
            disabled={!send.appendTail}
            onChange={(event) => update('send.tail', event.target.value)}
          >
            {TAIL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className={`checksum-group ${send.checksum ? 'is-on' : ''}`}>
          <div className="checksum-toggle-row">
            <Switch
              label="自动加校验"
              checked={send.checksum}
              hint="开启后把校验值插入发送数据"
              onChange={(value) => update('send.checksum', value)}
            />
            {send.checksum ? (
              <span className="micro-tag is-accent">{checksumAlgo.label}</span>
            ) : null}
          </div>

          {send.checksum ? (
            <div className="checksum-body">
              <label className="field-block">
                <span className="micro-label">算法</span>
                <select
                  value={checksumAlgo.value}
                  onChange={(event) => update('send.checksumAlgo', event.target.value)}
                >
                  {CHECKSUM_ALGOS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="checksum-row">
                <div className="mini-field">
                  <span className="micro-label">起始字节</span>
                  <input
                    className="num-input"
                    type="number"
                    min="1"
                    value={send.checksumFrom}
                    onChange={(event) => update('send.checksumFrom', event.target.value)}
                  />
                </div>
                <div className="mini-field grow">
                  <span className="micro-label">字节序</span>
                  <Segmented
                    className="segmented-mini"
                    options={ENDIAN_OPTIONS}
                    value={send.endian}
                    onChange={(value) => update('send.endian', value)}
                    disabled={checksumAlgo.width === 1}
                  />
                </div>
              </div>

              <label className="field-block">
                <span className="micro-label">校验位置（帧尾字节数）</span>
                <select
                  value={normalizeChecksumTo(send.checksumTo)}
                  onChange={(event) => update('send.checksumTo', Number(event.target.value))}
                >
                  {CHECKSUM_TARGET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <p className="checksum-note">
                {checksumAlgo.width === 1
                  ? '8 位校验无字节序差异。'
                  : '大端 / 小端决定校验值的字节顺序。'}
                帧尾字节不参与校验，校验值插入在帧尾之前。
              </p>

              <Switch
                label="校验值再转 HEX"
                checked={send.checksumHex}
                onChange={(value) => update('send.checksumHex', value)}
              />
            </div>
          ) : (
            <p className="checksum-hint">
              开启后可选择算法、帧尾插入位置与字节序，并随收藏保存。
            </p>
          )}
        </div>
      </Card>

      <div className="sidebar-tip">
        <span className="tip-kbd">Enter</span> 发送 · <span className="tip-kbd">Shift+Enter</span>{' '}
        换行 · <span className="tip-kbd">{isMac ? '⌘K' : 'Ctrl K'}</span> 指令库
      </div>
    </aside>
  )
}
