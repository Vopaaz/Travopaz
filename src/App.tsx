import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Compass,
  Download,
  FileJson,
  FolderOpen,
  Grid2X2,
  Hotel,
  Layers,
  List,
  LoaderCircle,
  MapPin,
  Moon,
  Plus,
  Redo2,
  RefreshCw,
  Search,
  Settings2,
  Undo2,
  Upload,
  Plane,
  AlertTriangle,
  ArrowUpRight,
  FileText,
  PanelRight,
  Car,
  X,
} from 'lucide-react';
import { DateTime } from 'luxon';
import { session } from './storage/session';
import { download, getBrowser, makeBundle, readBundle, recentBrowser } from './storage/browser';
import { aiContext, aiReadme, humanItinerary } from './storage/exports';
import { createDemo } from './domain/factory';
import { emptyMetadata, uid } from './domain/schema';
import { at, daysBetween, formatTime, ms, shiftTime } from './domain/time';
import { allConcrete, findBlock, removeBlocks, wrapOption } from './domain/operations';
import { DetailPanel } from './ui/DetailPanel';
import { CreateDialog } from './ui/CreateDialog';
import { NewTripDialog } from './ui/NewTripDialog';
import { GlobalSettingsDialog } from './ui/GlobalSettingsDialog';
import { Modal, TextField, TimeField, Field } from './ui/fields';
import { Timeline, Calendar } from './ui/Timeline';
import { useDerived } from './ui/useDerived';
import type { Focus } from './ui/types';
import './styles.css';

