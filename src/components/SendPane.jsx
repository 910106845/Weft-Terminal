import Icon from './Icons'
import GlassButton from './LiquidGlass'
import PortPicker from './PortPicker'
import BaudPicker from './BaudPicker'
import HistoryPicker from './HistoryPicker'
import { parseHexInput } from '../lib/format'
import { COMMON_BAUD_RATES, TAIL_OPTIONS } from '../lib/defaults'
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
  baudRate,
  customBauds,
  onSelectPort,
  onSelectBaud,
  onRemoveBaud,
  connected,
  connecting,
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
  open
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
            <span
              className="send-baud"
              title={connected ? '关闭串口后可切换波特率' : '切换波特率'}
            >
              <BaudPicker
                value={baudRate}
                commonRates={COMMON_BAUD_RATES}
                customRates={customBauds}
                disabled={connected}
                onChange={onSelectBaud}
                onRemoveCustom={onRemoveBaud}
              />
            </span>
            <button
              className={`device-connect ${connected ? 'is-connected' : ''}`}
              onClick={onTogglePort}
              disabled={connecting || (!connected && !portPath)}
              title={connected ? '关闭串口' : '打开串口'}
            >
              <Icon name={connected ? 'power' : 'plug'} size={13} />
              <span className="device-connect-label is-full">
                {connecting ? '连接中…' : connected ? '关闭串口' : '打开串口'}
              </span>
              <span className="device-connect-label is-short">
                {connecting ? '连接中…' : connected ? '关闭' : '打开'}
              </span>
            </button>
          </div>
          <span className="send-actions-sep" />
          <button
            className="ghost-btn"
            onClick={onFormat}
            disabled={!isHex}
            title={isHex ? '整理 HEX 输入：补空格并转大写' : '仅 HEX 模式可用'}
            aria-label="格式化"
          >
            <Icon name="format" size={14} />
            <span className="send-action-label">格式化</span>
          </button>
          <button
            className="ghost-btn"
            onClick={onAddFavorite}
            title="收藏当前指令"
            aria-label="收藏"
          >
            <Icon name="star" size={14} />
            <span className="send-action-label">收藏</span>
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
            <GlassButton
              size="md"
              className={`liquid-send ${looping ? 'is-stopping' : ''} ${
                batchRunning ? 'is-batch' : ''
              }`}
              onClick={onSend}
              disabled={batchRunning}
              title={batchRunning ? '批量循环进行中，请先在顶部停止' : undefined}
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
            </GlassButton>
          </div>
        </>
      ) : null}
    </section>
  )
}
