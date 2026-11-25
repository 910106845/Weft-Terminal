'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icons';
import BrandMark from './BrandMark';
import { isLiteLevel, useEffectsLevel } from '../lib/effects';
import PageTag from './PageTag';
import GhostCursor from './GhostCursor';
import StatusCapsule from './StatusCapsule';
import Modal from './Modal';
import Portal from './Portal';
import { useSharedJSON } from '../hooks/useSharedState';
import useResponsiveDrawer from '../lib/useResponsiveDrawer';
import { loadJSON } from '../lib/format';

const MAX_LOG = 200;
const LIVE_WINDOW = 4000;

const makeId = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const defaultRules = () => [
  {
    id: makeId('rule'),
    enabled: true,
    hex: false,
    match: 'hello',
    reply: '{串口名} 收到 {消息}'
  }
];

const normalizeRules = (value) => {
  if (!Array.isArray(value)) return defaultRules();
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: typeof item.id === 'string' && item.id ? item.id : makeId('rule'),
      enabled: item.enabled !== false,
      hex: Boolean(item.hex),
      match: typeof item.match === 'string' ? item.match : '',
      reply: typeof item.reply === 'string' ? item.reply : ''
    }));
};

const pairIdOf = (pair) => `pair-${pair.index}`;
const validCom = (name) => /^COM\d+$/i.test(String(name || ''));
const pairUsable = (pair) =>
  Boolean(pair) &&
  validCom(pair.a) &&
  validCom(pair.b) &&
  pair.a.toUpperCase() !== pair.b.toUpperCase();

