import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { DateTime } from 'luxon';
import {
  AlertTriangle,
  Car,
  Footprints,
  GripHorizontal,
  Hotel,
  Layers,
  LockKeyhole,
  MapPin,
  Moon,
  Plane,
  Route,
  Flag,
} from 'lucide-react';
import type { Block, ConcreteBlock, Workspace } from '../domain/schema';
import { at, daysBetween, formatDuration, formatTime, ms } from '../domain/time';
import {
  allConcrete,
  blockKind,
  blockTitle,
  bounds,
  findBlock,
  moveBlocks,
} from '../domain/operations';
import { placeCandidate } from '../domain/factory';
import type { Derived, DerivedBlock, Edge } from '../domain/derive';
import { session } from '../storage/session';
import type { Focus } from './types';

const OPTION_HEADER_SPACE = 25;
const ENDPOINT_HEIGHT = 30;

type Props = {
  w: Workspace;
  derived: Derived;
  zone: string;
  zoom: number;
  setZoom: (z: number) => void;
  selected: string[];
  setSelected: (ids: string[]) => void;
  setFocus: (f: Focus) => void;
  jumpDay: string | null;
  jumpTarget: string | null;
};
type Interaction = {
  mode: 'move' | 'start' | 'end';
  ids: string[];
  startY: number;
  startX: number;
  startTime: number;
  block: Block;
  base: Workspace;
  delta: number;
  moved: boolean;
};
type Box = {
  x: number;
  y: number;
  endX: number;
  endY: number;
  additive: boolean;
  baseIds: string[];
};

