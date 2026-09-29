import {
  Plus,
  Trash2,
  X,
  SlidersHorizontal,
  AlertTriangle,
  ArrowUpRight,
  Layers,
  MapPin,
} from 'lucide-react';
import { useState } from 'react';
import {
  emptyMetadata,
  uid,
  effectiveConfig,
  type Workspace,
  type Candidate,
  type Metadata,
  type Attachment,
  type Mode,
  type ConcreteBlock,
  type OptionBlock,
} from '../domain/schema';
import { at, formatDuration, formatTime, ms, shiftTime } from '../domain/time';
import {
  bounds,
  blockTitle,
  findBlock,
  removeBlocks,
  unwrapOption,
  moveBlocks,
} from '../domain/operations';
import { placeCandidate } from '../domain/factory';
import type { Derived, Edge, Issue } from '../domain/derive';
import { session } from '../storage/session';
import { Field, LocationFields, NumberField, TextField, TimeField } from './fields';
import { MetadataFields } from './MetadataFields';
import { TimezoneFields } from './TimezoneFields';
import { PlanningConfigFields } from './PlanningConfigFields';
import type { Focus } from './types';
import { modeLabel } from '../domain/routing';

const labels = {
  activity: '活动',
  transport: '主要交通',
  boundary: '状态边界',
  hotelRest: '酒店休息',
  option: '备选方案',
};
export function IssueList({
  issues,
  onFocus,
}: {
  issues: Issue[];
  onFocus?: (id: string) => void;
}) {
  return (
    <div className="issues-list">
      {issues.map((i) => (
        <button
          key={i.id}
          className={`issue-item ${i.severity}`}
          onClick={() =>
            onFocus?.(i.targetIds.find((t) => !t.startsWith('edge:')) ?? i.targetIds[0])
          }
        >
          <AlertTriangle size={15} />
          <span>
            <strong>
              {i.severity === 'error' ? '冲突' : i.severity === 'warning' ? '待确认' : '提示'}
            </strong>
            {i.message}
            {!!i.contexts.length && <small>{i.contexts.join('；')}</small>}
          </span>
        </button>
      ))}
    </div>
  );
}