export default function App() {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot),
    w = state.workspace;
  const [focus, setFocus] = useState<Focus>(null),
    [selected, setSelected] = useState<string[]>([]),
    [view, setView] = useState<'timeline' | 'calendar'>('timeline');
  const [zone, setZone] = useState(w.trip.primaryTimezone),
    [zoom, setZoom] = useState(0.8),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all');
  const [dialog, setDialog] = useState<
      'create' | 'new' | 'export' | 'help' | 'workspaces' | 'rest' | 'globalSettings' | null
    >(null),
    [menu, setMenu] = useState(false),
    [addMenu, setAddMenu] = useState(false);
  const [message, setMessage] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [recent, setRecent] = useState<{ id: string; name: string }[]>([]);
  const [jumpDay, setJumpDay] = useState<string | null>(null),
    [jumpTarget, setJumpTarget] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null),
    previousWorkspace = useRef('');
  const { derived, busy: routingBusy, configured, refresh } = useDerived(w);
  const displayZone = w.trip.timezones.includes(zone) ? zone : w.trip.primaryTimezone;
  useEffect(() => {
    void session.initialize();
  }, []);
  useEffect(() => {
    if (previousWorkspace.current !== w.id) {
      previousWorkspace.current = w.id;
      setZone(w.trip.primaryTimezone);
      setSelected([]);
      setFocus(null);
    }
  }, [w.id, w.trip.primaryTimezone]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const input = (e.target as HTMLElement).closest(
        'input, textarea, select, [contenteditable="true"]',
      );
      if (input) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) session.redo();
        else session.undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        session.redo();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
        e.preventDefault();
        session.edit((d) => removeBlocks(d, selected));
        setSelected([]);
        setFocus(null);
      }
      if (e.key === 'Escape') {
        setSelected([]);
        setMenu(false);
        setAddMenu(false);
        setDialog(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected]);
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (state.saving) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [state.saving]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const errors = derived.issues.filter((i) => i.severity === 'error').length,
    warnings = derived.issues.filter((i) => i.severity === 'warning').length;
  const placed = new Set(
    allConcrete(w)
      .filter((b) => b.kind === 'candidate')
      .map((b) => b.candidateId),
  );
  const candidates = w.candidates.filter(
    (c) =>
      (filter === 'all' || filter === 'unplaced'
        ? filter !== 'unplaced' || !placed.has(c.id)
        : c.kind === filter) &&
      `${c.title} ${c.metadata.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase()),
  );
  const setInspect = (next: Focus) => {
    setFocus(next);
    if (next?.kind === 'block') setSelected([next.id]);
  };
  const newOption = () => {
    let id = '';
    session.edit((d) => {
      id = wrapOption(d, selected).id;
    });
    setSelected([id]);
    setFocus({ kind: 'block', id });
    setAddMenu(false);
  };
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">
            <Compass size={24} strokeWidth={1.5} />
          </span>
          <span>
            travopaz<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="header-divider" />
        <span className="header-caption">把期待，安放在旅途里。</span>
        <div className="header-actions">
          <span className={`save-status ${state.error ? 'error-text' : ''}`}>
            {state.loading || state.saving ? (
              <LoaderCircle className="spin" size={13} />
            ) : state.error ? (
              <AlertTriangle size={13} />
            ) : (
              <Check size={13} />
            )}
            {state.loading
              ? '正在读取'
              : state.error
                ? '保存需处理'
                : state.saving
                  ? '正在保存'
                  : '已保存到本机'}
          </span>
          <button
            className="icon-button"
            title="使用说明"
            aria-label="使用说明"
            onClick={() => setDialog('help')}
          >
            <CircleHelp size={18} />
          </button>
          <div className="menu-anchor">
            <button className="button compact" onClick={() => setMenu(!menu)}>
              <FolderOpen size={15} />
              工作区
              <ChevronDown size={13} />
            </button>
            {menu && (
              <div className="dropdown-menu">
                <button
                  onClick={() => {
                    setDialog('new');
                    setMenu(false);
                  }}
                >
                  <Plus size={15} />
                  新建旅行
                </button>
                <button
                  onClick={() => {
                    void run(async () => {
                      setRecent(await recentBrowser());
                      setDialog('workspaces');
                    });
                    setMenu(false);
                  }}
                >
                  <FolderOpen size={15} />
                  最近的浏览器工作区
                </button>
                <button
                  onClick={() => {
                    fileInput.current?.click();
                    setMenu(false);
                  }}
                >
                  <Upload size={15} />
                  导入 Workspace
                </button>
                <button
                  onClick={() => {
                    void run(async () => {
                      download(
                        `${w.trip.name}.travopaz.zip`,
                        await makeBundle(w, session.readAttachment),
                      );
                    });
                    setMenu(false);
                  }}
                >
                  <Download size={15} />
                  导出 Workspace
                </button>
                {window.desktop && (
                  <>
                    <hr />
                    <button
                      onClick={() => {
                        void run(() => session.openDesktop());
                        setMenu(false);
                      }}
                    >
                      打开本地文件夹
                    </button>
                    <button
                      onClick={() => {
                        void run(() => session.saveAsDesktop());
                        setMenu(false);
                      }}
                    >
                      保存为本地工作区
                    </button>
                  </>
                )}
                <hr />
                <button
                  onClick={() => {
                    void run(() => session.replaceBrowser(createDemo()));
                    setMenu(false);
                  }}
                >
                  新建京都演示工作区
                </button>
              </div>
            )}
          </div>
          <button className="button compact" onClick={() => setDialog('globalSettings')}>
            <Settings2 size={15} />
            全局设置
          </button>
          <button className="button primary compact" onClick={() => setDialog('export')}>
            <ArrowUpRight size={15} />
            导出行程
          </button>
        </div>
      </header>
      <input
        type="file"
        ref={fileInput}
        accept=".zip,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file)
            void run(async () => {
              const bundle = await readBundle(file);
              await session.replaceBrowser(bundle.workspace, bundle.blobs);
              setMessage('工作区已导入，附件已复制到本机存储。');
            });
          e.target.value = '';
        }}
      />
      {(state.error || state.notice || message) && (
        <div className={`global-banner ${state.error ? 'error' : ''}`}>
          <AlertTriangle size={16} />
          <span>
            {state.error || message || state.notice}
            {state.error &&
              ' 当前可见数据保留。可以导出 Workspace 备份；外部文件无效时不会写回旧状态。'}
          </span>
          <button
            className="icon-button"
            title="关闭提示"
            onClick={() => {
              setMessage(null);
              session.clearNotice();
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <section className="trip-heading">
        <div>
          <div className="trip-kicker">
            <span className="tiny-dot" />
            我的旅行工作台 <span className="slash">/</span>{' '}
            {state.directory ? '本地文件夹' : '浏览器工作区'}
          </div>
          <h1>
            {w.trip.name}
            <button
              className="icon-button"
              title="编辑旅行设置"
              aria-label="编辑旅行设置"
              onClick={() => setFocus({ kind: 'trip' })}
            >
              <Settings2 size={17} />
            </button>
          </h1>
          <div className="trip-meta">
            <span>
              <CalendarDays size={14} />
              {formatTime(w.trip.displayStart, displayZone, 'yyyy.MM.dd')} —{' '}
              {formatTime(w.trip.displayEnd, displayZone, 'MM.dd')}
            </span>
            <span>
              <MapPin size={14} />
              {w.trip.startLocation.name || '设置旅行起点'} →{' '}
              {w.trip.endLocation.name || '设置旅行终点'}
            </span>
            <span className="pill neutral">
              {daysBetween(w.trip.displayStart, w.trip.displayEnd, displayZone).length} 天
            </span>
          </div>
        </div>
        <div className="trip-summary">
          <span className="summary-caption">你的安排，你来决定</span>
          <button
            className={`issue-chip ${errors ? 'error' : ''}`}
            onClick={() => setFocus({ kind: 'issues' })}
          >
            {errors ? <AlertTriangle size={15} /> : <Check size={15} />}
            {errors} 项冲突 <span>·</span> {warnings} 项待确认
          </button>
        </div>
      </section>
      <main className="workbench">
        <aside className="library-panel">
          <header className="panel-heading">
            <div>
              <span className="eyebrow">COLLECTION</span>
              <h3>
                候选库 <span className="count">{w.candidates.length}</span>
              </h3>
            </div>
            <button
              className="add-square"
              aria-label="添加候选项目"
              onClick={() => setDialog('create')}
            >
              <Plus size={19} />
            </button>
          </header>
          <div className="library-controls">
            <label className="search-box">
              <Search size={15} />
              <input
                placeholder="搜索地点、活动、标签…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="library-tabs">
              {[
                ['all', '全部'],
                ['activity', '活动'],
                ['transport', '交通'],
                ['boundary', '状态'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={filter === key ? 'active' : ''}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              className={`unplaced-filter ${filter === 'unplaced' ? 'active' : ''}`}
              onClick={() => setFilter(filter === 'unplaced' ? 'all' : 'unplaced')}
            >
              只看尚未安排 <span>{w.candidates.filter((c) => !placed.has(c.id)).length}</span>
            </button>
          </div>
          <div className="candidate-list">
            {candidates.map((c) => {
              const Icon =
                c.kind === 'transport'
                  ? Plane
                  : c.kind === 'boundary'
                    ? w.statuses.find((s) => s.id === c.statusId)?.kind === 'rentalCar'
                      ? Car
                      : Hotel
                    : MapPin;
              const location =
                c.kind === 'transport'
                  ? `${c.origin.name} → ${c.destination.name}`
                  : c.location.name;
              return (
                <button
                  className={`candidate-card ${c.kind} ${focus?.kind === 'candidate' && focus.id === c.id ? 'active' : ''}`}
                  key={c.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('candidate', c.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => setInspect({ kind: 'candidate', id: c.id })}
                >
                  <div className="candidate-icon">
                    <Icon size={16} />
                  </div>
                  <div className="candidate-info">
                    <strong>{c.title || '未命名项目'}</strong>
                    <small>{location || '地点待填写'}</small>
                    <div className="candidate-tags">
                      <span>
                        {c.kind === 'activity'
                          ? '活动'
                          : c.kind === 'transport'
                            ? '主要交通'
                            : c.role === 'start'
                              ? '开始边界'
                              : '结束边界'}
                      </span>
                      {placed.has(c.id) && (
                        <span className="placed">
                          <Check size={10} />
                          已安排
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
            {!candidates.length && (
              <div className="library-empty">
                <MapPin size={24} />
                <p>{search ? '没有找到匹配的项目' : '收藏下一段旅途的灵感'}</p>
                <button className="text-button" onClick={() => setDialog('create')}>
                  添加候选项目
                </button>
              </div>
            )}
          </div>
          <footer className="library-footer">
            <div className="drag-symbol">↗</div>
            <p>
              拖入右侧时间轴
              <br />
              <span>把想去的地方变成计划</span>
            </p>
          </footer>
        </aside>
        <section className="main-panel">
          <div className="view-toolbar">
            <div className="view-switch">
              <button
                className={view === 'timeline' ? 'active' : ''}
                onClick={() => setView('timeline')}
              >
                <List size={15} />
                时间轴
              </button>
              <button
                className={view === 'calendar' ? 'active' : ''}
                onClick={() => setView('calendar')}
              >
                <Grid2X2 size={14} />
                日历总览
              </button>
            </div>
            <div className="toolbar-spacer" />
            <button
              className="icon-button"
              title="撤销 Ctrl/⌘+Z"
              aria-label="撤销"
              disabled={!state.canUndo}
              onClick={() => session.undo()}
            >
              <Undo2 size={16} />
            </button>
            <button
              className="icon-button"
              title="重做 Ctrl/⌘+Shift+Z"
              aria-label="重做"
              disabled={!state.canRedo}
              onClick={() => session.redo()}
            >
              <Redo2 size={16} />
            </button>
            <span className="toolbar-separator" />
            <select
              className="timezone-select"
              aria-label="显示时区"
              value={displayZone}
              onChange={(e) => setZone(e.target.value)}
            >
              {w.trip.timezones.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
            <div className="menu-anchor">
              <button className="button compact" onClick={() => setAddMenu(!addMenu)}>
                <Plus size={14} />
                添加
              </button>
              {addMenu && (
                <div className="dropdown-menu right">
                  <button onClick={newOption}>
                    <Layers size={14} />
                    {selected.length ? '用选中项目创建 Option' : '创建 Option'}
                  </button>
                  <button
                    onClick={() => {
                      setDialog('rest');
                      setAddMenu(false);
                    }}
                  >
                    <Moon size={14} />
                    酒店休息
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="timeline-subtoolbar">
            <div className="legend">
              <span>
                <i className="activity-dot" />
                活动
              </span>
              <span>
                <i className="transport-dot" />
                交通
              </span>
              <span>
                <i className="boundary-dot" />
                状态
              </span>
              <span>
                <i className="derived-dot" />
                系统推导
              </span>
            </div>
            <div className="zoom-control">
              <button title="缩小时间轴" onClick={() => setZoom(Math.max(0.3, zoom / 1.25))}>
                −
              </button>
              <span>{Math.round((zoom / 0.8) * 100)}%</span>
              <button title="放大时间轴" onClick={() => setZoom(Math.min(3, zoom * 1.25))}>
                ＋
              </button>
            </div>
          </div>
          {view === 'timeline' ? (
            <Timeline
              w={w}
              derived={derived}
              zone={displayZone}
              zoom={zoom}
              setZoom={setZoom}
              selected={selected}
              setSelected={setSelected}
              setFocus={setFocus}
              jumpDay={jumpDay}
              jumpTarget={jumpTarget}
            />
          ) : (
            <Calendar
              w={w}
              derived={derived}
              zone={displayZone}
              setFocus={setInspect}
              onDay={(date) => {
                setView('timeline');
                setJumpDay(date);
              }}
            />
          )}
          <footer className="timeline-footer">
            <span>
              <span className="tiny-dot" />
              {allConcrete(w).length} 个实际项目 · {derived.edges.length} 条路线
            </span>
            <button
              className="text-button"
              onClick={() => {
                refresh();
                setMessage(
                  configured
                    ? '正在重新查询非实时路线。'
                    : '尚未配置 Google Routes Key。可先测试编辑，配置步骤见右上角“全局设置”。',
                );
              }}
            >
              <RefreshCw size={12} className={routingBusy ? 'spin' : ''} />
              {routingBusy ? '正在查询路线' : configured ? '重新查询路线' : '路线未配置'}
            </button>
          </footer>
        </section>
        <DetailPanel
          w={w}
          derived={derived}
          focus={focus}
          setFocus={(f) => {
            setInspect(f);
            if (f?.kind === 'block') {
              setJumpTarget(null);
              requestAnimationFrame(() => setJumpTarget(f.id));
            }
          }}
          displayZone={displayZone}
          selected={selected}
        />
      </main>
      {busy && (
        <div className="busy-overlay">
          <LoaderCircle className="spin" size={22} />
          正在处理文件…
        </div>
      )}
      {dialog === 'create' && (
        <CreateDialog workspace={w} onClose={() => setDialog(null)} onFocus={setInspect} />
      )}
      {dialog === 'new' && (
        <NewTripDialog
          globalConfig={w.globalConfig}
          onClose={() => setDialog(null)}
          onCreate={(workspace) => {
            void run(async () => {
              await session.replaceBrowser(workspace);
              setDialog(null);
            });
          }}
        />
      )}
      {dialog === 'rest' && <RestDialog onClose={() => setDialog(null)} onFocus={setInspect} />}
      {dialog === 'globalSettings' && (
        <GlobalSettingsDialog w={w} onClose={() => setDialog(null)} />
      )}
      {dialog === 'workspaces' && (
        <Modal title="最近的浏览器工作区" onClose={() => setDialog(null)}>
          <div className="modal-body">
            {recent.map((r) => (
              <button
                className="workspace-choice"
                key={r.id}
                onClick={() => {
                  void run(async () => {
                    await session.replaceBrowser(await getBrowser(r.id));
                    setDialog(null);
                  });
                }}
              >
                <FolderOpen size={18} />
                {r.name}
                {r.id === w.id && <span className="pill">当前</span>}
              </button>
            ))}
            <p className="hint">工作区存放在当前浏览器的本地存储中。可导出完整 ZIP 备份或迁移。</p>
          </div>
        </Modal>
      )}
      {dialog === 'export' && (
        <Modal title="带上你的旅行计划" onClose={() => setDialog(null)}>
          <div className="modal-body">
            <p className="hint">
              当前仍有 {errors} 项冲突与 {warnings} 项待确认。导出会保留并标记这些问题。
            </p>
            <button
              className="export-choice"
              onClick={() =>
                void run(async () => {
                  download(
                    `${w.trip.name}-行程.zip`,
                    await humanItinerary(w, derived, displayZone, session.readAttachment),
                  );
                })
              }
            >
              <FileText size={26} />
              <span>
                <strong>人类可读行程</strong>
                <small>按日期排列的 HTML 文档 + 附件，解压即可阅读或打印为 PDF。</small>
              </span>
              <Download size={18} />
            </button>
            <button
              className="export-choice"
              onClick={() => {
                download(
                  'itinerary-context.json',
                  new Blob([JSON.stringify(aiContext(w, derived, displayZone), null, 2)], {
                    type: 'application/json;charset=utf-8',
                  }),
                );
              }}
            >
              <FileJson size={26} />
              <span>
                <strong>AI Context · 明文 JSON</strong>
                <small>完整行程、方案、预订与派生信息。直接上传给聊天 AI，无需解压。</small>
              </span>
              <Download size={18} />
            </button>
            <button
              className="export-choice"
              onClick={() =>
                download(
                  'AI-旅行背景说明.md',
                  new Blob([aiReadme(w, derived, displayZone)], {
                    type: 'text/markdown;charset=utf-8',
                  }),
                )
              }
            >
              <FileText size={26} />
              <span>
                <strong>AI Context · 使用说明</strong>
                <small>可与 JSON 一同上传的简短背景说明。</small>
              </span>
              <Download size={18} />
            </button>
            {!!w.attachments.length && (
              <section className="detail-section">
                <strong>相关附件（单独下载给 AI）</strong>
                {w.attachments.map((a) => (
                  <button
                    className="variant-item"
                    key={a.id}
                    onClick={() =>
                      void run(async () =>
                        download(`${a.id}-${a.name}`, await session.readAttachment(a.path)),
                      )
                    }
                  >
                    {a.name}
                    <Download size={14} />
                  </button>
                ))}
              </section>
            )}
            <p className="hint">如需继续编辑或迁移，使用右上角“工作区 → 导出 Workspace”。</p>
          </div>
        </Modal>
      )}
      {dialog === 'help' && (
        <Modal title="使用 Travopaz" onClose={() => setDialog(null)}>
          <div className="modal-body help-copy">
            <h3>先收集，再安排</h3>
            <p>
              在候选库创建活动、主要交通或酒店／租车的状态边界。拖到时间轴后，在详情面板分别编辑
              Definition 与 Placement。
            </p>
            <h3>你掌握每一分钟</h3>
            <p>
              拖动整个项目移动时间，拖动上下边缘 Resize；跨日拖动有效。空白处框选，Shift／Ctrl／⌘
              增减选择，再拖动即可批量移动。默认吸附 5 分钟，按住 Alt 精确到 1 分钟。
            </p>
            <p>
              Ctrl + 滚轮缩放。Ctrl／⌘ + Z 撤销，Shift + Z 或 Ctrl + Y 重做。Delete
              只移除安排，保留候选定义。
            </p>
            <h3>Option 与状态</h3>
            <p>
              选中项目后从“添加”创建
              Option。各方案分别编辑时间，外框自动包住全部内容。所有方案均参与检查；只保留一个时可解除包装。
            </p>
            <p>
              酒店／租车需要将开始、结束两个 Boundary
              都放入时间轴。左侧纵向状态条与时间成比例对齐。住宿检查点可在旅行设置中增删；红眼航班跨过检查点时需要手动调整或删除检查点。
            </p>
            <h3>保存与文件</h3>
            <p>
              浏览器自动保存到当前浏览器的 IndexedDB。Workspace ZIP
              包括定义、安排和附件，可完整恢复。Electron 可直接打开本地文件夹并监听
              workspace.json。路线 Key 的官方配置说明在 docs/GOOGLE_MAPS_SETUP.md。
            </p>
            <p>系统只进行检查与推导，不会改变你的任何 Placement。</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RestDialog({ onClose, onFocus }: { onClose: () => void; onFocus: (f: Focus) => void }) {
  const w = session.getSnapshot().workspace;
  const [title, setTitle] = useState('在酒店休息'),
    [start, setStart] = useState(shiftTime(w.trip.displayStart, 8 * 60)),
    [end, setEnd] = useState(shiftTime(w.trip.displayStart, 9 * 60));
  return (
    <Modal title="安排酒店休息" onClose={onClose}>
      <div className="modal-body">
        <TextField label="标题" value={title} onChange={setTitle} />
        <TimeField label="休息开始" value={start} zones={w.trip.timezones} onChange={setStart} />
        <TimeField label="休息结束" value={end} zones={w.trip.timezones} onChange={setEnd} />
        <p className="hint">
          地点由覆盖整个时段的酒店状态推导。无酒店覆盖时仍可保留安排，系统会提示冲突。
        </p>
      </div>
      <footer>
        <button className="button" onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          onClick={() => {
            const id = uid();
            session.edit((d) =>
              d.blocks.push({
                id,
                kind: 'hotelRest',
                title,
                start,
                end,
                metadata: emptyMetadata(),
              }),
            );
            onFocus({ kind: 'block', id });
            onClose();
          }}
        >
          添加安排
        </button>
      </footer>
    </Modal>
  );
}