export function Timeline({
  w,
  derived,
  zone,
  zoom,
  setZoom,
  selected,
  setSelected,
  setFocus,
  jumpDay,
  jumpTarget,
}: Props) {
  const scroll = useRef<HTMLDivElement>(null),
    interaction = useRef<Interaction | null>(null),
    boxRef = useRef<Box | null>(null);
  const [preview, setPreview] = useState<Workspace | null>(null),
    [box, setBox] = useState<Box | null>(null);
  const display = preview ?? w;
  const days = daysBetween(w.trip.displayStart, w.trip.displayEnd, zone);
  const variantOwners = new Map<string, string>();
  let maxVariants = 0;
  for (const block of display.blocks) {
    if (block.kind !== 'option') continue;
    maxVariants = Math.max(maxVariants, block.variants.length);
    for (const variant of block.variants)
      for (const child of variant.blocks) variantOwners.set(child.id, variant.id);
  }
  const variantEdges = new Map<string, Edge[]>();
  const mainEdges: Edge[] = [];
  for (const edge of derived.edges) {
    const owner = variantOwners.get(edge.fromId);
    if (owner && owner === variantOwners.get(edge.toId)) {
      const edges = variantEdges.get(owner) ?? [];
      edges.push(edge);
      variantEdges.set(owner, edges);
    } else mainEdges.push(edge);
  }
  const initialWorkspace = useRef('');
  const timeAtY = (clientY: number) => {
    const grids = [...(scroll.current?.querySelectorAll<HTMLElement>('.day-grid') ?? [])];
    for (let i = 0; i < grids.length; i++) {
      const grid = grids[i],
        rect = grid.getBoundingClientRect(),
        start = Number(grid.dataset.start);
      if (clientY <= rect.bottom || i === grids.length - 1)
        return start + (Math.max(0, Math.min(rect.height, clientY - rect.top)) / zoom) * 60000;
    }
    return ms(w.trip.displayStart);
  };
  useLayoutEffect(() => {
    if (!scroll.current || initialWorkspace.current === w.id) return;
    initialWorkspace.current = w.id;
    const first = w.blocks
      .map(bounds)
      .filter((b): b is { start: number; end: number } => !!b)
      .sort((a, b) => a.start - b.start)[0];
    const dayStart = days[0]?.toMillis() ?? 0;
    scroll.current.scrollTop = Math.max(
      0,
      (((first?.start ?? dayStart + 9 * 3600000) - dayStart) / 60000) * zoom - 100,
    );
  }, [w.id, days, w.blocks, zoom]);
  useEffect(() => {
    if (jumpDay)
      scroll.current
        ?.querySelector(`[data-day="${jumpDay}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [jumpDay]);
  useEffect(() => {
    if (jumpTarget)
      scroll.current
        ?.querySelector(`[data-block-id="${jumpTarget}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [jumpTarget]);
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const next = Math.max(0.3, Math.min(3, zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
      const pointerOffset = e.clientY - el.getBoundingClientRect().top;
      const oldTop = el.scrollTop;
      setZoom(next);
      requestAnimationFrame(() => {
        el.scrollTop = ((oldTop + pointerOffset) * next) / zoom - pointerOffset;
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [zoom, setZoom]);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const drag = interaction.current;
      if (drag) {
        if (
          Math.abs(e.clientY - drag.startY) + Math.abs(e.clientX - drag.startX) < 4 &&
          !drag.moved
        )
          return;
        drag.moved = true;
        const rect = scroll.current?.getBoundingClientRect();
        if (rect && scroll.current) {
          if (e.clientY < rect.top + 45) scroll.current.scrollTop -= 16;
          if (e.clientY > rect.bottom - 45) scroll.current.scrollTop += 16;
        }
        const snap = e.altKey ? 1 : 5;
        drag.delta = Math.round((timeAtY(e.clientY) - drag.startTime) / 60000 / snap) * snap;
        const draft = structuredClone(drag.base);
        if (drag.mode === 'move') moveBlocks(draft, drag.ids, drag.delta);
        else {
          const target = findBlock(draft, drag.block.id) as ConcreteBlock;
          target[drag.mode] = at(
            ms((drag.block as ConcreteBlock)[drag.mode]) + drag.delta * 60000,
            target[drag.mode].timezone,
          );
        }
        setPreview(draft);
      } else if (boxRef.current) {
        const next = { ...boxRef.current, endX: e.clientX, endY: e.clientY };
        boxRef.current = next;
        setBox(next);
      }
    };
    const up = () => {
      const drag = interaction.current;
      if (drag?.moved) {
        session.edit((d) => {
          if (drag.mode === 'move') moveBlocks(d, drag.ids, drag.delta);
          else {
            const target = findBlock(d, drag.block.id) as ConcreteBlock;
            target[drag.mode] = at(
              ms((drag.block as ConcreteBlock)[drag.mode]) + drag.delta * 60000,
              target[drag.mode].timezone,
            );
          }
        });
      }
      if (boxRef.current) {
        const b = boxRef.current,
          left = Math.min(b.x, b.endX),
          right = Math.max(b.x, b.endX),
          top = Math.min(b.y, b.endY),
          bottom = Math.max(b.y, b.endY);
        const ids = [
          ...(scroll.current?.querySelectorAll<HTMLElement>('[data-selectable="true"]') ?? []),
        ]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (el.classList.contains('option-block'))
              return r.right > left && r.left < right && top <= r.top && bottom >= r.top - 24;
            return r.right > left && r.left < right && r.bottom > top && r.top < bottom;
          })
          .map((el) => el.dataset.blockId!);
        setSelected([...new Set([...(b.additive ? b.baseIds : []), ...ids])]);
      }
      interaction.current = null;
      boxRef.current = null;
      setPreview(null);
      setBox(null);
    };
    const cancel = () => {
      interaction.current = null;
      boxRef.current = null;
      setPreview(null);
      setBox(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  });
  const begin = (e: ReactPointerEvent, block: Block, mode: Interaction['mode'] = 'move') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    let ids = selected;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      ids = selected.includes(block.id)
        ? selected.filter((id) => id !== block.id)
        : [...selected, block.id];
      setSelected(ids);
      setFocus({ kind: 'block', id: block.id });
      return;
    }
    if (!selected.includes(block.id)) {
      ids = [block.id];
      setSelected(ids);
    }
    setFocus({ kind: 'block', id: block.id });
    interaction.current = {
      mode,
      ids,
      startY: e.clientY,
      startX: e.clientX,
      startTime: timeAtY(e.clientY),
      block,
      base: w,
      delta: 0,
      moved: false,
    };
  };
  const selectionStart = (e: ReactPointerEvent) => {
    if (
      e.button !== 0 ||
      (e.target as HTMLElement).closest('button, a, .timeline-block, .status-bar')
    )
      return;
    e.preventDefault();
    const b = {
      x: e.clientX,
      y: e.clientY,
      endX: e.clientX,
      endY: e.clientY,
      additive: e.shiftKey || e.ctrlKey || e.metaKey,
      baseIds: selected,
    };
    boxRef.current = b;
    setBox(b);
  };
  const hasIssues = (id: string) => derived.issues.some((i) => i.targetIds.includes(id));
  const errorCount = (id: string) =>
    derived.issues.filter((i) => i.targetIds.includes(id) && i.severity === 'error').length;
  const statusGroups = new Map<string, typeof derived.statuses>();
  for (const interval of derived.statuses) {
    const group = statusGroups.get(interval.status.id) ?? [];
    group.push(interval);
    statusGroups.set(interval.status.id, group);
  }
  const visibleStatuses = [...statusGroups.values()].map((group) => ({
    ...group[0],
    start: Math.max(...group.map((i) => i.start)),
    end: Math.min(...group.map((i) => i.end)),
  }));
  const boundaryProblems = allConcrete(display).flatMap((b) => {
    const c =
      b.kind === 'candidate' ? display.candidates.find((c) => c.id === b.candidateId) : undefined;
    return c?.kind === 'boundary' &&
      derived.issues.some(
        (i) =>
          ['boundary_pair', 'status_order', 'status_missing'].includes(i.code) &&
          i.targetIds.includes(b.id),
      )
      ? [{ block: b, candidate: c }]
      : [];
  });
  const emptyOptions = display.blocks.filter((b) => b.kind === 'option' && !bounds(b));
  const outside = display.blocks.filter((b) => {
    const span = bounds(b);
    return span && (span.start < ms(w.trip.displayStart) || span.end > ms(w.trip.displayEnd));
  });
  const renderBuffer = (
    block: ConcreteBlock,
    dayStart: number,
    dayEnd: number,
    style: CSSProperties = {},
    offset = 0,
  ) => {
    const c =
      block.kind === 'candidate'
        ? display.candidates.find((c) => c.id === block.candidateId)
        : undefined;
    if (c?.kind !== 'transport') return null;
    const start = ms(c.departure) - c.preBuffer * 60000,
      end = ms(c.arrival) + c.postBuffer * 60000;
    if (end <= dayStart || start >= dayEnd || end <= start) return null;
    const { top: _top, height: _height, ...horizontal } = style;
    return (
      <div
        key={`buffer-${block.id}`}
        className="transport-buffer"
        style={{
          ...horizontal,
          top: ((Math.max(start, dayStart) - dayStart) / 60000) * zoom + offset,
          height: ((Math.min(end, dayEnd) - Math.max(start, dayStart)) / 60000) * zoom,
        }}
      >
        <span>提前抵达 · {c.preBuffer} 分</span>
        {(ms(block.start) !== ms(c.departure) || ms(block.end) !== ms(c.arrival)) && (
          <div
            className="scheduled-ghost"
            style={{
              top: ((ms(c.departure) - Math.max(start, dayStart)) / 60000) * zoom,
              height: Math.max(0, ((ms(c.arrival) - ms(c.departure)) / 60000) * zoom),
            }}
          >
            Scheduled · {formatTime(c.departure, zone)}–{formatTime(c.arrival, zone)}
          </div>
        )}
        <span className="post-buffer">抵达缓冲 · {c.postBuffer} 分</span>
      </div>
    );
  };
  const renderBlock = (
    block: Block,
    dayStart: number,
    dayEnd: number,
    style: CSSProperties = {},
    child = false,
  ) => {
    const span = bounds(block);
    if (
      !span ||
      Math.max(span.start, span.end) < dayStart ||
      Math.min(span.start, span.end) >= dayEnd
    )
      return null;
    const start = Math.max(dayStart, Math.min(span.start, span.end)),
      end = Math.min(dayEnd, Math.max(span.start, span.end));
    const top = ((start - dayStart) / 60000) * zoom,
      height = Math.max(2, ((end - start) / 60000) * zoom);
    const kind = blockKind(display, block),
      active = selected.includes(block.id),
      issues = hasIssues(block.id),
      errors = errorCount(block.id);
    if (block.kind === 'option')
      return (
        <div
          key={block.id}
          data-block-id={block.id}
          data-selectable="true"
          className={`option-block ${active ? 'selected' : ''} ${errors ? 'has-error' : ''}`}
          style={{ top, height, ...style }}
        >
          <div className="option-grip" onPointerDown={(e) => begin(e, block)}>
            <Layers size={13} />
            <strong>{block.title}</strong>
            <span>
              {block.variants.length} 个方案{issues ? ' · !' : ''}
            </span>
          </div>
          <div className="variant-columns">
            {block.variants.map((v) => (
              <div
                key={v.id}
                className="variant-column"
                data-variant-id={v.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const c = w.candidates.find((c) => c.id === e.dataTransfer.getData('candidate'));
                  if (!c) return;
                  const b = placeCandidate(
                    c,
                    Math.round(timeAtY(e.clientY) / 300000) * 300000,
                    w.trip.primaryTimezone,
                  );
                  session.edit((d) =>
                    (d.blocks.find((x) => x.id === block.id) as typeof block).variants
                      .find((x) => x.id === v.id)!
                      .blocks.push(b),
                  );
                  setFocus({ kind: 'block', id: b.id });
                }}
              >
                <div className="variant-label">{v.title}</div>
                {v.blocks.map((b) =>
                  renderBlock(
                    b,
                    dayStart,
                    dayEnd,
                    {
                      top:
                        ((Math.max(dayStart, Math.min(ms(b.start), ms(b.end))) - dayStart) /
                          60000) *
                          zoom -
                        top,
                      left: 3,
                      right: variantEdges.has(v.id) ? 86 : 3,
                      width: 'auto',
                    },
                    true,
                  ),
                )}
                <div className="variant-edge-lane">
                  <TravelEdges
                    edges={variantEdges.get(v.id) ?? []}
                    dayStart={dayStart}
                    dayEnd={dayEnd}
                    zoom={zoom}
                    offset={-top}
                    errorCount={errorCount}
                    setFocus={setFocus}
                  />
                </div>
                {!v.blocks.length && <span className="variant-empty">拖入候选项目</span>}
              </div>
            ))}
          </div>
        </div>
      );
    const c =
      block.kind === 'candidate'
        ? display.candidates.find((c) => c.id === block.candidateId)
        : undefined;
    const location =
      c?.kind === 'transport'
        ? `${c.origin.name} → ${c.destination.name}`
        : c && 'location' in c
          ? c.location.name
          : derived.restLocations[block.id]?.[0]?.name || '地点待推导';
    const Icon =
      kind === 'transport'
        ? Plane
        : kind === 'boundary'
          ? Hotel
          : kind === 'hotelRest'
            ? Moon
            : MapPin;
    return (
      <Fragment key={block.id}>
        {renderBuffer(
          block,
          dayStart,
          dayEnd,
          style,
          (typeof style.top === 'number' ? style.top : top) - top,
        )}
        <div
          role="button"
          tabIndex={0}
          aria-label={`${blockTitle(display, block)} ${formatTime(span.start, zone)}—${formatTime(span.end, zone)}`}
          data-block-id={block.id}
          data-selectable="true"
          className={`timeline-block ${kind} ${active ? 'selected' : ''} ${errors ? 'has-error' : ''} ${height < 35 ? 'tiny' : ''}`}
          style={{ top, height, ...style }}
          onPointerDown={(e) => begin(e, block)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setSelected([block.id]);
              setFocus({ kind: 'block', id: block.id });
            }
          }}
          title={`${blockTitle(display, block)} · ${formatTime(span.start, zone, 'MM/dd HH:mm')}–${formatTime(span.end, zone, 'MM/dd HH:mm')}\n拖动移动；拖动上下边缘调整；Alt 精确到分钟`}
        >
          <div
            className="resize-handle top"
            data-testid={`resize-start-${block.id}`}
            onPointerDown={(e) => begin(e, block, 'start')}
          />
          <div className="block-title">
            <Icon size={14} />
            <strong>{blockTitle(display, block)}</strong>
            {issues && (
              <span className={`block-warning ${errors ? 'error' : ''}`}>
                <AlertTriangle size={12} />
                {errors || ''}
              </span>
            )}
          </div>
          {height >= 35 && (
            <div className="block-time">
              {formatTime(span.start, zone)} – {formatTime(span.end, zone)}{' '}
              <span>· {formatDuration((span.end - span.start) / 60000)}</span>
            </div>
          )}
          {height >= 62 && <div className="block-location">{location || '地点尚未填写'}</div>}
          {height >= 90 && <GripHorizontal className="block-grip" size={16} />}
          <div
            className="resize-handle bottom"
            data-testid={`resize-end-${block.id}`}
            onPointerDown={(e) => begin(e, block, 'end')}
          />
        </div>
      </Fragment>
    );
  };
  return (
    <div
      className="timeline-scroll"
      ref={scroll}
      data-testid="timeline-scroll"
      style={
        {
          '--option-header-space': `${OPTION_HEADER_SPACE}px`,
          '--endpoint-height': `${ENDPOINT_HEIGHT}px`,
        } as CSSProperties
      }
    >
      {!!outside.length && (
        <div className="range-notice">
          {outside.length} 个安排超出 Trip 显示范围。
          <button onClick={() => setFocus({ kind: 'trip' })}>修改显示范围</button>
        </div>
      )}
      {!!emptyOptions.length && (
        <div className="empty-options">
          {emptyOptions.map((b) => (
            <button
              key={b.id}
              className="button"
              onClick={() => setFocus({ kind: 'block', id: b.id })}
            >
              <Layers size={14} />
              {blockTitle(display, b)} · 添加内部项目
            </button>
          ))}
        </div>
      )}
      {days.map((day, dayIndex) => {
        const dayStart = day.toMillis(),
          dayEnd = day.plus({ days: 1 }).toMillis(),
          minutes = (dayEnd - dayStart) / 60000;
        const dayBlocks = display.blocks.filter((b) => {
          const span = bounds(b);
          return (
            span &&
            Math.max(span.start, span.end) >= dayStart &&
            Math.min(span.start, span.end) < dayEnd
          );
        });
        const layouts = layoutBlocks(dayBlocks);
        const endpointLayout = layoutEndpoints(derived.blocks, dayBlocks, dayStart, dayEnd, zoom);
        const ticks = Array.from(
          { length: Math.ceil(minutes / 60) },
          (_, i) => dayStart + i * 3600000,
        );
        return (
          <section
            className="timeline-day"
            key={day.toISODate()}
            data-day={day.toISODate()}
            style={maxVariants ? { minWidth: maxVariants * 200 + 270 } : undefined}
          >
            <header className="day-header">
              <div className="day-number">{String(dayIndex + 1).padStart(2, '0')}</div>
              <div>
                <h3>
                  {day.setLocale('zh-CN').toFormat('M 月 d 日')}{' '}
                  <span>{day.setLocale('zh-CN').toFormat('cccc')}</span>
                </h3>
                <p>
                  {dayBlocks.length} 项安排 · {zone}
                </p>
              </div>
              <span className="day-line" />
              <span className="eyebrow">DAY {dayIndex + 1}</span>
            </header>
            <div
              className="day-grid"
              data-start={dayStart}
              style={{
                height: minutes * zoom,
                marginTop: endpointLayout.spaceBefore,
                marginBottom: endpointLayout.spaceAfter,
              }}
              onPointerDown={selectionStart}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(e) => {
                e.preventDefault();
                const candidate = w.candidates.find(
                  (c) => c.id === e.dataTransfer.getData('candidate'),
                );
                if (!candidate) return;
                const b = placeCandidate(
                  candidate,
                  Math.round(timeAtY(e.clientY) / 300000) * 300000,
                  w.trip.primaryTimezone,
                );
                session.edit((d) => d.blocks.push(b));
                setSelected([b.id]);
                setFocus({ kind: 'block', id: b.id });
              }}
            >
              {ticks.map((t) => (
                <div key={t} className="hour-line" style={{ top: ((t - dayStart) / 60000) * zoom }}>
                  <span>{formatTime(t, zone)}</span>
                </div>
              ))}
              {visibleStatuses.map((s) => {
                const finish =
                  s.ambiguousAfter === null ? s.end : Math.min(s.end, s.ambiguousAfter);
                if (s.start >= dayEnd || finish <= dayStart) return null;
                return (
                  <button
                    key={s.id}
                    className={`status-bar ${s.status.kind} ${errorCount(s.status.id) ? 'has-error' : ''}`}
                    title={`${s.status.title} · ${formatTime(s.start, zone, 'MM/dd HH:mm')}–${formatTime(finish, zone, 'MM/dd HH:mm')}`}
                    style={{
                      top: ((Math.max(s.start, dayStart) - dayStart) / 60000) * zoom,
                      height:
                        ((Math.min(finish, dayEnd) - Math.max(s.start, dayStart)) / 60000) * zoom,
                    }}
                    onClick={() => setFocus({ kind: 'status', id: s.status.id })}
                  >
                    {s.status.kind === 'hotel' ? <Hotel size={12} /> : <Car size={12} />}
                    <span>{s.status.title}</span>
                  </button>
                );
              })}
              {derived.unknownStatuses.map((unknown, i) => {
                const status = w.statuses.find((s) => s.id === unknown.statusId);
                if (!status || unknown.start >= dayEnd) return null;
                return (
                  <button
                    key={`unknown-${unknown.optionId}-${i}`}
                    className={`status-bar unknown ${status.kind}`}
                    title={`${status.title}：Option 各方案对外改动不一致，状态未知`}
                    style={{
                      top: ((Math.max(dayStart, unknown.start) - dayStart) / 60000) * zoom,
                      height: ((dayEnd - Math.max(dayStart, unknown.start)) / 60000) * zoom,
                    }}
                    onClick={() => setFocus({ kind: 'block', id: unknown.optionId })}
                  >
                    <AlertTriangle size={11} />
                    <span>状态未知</span>
                  </button>
                );
              })}
              {boundaryProblems.map(({ block, candidate }) => {
                const start = ms(block.start),
                  end = Math.max(start + 60000, ms(block.end));
                if (start >= dayEnd || end <= dayStart) return null;
                const status = w.statuses.find((s) => s.id === candidate.statusId);
                return (
                  <button
                    key={`invalid-${block.id}`}
                    className={`status-bar has-error ${status?.kind ?? 'hotel'}`}
                    title={`${candidate.title}：边界无效，状态未形成`}
                    style={{
                      top: ((Math.max(start, dayStart) - dayStart) / 60000) * zoom,
                      height: Math.max(
                        2,
                        ((Math.min(end, dayEnd) - Math.max(start, dayStart)) / 60000) * zoom,
                      ),
                    }}
                    onClick={() => setFocus({ kind: 'block', id: block.id })}
                  >
                    !
                  </button>
                );
              })}
              {w.trip.overnightBreaks.map((br) => {
                const t = ms(br.time);
                if (t < dayStart || t >= dayEnd) return null;
                return (
                  <button
                    key={br.id}
                    className={`overnight-point ${hasIssues(br.id) ? 'has-issue' : ''}`}
                    style={{ top: ((t - dayStart) / 60000) * zoom }}
                    onClick={() => setFocus({ kind: 'break', id: br.id })}
                  >
                    <Moon size={11} />
                    {formatTime(t, zone)} 住宿检查{hasIssues(br.id) && <AlertTriangle size={12} />}
                  </button>
                );
              })}
              <div className="block-lane">
                {derived.blocks
                  .filter((b) => b.kind === 'overnight')
                  .map((b, index) => {
                    const start = b.start ?? b.anchor,
                      end = b.end ?? b.anchor;
                    if (Math.max(start, end) < dayStart || Math.min(start, end) >= dayEnd)
                      return null;
                    return (
                      <div
                        className={`derived-overnight ${hasIssues(b.id) ? 'has-error' : ''}`}
                        key={`${b.id}-${index}`}
                        style={{
                          top:
                            ((Math.max(dayStart, Math.min(start, end)) - dayStart) / 60000) * zoom,
                          height: Math.max(
                            2,
                            ((Math.min(dayEnd, Math.max(start, end)) -
                              Math.max(dayStart, Math.min(start, end))) /
                              60000) *
                              zoom,
                          ),
                        }}
                      >
                        <span>
                          <Moon size={13} />
                          {b.title} · 只读
                        </span>
                        <small>
                          {b.start === null
                            ? '回到酒店：未知'
                            : `预计 ${formatTime(b.start, zone)} 回到酒店`}
                          <br />
                          {b.end === null
                            ? '离开酒店：未知'
                            : `最晚 ${formatTime(b.end, zone)} 离开酒店`}
                        </small>
                      </div>
                    );
                  })}
                {allConcrete(display)
                  .filter(
                    (b) =>
                      !dayBlocks.some((main) => main.id === b.id) &&
                      (Math.max(ms(b.start), ms(b.end)) < dayStart ||
                        Math.min(ms(b.start), ms(b.end)) >= dayEnd),
                  )
                  .map((b) => renderBuffer(b, dayStart, dayEnd, { left: 0, right: 5 }))}
                {dayBlocks.map((b) => {
                  const l = layouts.get(b.id)!;
                  return renderBlock(b, dayStart, dayEnd, {
                    left: `${(l.lane / l.total) * 100}%`,
                    width: `calc(${100 / l.total}% - 5px)`,
                  });
                })}
                {endpointLayout.labels.map(({ block: b, anchor, top }, i) => {
                  const labelAnchor = b.kind === 'start' ? top + ENDPOINT_HEIGHT : top;
                  return (
                    <Fragment key={`${b.id}-${i}`}>
                      {labelAnchor !== anchor && (
                        <div
                          className="trip-endpoint-connector"
                          style={{
                            top: Math.min(labelAnchor, anchor),
                            height: Math.abs(anchor - labelAnchor),
                          }}
                          aria-hidden="true"
                        >
                          <i style={{ top: anchor - Math.min(labelAnchor, anchor) }} />
                        </div>
                      )}
                      <div className={`trip-endpoint ${b.kind}`} style={{ top }} title={b.context}>
                        <Flag size={13} />
                        <strong>
                          {b.title} {b.start === null ? '时间未知' : formatTime(b.start, zone)}
                        </strong>
                        <span>{b.location.name || '地点缺失'}</span>
                        <LockKeyhole size={11} />
                      </div>
                    </Fragment>
                  );
                })}
              </div>
              <div className="edge-lane">
                <TravelEdges
                  edges={mainEdges}
                  dayStart={dayStart}
                  dayEnd={dayEnd}
                  zoom={zoom}
                  errorCount={errorCount}
                  setFocus={setFocus}
                />
              </div>
            </div>
          </section>
        );
      })}
      {!w.blocks.length && (
        <div className="timeline-empty">
          <MapPin size={25} />
          <strong>旅程，从一个想去的地方开始</strong>
          <span>从左侧拖入候选项目，即可安排时间。</span>
        </div>
      )}
      {box && (
        <div
          className="selection-box"
          style={{
            left: Math.min(box.x, box.endX),
            top: Math.min(box.y, box.endY),
            width: Math.abs(box.endX - box.x),
            height: Math.abs(box.endY - box.y),
          }}
        />
      )}
    </div>
  );
}