const formatTime = (value) => {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(
    date.getSeconds()
  ).padStart(2, '0')}`;
};

export default function WindowsVirtualPage({
  sessionId,
  active,
  accent,
  statusAccent,
  tagAccent,
  resolvedTheme,
  split = false,
  onPaneDragStart,
  onPaneDragEnd,
  paneTitle,
  paneTag,
  paneTagClass
}) {
  const effectsLevel = useEffectsLevel();
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [rulesCollapsed, setRulesCollapsed] = useState(false);
  const rulesRatioKey = `serialdebug.virtual.rulesRatio.${sessionId}`;
  const [rulesRatio, setRulesRatio] = useState(() => {
    const value = Number(loadJSON(rulesRatioKey, 0.5));
    return Number.isFinite(value) && value >= 0.2 && value <= 0.8
      ? value
      : 0.5;
  });
  useEffect(() => {
    try {
      localStorage.setItem(rulesRatioKey, JSON.stringify(rulesRatio));
    } catch {
      // 忽略存储失败
    }
  }, [rulesRatio, rulesRatioKey]);
  const pageRef = useRef(null);
  const { drawerMode, toggle: toggleRail } = useResponsiveDrawer({
    ref: pageRef,
    enabled: split,
    threshold: 900,
    collapsed: railCollapsed,
    setCollapsed: setRailCollapsed
  });
  const splitWasRef = useRef(split);
  useEffect(() => {
    if (splitWasRef.current === split) return;
    splitWasRef.current = split;
    if (!split) setRailCollapsed(false);
  }, [split]);

  useEffect(() => {
    if (!split || !drawerMode || railCollapsed) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setRailCollapsed(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [split, drawerMode, railCollapsed]);

  const [pairs, setPairs] = useState([]);
  const [runtime, setRuntime] = useState({});
  const [logs, setLogs] = useState({});
  const startRulesResize = useCallback((event) => {
    event.preventDefault();
    const main = event.currentTarget.parentElement;
    if (!main) return;
    const rect = main.getBoundingClientRect();
    const startY = event.clientY;
    const startRatio = rulesRatio;
    const onMove = (moveEvent) => {
      const next = startRatio + (moveEvent.clientY - startY) / rect.height;
      setRulesRatio(Math.min(0.8, Math.max(0.2, next)));
    };
    const onUp = () => {
      document.body.classList.remove('is-resizing-row');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    document.body.classList.add('is-resizing-row');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [rulesRatio]);

  const [activeId, setActiveId] = useState('');
  const [endChoice, setEndChoice] = useState({});
  const [hexView, setHexView] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [copiedId, setCopiedId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [cleanOpen, setCleanOpen] = useState(false);
  const [cleanBusy, setCleanBusy] = useState(false);
  const [cleanError, setCleanError] = useState('');
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [uninstallBusy, setUninstallBusy] = useState(false);
  const [uninstallResult, setUninstallResult] = useState('');
  const [admin, setAdmin] = useState(null);
  const [installed, setInstalled] = useState(true);
  const [installer, setInstaller] = useState(false);
  const [installNotice, setInstallNotice] = useState('');
  const [rules, setRules] = useSharedJSON(
    `serialdebug.virtual.rules.${sessionId}`,
    defaultRules(),
    normalizeRules
  );
  const platform = window.terminalAPI?.platform || 'win32';
  const logRef = useRef(null);
  const copyTimerRef = useRef(null);
  const toastTimerRef = useRef(null);
  const activePair =
    pairs.find((pair) => pairIdOf(pair) === activeId) || pairs[0] || null;
  const activePairId = activePair ? pairIdOf(activePair) : '';
  const activeRuntime = activePairId ? runtime[activePairId] || {} : {};
  const activeLog = activePairId ? logs[activePairId] || [] : [];
  const adminBlocked = admin !== true;
  const adminRequired = admin === false;

  const showToast = useCallback((message, kind = 'success') => {
    setToast({ message, kind });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const loadPairs = useCallback(async () => {
    setLoading(true);
    setError('');
    const api = window.terminalAPI?.virtual;
    const status = await api?.com0comStatus?.().catch(() => null);
    if (status) {
      setAdmin(Boolean(status.admin));
      setInstalled(Boolean(status.installed));
      setInstaller(Boolean(status.installer));
    }
    if (!status?.installed) {
      setPairs([]);
      setLoading(false);
      return;
    }
    if (!status.admin) {
      setPairs([]);
      setLoading(false);
      setError('需要管理员权限才能读取虚拟串口。请以管理员身份重新打开应用。');
      return;
    }
    const result = await api?.listCom0com?.().catch((err) => ({
      ok: false,
      error: err?.message || String(err)
    }));
    setLoading(false);
    if (!result?.ok) {
      setPairs([]);
      setError(result?.error || '读取虚拟串口失败');
      return;
    }
    const list = (Array.isArray(result.pairs) ? result.pairs : []).filter(
      pairUsable
    );
    setPairs(list);
    setRuntime((prev) => {
      const next = {};
      list.forEach((pair) => {
        const id = pairIdOf(pair);
        if (prev[id]) next[id] = prev[id];
      });
      return next;
    });
    setLogs((prev) => {
      const next = {};
      list.forEach((pair) => {
        const id = pairIdOf(pair);
        if (prev[id]) next[id] = prev[id];
      });
      return next;
    });
    setActiveId((prev) =>
      list.some((pair) => pairIdOf(pair) === prev)
        ? prev
        : list[0]
          ? pairIdOf(list[0])
          : ''
    );
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    loadPairs();
    return undefined;
  }, [active, loadPairs]);

  useEffect(() => {
    const api = window.terminalAPI?.virtual;
    if (!api?.onEvent) return undefined;
    const off = api.onEvent((payload) => {
      if (!payload?.portId) return;
      const id = payload.portId;
      if (payload.type === 'status') {
        setRuntime((prev) => ({
          ...prev,
          [id]: { ...(prev[id] || {}), status: payload.status }
        }));
        return;
      }
      if (payload.type !== 'data') return;
      setLogs((prev) => {
        const list = prev[id] || [];
        return {
          ...prev,
          [id]: [
            ...list,
            {
              id: `${payload.direction}-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 6)}`,
              direction: payload.direction,
              hex: payload.hex,
              text: payload.text,
              at: Date.now()
            }
          ].slice(-MAX_LOG)
        };
      });
    });
    return off;
  }, []);

  // 规则是页面级的，任何规则修改都同步到所有已打开的串口
  useEffect(() => {
    const api = window.terminalAPI?.virtual;
    if (!api) return;
    Object.entries(runtime).forEach(([id, item]) => {
      if (item?.status === 'ready') api.setRules(id, rules);
    });
  }, [rules, runtime]);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [activeLog.length, hexView, activePairId]);

  const chosenEnd = (pair) => endChoice[pairIdOf(pair)] || 'a';
  const isOpen = (pair) => {
    const status = runtime[pairIdOf(pair)]?.status;
    return status === 'ready' || status === 'opening';
  };

  const togglePair = async (pair) => {
    const id = pairIdOf(pair);
    const item = runtime[id] || {};
    if (item.status === 'ready' || item.status === 'opening') {
      await window.terminalAPI?.virtual?.close(id);
      setRuntime((prev) => ({ ...prev, [id]: { status: 'idle' } }));
      return;
    }
    if (!pairUsable(pair)) {
      setRuntime((prev) => ({
        ...prev,
        [id]: { status: 'error', error: '串口对未命名或两端相同，无法打开' }
      }));
      return;
    }
    const end = chosenEnd(pair);
    setRuntime((prev) => ({ ...prev, [id]: { status: 'opening' } }));
    const result = await window.terminalAPI?.virtual
      ?.openPair?.({ portId: id, a: pair.a, b: pair.b, end, rules })
      ?.catch((err) => ({ ok: false, error: err?.message || String(err) }));
    if (!result?.ok) {
      setRuntime((prev) => ({
        ...prev,
        [id]: { status: 'error', error: result?.error || '打开串口失败' }
      }));
      return;
    }
    setRuntime((prev) => ({
      ...prev,
      [id]: {
        status: 'ready',
        internalPath: result.internalPath,
        externalPath: result.externalPath,
        error: ''
      }
    }));
  };

  const createPair = async () => {
    setError('');
    setLoading(true);
    const result = await window.terminalAPI?.virtual
      ?.createCom0com?.()
      ?.catch((err) => ({ ok: false, error: err?.message || String(err) }));
    setLoading(false);
    if (!result?.ok) {
      setError(
        result?.detail
          ? `${result.error || '新建失败'}：${result.detail}`
          : result?.error || '新建虚拟串口失败'
      );
      return;
    }
    await loadPairs();
    const index = result.pair?.index;
    if (Number.isInteger(index)) setActiveId(`pair-${index}`);
    showToast('虚拟串口创建成功');
  };

  const removePair = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError('');
    const id = pairIdOf(deleteTarget);
    if (isOpen(deleteTarget)) {
      await window.terminalAPI?.virtual?.close(id);
    }
    const result = await window.terminalAPI?.virtual
      ?.removeCom0com?.({
        index: deleteTarget.index,
        a: deleteTarget.a,
        b: deleteTarget.b
      })
      ?.catch((err) => ({ ok: false, error: err?.message || String(err) }));
    setDeleteBusy(false);
    if (!result?.ok) {
      setDeleteError(
        result?.detail
          ? `${result.error || '删除失败'}：${result.detail}`
          : result?.error || '删除失败'
      );
      return;
    }
    setDeleteTarget(null);
    setRuntime((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setLogs((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await loadPairs();
  };

  const cleanAll = async () => {
    setCleanBusy(true);
    setCleanError('');
    const result = await window.terminalAPI?.virtual
      ?.cleanCom0com?.()
      ?.catch((err) => ({ ok: false, error: err?.message || String(err) }));
    setCleanBusy(false);
    if (!result?.ok) {
      setCleanError(
        result?.detail
          ? `${result.error || '清理失败'}：${result.detail}`
          : result?.error || '清理失败'
      );
      return;
    }
    setCleanOpen(false);
    setPairs([]);
    setRuntime({});
    setLogs({});
    setActiveId('');
    await loadPairs();
  };

  const installCom0com = async () => {
    setInstallNotice('');
    const result = await window.terminalAPI?.virtual
      ?.installCom0com?.()
      ?.catch((err) => ({ ok: false, error: err?.message || String(err) }));
    if (!result?.ok) {
      setInstallNotice(result?.error || '无法打开安装程序');
      return;
    }
    setInstallNotice('正在等待安装完成…');
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      const status = await window.terminalAPI?.virtual
        ?.com0comStatus?.()
        ?.catch(() => null);
      if (status?.installed) {
        setInstalled(true);
        setAdmin(Boolean(status.admin));
        setInstaller(Boolean(status.installer));
        setInstallNotice('已检测到虚拟串口驱动，可以新建虚拟串口。');
        await loadPairs();
        return;
      }
      if (attempts < 40) setTimeout(poll, 2000);
      else setInstallNotice('未检测到安装完成，请安装后点「重新检测」。');
    };
    setTimeout(poll, 1500);
  };

  const uninstallCom0com = async () => {
    setUninstallBusy(true);
    setUninstallResult('');
    const result = await window.terminalAPI?.virtual
      ?.uninstallCom0com?.()
      ?.catch((err) => ({ ok: false, error: err?.message || String(err) }));
    setUninstallBusy(false);
    if (result?.ok) {
      setPairs([]);
      setRuntime({});
      setLogs({});
      setActiveId('');
      setInstalled(false);
      setUninstallResult('虚拟串口驱动已卸载。请重启电脑后再重新安装。');
    } else {
      setUninstallResult(result?.error || '卸载虚拟串口驱动失败');
    }
  };

  const updateRule = (id, patch) => {
    setRules((prev) =>
      prev.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
    );
  };
  const addRule = () => {
    setRules((prev) => [
      ...prev,
      { id: makeId('rule'), enabled: true, hex: false, match: '', reply: '' }
    ]);
  };
  const removeRule = (id) => {
    setRules((prev) => prev.filter((rule) => rule.id !== id));
  };

  const copyExternal = async (pair) => {
    const id = pairIdOf(pair);
    const path = runtime[id]?.externalPath;
    if (!path) return;
    try {
      await window.terminalAPI?.clipboard?.writeText(path);
      setCopiedId(id);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedId(''), 1600);
    } catch {
      // 忽略复制失败
    }
  };

  const statusText = !activePair
    ? '未打开'
    : activeRuntime.status === 'ready'
      ? '已打开'
      : activeRuntime.status === 'opening'
        ? '打开中'
        : activeRuntime.status === 'error'
          ? '打开失败'
          : '未打开';

  const rxCount = activeLog.filter((item) => item.direction === 'rx').length;
  const txCount = activeLog.length - rxCount;
  const activeRules = rules;

  const railPanel = (
          <aside className="virtual-rail">
            <div className="virtual-rail-head">
              <h2>串口列表</h2>
              <span className="virtual-count">{pairs.length}</span>
            </div>

            {adminRequired ? (
              <div className="virtual-admin-warning" role="alert">
                <Icon name="alert" size={14} />
                <span>
                  读取/新建/删除虚拟串口需要管理员权限。请关闭应用，右键
                  Weft Terminal →「以管理员身份运行」。
                </span>
              </div>
            ) : null}
            {error ? (
              <p className="virtual-port-hint" title={error}>
                {error}
              </p>
            ) : null}

            <div className="virtual-port-list">
              {pairs.map((pair) => {
                const id = pairIdOf(pair);
                const rt = runtime[id] || {};
                const open = rt.status === 'ready' || rt.status === 'opening';
                const usable = pairUsable(pair);
                const choose = chosenEnd(pair);
                const chosenName = choose === 'b' ? pair.b : pair.a;
                return (
                  <article
                    key={id}
                    className={`virtual-port-card ${
                      id === activePairId ? 'is-active' : ''
                    }`}
                  >
                    <div className="virtual-port-head">
                      <span
                        className={`virtual-port-state ${
                          rt.status === 'error' ? 'is-error' : ''
                        }`}
                      >
                        <i
                          className={`virtual-port-dot is-${
                            rt.status || 'idle'
                          }`}
                        />
                        {rt.status === 'ready'
                          ? '已打开'
                          : rt.status === 'opening'
                            ? '打开中…'
                            : rt.status === 'error'
                              ? '打开失败'
                              : '未打开'}
                        {rt.status === 'ready' && rt.internalPath ? (
                          <span className="wvp-opened-port">
                            {rt.internalPath}
                          </span>
                        ) : null}
                      </span>
                    </div>

                    <div className="wvp-title-row">
                      <span className="virtual-port-avatar" aria-hidden="true">
                        <Icon name="windows" size={17} />
                      </span>
                      <div
                        className="wvp-end-pill"
                        role="group"
                        aria-label={`选择 ${pair.a} / ${pair.b} 中本应用占用的串口`}
                      >
                        <button
                          type="button"
                          className={choose === 'a' ? 'is-on' : ''}
                          disabled={!usable || open}
                          aria-pressed={choose === 'a'}
                          onClick={() => {
                            setActiveId(id);
                            setEndChoice((prev) => ({ ...prev, [id]: 'a' }));
                          }}
                        >
                          {pair.a}
                        </button>
                        <button
                          type="button"
                          className={choose === 'b' ? 'is-on' : ''}
                          disabled={!usable || open}
                          aria-pressed={choose === 'b'}
                          onClick={() => {
                            setActiveId(id);
                            setEndChoice((prev) => ({ ...prev, [id]: 'b' }));
                          }}
                        >
                          {pair.b}
                        </button>
                      </div>
                      <button
                        type="button"
                        className={`wvp-open-btn ${open ? 'is-on' : ''}`}
                        disabled={!usable || rt.status === 'opening'}
                        onClick={() => togglePair(pair)}
                      >
                        <Icon name={open ? 'stop' : 'plug'} size={12} />
                        {open ? '关闭' : '打开'}
                      </button>
                    </div>

                    {!usable ? (
                      <p className="virtual-port-hint">串口未命名或无效</p>
                    ) : null}

                    {rt.error ? (
                      <p className="virtual-port-hint">{rt.error}</p>
                    ) : null}

                    <div className="virtual-port-actions">
                      <button
                        type="button"
                        className={`virtual-port-btn ${
                          copiedId === id ? 'is-done' : ''
                        }`}
                        onClick={() => copyExternal(pair)}
                        disabled={!open}
                      >
                        <Icon
                          name={copiedId === id ? 'check' : 'copy'}
                          size={13}
                        />
                        {copiedId === id ? '已复制' : '复制串口'}
                      </button>
                      <button
                        type="button"
                        className="virtual-port-btn is-danger"
                        onClick={() => {
                          setDeleteError('');
                          setDeleteTarget(pair);
                        }}
                      >
                        <Icon name="trash" size={13} />
                        删除串口
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <button
              type="button"
              className="virtual-add-port"
              onClick={createPair}
              disabled={adminBlocked || loading || installed === false}
            >
              <Icon name="plus" size={13} />
              新建虚拟串口
            </button>

            {platform === 'win32' && installed === false ? (
              <div className="virtual-install-actions">
                <button
                  type="button"
                  className="virtual-add-port"
                  disabled={adminBlocked || !installer}
                  onClick={installCom0com}
                >
                  <Icon name="download" size={13} />
                  安装虚拟串口驱动
                </button>
                <button
                  type="button"
                  className="virtual-uninstall-com0com"
                  onClick={loadPairs}
                >
                  <Icon name="refresh" size={12} />
                  重新检测
                </button>
                {installNotice ? (
                  <p className="virtual-port-hint">{installNotice}</p>
                ) : null}
              </div>
            ) : null}

            {platform === 'win32' && installed ? (
              <div className="virtual-com0com-box">
                <div className="virtual-com0com-head">
                  <strong>{pairs.length}</strong>
                  <span>对 · {pairs.length * 2} 个 COM 口</span>
                </div>
                <div className="virtual-com0com-actions">
                  <button
                    type="button"
                    className="virtual-port-btn"
                    disabled={loading}
                    onClick={loadPairs}
                  >
                    <Icon name="refresh" size={12} />
                    刷新
                  </button>
                  <button
                    type="button"
                    className="virtual-port-btn"
                    disabled={adminBlocked || !pairs.length}
                    onClick={() => {
                      setCleanError('');
                      setCleanOpen(true);
                    }}
                  >
                    <Icon name="trash" size={12} />
                    清理全部
                  </button>
                  <button
                    type="button"
                    className="virtual-port-btn is-danger"
                    disabled={adminBlocked}
                    onClick={() => {
                      setUninstallResult('');
                      setUninstallOpen(true);
                    }}
                  >
                    <Icon name="trash" size={12} />
                    卸载驱动
                  </button>
                </div>
              </div>
            ) : null}

            <p className="virtual-note">
              Windows 下通过虚拟串口驱动创建串口对。默认不占用任何一端，点「打开」后本应用占用选中的一端，第三方软件打开另一端，即可使用自定义回复功能
            </p>
          </aside>
  );

  return (
    <div
      ref={pageRef}
      className={`app virtual-page wvp-page ${split ? 'is-split' : ''} ${
        split && drawerMode ? 'is-split-drawer' : ''
      } ${railCollapsed ? 'is-rail-collapsed' : ''} ${
        rulesCollapsed ? 'is-rules-collapsed' : ''
      }`}
    >
      <header className="topbar">
        {active && !isLiteLevel(effectsLevel) ? (
          <GhostCursor
            className="topbar-ghost"
            theme={resolvedTheme}
            color={accent || '#7c3aed'}
            brightness={resolvedTheme === 'dark' ? 0.95 : 0.62}
            size={72}
            trailLength={44}
            inertia={0.45}
            turbulence={0.55}
            drift={0.22}
            detail={1}
            grainIntensity={0.02}
            bloomStrength={0.3}
            bloomRadius={1}
            bloomThreshold={0.04}
            edgeIntensity={0.18}
            mixBlendMode="normal"
            zIndex={0}
            intro
          />
        ) : null}
        <div className="brand">
          <BrandMark active={active} />
          <div className="brand-text">
            <span className="brand-line">
              <span className="brand-title">Weft Terminal</span>
              <PageTag kind="virtual" label="虚拟串口" accent={tagAccent} />
            </span>
            <span className="brand-sub">WEAVE EVERY CONNECTION</span>
          </div>
          <span className="pane-title">
              <span className="pane-title-row">
                <span className="pane-title-main">{paneTitle || '虚拟串口'}</span>
                {paneTag ? (
                  <span
                    className={`tab-kind-tag pane-kind-tag ${
                      paneTagClass || ''
                    }`}
                  >
                    {paneTag}
                  </span>
                ) : null}
              </span>
            <span className="pane-title-sub">
              {activeRuntime.internalPath
                ? `${activeRuntime.internalPath} · ${statusText}`
                : statusText}
            </span>
          </span>
          {split ? (
            <button
              type="button"
              className="pane-drag-handle"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', sessionId)
                onPaneDragStart?.(sessionId, event)
              }}
              onDragEnd={onPaneDragEnd}
              title="拖动调整会话位置"
              aria-label="拖动调整会话位置"
            >
              <Icon name="grip" size={12} />
            </button>
          ) : null}
        </div>

        <div className="topbar-actions">
          <StatusCapsule
            active={activeRuntime.status === 'ready'}
            accent={statusAccent || accent}
            enabled={active}
            theme={resolvedTheme}
            label={statusText}
            meta={activeRuntime.internalPath || undefined}
          />
          <button
            type="button"
            className={`topbar-btn is-icon virtual-rail-toggle ${
              railCollapsed ? '' : 'is-active'
            }`}
            onClick={toggleRail}
            title={railCollapsed ? '展开串口列表' : '收起串口列表'}
            aria-label={railCollapsed ? '展开串口列表' : '收起串口列表'}
            aria-pressed={!railCollapsed}
          >
            <Icon name="panel-left" size={15} />
          </button>
          <button
            type="button"
            className={`topbar-btn is-icon virtual-rules-toggle ${
              rulesCollapsed ? '' : 'is-active'
            }`}
            onClick={() => setRulesCollapsed((prev) => !prev)}
            title={rulesCollapsed ? '展开自动回复规则' : '收起自动回复规则'}
            aria-label={rulesCollapsed ? '展开自动回复规则' : '收起自动回复规则'}
            aria-pressed={!rulesCollapsed}
          >
            <Icon name="panel-top" size={15} />
          </button>
          <span className="topbar-sep" aria-hidden="true" />
          <button
            type="button"
            className="topbar-btn is-icon"
            onClick={loadPairs}
            disabled={loading}
            title="刷新虚拟串口列表"
            aria-label="刷新虚拟串口列表"
          >
            <Icon name="refresh" size={15} />
          </button>
        </div>
      </header>

      <div className="virtual-body">
        <div className="virtual-grid">
          {drawerMode ? null : railPanel}

          <div className="virtual-main">
            <section
              className="virtual-panel is-rules"
              style={{
                flexGrow: rulesCollapsed ? 0 : rulesRatio,
                flexBasis: 0
              }}
            >
              <div className="virtual-panel-head">
                <h2>自动回复规则</h2>
                <span className="virtual-meta">
                  对所有虚拟串口生效
                  {activeRules.length
                    ? ` · ${activeRules.filter((rule) => rule.enabled && rule.match.trim()).length} 条生效`
                    : ''}
                </span>
                <div className="virtual-head-actions">
                  <button type="button" className="soft-btn" onClick={addRule}>
                    <Icon name="plus" size={13} />
                    添加规则
                  </button>
                </div>
              </div>

              {activeRules.length ? (
                <div className="virtual-rules">
                  {activeRules.map((rule) => (
                    <div
                      className={`virtual-rule ${
                        rule.enabled ? 'is-on' : 'is-off'
                      }`}
                      key={rule.id}
                    >
                      <button
                        type="button"
                        role="switch"
                        aria-checked={rule.enabled}
                        className={`virtual-switch ${
                          rule.enabled ? 'is-on' : ''
                        }`}
                        onClick={() =>
                          updateRule(rule.id, { enabled: !rule.enabled })
                        }
                        title={rule.enabled ? '停用这条规则' : '启用这条规则'}
                      >
                        <span />
                      </button>
                      <label className="virtual-field">
                        <span>收到</span>
                        <input
                          value={rule.match}
                          className={rule.match.trim() ? '' : 'is-incomplete'}
                          placeholder={rule.hex ? '41 54' : 'AT'}
                          spellCheck={false}
                          onChange={(event) =>
                            updateRule(rule.id, { match: event.target.value })
                          }
                        />
                      </label>
                      <span className="virtual-arrow" aria-hidden="true">
                        →
                      </span>
                      <label className="virtual-field">
                        <span>回复</span>
                        <input
                          value={rule.reply}
                          placeholder="OK\r\n"
                          spellCheck={false}
                          onChange={(event) =>
                            updateRule(rule.id, { reply: event.target.value })
                          }
                        />
                      </label>
                      <div className="virtual-seg">
                        <button
                          type="button"
                          className={!rule.hex ? 'is-on' : ''}
                          aria-pressed={!rule.hex}
                          onClick={() => updateRule(rule.id, { hex: false })}
                        >
                          文本
                        </button>
                        <button
                          type="button"
                          className={rule.hex ? 'is-on' : ''}
                          aria-pressed={rule.hex}
                          onClick={() => updateRule(rule.id, { hex: true })}
                        >
                          HEX
                        </button>
                      </div>
                      <button
                        type="button"
                        className="icon-btn mini is-danger"
                        onClick={() => removeRule(rule.id)}
                        title="删除规则"
                        aria-label="删除规则"
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="virtual-empty is-inline">
                  <strong>还没有规则</strong>
                  <p>添加一条「收到 X → 回复 Y」，任意串口收到 X 都会自动应答。</p>
                </div>
              )}

              <p className="virtual-footnote">
                规则对当前页面所有虚拟串口生效；整条消息与「收到」一致时才回复，行尾的{' '}
                <code>\r\n</code> 会自动忽略。
              </p>
            </section>

            {rulesCollapsed ? null : (
              <div
                className="row-resizer virtual-row-resizer"
                role="separator"
                aria-orientation="horizontal"
                tabIndex={0}
                title="拖动调整规则与收发记录比例"
                onPointerDown={startRulesResize}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
                    return;
                  }
                  event.preventDefault();
                  setRulesRatio((prev) =>
                    Math.min(
                      0.8,
                      Math.max(0.2, prev + (event.key === 'ArrowDown' ? 0.03 : -0.03))
                    )
                  );
                }}
              >
                <span className="row-resizer-grip" />
              </div>
            )}

            <section
              className="virtual-panel is-log"
              style={{
                flexGrow: rulesCollapsed ? 1 : 1 - rulesRatio,
                flexBasis: 0
              }}
            >
              <div className="virtual-panel-head">
                <h2>收发记录</h2>
                {activePair ? (
                  <span className="virtual-meta">
                    {activeRuntime.internalPath || `${activePair.a} ↔ ${activePair.b}`}
                    {activeLog.length
                      ? ` · 收 ${rxCount} / 回 ${txCount}`
                      : ''}
                  </span>
                ) : null}
                <div className="virtual-head-actions">
                  <div className="virtual-seg">
                    <button
                      type="button"
                      className={!hexView ? 'is-on' : ''}
                      onClick={() => setHexView(false)}
                    >
                      文本
                    </button>
                    <button
                      type="button"
                      className={hexView ? 'is-on' : ''}
                      onClick={() => setHexView(true)}
                    >
                      HEX
                    </button>
                  </div>
                  <button
                    type="button"
                    className="icon-btn mini"
                    title="清空收发记录"
                    onClick={() => {
                      if (!activePairId) return;
                      setLogs((prev) => ({ ...prev, [activePairId]: [] }));
                    }}
                  >
                    <Icon name="broom" size={13} />
                  </button>
                </div>
              </div>

              <div className={`virtual-log ${!activePair || activeLog.length === 0 ? 'is-empty' : ''}`} ref={logRef}>
                {activeLog.length ? (
                  activeLog.map((entry) => (
                    <div
                      className={`virtual-log-row is-${entry.direction}`}
                      key={entry.id}
                    >
                      <time className="virtual-log-time">
                        {formatTime(entry.at)}
                      </time>
                      <span className={`virtual-log-dir is-${entry.direction}`}>
                        {entry.direction === 'rx' ? '收' : '回'}
                      </span>
                      <code>
                        {hexView
                          ? entry.hex
                          : entry.text.replace(/\r/g, '␍').replace(/\n/g, '␊')}
                      </code>
                    </div>
                  ))
                ) : (
                  <div className="virtual-empty is-log">
                    <strong>暂未收到串口数据</strong>
                    <p>
                      请用串口工具打开{' '}
                      {activeRuntime.externalPath ||
                        (activePair
                          ? chosenEnd(activePair) === 'b'
                            ? activePair.a
                            : activePair.b
                          : '外部串口')}{' '}
                      串口发送数据，这里会实时显示收发数据
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      {drawerMode && !railCollapsed ? (
        <Portal>
          <div className="pane-drawer-layer">
            <button
              type="button"
              className="pane-drawer-backdrop"
              aria-label="关闭串口列表"
              onClick={() => setRailCollapsed(true)}
            />
            <div
              className="pane-drawer is-virtual"
              role="dialog"
              aria-label="串口列表"
            >
              {railPanel}
            </div>
          </div>
        </Portal>
      ) : null}

      <footer className="statusbar">
        <div
          className={`status-state ${
            activeRuntime.status === 'ready'
              ? 'ok'
              : activeRuntime.status === 'error'
                ? 'error'
                : ''
          }`}
        >
          <span className="status-dot" />
          <span>虚拟串口 · {statusText}</span>
        </div>
        <div className="status-meta">
          <span>
            收 {rxCount} · 回 {txCount}
          </span>
          <span className="status-sep" />
          <span>
            {activeRuntime.internalPath ||
              (activePair
                ? `${activePair.a} ↔ ${activePair.b}`
                : '尚无活动串口')}
          </span>
        </div>
      </footer>

      <Portal>
      {deleteTarget ? (
        <Modal
          title="删除虚拟串口对"
          width={430}
          tone="danger"
          icon={<Icon name="trash" size={15} />}
          onClose={() => {
            if (!deleteBusy) setDeleteTarget(null);
          }}
          footer={
            <>
              <button
                type="button"
                className="soft-btn"
                disabled={deleteBusy}
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="danger-btn"
                disabled={deleteBusy || adminBlocked}
                onClick={removePair}
              >
                {deleteBusy ? '正在删除…' : '删除'}
              </button>
            </>
          }
        >
          <p className="virtual-confirm-text">
            将从系统中删除 <code>{deleteTarget.a} ↔ {deleteTarget.b}</code>
            ，两个 COM 口都会消失。
          </p>
          {deleteError ? (
            <p className="virtual-confirm-note is-danger">{deleteError}</p>
          ) : null}
        </Modal>
      ) : null}

      {cleanOpen ? (
        <Modal
          title="清理全部虚拟串口"
          width={440}
          tone="danger"
          icon={<Icon name="trash" size={15} />}
          onClose={() => {
            if (!cleanBusy) setCleanOpen(false);
          }}
          footer={
            <>
              <button
                type="button"
                className="soft-btn"
                disabled={cleanBusy}
                onClick={() => setCleanOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="danger-btn"
                disabled={cleanBusy || adminBlocked}
                onClick={cleanAll}
              >
                {cleanBusy ? '正在清理…' : '清理'}
              </button>
            </>
          }
        >
          <p className="virtual-confirm-text">
            将删除系统中的全部 {pairs.length} 对串口，不会卸载驱动。
          </p>
          {cleanError ? (
            <p className="virtual-confirm-note is-danger">{cleanError}</p>
          ) : null}
        </Modal>
      ) : null}

      {uninstallOpen ? (
        <Modal
          title="卸载虚拟串口驱动"
          width={440}
          tone="danger"
          icon={<Icon name="trash" size={15} />}
          onClose={() => {
            if (!uninstallBusy) setUninstallOpen(false);
          }}
          footer={
            uninstallResult ? (
              <button
                type="button"
                className="soft-btn"
                onClick={() => setUninstallOpen(false)}
              >
                关闭
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="soft-btn"
                  disabled={uninstallBusy}
                  onClick={() => setUninstallOpen(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="danger-btn"
                  disabled={uninstallBusy || adminBlocked}
                  onClick={uninstallCom0com}
                >
                  {uninstallBusy ? '正在卸载…' : '卸载'}
                </button>
              </>
            )
          }
        >
          {uninstallResult ? (
            <p className="virtual-confirm-text">{uninstallResult}</p>
          ) : (
            <p className="virtual-confirm-text">
              将卸载虚拟串口驱动并删除所有串口对，完成后可能需要重启电脑。
            </p>
          )}
        </Modal>
      ) : null}

      {toast ? (
        <div className={`toast ${toast.kind}`} role="status" aria-live="polite">
          {toast.message}
        </div>
      ) : null}
      </Portal>
    </div>
  );
}