function CandidateFields({ candidate: c, w }: { candidate: Candidate; w: Workspace }) {
  const update = (patch: Partial<Candidate>) =>
    session.edit((d) => {
      const target = d.candidates.find((x) => x.id === c.id)!;
      Object.assign(target, patch);
    });
  const metadata = (m: Metadata, a?: Attachment) =>
    session.edit((d) => {
      d.candidates.find((x) => x.id === c.id)!.metadata = m;
      if (a) d.attachments.push(a);
    });
  const zones = w.trip.timezones;
  return (
    <>
      <div className="section-label">
        Definition <span className="pill neutral">{labels[c.kind]}</span>
      </div>
      <TextField label="名称" value={c.title} onChange={(title) => update({ title })} />
      {c.kind === 'transport' ? (
        <>
          <Field label="类型">
            <select
              value={c.subtype}
              onChange={(e) => update({ subtype: e.target.value as typeof c.subtype })}
            >
              <option value="flight">航班</option>
              <option value="train">火车</option>
              <option value="ferry">渡轮</option>
              <option value="bus">城际巴士</option>
              <option value="other">其他</option>
            </select>
          </Field>
          <LocationFields value={c.origin} onChange={(origin) => update({ origin })} label="出发" />
          <LocationFields
            value={c.destination}
            onChange={(destination) => update({ destination })}
            label="到达"
          />
          <TimeField
            label="Scheduled Departure"
            value={c.departure}
            zones={zones}
            onChange={(departure) => update({ departure })}
          />
          <TimeField
            label="Scheduled Arrival"
            value={c.arrival}
            zones={zones}
            onChange={(arrival) => update({ arrival })}
          />
          <div className="field-row">
            <NumberField
              label="出发前缓冲 / 分钟"
              value={c.preBuffer}
              onChange={(n) => update({ preBuffer: n ?? 0 })}
            />
            <NumberField
              label="到达后缓冲 / 分钟"
              value={c.postBuffer}
              onChange={(n) => update({ postBuffer: n ?? 0 })}
            />
          </div>
          <TextField
            label="运营方"
            value={c.operator}
            onChange={(operator) => update({ operator })}
          />
          <TextField
            label="航班／车次号"
            value={c.serviceNumber}
            onChange={(serviceNumber) => update({ serviceNumber })}
          />
        </>
      ) : (
        <LocationFields
          value={c.location}
          onChange={(location) => update({ location })}
          preference={effectiveConfig(w).navigation}
        />
      )}
      {c.kind === 'activity' && (
        <section className="detail-section">
          <div className="section-label">Placement 约束</div>
          <p className="hint">时间区间与时长独立检查；多个区间满足其一即可。</p>
          <div className="field-row">
            <NumberField
              label="最短 / 分钟"
              value={c.constraints.minMinutes}
              nullable
              onChange={(minMinutes) => update({ constraints: { ...c.constraints, minMinutes } })}
            />
            <NumberField
              label="最长 / 分钟"
              value={c.constraints.maxMinutes}
              nullable
              onChange={(maxMinutes) => update({ constraints: { ...c.constraints, maxMinutes } })}
            />
          </div>
          {c.constraints.intervals.map((interval, i) => (
            <div className="constraint-box" key={i}>
              <Field label={`区间 ${i + 1} 关系`}>
                <select
                  value={interval.relation}
                  onChange={(e) =>
                    update({
                      constraints: {
                        ...c.constraints,
                        intervals: c.constraints.intervals.map((r, j) =>
                          j === i ? { ...r, relation: e.target.value as 'within' | 'covers' } : r,
                        ),
                      },
                    })
                  }
                >
                  <option value="within">Placement 必须被区间包含</option>
                  <option value="covers">Placement 必须完整覆盖区间</option>
                </select>
              </Field>
              <TimeField
                label={`区间 ${i + 1} 开始`}
                value={interval.start}
                zones={zones}
                onChange={(start) =>
                  update({
                    constraints: {
                      ...c.constraints,
                      intervals: c.constraints.intervals.map((r, j) =>
                        j === i ? { ...r, start } : r,
                      ),
                    },
                  })
                }
              />
              <TimeField
                label={`区间 ${i + 1} 结束`}
                value={interval.end}
                zones={zones}
                onChange={(end) =>
                  update({
                    constraints: {
                      ...c.constraints,
                      intervals: c.constraints.intervals.map((r, j) =>
                        j === i ? { ...r, end } : r,
                      ),
                    },
                  })
                }
              />
              <button
                className="text-button danger"
                onClick={() =>
                  update({
                    constraints: {
                      ...c.constraints,
                      intervals: c.constraints.intervals.filter((_, j) => j !== i),
                    },
                  })
                }
              >
                删除此区间
              </button>
            </div>
          ))}
          <button
            className="button compact full"
            onClick={() =>
              update({
                constraints: {
                  ...c.constraints,
                  intervals: [
                    ...c.constraints.intervals,
                    {
                      relation: 'within',
                      start: shiftTime(w.trip.displayStart, 540),
                      end: shiftTime(w.trip.displayStart, 1020),
                    },
                  ],
                },
              })
            }
          >
            <Plus size={14} />
            添加合法区间
          </button>
        </section>
      )}
      {c.kind === 'boundary' && (
        <section className="detail-section">
          <Field label="状态实例">
            <select value={c.statusId} onChange={(e) => update({ statusId: e.target.value })}>
              {w.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {s.kind === 'hotel' ? '酒店' : '租车'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="边界角色">
            <select
              value={c.role}
              onChange={(e) => update({ role: e.target.value as 'start' | 'end' })}
            >
              <option value="start">开始（入住／取车）</option>
              <option value="end">结束（退房／还车）</option>
            </select>
          </Field>
          <TimeField
            label="初始 Placement 开始"
            value={c.defaultStart}
            zones={zones}
            onChange={(defaultStart) => update({ defaultStart })}
          />
          <TimeField
            label="初始 Placement 结束"
            value={c.defaultEnd}
            zones={zones}
            onChange={(defaultEnd) => update({ defaultEnd })}
          />
          <p className="hint">状态从开始 Boundary 的 end 生效，到结束 Boundary 的 start 失效。</p>
        </section>
      )}
      <MetadataFields value={c.metadata} workspace={w} onChange={metadata} />
    </>
  );
}

function OptionFields({
  option,
  w,
  setFocus,
}: {
  option: OptionBlock;
  w: Workspace;
  setFocus: (f: Focus) => void;
}) {
  const [candidateId, setCandidateId] = useState(w.candidates[0]?.id ?? '');
  const update = (fn: (o: OptionBlock) => void) =>
    session.edit((d) => fn(d.blocks.find((b) => b.id === option.id) as OptionBlock));
  return (
    <>
      <TextField
        label="Option 名称"
        value={option.title}
        onChange={(title) =>
          update((o) => {
            o.title = title;
          })
        }
      />
      <p className="hint">所有方案都参与检查。外框由内部项目决定，整体拖动会同步平移所有方案。</p>
      {option.variants.map((v, index) => (
        <section key={v.id} className="variant-editor">
          <TextField
            label={`方案 ${index + 1} 名称`}
            value={v.title}
            onChange={(title) =>
              update((o) => {
                o.variants[index].title = title;
              })
            }
          />
          {v.blocks.map((b) => (
            <button
              className="variant-item"
              key={b.id}
              onClick={() => setFocus({ kind: 'block', id: b.id })}
            >
              <span>{blockTitle(w, b)}</span>
              <small>{formatTime(b.start, w.trip.primaryTimezone, 'MM/dd HH:mm')}</small>
              <ArrowUpRight size={14} />
            </button>
          ))}
          <Field label="加入已有 Candidate">
            <select value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
              <option value="">请选择</option>
              {w.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </Field>
          <div className="button-row">
            <button
              className="button compact"
              disabled={!candidateId}
              onClick={() => {
                const c = w.candidates.find((c) => c.id === candidateId);
                if (c)
                  update((o) =>
                    o.variants[index].blocks.push(
                      placeCandidate(
                        c,
                        bounds(option)?.start ?? ms(w.trip.displayStart) + 9 * 3600000,
                        w.trip.primaryTimezone,
                      ),
                    ),
                  );
              }}
            >
              <Plus size={14} />
              加入方案
            </button>
            <button
              className="text-button danger"
              onClick={() =>
                update((o) => {
                  o.variants.splice(index, 1);
                })
              }
            >
              删除方案
            </button>
          </div>
        </section>
      ))}
      <button
        className="button full"
        onClick={() =>
          update((o) =>
            o.variants.push({ id: uid(), title: `方案 ${o.variants.length + 1}`, blocks: [] }),
          )
        }
      >
        <Plus size={14} />
        添加方案
      </button>
      <button
        className="button full"
        disabled={option.variants.length !== 1}
        onClick={() => {
          session.edit((d) => unwrapOption(d, option.id));
          setFocus(null);
        }}
      >
        <Layers size={14} />
        解除 Option 包装
      </button>
      <p className="hint">仅剩一个方案时可将内部项目归并到主 Timeline。</p>
      <MetadataFields
        value={option.metadata}
        workspace={w}
        onChange={(metadata, a) =>
          session.edit((d) => {
            (d.blocks.find((b) => b.id === option.id) as OptionBlock).metadata = metadata;
            if (a) d.attachments.push(a);
          })
        }
      />
    </>
  );
}

export function DetailPanel({
  w,
  derived,
  focus,
  setFocus,
  displayZone,
  selected,
}: {
  w: Workspace;
  derived: Derived;
  focus: Focus;
  setFocus: (f: Focus) => void;
  displayZone: string;
  selected: string[];
}) {
  const [shift, setShift] = useState(30);
  const block = focus?.kind === 'block' ? findBlock(w, focus.id) : undefined;
  const candidate =
    focus?.kind === 'candidate'
      ? w.candidates.find((c) => c.id === focus.id)
      : block?.kind === 'candidate'
        ? w.candidates.find((c) => c.id === block.candidateId)
        : undefined;
  const edge = focus?.kind === 'edge' ? derived.edges.find((e) => e.id === focus.id) : undefined;
  const status = focus?.kind === 'status' ? w.statuses.find((s) => s.id === focus.id) : undefined;
  const point =
    focus?.kind === 'break' ? w.trip.overnightBreaks.find((b) => b.id === focus.id) : undefined;
  const targetIds = focus && 'id' in focus ? [focus.id, ...(candidate ? [candidate.id] : [])] : [];
  const issues = derived.issues.filter((i) => i.targetIds.some((id) => targetIds.includes(id)));
  const title =
    focus?.kind === 'issues'
      ? '行程检查'
      : focus?.kind === 'trip'
        ? '旅行设置'
        : edge
          ? 'Travel Edge'
          : status
            ? status.title
            : point
              ? '住宿检查点'
              : block
                ? blockTitle(w, block)
                : candidate
                  ? candidate.title
                  : '项目详情';
  const jump = (id: string) => {
    if (findBlock(w, id)) setFocus({ kind: 'block', id });
    else if (w.trip.overnightBreaks.some((b) => b.id === id)) setFocus({ kind: 'break', id });
    else if (w.statuses.some((s) => s.id === id)) setFocus({ kind: 'status', id });
    else if (derived.edges.some((e) => e.id === id)) setFocus({ kind: 'edge', id });
    else setFocus({ kind: 'trip' });
  };
  return (
    <aside className="detail-panel">
      <header className="panel-heading">
        <div>
          <span className="eyebrow">INSPECTOR</span>
          <h3>{title || '未命名项目'}</h3>
        </div>
        {focus && (
          <button className="icon-button" aria-label="关闭详情" onClick={() => setFocus(null)}>
            <X size={18} />
          </button>
        )}
      </header>
      <div className="detail-content" key={focus && 'id' in focus ? focus.id : focus?.kind}>
        {selected.length > 1 && (
          <section className="selection-tools">
            <strong>已选择 {selected.length} 个项目</strong>
            <NumberField label="整体平移 / 分钟" value={shift} onChange={(n) => setShift(n ?? 0)} />
            <div className="button-row">
              <button
                className="button compact"
                onClick={() => session.edit((d) => moveBlocks(d, selected, -shift))}
              >
                提前
              </button>
              <button
                className="button compact"
                onClick={() => session.edit((d) => moveBlocks(d, selected, shift))}
              >
                延后
              </button>
            </div>
          </section>
        )}
        {!!issues.length && <IssueList issues={issues} />}
        {!focus && (
          <div className="inspector-empty">
            <SlidersHorizontal size={32} strokeWidth={1.3} />
            <h3>让每段旅程各就其位</h3>
            <p>选择候选项目、时间轴上的安排或路线，在这里查看和编辑。</p>
            <div className="shortcut">
              <kbd>Shift / Ctrl / ⌘</kbd>
              <span>增减选择</span>
              <kbd>Ctrl + 滚轮</kbd>
              <span>缩放时间轴</span>
              <kbd>Ctrl / ⌘ + Z</kbd>
              <span>撤销操作</span>
            </div>
          </div>
        )}
        {block && block.kind !== 'option' && (
          <section className="placement-editor">
            <div className="section-label">
              Placement <span className="pill">由你安排</span>
            </div>
            <TimeField
              label="安排开始"
              value={block.start}
              zones={w.trip.timezones}
              onChange={(start) =>
                session.edit((d) => {
                  (findBlock(d, block.id) as ConcreteBlock).start = start;
                })
              }
            />
            <TimeField
              label="安排结束"
              value={block.end}
              zones={w.trip.timezones}
              onChange={(end) =>
                session.edit((d) => {
                  (findBlock(d, block.id) as ConcreteBlock).end = end;
                })
              }
            />
            <div className="duration-note">
              持续 {formatDuration((ms(block.end) - ms(block.start)) / 60000)}
            </div>
          </section>
        )}
        {candidate && <CandidateFields candidate={candidate} w={w} />}
        {candidate?.kind === 'boundary' && (
          <button
            className="button full"
            onClick={() => setFocus({ kind: 'status', id: candidate.statusId })}
          >
            编辑酒店／租车状态资料 <ArrowUpRight size={14} />
          </button>
        )}
        {focus?.kind === 'candidate' && candidate && (
          <>
            <button
              className="button primary full"
              onClick={() => {
                const b = placeCandidate(
                  candidate,
                  ms(w.trip.displayStart) + 9 * 3600000,
                  w.trip.primaryTimezone,
                );
                session.edit((d) => d.blocks.push(b));
                setFocus({ kind: 'block', id: b.id });
              }}
            >
              安排到时间轴
            </button>
            <p className="hint">活动默认放在首日 09:00；也可直接拖到想要的时间。</p>
            <button
              className="text-button danger"
              onClick={() => {
                session.edit((d) => {
                  const ids = d.blocks
                    .flatMap((b) =>
                      b.kind === 'option' ? b.variants.flatMap((v) => v.blocks) : [b],
                    )
                    .filter((b) => b.kind === 'candidate' && b.candidateId === candidate.id)
                    .map((b) => b.id);
                  removeBlocks(d, ids);
                  d.candidates = d.candidates.filter((c) => c.id !== candidate.id);
                });
                setFocus(null);
              }}
            >
              <Trash2 size={14} />
              删除定义及其 Placements
            </button>
          </>
        )}
        {block?.kind === 'option' && <OptionFields option={block} w={w} setFocus={setFocus} />}
        {block?.kind === 'hotelRest' && (
          <>
            <TextField
              label="活动名称"
              value={block.title}
              onChange={(title) =>
                session.edit((d) => {
                  Object.assign(findBlock(d, block.id)!, { title });
                })
              }
            />
            <div className="derived-note">
              <MapPin size={15} />
              {derived.restLocations[block.id]?.map((l) => l.name).join(' / ') ||
                '酒店地点尚无法推导'}
            </div>
            <MetadataFields
              value={block.metadata}
              workspace={w}
              onChange={(metadata, a) =>
                session.edit((d) => {
                  Object.assign(findBlock(d, block.id)!, { metadata });
                  if (a) d.attachments.push(a);
                })
              }
            />
          </>
        )}
        {block && (
          <button
            className="text-button danger delete-placement"
            onClick={() => {
              session.edit((d) => removeBlocks(d, [block.id]));
              setFocus(null);
            }}
          >
            <Trash2 size={14} />
            从时间轴移除{block.kind === 'candidate' ? '（保留定义）' : ''}
          </button>
        )}
        {edge && <EdgeFields edge={edge} w={w} zone={displayZone} />}
        {status && (
          <>
            <TextField
              label="状态名称"
              value={status.title}
              onChange={(title) =>
                session.edit((d) => {
                  d.statuses.find((s) => s.id === status.id)!.title = title;
                })
              }
            />
            <LocationFields
              value={status.location}
              onChange={(location) =>
                session.edit((d) => {
                  d.statuses.find((s) => s.id === status.id)!.location = location;
                })
              }
            />
            <MetadataFields
              value={status.metadata}
              workspace={w}
              onChange={(metadata, a) =>
                session.edit((d) => {
                  d.statuses.find((s) => s.id === status.id)!.metadata = metadata;
                  if (a) d.attachments.push(a);
                })
              }
            />
            <p className="hint">
              状态实例地点用于推导酒店休息和 Overnight；Boundary 地点用于办理及路线，可分别编辑。
            </p>
            <button
              className="button full"
              onClick={() => {
                const id = uid(),
                  start = w.trip.displayStart;
                session.edit((d) =>
                  d.candidates.push({
                    id,
                    kind: 'boundary',
                    title: `${status.title} · 补充边界`,
                    statusId: status.id,
                    role: 'end',
                    location: status.location,
                    defaultStart: start,
                    defaultEnd: shiftTime(start, 30),
                    metadata: emptyMetadata(),
                  }),
                );
                setFocus({ kind: 'candidate', id });
              }}
            >
              <Plus size={14} />
              为此状态补充 Boundary
            </button>
          </>
        )}
        {point && (
          <>
            <TimeField
              label="住宿检查时间"
              value={point.time}
              zones={w.trip.timezones}
              onChange={(time) =>
                session.edit((d) => {
                  d.trip.overnightBreaks.find((b) => b.id === point.id)!.time = time;
                })
              }
            />
            <p className="hint">
              此时刻需要酒店覆盖，且不得与实际项目冲突。删除表示这一跨日边界不要求住宿。
            </p>
            <button
              className="button danger full"
              onClick={() => {
                session.edit((d) => {
                  d.trip.overnightBreaks = d.trip.overnightBreaks.filter((b) => b.id !== point.id);
                });
                setFocus(null);
              }}
            >
              删除此住宿检查点
            </button>
          </>
        )}
        {focus?.kind === 'trip' && <TripFields w={w} setFocus={setFocus} />}
        {focus?.kind === 'issues' && (
          <>
            <div className="issue-summary">
              <strong>{derived.issues.filter((i) => i.severity === 'error').length}</strong>
              <span>项冲突</span>
              <strong>{derived.issues.filter((i) => i.severity === 'warning').length}</strong>
              <span>项待确认</span>
            </div>
            <p className="hint">检查结果不会阻止编辑或改变行程。点击问题可查看相关项目。</p>
            {!derived.issues.length && (
              <div className="success-note">当前安排通过全部一致性检查。</div>
            )}
            <IssueList issues={derived.issues} onFocus={jump} />
          </>
        )}
      </div>
    </aside>
  );
}

function EdgeFields({ edge, w, zone }: { edge: Edge; w: Workspace; zone: string }) {
  const defaultOverhead = edge.mode === 'NONE' ? 0 : effectiveConfig(w).overhead[edge.mode];
  return (
    <>
      <div className="route-endpoints">
        <span>{edge.origin.name || edge.origin.address || '起点缺失'}</span>
        <span>↓</span>
        <span>{edge.destination.name || edge.destination.address || '终点缺失'}</span>
      </div>
      <Field label="交通方式">
        <select
          value={w.edgeOverrides[edge.key] ?? ''}
          onChange={(e) =>
            session.edit((d) => {
              if (e.target.value) d.edgeOverrides[edge.key] = e.target.value as Mode;
              else delete d.edgeOverrides[edge.key];
            })
          }
        >
          <option value="">
            使用默认推导（{edge.modeKnown ? modeLabel[edge.mode] : '待确认'}）
          </option>
          <option value="NONE">无移动 NONE</option>
          <option value="WALK">步行 WALK</option>
          <option value="DRIVE">驾车 DRIVE</option>
          <option value="RIDESHARE">打车 RIDESHARE</option>
        </select>
      </Field>
      <NumberField
        key={edge.key}
        label="额外耗时（buffer）/ 分钟"
        value={w.edgeOverheadOverrides[edge.key] ?? null}
        nullable
        placeholder={
          edge.modeKnown
            ? `${edge.mode === 'NONE' ? '默认' : '旅行默认'}：${defaultOverhead} 分钟`
            : '使用对应交通方式的默认值'
        }
        onChange={(value) =>
          session.edit((d) => {
            if (value === null) delete d.edgeOverheadOverrides[edge.key];
            else d.edgeOverheadOverrides[edge.key] = value;
          })
        }
      />
      <p className="hint">
        留空使用对应交通方式的旅行默认值（无移动默认 0）；填写 0 表示无需额外耗时。
      </p>
      {edge.overheadOverridden && (
        <button
          className="text-button"
          onClick={() =>
            session.edit((d) => {
              delete d.edgeOverheadOverrides[edge.key];
            })
          }
        >
          恢复默认额外耗时
        </button>
      )}
      <dl className="metrics">
        <dt>路线耗时</dt>
        <dd>{formatDuration(edge.route.minutes)}</dd>
        <dt>额外耗时</dt>
        <dd>{formatDuration(edge.overhead)}</dd>
        <dt>总耗时</dt>
        <dd>{formatDuration(edge.effectiveMinutes)}</dd>
        <dt>出发</dt>
        <dd>
          {edge.departure === null ? '未知' : formatTime(edge.departure, zone, 'MM/dd HH:mm')}
        </dd>
        <dt>抵达</dt>
        <dd>{edge.arrival === null ? '未知' : formatTime(edge.arrival, zone, 'MM/dd HH:mm')}</dd>
        <dt>计算来源</dt>
        <dd>{edge.route.source}</dd>
      </dl>
      {edge.route.status !== 'ok' && <p className="inline-issue">{edge.route.message}</p>}
      {edge.context && <p className="hint">方案：{edge.context}</p>}
      <p className="hint">
        相邻关系决定路线。手动交通方式与额外耗时会保留，直到你恢复默认值。若相邻项目改变，将建立新路线。
      </p>
    </>
  );
}

function TripFields({ w, setFocus }: { w: Workspace; setFocus: (f: Focus) => void }) {
  return (
    <>
      <TextField
        label="旅行名称"
        value={w.trip.name}
        onChange={(name) =>
          session.edit((d) => {
            d.trip.name = name;
          })
        }
      />
      <TimeField
        label="显示范围开始"
        value={w.trip.displayStart}
        zones={w.trip.timezones}
        onChange={(displayStart) =>
          session.edit((d) => {
            d.trip.displayStart = displayStart;
          })
        }
      />
      <TimeField
        label="显示范围结束"
        value={w.trip.displayEnd}
        zones={w.trip.timezones}
        onChange={(displayEnd) =>
          session.edit((d) => {
            d.trip.displayEnd = displayEnd;
          })
        }
      />
      <p className="hint">显示范围不会决定实际出发／到家时间，也不会自动改变已有住宿检查点。</p>
      <LocationFields
        label="旅行起点"
        value={w.trip.startLocation}
        onChange={(startLocation) =>
          session.edit((d) => {
            d.trip.startLocation = startLocation;
          })
        }
      />
      <LocationFields
        label="旅行终点"
        value={w.trip.endLocation}
        onChange={(endLocation) =>
          session.edit((d) => {
            d.trip.endLocation = endLocation;
          })
        }
      />
      <TimezoneFields
        timezones={w.trip.timezones}
        primaryTimezone={w.trip.primaryTimezone}
        onChange={(zones) =>
          session.edit((d) => {
            Object.assign(d.trip, zones);
          })
        }
      />
      <section className="detail-section">
        <h4 className="section-label">交通与路线设置</h4>
        <p className="hint">未修改的项目继承全局默认。在这里修改只覆盖本次旅行。</p>
        <PlanningConfigFields
          config={effectiveConfig(w)}
          onChange={(patch) =>
            session.edit((d) => {
              Object.assign(d.trip.config, patch);
            })
          }
        />
        <button
          className="text-button"
          onClick={() =>
            session.edit((d) => {
              d.trip.config = {};
            })
          }
        >
          清除本次旅行全部覆盖
        </button>
      </section>
      <section className="detail-section">
        <div className="section-label">Overnight Break Points</div>
        {w.trip.overnightBreaks.map((p) => (
          <button
            key={p.id}
            className="variant-item"
            onClick={() => setFocus({ kind: 'break', id: p.id })}
          >
            <span>{formatTime(p.time, w.trip.primaryTimezone, 'MM/dd HH:mm')}</span>
            <ArrowUpRight size={14} />
          </button>
        ))}
        <button
          className="button full"
          onClick={() => {
            const id = uid();
            session.edit((d) =>
              d.trip.overnightBreaks.push({
                id,
                time: shiftTime(d.trip.displayStart, 24 * 60 + 210),
              }),
            );
            setFocus({ kind: 'break', id });
          }}
        >
          <Plus size={14} />
          添加住宿检查点
        </button>
      </section>
      <section className="detail-section">
        <div className="section-label">酒店与租车</div>
        {w.statuses.map((s) => (
          <button
            key={s.id}
            className="variant-item"
            onClick={() => setFocus({ kind: 'status', id: s.id })}
          >
            {s.title}
            <span className="pill neutral">{s.kind === 'hotel' ? '酒店' : '租车'}</span>
          </button>
        ))}
      </section>
    </>
  );
}