function layoutEndpoints(
  blocks: DerivedBlock[],
  dayBlocks: Block[],
  dayStart: number,
  dayEnd: number,
  zoom: number,
) {
  const gap = 4;
  // Reserve the pixels actually occupied by blocks and their Option headers, independently of zoom.
  const occupied = dayBlocks.map((block) => {
    const span = bounds(block)!;
    const start = ((Math.max(dayStart, Math.min(span.start, span.end)) - dayStart) / 60000) * zoom;
    const end = ((Math.min(dayEnd, Math.max(span.start, span.end)) - dayStart) / 60000) * zoom;
    return {
      start: start - (block.kind === 'option' ? OPTION_HEADER_SPACE : 0),
      end: Math.max(start + 2, end),
    };
  });
  const labels = blocks
    .filter((block) => {
      const time = block.start ?? block.anchor;
      return block.kind !== 'overnight' && time >= dayStart && time < dayEnd;
    })
    .sort((a, b) => {
      // Allocate the nearest departure label first; earlier departures stack above it.
      if (a.kind !== b.kind) return a.kind === 'start' ? -1 : 1;
      const delta = (a.start ?? a.anchor) - (b.start ?? b.anchor);
      return a.kind === 'start' ? -delta : delta;
    })
    .map((block) => {
      const anchor = (((block.start ?? block.anchor) - dayStart) / 60000) * zoom;
      let top = block.kind === 'start' ? anchor - ENDPOINT_HEIGHT : anchor;
      while (true) {
        const collisions = occupied.filter(
          (span) =>
            top < span.end + gap - 0.001 && top + ENDPOINT_HEIGHT + gap > span.start + 0.001,
        );
        if (!collisions.length) break;
        top =
          block.kind === 'start'
            ? Math.min(...collisions.map((span) => span.start)) - gap - ENDPOINT_HEIGHT
            : Math.max(...collisions.map((span) => span.end)) + gap;
      }
      occupied.push({ start: top, end: top + ENDPOINT_HEIGHT });
      return { block, anchor, top };
    });
  const first = Math.min(0, ...occupied.map((span) => span.start));
  const overflow = Math.max(
    0,
    ...labels.map(({ top }) => top + ENDPOINT_HEIGHT - ((dayEnd - dayStart) / 60000) * zoom),
  );
  return {
    labels,
    spaceBefore: first < 0 ? -first + gap : 0,
    spaceAfter: overflow ? overflow + gap : 0,
  };
}

