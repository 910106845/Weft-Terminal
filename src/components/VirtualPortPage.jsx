'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icons';
import BrandMark from './BrandMark'
import PageTag from './PageTag';
import GhostCursor from './GhostCursor';
import StatusCapsule from './StatusCapsule';
import Modal from './Modal';
import { useSharedJSON } from '../hooks/useSharedState';

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

const normalizePorts = (value) => {
  if (!Array.isArray(value)) {
    return [{ id: 'v1', name: '虚拟串口 1', rules: defaultRules() }];
  }
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      id: typeof item.id === 'string' && item.id ? item.id : makeId('vp'),
      name:
        typeof item.name === 'string' && item.name
          ? item.name
          : `虚拟串口 ${index + 1}`,
      rules: normalizeRules(item.rules)
    }));
};

const DEFAULT_PORTS = [{ id: 'v1', name: '虚拟串口 1', rules: defaultRules() }];

const formatTime = (value) => {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(
    date.getSeconds()
  ).padStart(2, '0')}`;
};

export default function VirtualPortPage({
  sessionId,
  active,
  accent,
  statusAccent,
  tagAccent,
  resolvedTheme,
  onToggleTheme
}) {
  const [ports, setPorts] = useSharedJSON(
    `serialdebug.virtual.ports.${sessionId}`,
    DEFAULT_PORTS,
    normalizePorts
  );
  const [activePortId, setActivePortId] = useState('');
  const [runtime, setRuntime] = useState({});
  const [logs, setLogs] = useState({});
  const [lastRxAt, setLastRxAt] = useState({});
  const [now, setNow] = useState(() => Date.now());
  const [hexView, setHexView] = useState(false);
  const [copiedId, setCopiedId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState('');
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [uninstallBusy, setUninstallBusy] = useState(false);
  const [uninstallResult, setUninstallResult] = useState('');
  const [isAdmin, setIsAdmin] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [clearBusy, setClearBusy] = useState(false);
  const [clearError, setClearError] = useState('');
  const platform = window.terminalAPI?.platform || '';
  const adminBlocked = platform === 'win32' && isAdmin !== true;
  const adminRequired = platform === 'win32' && isAdmin === false;

  useEffect(() => {
    if (platform !== 'win32') return;
    let cancelled = false;
    window.terminalAPI?.isAdmin?.()
      ?.then((result) => {
        if (!cancelled) setIsAdmin(Boolean(result?.admin));
      })
      ?.catch?.(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [platform]);
  const logRef = useRef(null);
  const followRef = useRef(true);
  const copyTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const activeCardRef = useRef(null);
  const portsRef = useRef(ports);
  const syncedRulesRef = useRef({});
  portsRef.current = ports;

  const activePort =
    ports.find((port) => port.id === activePortId) || ports[0] || null;
  const activeId = activePort ? activePort.id : '';
  const activeRuntime = activeId ? runtime[activeId] || {} : {};
  const activeLog = activeId ? logs[activeId] || [] : [];
  const activeRules = activePort ? activePort.rules : [];

  // 哪些端口正在收发（4 秒内有数据）
  const liveIds = useMemo(() => {
    const ids = new Set();
    Object.entries(lastRxAt).forEach(([id, at]) => {
      if (now - at < LIVE_WINDOW) ids.add(id);
    });
    return ids;
  }, [lastRxAt, now]);

  const createPort = useCallback(async (port) => {
    const api = window.terminalAPI?.virtual;
    if (!api) return;
    setRuntime((prev) => ({
      ...prev,
      [port.id]: {
        ...(prev[port.id] || {}),
        status: 'creating',
        startedAt: prev[port.id]?.startedAt || Date.now(),
        error: '',
        hint: ''
      }
    }));
    try {
      const result = await api.create({ portId: port.id, rules: port.rules });
      if (!result?.ok) {
        setRuntime((prev) => ({
          ...prev,
          [port.id]: {
            ...(prev[port.id] || {}),
            status: 'error',
            externalPath: '',
            internalPath: '',
            error: result?.error || '创建失败',
            hint: result?.hint || '',
            installer: Boolean(result?.installer)
          }
        }));
      } else {
        setRuntime((prev) => ({
          ...prev,
          [port.id]: {
            ...(prev[port.id] || {}),
            status: 'ready',
            externalPath: result.externalPath || '',
            internalPath: result.internalPath || '',
            error: '',
            hint: ''
          }
        }));
      }
    } catch (error) {
      setRuntime((prev) => ({
        ...prev,
        [port.id]: {
          ...(prev[port.id] || {}),
          status: 'error',
          externalPath: '',
          internalPath: '',
          error: error.message || String(error),
          hint: ''
        }
      }));
    }
  }, []);

  // 页面激活后，把还没创建过的端口建出来
  useEffect(() => {
    if (!active) return;
    // Windows 需要先确认管理员权限，避免未提权时刷出一堆失败卡片
    if (platform === 'win32' && isAdmin !== true) return;
    ports.forEach((port) => {
      if (runtime[port.id]) return;
      createPort(port);
    });
  }, [active, ports, runtime, createPort, platform, isAdmin]);

  // 规则改动同步到主进程
  useEffect(() => {
    const api = window.terminalAPI?.virtual;
    if (!api) return;
    ports.forEach((port) => {
      if (runtime[port.id]?.status !== 'ready') return;
      const signature = JSON.stringify(port.rules);
      if (syncedRulesRef.current[port.id] === signature) return;
      syncedRulesRef.current[port.id] = signature;
      api.setRules(port.id, port.rules);
    });
  }, [ports, runtime]);

  useEffect(() => {
    const api = window.terminalAPI?.virtual;
    if (!api?.onEvent) return undefined;
    const off = api.onEvent((payload) => {
      if (!payload?.portId) return;
      const { portId } = payload;
      if (payload.type === 'status') {
        setRuntime((prev) => ({
          ...prev,
          [portId]: { ...(prev[portId] || {}), status: payload.status }
        }));
        return;
      }
      if (payload.type !== 'data') return;
      if (payload.direction === 'rx') {
        setLastRxAt((prev) => ({ ...prev, [portId]: Date.now() }));
      }
      setLogs((prev) => {
        const list = prev[portId] || [];
        const next = [
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
        ];
        return { ...prev, [portId]: next.slice(-MAX_LOG) };
      });
    });
    return off;
  }, []);

  // 让“通信中”在停止收发后自动回落
  useEffect(() => {
    const expiries = Object.values(lastRxAt)
      .filter((at) => Date.now() - at < LIVE_WINDOW)
      .map((at) => at + LIVE_WINDOW);
    if (!expiries.length) return undefined;
    const delay = Math.max(0, Math.min(...expiries) - Date.now()) + 30;
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [lastRxAt, now]);

  // 关闭页面时释放该页面的所有端口。
  // 延迟一拍再关，避免 React StrictMode 的“假卸载”把刚建好的端口关掉。
  useEffect(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        portsRef.current.forEach((port) => {
          window.terminalAPI?.virtual?.close(port.id);
        });
      }, 0);
    };
  }, []);

  // 选中端口时让卡片保持在可视区域
  useEffect(() => {
    const el = activeCardRef.current;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  // 切换端口 / 新数据时保持日志在底部
  useEffect(() => {
    followRef.current = true;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId]);

  useEffect(() => {
    const el = logRef.current;
    if (!el || !followRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [activeLog.length, hexView]);

  const onLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const updateRule = (portId, ruleId, patch) => {
    setPorts((prev) =>
      prev.map((port) => {
        if (port.id !== portId) return port;
        return {
          ...port,
          rules: port.rules.map((rule) =>
            rule.id === ruleId ? { ...rule, ...patch } : rule
          )
        };
      })
    );
  };

  const addRule = (portId) => {
    setPorts((prev) =>
      prev.map((port) =>
        port.id !== portId
          ? port
          : {
              ...port,
              rules: [
                ...port.rules,
                {
                  id: makeId('rule'),
                  enabled: true,
                  hex: false,
                  match: '',
                  reply: ''
                }
              ]
            }
      )
    );
  };

  const removeRule = (portId, ruleId) => {
    setPorts((prev) =>
      prev.map((port) =>
        port.id !== portId
          ? port
          : { ...port, rules: port.rules.filter((rule) => rule.id !== ruleId) }
      )
    );
  };

  const addPort = () => {
    const used = new Set(ports.map((port) => port.name));
    let index = ports.length + 1;
    while (used.has(`虚拟串口 ${index}`)) index += 1;
    const id = makeId('vp');
    setPorts((prev) => [
      ...prev,
      { id, name: `虚拟串口 ${index}`, rules: defaultRules() }
    ]);
    setActivePortId(id);
    followRef.current = true;
  };

  const removePort = async (portId) => {
    setDeleteError('');
    setDeleteBusy(true);
    const result = await window.terminalAPI?.virtual
      ?.remove?.(portId)
      ?.catch?.((error) => ({
        ok: false,
        error: error?.message || String(error)
      }));
    setDeleteBusy(false);
    if (!result?.ok) {
      setDeleteError(result?.error || '删除虚拟串口失败');
      return;
    }
    const nextPorts = ports.filter((port) => port.id !== portId);
    setPorts(nextPorts);
    setRuntime((prev) => {
      const next = { ...prev };
      delete next[portId];
      return next;
    });
    setLogs((prev) => {
      const next = { ...prev };
      delete next[portId];
      return next;
    });
    setLastRxAt((prev) => {
      const next = { ...prev };
      delete next[portId];
      return next;
    });
    delete syncedRulesRef.current[portId];
    if (activePortId === portId) {
      setActivePortId(nextPorts[0]?.id || '');
    }
    setDeleteTarget('');
  };

  const clearAllPorts = async () => {
    setClearError('');
    setClearBusy(true);
    const failed = [];
    for (const port of portsRef.current) {
      const result = await window.terminalAPI?.virtual
        ?.remove?.(port.id)
        ?.catch?.((error) => ({
          ok: false,
          error: error?.message || String(error)
        }));
      if (!result?.ok) failed.push({ port, error: result?.error || '删除失败' });
    }
    setClearBusy(false);
    const failedIds = new Set(failed.map((item) => item.port.id));
    if (failed.length) {
      setPorts((prev) => prev.filter((port) => failedIds.has(port.id)));
      setRuntime((prev) => {
        const next = {};
        failed.forEach(({ port }) => {
          if (prev[port.id]) next[port.id] = prev[port.id];
        });
        return next;
      });
      setLogs((prev) => {
        const next = {};
        failed.forEach(({ port }) => {
          if (prev[port.id]) next[port.id] = prev[port.id];
        });
        return next;
      });
      setLastRxAt((prev) => {
        const next = {};
        failed.forEach(({ port }) => {
          if (prev[port.id]) next[port.id] = prev[port.id];
        });
        return next;
      });
      setActivePortId(failed[0].port.id);
      setClearError(
        `${failed.length} 个端口未删除：${failed[0].error}`
      );
      return;
    }
    setPorts([]);
    setRuntime({});
    setLogs({});
    setLastRxAt({});
    setActivePortId('');
    setDeleteTarget('');
    setClearAllOpen(false);
    setCopiedId('');
    syncedRulesRef.current = {};
  };

  const copyPath = async (port) => {
    const path = runtime[port.id]?.externalPath;
    if (!path) return;
    try {
      await window.terminalAPI?.clipboard?.writeText(path);
      setCopiedId(port.id);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedId(''), 1600);
    } catch {
      // 忽略复制失败
    }
  };

  const clearLog = () => {
    if (!activeId) return;
    followRef.current = true;
    setLogs((prev) => ({ ...prev, [activeId]: [] }));
  };

  const stateLabel = (port) => {
    const rt = runtime[port.id];
    if (!rt?.status) return '未创建';
    if (rt.status === 'creating') return '创建中…';
    if (rt.status === 'error') return '创建失败';
    if (rt.status === 'closed') return '已关闭';
    if (rt.status === 'ready') {
      return liveIds.has(port.id) ? '通信中' : '等待数据';
    }
    return '未创建';
  };

  const statusText = !activePort
    ? '未创建'
    : activeRuntime.status === 'ready'
      ? liveIds.has(activeId)
        ? '通信中'
        : '已就绪'
      : activeRuntime.status === 'creating'
        ? '创建中'
        : activeRuntime.status === 'error'
          ? '创建失败'
          : '未创建';

  const deletePort = ports.find((port) => port.id === deleteTarget) || null;
  const deletePath = deletePort
    ? runtime[deletePort.id]?.externalPath || '未创建'
    : '';

  const activePathLabel =
    activeRuntime.externalPath ||
    (activeRuntime.status === 'creating' ? '创建中…' : '未创建');

  const rxCount = activeLog.reduce(
    (total, entry) => (entry.direction === 'rx' ? total + 1 : total),
    0
  );
  const txCount = activeLog.length - rxCount;
  const activeRuleCount = activeRules.filter(
    (rule) => rule.enabled && rule.match.trim()
  ).length;

  return (
    <div className="app virtual-page">
      <header className="topbar">
        {active ? (
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
        </div>

        <div className="topbar-actions">
          <StatusCapsule
            active={activeRuntime.status === 'ready'}
            accent={statusAccent || accent}
            enabled={active}
            theme={resolvedTheme}
            label={statusText}
            meta={activeRuntime.externalPath || undefined}
          />
          <span className="topbar-sep" aria-hidden="true" />
          <button
            type="button"
            className="topbar-btn is-icon"
            onClick={() => activePort && createPort(activePort)}
            disabled={!activePort || activeRuntime.status === 'creating'}
            title={
              activeRuntime.status === 'creating'
                ? '正在重新创建…'
                : '重新创建选中的虚拟串口'
            }
            aria-label="重新创建选中的虚拟串口"
          >
            <Icon name="refresh" size={15} />
          </button>
        </div>
      </header>

      <div className="virtual-body">
        <div className="virtual-grid">
          <aside className="virtual-rail">
            <div className="virtual-rail-head">
              <h2>端口列表</h2>
              <span className="virtual-count">{ports.length}</span>
            </div>

            {adminRequired ? (
              <div className="virtual-admin-warning" role="alert">
                <Icon name="alert" size={14} />
                <span>
                  创建或删除虚拟串口需要管理员权限。请关闭应用，右键 Weft Terminal
                  →「以管理员身份运行」。
                </span>
              </div>
            ) : null}

            <div className="virtual-port-list">
              {ports.map((port) => {
                const rt = runtime[port.id] || {};
                const live = liveIds.has(port.id);
                const isActive = port.id === activeId;
                const entries = logs[port.id] || [];
                const lastAt = entries.length
                  ? entries[entries.length - 1].at
                  : rt.startedAt;
                return (
                  <article
                    key={port.id}
                    ref={isActive ? activeCardRef : null}
                    className={`virtual-port-card ${isActive ? 'is-active' : ''}`}
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
                          } ${live ? 'is-live' : ''}`}
                        />
                        {stateLabel(port)}
                      </span>
                      <span className="virtual-port-time" title="最近收发时间">
                        <Icon name="clock" size={11} />
                        {lastAt ? formatTime(lastAt) : '--:--'}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="virtual-port-main"
                      onClick={() => setActivePortId(port.id)}
                      aria-pressed={isActive}
                    >
                      <span className="virtual-port-avatar" aria-hidden="true">
                        <Icon
                          name={
                            platform === 'win32'
                              ? 'windows'
                              : platform === 'darwin'
                                ? 'apple'
                                : 'plug'
                          }
                          size={19}
                        />
                      </span>
                      <span className="virtual-port-id">
                        <span
                          className="virtual-port-name"
                          title={rt.externalPath || undefined}
                        >
                          {rt.externalPath ||
                            (rt.status === 'creating'
                              ? '创建中…'
                              : rt.status === 'error'
                                ? '创建失败'
                                : '未创建')}
                        </span>
                        <span
                          className={`virtual-port-role ${
                            rt.status === 'error' ? 'is-error' : ''
                          }`}
                          title={
                            rt.status === 'error'
                              ? [rt.error, rt.hint].filter(Boolean).join(' · ')
                              : platform === 'win32' && rt.externalPath
                                ? `第三方软件使用 ${rt.externalPath} · 本应用内部占用 ${rt.internalPath}`
                                : '虚拟串口 · 波特率 115200'
                          }
                        >
                          {rt.status === 'error'
                            ? rt.error
                            : platform === 'win32' && rt.externalPath
                              ? '第三方软件使用'
                              : '波特率 115200'}
                        </span>
                      </span>
                    </button>

                    {rt.status === 'ready' &&
                    platform === 'win32' &&
                    rt.externalPath ? (
                      <p className="virtual-port-usage">
                        第三方软件打开 <code>{rt.externalPath}</code>
                        <span>·</span>
                        本应用占用 <code>{rt.internalPath}</code>
                      </p>
                    ) : null}

                    {rt.status === 'error' && rt.hint ? (
                      <p className="virtual-port-hint" title={rt.hint}>
                        {rt.hint}
                      </p>
                    ) : null}

                    <div className="virtual-port-actions">
                      {rt.status === 'error' ? (
                        <>
                          {rt.installer ? (
                            <button
                              type="button"
                              className="virtual-port-btn is-wide"
                              disabled={adminBlocked}
                              title={
                                adminRequired
                                  ? '请以管理员身份重新打开应用后再安装 com0com'
                                  : undefined
                              }
                              onClick={() => {
                                window.terminalAPI?.virtual
                                  ?.installCom0com?.()
                                  ?.catch?.(() => {})
                              }}
                            >
                              <Icon name="download" size={13} />
                              安装 com0com
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="virtual-port-btn"
                            disabled={adminBlocked}
                            onClick={() => createPort(port)}
                          >
                            <Icon name="refresh" size={13} />
                            重试
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className={`virtual-port-btn ${
                            copiedId === port.id ? 'is-done' : ''
                          }`}
                          onClick={() => copyPath(port)}
                          disabled={!rt.externalPath}
                        >
                          <Icon
                            name={copiedId === port.id ? 'check' : 'copy'}
                            size={13}
                          />
                          {copiedId === port.id
                            ? '已复制'
                            : platform === 'win32'
                              ? '复制外部端口'
                              : '复制路径'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="virtual-port-btn is-danger"
                        onClick={() => {
                          setDeleteError('');
                          setDeleteTarget(port.id);
                        }}
                      >
                        <Icon name="trash" size={13} />
                        删除
                      </button>
                    </div>
                  </article>
                );
              })}

            </div>

            <button
              type="button"
              className="virtual-add-port"
              onClick={addPort}
              disabled={adminBlocked}
              title={
                adminRequired
                  ? '请以管理员身份重新打开应用后再新建虚拟串口'
                  : undefined
              }
            >
              <Icon name="plus" size={13} />
              新建虚拟串口
            </button>

            <button
              type="button"
              className="virtual-clear-all"
              onClick={() => {
                setClearError('');
                setClearAllOpen(true);
              }}
              disabled={!ports.length || adminBlocked}
              title={
                adminRequired
                  ? '请以管理员身份重新打开应用后再删除 com0com 端口对'
                  : undefined
              }
            >
              <Icon name="trash" size={13} />
              清空全部虚拟串口
            </button>

            {platform === 'win32' ? (
              <button
                type="button"
                className="virtual-uninstall-com0com"
                disabled={adminBlocked}
                title={
                  adminRequired
                    ? '请以管理员身份重新打开应用后再卸载 com0com'
                    : undefined
                }
                onClick={() => {
                  setUninstallResult('');
                  setUninstallOpen(true);
                }}
              >
                <Icon name="trash" size={12} />
                卸载 com0com
              </button>
            ) : null}

            <p className="virtual-note">
              {platform === 'win32'
                ? activeRuntime.externalPath
                  ? `第三方软件请打开 ${activeRuntime.externalPath}；本应用内部占用 ${activeRuntime.internalPath}，不要打开它。波特率 115200。`
                  : 'Windows 使用 com0com 创建端口对（需先安装 com0com），新建后会自动分配一对 COM 端口；把外部端口给第三方软件打开即可，波特率 115200。'
                : '用支持手填设备路径的工具打开选中的端口，波特率 115200。虚拟串口是 PTY，系统串口列表里看不到；关闭此页面会释放全部端口。'}
            </p>
          </aside>

          <div className="virtual-main">
            <section className="virtual-panel is-rules">
              <div className="virtual-panel-head">
                <h2>自动回复规则</h2>
                {activePort ? (
                  <span className="virtual-meta">
                    {activePathLabel}
                    {activeRules.length
                      ? ` · ${activeRuleCount} 条生效`
                      : ''}
                  </span>
                ) : null}
                <div className="virtual-head-actions">
                  <button
                    type="button"
                    className="soft-btn"
                    onClick={() => activePort && addRule(activePort.id)}
                    disabled={!activePort}
                  >
                    <Icon name="plus" size={13} />
                    添加规则
                  </button>
                </div>
              </div>

              {!activePort ? (
                <div className="virtual-empty is-inline">
                  <strong>还没有虚拟串口</strong>
                  <p>先在左侧新建一个虚拟串口，再来配置自动回复。</p>
                </div>
              ) : activeRules.length ? (
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
                          updateRule(activeId, rule.id, {
                            enabled: !rule.enabled
                          })
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
                            updateRule(activeId, rule.id, {
                              match: event.target.value
                            })
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
                          placeholder={rule.hex ? '4F 4B 0D 0A' : 'OK\\r\\n'}
                          spellCheck={false}
                          onChange={(event) =>
                            updateRule(activeId, rule.id, {
                              reply: event.target.value
                            })
                          }
                        />
                      </label>
                      <div
                        className="virtual-seg"
                        role="group"
                        aria-label="内容格式"
                      >
                        <button
                          type="button"
                          className={rule.hex ? '' : 'is-on'}
                          aria-pressed={!rule.hex}
                          onClick={() =>
                            updateRule(activeId, rule.id, { hex: false })
                          }
                        >
                          文本
                        </button>
                        <button
                          type="button"
                          className={rule.hex ? 'is-on' : ''}
                          aria-pressed={rule.hex}
                          onClick={() =>
                            updateRule(activeId, rule.id, { hex: true })
                          }
                        >
                          HEX
                        </button>
                      </div>
                      <button
                        type="button"
                        className="icon-btn mini is-danger"
                        onClick={() => removeRule(activeId, rule.id)}
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
                  <p>添加一条「收到 X → 回复 Y」，对方发来 X 时会自动应答。</p>
                </div>
              )}

              {activePort ? (
                <p className="virtual-footnote">
                  整条消息与「收到」一致时才回复，行尾的 <code>\r\n</code>{' '}
                  会自动忽略；回复里可用 <code>{'{串口名}'}</code>、
                  <code>{'{消息}'}</code>。
                </p>
              ) : null}
            </section>

            <section className="virtual-panel is-log">
              <div className="virtual-panel-head">
                <h2>收发记录</h2>
                {activePort ? (
                  <span className="virtual-meta">
                    {activePathLabel}
                    {activeLog.length
                      ? ` · ${rxCount} 收 · ${txCount} 回`
                      : ''}
                  </span>
                ) : null}
                <div className="virtual-head-actions">
                  <div className="virtual-seg" role="group" aria-label="显示格式">
                    <button
                      type="button"
                      className={hexView ? '' : 'is-on'}
                      aria-pressed={!hexView}
                      onClick={() => setHexView(false)}
                    >
                      文本
                    </button>
                    <button
                      type="button"
                      className={hexView ? 'is-on' : ''}
                      aria-pressed={hexView}
                      onClick={() => setHexView(true)}
                    >
                      HEX
                    </button>
                  </div>
                  <button
                    type="button"
                    className="icon-btn mini"
                    onClick={clearLog}
                    disabled={!activeLog.length}
                    title="清空收发记录"
                    aria-label="清空收发记录"
                  >
                    <Icon name="broom" size={13} />
                  </button>
                </div>
              </div>

              <div
                className="virtual-log"
                ref={logRef}
                onScroll={onLogScroll}
                role="log"
                aria-live="off"
                aria-label="收发记录"
              >
                {!activePort ? (
                  <div className="virtual-empty is-log">
                    <span className="virtual-empty-icon">
                      <Icon name="plug" size={17} />
                    </span>
                    <strong>还没有虚拟串口</strong>
                    <p>先在左侧新建一个虚拟串口。</p>
                  </div>
                ) : activeLog.length === 0 ? (
                  <div className="virtual-empty is-log">
                    <span className="virtual-empty-icon">
                      <Icon name="terminal" size={17} />
                    </span>
                    <strong>还没有收发数据</strong>
                    <p>
                      用第三方工具打开 {activeRuntime.externalPath || '左侧端口'}
                      ，这里会实时显示。
                    </p>
                  </div>
                ) : (
                  activeLog.map((entry) => (
                    <div
                      className={`virtual-log-row is-${entry.direction}`}
                      key={entry.id}
                    >
                      <time className="virtual-log-time">
                        {formatTime(entry.at)}
                      </time>
                      <span
                        className={`virtual-log-dir is-${entry.direction}`}
                      >
                        {entry.direction === 'rx' ? '收' : '回'}
                      </span>
                      <code>
                        {hexView
                          ? entry.hex
                          : entry.text.replace(/\r/g, '␍').replace(/\n/g, '␊')}
                      </code>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      {uninstallOpen ? (
        <Modal
          title="卸载 com0com"
          width={440}
          tone="danger"
          icon={<Icon name="trash" size={15} />}
          onClose={() => {
            if (uninstallBusy) return;
            setUninstallOpen(false);
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
                  disabled={uninstallBusy}
                  onClick={async () => {
                    setUninstallBusy(true);
                    setUninstallResult('');
                    const result =
                      await window.terminalAPI?.virtual
                        ?.uninstallCom0com?.()
                        ?.catch?.((error) => ({
                          ok: false,
                          error: error?.message || String(error)
                        }));
                    setUninstallBusy(false);
                    if (result?.ok) {
                      clearAllPorts();
                      setUninstallResult(
                        'com0com 已卸载。请重启电脑后再重新创建虚拟串口。'
                      );
                    } else {
                      setUninstallResult(
                        result?.error || '卸载 com0com 失败'
                      );
                    }
                  }}
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
            <>
              <p className="virtual-confirm-text">
                将卸载 com0com 驱动，并关闭当前所有虚拟串口。系统中由 com0com 创建的 COM 端口对也会一并移除。
              </p>
              <p className="virtual-confirm-note">
                卸载需要管理员权限，完成后通常需要重启电脑。若其他程序仍在使用这些虚拟端口，请先关闭它们。
              </p>
            </>
          )}
        </Modal>
      ) : null}

      {clearAllOpen ? (
        <Modal
          title="清空所有虚拟串口"
          width={420}
          tone="danger"
          icon={<Icon name="trash" size={15} />}
          onClose={() => setClearAllOpen(false)}
          footer={
            <>
              <button
                type="button"
                className="soft-btn"
                onClick={() => setClearAllOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="danger-btn"
                disabled={clearBusy || adminBlocked}
                onClick={clearAllPorts}
              >
                {clearBusy ? '正在清空…' : '清空'}
              </button>
            </>
          }
        >
          <p className="virtual-confirm-text">
            将关闭当前页面的 {ports.length} 个虚拟串口，并删除它们的自动回复规则和收发记录。
          </p>
          {platform === 'win32' ? (
            <p className="virtual-confirm-note">
              会同时从 com0com 删除这些虚拟串口对应的 COM 端口对。
            </p>
          ) : null}
          {adminRequired ? (
            <p className="virtual-confirm-note is-danger">
              需要管理员权限。请关闭应用，右键 Weft Terminal →「以管理员身份运行」后再清空。
            </p>
          ) : null}
          {clearError ? (
            <p className="virtual-confirm-note is-danger">{clearError}</p>
          ) : null}
        </Modal>
      ) : null}

      {deletePort ? (
        <Modal
          title="删除虚拟串口"
          width={380}
          tone="danger"
          icon={<Icon name="trash" size={15} />}
          onClose={() => setDeleteTarget('')}
          footer={
            <>
              <button
                type="button"
                className="soft-btn"
                onClick={() => setDeleteTarget('')}
              >
                取消
              </button>
              <button
                type="button"
                className="danger-btn"
                disabled={deleteBusy || adminBlocked}
                onClick={() => removePort(deletePort.id)}
              >
                {deleteBusy ? '正在删除…' : '删除'}
              </button>
            </>
          }
        >
          <p className="virtual-confirm-text">
            将关闭 <code>{deletePath}</code>，并删除它的自动回复规则。
          </p>
          {platform === 'win32' ? (
            <p className="virtual-confirm-note">
              同时会从 com0com 删除这对 COM 端口，其他程序将无法再打开它们。
            </p>
          ) : null}
          {adminRequired ? (
            <p className="virtual-confirm-note is-danger">
              需要管理员权限。请关闭应用，右键 Weft Terminal →「以管理员身份运行」后再删除。
            </p>
          ) : null}
          {deleteError ? (
            <p className="virtual-confirm-note is-danger">{deleteError}</p>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
