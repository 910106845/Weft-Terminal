import Icon from './Icons'
import SpecularButton from './SpecularButton'
import PortPicker from './PortPicker'
import HistoryPicker from './HistoryPicker'
import { parseHexInput } from '../lib/format'
import { TAIL_OPTIONS } from '../lib/defaults'
import { getChecksumAlgo } from '../lib/checksum'

function tailLabel(value) {
  return (
    TAIL_OPTIONS.find((option) => option.value === value)?.label.replace(/\s*\(.*\)/, '') ||
    'CRLF'
  )
}


export default function SendPane({
  send,
  sendText,
  onChangeText,
  onSend,
  looping,
  history,
  onClearHistory,
  onPickHistory,
  ports,
  portPath,
  connected,
  connecting,
  onSelectPort,
  onTogglePort,
  onRefreshPorts,
  batchRunning,
  onFormat,
  onAddFavorite,
  onOpenLibrary,
  favorites,
  onFillFavorite,
  onSendFavorite,
  height,
  open,
  onToggleOpen
}) {
  const isHex = send.encoding === 'hex'
  const checksumAlgo = getChecksumAlgo(send.checksumAlgo)
  const hexResult = isHex ? parseHexInput(sendText) : null
  const metaText = isHex
    ? hexResult.error
      ? 'HEX 格式待修正'
      : `${hexResult.bytes.length} bytes`
    : `${sendText.length} 字符`

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onSend()
    }
  }

  return (
    <section
      className={`send-card ${open ? '' : 'is-collapsed'}`}
      style={open && height ? { height: `${height}px` } : undefined}
    >
      <header className="send-head">
        <div className="send-head-left">
          <span className="send-icon">
            <Icon name="send" size={15} />
          </span>
          <h2>发送</h2>
          <span className="tag">{send.encoding.toUpperCase()}</span>
          {send.appendTail ? (
            <span className="tag tag-tail">{tailLabel(send.tail)}</span>
          ) : null}
          {send.checksum ? (
            <span className="tag tag-check">
              {checksumAlgo.label}
              {checksumAlgo.width > 1
                ? ` · ${send.endian === 'little' ? '小端' : '大端'}`
                : ''}
            </span>
          ) : null}
          {looping ? (
            <span className="loop-badge">
              <span className="loop-dot" />
              循环发送中
            </span>
          ) : null}
        </div>
        <div className="send-actions">
          <div className="send-device">
            <PortPicker
              ports={ports}
              value={portPath}
              connected={connected}
              onChange={onSelectPort}
              onRefresh={onRefreshPorts}
            />
            <button
              className={`device-connect ${connected ? 'is-connected' : ''}`}
              onClick={onTogglePort}
              disabled={connecting || (!connected && !portPath)}
              title={connected ? '关闭串口' : '打开串口'}
            >
              <Icon name={connected ? 'power' : 'plug'} size={13} />
              <span>
                {connecting ? '连接中…' : connected ? '关闭串口' : '打开串口'}
              </span>
            </button>
          </div>
          <span className="send-actions-sep" />
          <button
            className="ghost-btn"
            onClick={onFormat}
            disabled={!isHex}
            title={isHex ? '整理 HEX 输入：补空格并转大写' : '仅 HEX 模式可用'}
          >
            <Icon name="format" size={14} />
            格式化
          </button>
          <button className="ghost-btn" onClick={onAddFavorite} title="收藏当前指令">
            <Icon name="star" size={14} />
            收藏
          </button>
          <button className="ghost-btn accent" onClick={onOpenLibrary} title="指令库 (⌘K)">
            <Icon name="command" size={14} />
            指令库
            <kbd>⌘K</kbd>
          </button>
          <button
            className="icon-btn"
            onClick={onToggleOpen}
            title={open ? '收起发送区' : '展开发送区'}
          >
            <Icon name="chevron-down" size={14} className={open ? '' : 'rotate'} />
          </button>
        </div>
      </header>

      {open ? (
        <>
          <div className="command-shelf">
            <span className="shelf-label">
              <Icon name="star" size={12} />
              常用指令
            </span>
            <div className="shelf-track">
              {favorites.length === 0 ? (
                <button className="shelf-empty" onClick={onAddFavorite}>
                  <Icon name="plus" size={12} />
                  收藏当前内容，之后可一键填入或发送
                </button>
              ) : (
                favorites.map((item) => (
                  <div className="cmd-chip" key={item.id}>
                    <button
                      className="cmd-chip-main"
                      onClick={() => onFillFavorite(item)}
                      title={item.text}
                    >
                      <span className="cmd-chip-name">{item.name}</span>
                      <span className="cmd-chip-meta">{(item.encoding || 'hex').toUpperCase()}</span>
                    </button>
                    <button
                      className="cmd-chip-send"
                      onClick={() => onSendFavorite(item)}
                      title="立即发送"
                    >
                      <Icon name="bolt" size={12} />
                    </button>
                  </div>
                ))
              )}
              {favorites.length > 0 ? (
                <button className="shelf-manage" onClick={onOpenLibrary}>
                  管理
                  <Icon name="chevron-down" size={11} className="rotate-90" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="editor-shell">
            <textarea
              className="send-textarea"
              value={sendText}
              onChange={(event) => onChangeText(event.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              placeholder={
                isHex
                  ? '输入十六进制数据，例如：01 03 00 00 00 01 84 0A'
                  : '输入要发送的文本，Enter 发送，Shift+Enter 换行'
              }
            />
            <div className="editor-meta">
              <span className={`editor-encoding ${isHex && hexResult.error ? 'is-error' : ''}`}>
                {send.encoding.toUpperCase()}
                <span className="meta-dot" />
                {metaText}
              </span>
              <span className="editor-hint">Enter 发送 · Shift+Enter 换行</span>
            </div>
          </div>

          <div className="send-footer">
            <div className="history-picker">
              <HistoryPicker history={history} onPick={onPickHistory} />
              <button className="icon-btn mini" onClick={onClearHistory} title="清空发送历史">
                <Icon name="trash" size={13} />
              </button>
            </div>
            <SpecularButton
              size="sm"
              radius={10}
              lineColor="#ffffff"
              baseColor="#525252"
              textColor="#f5f5f5"
              tint="#ffffff"
              tintOpacity={0.04}
              intensity={1}
              idleIntensity={0.34}
              shineSize={10}
              shineFade={34}
              thickness={1.2}
              glow={1}
              proximity={240}
              className={`send-button ${looping ? 'is-stopping' : ''} ${
                batchRunning ? 'is-batch' : ''
              }`}
              onClick={onSend}
              disabled={batchRunning}
              title={batchRunning ? '批量循环进行中，请先在顶部停止' : undefined}
              style={{
                height: '38px',
                padding: '0 16px',
                fontSize: '12.5px',
                fontWeight: 650,
                gap: '8px',
                borderRadius: '10px',
                '--btn-bg': 'var(--spec-btn-bg, #1a1b1f)',
                '--btn-bg-hover': 'var(--spec-btn-bg-hover, #212228)',
                '--btn-fg': '#f5f5f5',
                '--btn-fg-hover': '#ffffff',
                '--btn-border': 'transparent',
                '--btn-border-hover': 'transparent',
                '--btn-shadow': '0 10px 22px -16px rgba(6, 12, 24, 0.7)',
                '--btn-shadow-hover': '0 14px 26px -16px rgba(6, 12, 24, 0.75)'
              }}
            >
              {batchRunning ? (
                <>
                  <span className="batch-pulse" />
                  <span>循环发送中</span>
                </>
              ) : (
                <>
                  <Icon name={looping ? 'stop' : 'send'} size={15} />
                  <span>{looping ? '停止循环' : '发送'}</span>
                  <kbd>{looping ? 'Stop' : 'Enter'}</kbd>
                </>
              )}
            </SpecularButton>
          </div>
        </>
      ) : null}
    </section>
  )
}