function TravelEdges({
  edges,
  dayStart,
  dayEnd,
  zoom,
  offset = 0,
  errorCount,
  setFocus,
}: {
  edges: Edge[];
  dayStart: number;
  dayEnd: number;
  zoom: number;
  offset?: number;
  errorCount: (id: string) => number;
  setFocus: (focus: Focus) => void;
}) {
  const visible = edges.flatMap((edge, index) => {
    const time = edge.departure ?? edge.arrival;
    if (time === null || time < dayStart || time >= dayEnd) return [];
    const top = ((time - dayStart) / 60000) * zoom;
    const height = Math.min(75, Math.max(40, (edge.effectiveMinutes ?? 0) * zoom));
    return [{ edge, id: String(index), top, height }];
  });
  // Pack the visible labels, not just route durations: unknown and zero-minute routes still need room.
  const layouts = layoutIntervals(
    visible.map(({ id, top, height }) => ({ id, start: top, end: top + height + 3 })),
  );
  return visible.map(({ edge, id, top, height }) => {
    const error = errorCount(edge.id);
    const layout = layouts.get(id)!;
    return (
      <button
        key={`${edge.id}-${id}`}
        data-edge-key={edge.key}
        className={`travel-edge ${error ? 'has-error' : ''} ${layout.total > 1 ? 'packed' : ''}`}
        style={{
          top: top + offset,
          height,
          left: `calc(${(layout.lane / layout.total) * 100}% + 3px)`,
          width: `calc(${100 / layout.total}% - 6px)`,
          right: 'auto',
        }}
        onClick={() => setFocus({ kind: 'edge', id: edge.id })}
        aria-label={`Travel Edge：${edge.fromTitle} → ${edge.toTitle}`}
        title={`${edge.fromTitle} → ${edge.toTitle}\n路线 ${formatDuration(edge.route.minutes)} + 额外 ${edge.overhead} 分钟\n${edge.context}`}
      >
        <span>
          {edge.mode === 'WALK' ? <Footprints size={12} /> : <Car size={12} />}
          {edge.modeKnown
            ? edge.mode === 'WALK'
              ? '步行'
              : edge.mode === 'DRIVE'
                ? '驾车'
                : '打车'
            : '方式待确认'}
          {error > 0 && <AlertTriangle size={12} />}
        </span>
        <small>
          {formatDuration(edge.route.minutes)}
          {edge.overhead ? ` + ${edge.overhead} 分` : ''}
          {edge.overridden ? ' · 手动' : ''}
        </small>
      </button>
    );
  });
}

function layoutBlocks(blocks: Block[]) {
  return layoutIntervals(blocks.map((block) => ({ id: block.id, ...bounds(block)! })));
}

function layoutIntervals(intervals: { id: string; start: number; end: number }[]) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const result = new Map<string, { lane: number; total: number }>();
  let group: { id: string; lane: number }[] = [],
    laneEnds: number[] = [],
    groupEnd = -Infinity;
  const finish = () => {
    for (const g of group) result.set(g.id, { lane: g.lane, total: laneEnds.length || 1 });
    group = [];
    laneEnds = [];
  };
  for (const { id, start, end } of sorted) {
    if (start >= groupEnd) {
      finish();
      groupEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = Math.max(end, start + 1);
    group.push({ id, lane });
    groupEnd = Math.max(groupEnd, laneEnds[lane]);
  }
  finish();
  return result;
}

export function Calendar({
  w,
  zone,
  derived,
  onDay,
  setFocus,
}: {
  w: Workspace;
  zone: string;
  derived: Derived;
  onDay: (date: string) => void;
  setFocus: (f: Focus) => void;
}) {
  const days = daysBetween(w.trip.displayStart, w.trip.displayEnd, zone),
    first = days[0];
  if (!first) return null;
  const start = first.minus({ days: first.weekday - 1 }),
    count = Math.ceil((days.length + first.weekday - 1) / 7) * 7;
  return (
    <div className="calendar-scroll">
      <div className="calendar-weekdays">
        {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {Array.from({ length: count }, (_, i) => start.plus({ days: i })).map((day) => {
          const inside = day >= first && day <= days[days.length - 1],
            start = day.toMillis(),
            end = day.plus({ days: 1 }).toMillis();
          const blocks = w.blocks
            .filter((b) => {
              const r = bounds(b);
              return r && r.start < end && r.end > start;
            })
            .sort((a, b) => bounds(a)!.start - bounds(b)!.start);
          return (
            <div key={day.toISODate()} className={`calendar-cell ${inside ? '' : 'outside'}`}>
              <button
                className="calendar-date"
                disabled={!inside}
                onClick={() => onDay(day.toISODate()!)}
              >
                <strong>{day.day}</strong>
                {day.day === 1 && <span>{day.month} 月</span>}
              </button>
              {inside &&
                blocks.map((b) => (
                  <button
                    key={b.id}
                    className={`calendar-event ${blockKind(w, b)}`}
                    onClick={() => setFocus({ kind: 'block', id: b.id })}
                  >
                    <small>{formatTime(bounds(b)!.start, zone)}</small>
                    <span>{blockTitle(w, b)}</span>
                    {derived.issues.some((i) => i.targetIds.includes(b.id)) && (
                      <AlertTriangle size={11} />
                    )}
                  </button>
                ))}
              {inside && !blocks.length && <span className="calendar-free">自由的一天</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
