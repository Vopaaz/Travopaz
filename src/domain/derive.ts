import {
  effectiveConfig,
  emptyLocation,
  type Workspace,
  type ConcreteBlock,
  type Candidate,
  type Location,
  type Status,
  type Mode,
  type OptionBlock,
} from './schema';
import { ms } from './time';
import { bounds, blockTitle } from './operations';
import {
  sameLocation,
  hasLocation,
  unknownRoute,
  type RouteLookup,
  type RouteResult,
} from './routing';

export type Issue = {
  id: string;
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  targetIds: string[];
  contexts: string[];
};
export type StatusInterval = {
  id: string;
  status: Status;
  start: number;
  end: number;
  startId: string;
  endId: string;
  context: string;
  ambiguousAfter: number | null;
};
export type Edge = {
  id: string;
  key: string;
  fromId: string;
  toId: string;
  fromTitle: string;
  toTitle: string;
  origin: Location;
  destination: Location;
  mode: Mode;
  overridden: boolean;
  modeKnown: boolean;
  route: RouteResult;
  overhead: number;
  effectiveMinutes: number | null;
  departure: number | null;
  arrival: number | null;
  availableMinutes: number | null;
  context: string;
  optionIds: string[];
};
export type DerivedBlock = {
  id: string;
  kind: 'start' | 'end' | 'overnight';
  title: string;
  location: Location;
  start: number | null;
  end: number | null;
  anchor: number;
  context: string;
};
export type Derived = {
  issues: Issue[];
  edges: Edge[];
  statuses: StatusInterval[];
  unknownStatuses: { optionId: string; statusId: string; start: number }[];
  blocks: DerivedBlock[];
  scenarioCount: number;
  restLocations: Record<string, Location[]>;
};
type Node = {
  id: string;
  title: string;
  start: number;
  end: number;
  origin: Location;
  destination: Location;
  block?: ConcreteBlock;
  candidate?: Candidate;
  owner?: string;
};
type Path = { blocks: ConcreteBlock[]; variants: Record<string, string>; context: string };
type Ambiguity = { optionId: string; statusIds: string[]; start: number; end: number };

function* paths(
  w: Workspace,
  index = 0,
  blocks: ConcreteBlock[] = [],
  variants: Record<string, string> = {},
  names: string[] = [],
): Generator<Path> {
  if (index === w.blocks.length) {
    yield { blocks, variants, context: names.join(' / ') };
    return;
  }
  const block = w.blocks[index];
  if (block.kind !== 'option') yield* paths(w, index + 1, [...blocks, block], variants, names);
  else if (!block.variants.length)
    yield* paths(w, index + 1, blocks, variants, [...names, `${block.title}（空）`]);
  else
    for (const variant of block.variants)
      yield* paths(
        w,
        index + 1,
        [...blocks, ...variant.blocks],
        { ...variants, [block.id]: variant.id },
        [...names, `${block.title} · ${variant.title}`],
      );
}

/** Pure derivation: this function never mutates canonical data or placements. */
export function derive(w: Workspace, lookup: RouteLookup = () => unknownRoute()): Derived {
  const config = effectiveConfig(w),
    candidates = new Map(w.candidates.map((c) => [c.id, c]));
  const issueMap = new Map<string, Issue>(),
    edgeMap = new Map<string, Edge>(),
    statusMap = new Map<string, StatusInterval>(),
    derivedMap = new Map<string, DerivedBlock>();
  const owners = new Map<string, string>(),
    restLocations: Record<string, Location[]> = {};
  const options = w.blocks.filter((b): b is OptionBlock => b.kind === 'option');
  for (const option of options)
    for (const variant of option.variants)
      for (const b of variant.blocks) owners.set(b.id, option.id);
  const addIssue = (
    code: string,
    message: string,
    targetIds: string[],
    context = '',
    severity: Issue['severity'] = 'error',
  ) => {
    const targets = [
      ...new Set([
        ...targetIds,
        ...targetIds.flatMap((id) => (owners.has(id) ? [owners.get(id)!] : [])),
      ]),
    ].sort();
    const id = `${code}:${targets.join('|')}:${message}`;
    const existing = issueMap.get(id);
    if (existing) {
      if (context && !existing.contexts.includes(context)) existing.contexts.push(context);
    } else
      issueMap.set(id, {
        id,
        severity,
        code,
        message,
        targetIds: targets,
        contexts: context ? [context] : [],
      });
  };
  const ambiguities: Ambiguity[] = [];
  // An Option occupies its derived envelope in the parent Timeline.
  for (let i = 0; i < w.blocks.length; i++)
    for (let j = i + 1; j < w.blocks.length; j++) {
      const a = w.blocks[i],
        b = w.blocks[j],
        ar = bounds(a),
        br = bounds(b);
      if (
        (a.kind === 'option' || b.kind === 'option') &&
        ar &&
        br &&
        Math.max(ar.start, br.start) < Math.min(ar.end, br.end)
      )
        addIssue('option_overlap', 'Option 外框与其他一级项目重叠。', [a.id, b.id]);
    }
  for (const option of options) {
    if (!option.variants.length)
      addIssue('option_empty', 'Option 没有方案，请添加方案或删除空 Option。', [option.id]);
    const signatures = option.variants.map((v) => {
      const net = new Map<string, number>();
      for (const b of v.blocks) {
        const c = b.kind === 'candidate' ? candidates.get(b.candidateId) : undefined;
        if (c?.kind === 'boundary')
          net.set(c.statusId, (net.get(c.statusId) ?? 0) + (c.role === 'start' ? 1 : -1));
      }
      return [...net].filter(([, n]) => n !== 0).sort(([a], [b]) => a.localeCompare(b));
    });
    if (new Set(signatures.map((s) => JSON.stringify(s))).size > 1) {
      addIssue('option_status', '各方案对外开启／关闭的状态不一致；Option 之外的相关状态未知。', [
        option.id,
      ]);
      const b = bounds(option);
      const changedIds = [...new Set(signatures.flatMap((s) => s.map(([id]) => id)))].filter(
        (id) =>
          new Set(signatures.map((signature) => signature.find(([key]) => key === id)?.[1] ?? 0))
            .size > 1,
      );
      if (b) ambiguities.push({ optionId: option.id, statusIds: changedIds, ...b });
    }
    for (const v of option.variants)
      if (!v.blocks.length)
        addIssue(
          'variant_empty',
          `「${v.title}」没有项目，无法确定完整路径。`,
          [option.id],
          '',
          'warning',
        );
  }
  if (ms(w.trip.displayEnd) <= ms(w.trip.displayStart))
    addIssue('display_range', '显示结束时间应晚于开始时间。', ['trip']);
  const metadataOwners = [
    ...w.candidates,
    ...w.statuses,
    ...w.blocks.flatMap((b) =>
      b.kind === 'option'
        ? [b, ...b.variants.flatMap((v) => v.blocks).filter((b) => b.kind === 'hotelRest')]
        : b.kind === 'hotelRest'
          ? [b]
          : [],
    ),
  ];
  for (const owner of metadataOwners)
    for (const id of owner.metadata.attachmentIds)
      if (!w.attachments.some((a) => a.id === id))
        addIssue('attachment_missing', '项目引用了不存在的附件记录。', [owner.id]);
  for (const status of w.statuses)
    if (!hasLocation(status.location))
      addIssue('status_location', `「${status.title}」缺少状态地点。`, [status.id], '', 'warning');
  let scenarioCount = 0;
  for (const path of paths(w)) {
    scenarioCount++;
    const context = path.context;
    const ordered = [...path.blocks].sort(
      (a, b) => ms(a.start) - ms(b.start) || a.id.localeCompare(b.id),
    );
    const intervals: StatusInterval[] = [];
    const boundaryGroups = new Map<
      string,
      { block: ConcreteBlock; candidate: Extract<Candidate, { kind: 'boundary' }> }[]
    >();
    for (const b of ordered) {
      const c = b.kind === 'candidate' ? candidates.get(b.candidateId) : undefined;
      if (c?.kind === 'boundary') {
        const group = boundaryGroups.get(c.statusId) ?? [];
        group.push({ block: b, candidate: c });
        boundaryGroups.set(c.statusId, group);
      }
    }
    for (const [statusId, group] of boundaryGroups) {
      const status = w.statuses.find((s) => s.id === statusId);
      const starts = group.filter((g) => g.candidate.role === 'start'),
        ends = group.filter((g) => g.candidate.role === 'end');
      const targets = [statusId, ...group.map((g) => g.block.id)];
      if (!status) {
        addIssue('status_missing', 'Boundary 引用了不存在的状态。', targets, context);
        continue;
      }
      if (starts.length !== 1 || ends.length !== 1) {
        addIssue(
          'boundary_pair',
          `「${status.title}」需要恰好一个开始 Boundary 和一个结束 Boundary（当前 ${starts.length} / ${ends.length}）。`,
          targets,
          context,
        );
        continue;
      }
      const start = ms(starts[0].block.end),
        end = ms(ends[0].block.start);
      if (start >= end || ms(starts[0].block.start) >= start || end >= ms(ends[0].block.end)) {
        addIssue('status_order', `「${status.title}」状态区间或办理时间无效。`, targets, context);
        continue;
      }
      const ambiguity = ambiguities.filter((a) => a.statusIds.includes(statusId));
      const interval: StatusInterval = {
        id: `${statusId}:${starts[0].block.id}:${ends[0].block.id}`,
        status,
        start,
        end,
        startId: starts[0].block.id,
        endId: ends[0].block.id,
        context,
        ambiguousAfter: ambiguity.length ? Math.min(...ambiguity.map((a) => a.start)) : null,
      };
      intervals.push(interval);
      statusMap.set(interval.id, interval);
    }
    const covering = (kind: Status['kind'], start: number, end: number, owner?: string) =>
      intervals.filter(
        (i) =>
          i.status.kind === kind &&
          i.start <= start &&
          i.end >= end &&
          !ambiguities.some(
            (a) => a.statusIds.includes(i.status.id) && end > a.start && owner !== a.optionId,
          ),
      );
    for (let i = 0; i < intervals.length; i++)
      for (let j = i + 1; j < intervals.length; j++) {
        const a = intervals[i],
          b = intervals[j];
        if (a.status.kind === b.status.kind && Math.max(a.start, b.start) < Math.min(a.end, b.end))
          addIssue(
            'status_overlap',
            `「${a.status.title}」与「${b.status.title}」状态重叠，无法唯一确定当前状态。`,
            [a.status.id, b.status.id, a.startId, b.startId],
            context,
          );
      }
    const nodes: Node[] = ordered.map((block) => {
      const c = block.kind === 'candidate' ? candidates.get(block.candidateId) : undefined;
      const start = ms(block.start),
        end = ms(block.end),
        owner = owners.get(block.id);
      const title = blockTitle(w, block);
      if (end <= start)
        addIssue('duration_positive', 'Placement 必须有正数 duration。', [block.id], context);
      let origin = emptyLocation(),
        destination = emptyLocation();
      if (block.kind === 'hotelRest') {
        const hotels = covering('hotel', start, end, owner);
        if (hotels.length !== 1)
          addIssue(
            'hotel_rest',
            '酒店休息的整个 Placement 必须由同一个唯一有效酒店状态覆盖。',
            [block.id],
            context,
          );
        else {
          origin = destination = hotels[0].status.location;
          const locations = restLocations[block.id] ?? [];
          if (!locations.some((l) => sameLocation(l, origin))) locations.push(origin);
          restLocations[block.id] = locations;
        }
      } else if (!c)
        addIssue('candidate_missing', 'Placement 引用了不存在的 Candidate。', [block.id], context);
      else if (c.kind === 'transport') {
        origin = c.origin;
        destination = c.destination;
        if (start !== ms(c.departure) || end !== ms(c.arrival))
          addIssue(
            'scheduled_mismatch',
            'Placement 与 Scheduled time 不一致；Scheduled time 未被修改。',
            [block.id, c.id],
            context,
          );
        if (ms(c.arrival) <= ms(c.departure))
          addIssue(
            'schedule_order',
            'Scheduled Arrival 必须晚于 Departure。',
            [block.id, c.id],
            context,
          );
      } else {
        origin = destination = c.location;
        if (c.kind === 'activity') {
          const minutes = (end - start) / 60000;
          if (c.constraints.minMinutes !== null && minutes < c.constraints.minMinutes)
            addIssue(
              'duration_min',
              `时长不足：至少需要 ${c.constraints.minMinutes} 分钟。`,
              [block.id, c.id],
              context,
            );
          if (c.constraints.maxMinutes !== null && minutes > c.constraints.maxMinutes)
            addIssue(
              'duration_max',
              `时长超限：最多允许 ${c.constraints.maxMinutes} 分钟。`,
              [block.id, c.id],
              context,
            );
          const ranges = c.constraints.intervals;
          if (
            ranges.length &&
            !ranges.some(
              (r) =>
                ms(r.end) > ms(r.start) &&
                (r.relation === 'within'
                  ? start >= ms(r.start) && end <= ms(r.end)
                  : start <= ms(r.start) && end >= ms(r.end)),
            )
          )
            addIssue(
              'time_constraint',
              'Placement 不满足任何一个合法时间区间。',
              [block.id, c.id],
              context,
            );
        }
      }
      if (!hasLocation(origin) || !hasLocation(destination))
        addIssue('location_missing', '缺少地点，相关路线无法计算。', [block.id], context);
      return {
        id: block.id,
        title,
        start: c?.kind === 'transport' ? ms(c.departure) - c.preBuffer * 60000 : start,
        end: c?.kind === 'transport' ? ms(c.arrival) + c.postBuffer * 60000 : end,
        origin,
        destination,
        block,
        candidate: c,
        owner,
      };
    });
    // Check every pair, including contained overlaps; never only adjacent pairs.
    for (let i = 0; i < ordered.length; i++)
      for (let j = i + 1; j < ordered.length; j++) {
        const a = ordered[i],
          b = ordered[j];
        if (Math.max(ms(a.start), ms(b.start)) < Math.min(ms(a.end), ms(b.end)))
          addIssue(
            'overlap',
            `「${blockTitle(w, a)}」与「${blockTitle(w, b)}」Placement 重叠。`,
            [a.id, b.id],
            context,
          );
      }
    const makeEdge = (a: Node, b: Node, anchor: 'forward' | 'backward' = 'forward'): Edge => {
      const key = `${a.id}>${b.id}`,
        override = w.edgeOverrides[key],
        owner = a.owner === b.owner ? a.owner : undefined;
      const probe = anchor === 'forward' ? a.end : b.start;
      const ambiguousCar = ambiguities.filter(
        (a) =>
          owner !== a.optionId &&
          probe >= a.start &&
          a.statusIds.some((id) => w.statuses.find((s) => s.id === id)?.kind === 'rentalCar'),
      );
      let carAtProbe = covering('rentalCar', probe, probe, owner).length === 1;
      let mode: Mode = override ?? (carAtProbe ? 'DRIVE' : 'WALK');
      let modeKnown = true;
      const read = (m: Mode): RouteResult =>
        sameLocation(a.destination, b.origin)
          ? { status: 'ok', minutes: 0, distanceMeters: 0, source: 'same-location' }
          : !hasLocation(a.destination) || !hasLocation(b.origin)
            ? unknownRoute('缺少起点或终点')
            : config.routingProvider === 'unavailable'
              ? unknownRoute('路线查询已在设置中关闭')
              : lookup(a.destination, b.origin, m);
      if (!override && carAtProbe) {
        const driving = read('DRIVE');
        if (driving.status === 'ok') {
          const elapsed = (driving.minutes + config.overhead.DRIVE) * 60000;
          carAtProbe =
            covering(
              'rentalCar',
              anchor === 'forward' ? probe : probe - elapsed,
              anchor === 'forward' ? probe + elapsed : probe,
              owner,
            ).length === 1;
          if (!carAtProbe) mode = 'WALK';
        }
      }
      if (!override && !carAtProbe) {
        const walking = read('WALK');
        if (walking.status === 'ok')
          mode = walking.minutes <= config.walkingThreshold ? 'WALK' : 'RIDESHARE';
        else modeKnown = false;
      }
      if (!override && ambiguousCar.length) modeKnown = false;
      const route = read(mode),
        overhead = config.overhead[mode];
      const effectiveMinutes = route.status === 'ok' && modeKnown ? route.minutes + overhead : null;
      const departure =
        anchor === 'forward'
          ? a.end
          : effectiveMinutes === null
            ? null
            : b.start - effectiveMinutes * 60000;
      const arrival =
        anchor === 'backward'
          ? b.start
          : effectiveMinutes === null
            ? null
            : a.end + effectiveMinutes * 60000;
      const edge: Edge = {
        id: `edge:${key}`,
        key,
        fromId: a.id,
        toId: b.id,
        fromTitle: a.title,
        toTitle: b.title,
        origin: a.destination,
        destination: b.origin,
        mode,
        overridden: Boolean(override),
        modeKnown,
        route,
        overhead,
        effectiveMinutes,
        departure,
        arrival,
        availableMinutes:
          a.id === 'trip-start' ||
          b.id === 'trip-end' ||
          a.id.startsWith('overnight:') ||
          b.id.startsWith('overnight:')
            ? null
            : (b.start - a.end) / 60000,
        context,
        optionIds: [...new Set([a.owner, b.owner].filter(Boolean))] as string[],
      };
      const targets = [edge.id, a.id, b.id, ...edge.optionIds];
      if (route.status !== 'ok')
        addIssue('route_unknown', route.message, targets, context, 'warning');
      if (!modeKnown)
        addIssue(
          'mode_unknown',
          ambiguousCar.length
            ? 'Option 对外租车状态未知，默认交通方式无法确认。'
            : '步行耗时未知，默认交通方式尚无法确认。',
          [...targets, ...ambiguousCar.map((a) => a.optionId)],
          context,
          'warning',
        );
      if (
        effectiveMinutes !== null &&
        edge.availableMinutes !== null &&
        effectiveMinutes > edge.availableMinutes
      )
        addIssue(
          'travel_short',
          `路程与额外耗时共需 ${Math.ceil(effectiveMinutes)} 分钟，当前仅有 ${Math.floor(edge.availableMinutes)} 分钟。`,
          targets,
          context,
        );
      if (
        mode === 'DRIVE' &&
        (departure !== null && arrival !== null
          ? covering('rentalCar', departure, arrival, owner).length !== 1
          : !carAtProbe)
      )
        addIssue('drive_without_car', '驾驶路段未被唯一有效的租车状态完整覆盖。', targets, context);
      // Same endpoint pair can have different results in different Option contexts.
      const storageKey = JSON.stringify([key, mode, departure, arrival, effectiveMinutes]);
      edgeMap.set(storageKey, edge);
      return edge;
    };
    const breaks = [...w.trip.overnightBreaks].sort((a, b) => ms(a.time) - ms(b.time));
    const hotelForBreak = new Map<string, StatusInterval>();
    for (const br of breaks) {
      const time = ms(br.time),
        crossing = ordered.filter((b) => ms(b.start) < time && ms(b.end) > time);
      for (const b of crossing)
        addIssue(
          'break_overlap',
          'Overnight Break Point 与实际项目冲突，请修改或删除该 Break Point。',
          [br.id, b.id],
          context,
        );
      const hotels = covering('hotel', time, time);
      if (hotels.length !== 1)
        addIssue('lodging_missing', '此住宿检查点没有唯一有效的酒店覆盖。', [br.id], context);
      else if (!crossing.length) hotelForBreak.set(br.id, hotels[0]);
    }
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i],
        b = nodes[i + 1];
      const between = breaks.filter(
        (br) => ms(br.time) >= ms(a.block!.end) && ms(br.time) <= ms(b.block!.start),
      );
      // Both travel periods must contain a concrete block. Empty intermediate periods don't invent stays.
      if (between.length === 1 && hotelForBreak.has(between[0].id)) {
        const br = between[0],
          hotel = hotelForBreak.get(br.id)!;
        const id = `overnight:${br.id}:${hotel.status.id}`;
        const node: Node = {
          id,
          title: hotel.status.title,
          origin: hotel.status.location,
          destination: hotel.status.location,
          start: ms(br.time),
          end: ms(br.time),
        };
        const incoming = makeEdge(a, node),
          outgoing = makeEdge(node, b, 'backward');
        const start = incoming.arrival,
          end = outgoing.departure;
        derivedMap.set(`${id}:${start}:${end}`, {
          id,
          kind: 'overnight',
          title: hotel.status.title,
          location: hotel.status.location,
          start,
          end,
          anchor: ms(br.time),
          context,
        });
        if (
          start !== null &&
          end !== null &&
          (start > ms(br.time) || end < ms(br.time) || start > end)
        )
          addIssue(
            'overnight_short',
            '往返酒店的路线与住宿检查点不相容，无法形成有效休息区间。',
            [br.id, id, a.id, b.id],
            context,
          );
      } else makeEdge(a, b);
    }
    if (nodes.length) {
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      const start: Node = {
        id: 'trip-start',
        title: '旅行起点',
        origin: w.trip.startLocation,
        destination: w.trip.startLocation,
        start: first.start,
        end: first.start,
      };
      const end: Node = {
        id: 'trip-end',
        title: '旅行终点',
        origin: w.trip.endLocation,
        destination: w.trip.endLocation,
        start: last.end,
        end: last.end,
      };
      const incoming = makeEdge(start, first, 'backward'),
        outgoing = makeEdge(last, end);
      derivedMap.set(`trip-start:${incoming.departure}`, {
        id: 'trip-start',
        kind: 'start',
        title: '必须出发',
        location: w.trip.startLocation,
        start: incoming.departure,
        end: incoming.departure,
        anchor: first.start,
        context,
      });
      derivedMap.set(`trip-end:${outgoing.arrival}`, {
        id: 'trip-end',
        kind: 'end',
        title: '预计到达',
        location: w.trip.endLocation,
        start: outgoing.arrival,
        end: outgoing.arrival,
        anchor: last.end,
        context,
      });
    }
  }
  const issues = [...issueMap.values()];
  for (const option of options) {
    const errors = issues.filter((i) => i.severity === 'error' && i.targetIds.includes(option.id));
    if (errors.length)
      addIssue(
        'option_worst_case',
        `至少一个方案的完整路径不可行（${errors.length} 项冲突），请检查所有方案及进出路线。`,
        [option.id],
      );
  }
  const allDerived = [...derivedMap.values()];
  const endpoints: DerivedBlock[] = [];
  for (const kind of ['start', 'end'] as const) {
    const alternatives = allDerived.filter((b) => b.kind === kind);
    if (!alternatives.length) continue;
    const unknown = alternatives.some((b) => b.start === null);
    const time = unknown
      ? null
      : (kind === 'start' ? Math.min : Math.max)(...alternatives.map((b) => b.start!));
    endpoints.push({
      ...alternatives[0],
      start: time,
      end: time,
      context: alternatives
        .map((b) => b.context)
        .filter(Boolean)
        .join('；'),
    });
  }
  return {
    issues: [...issueMap.values()],
    edges: [...edgeMap.values()],
    statuses: [...statusMap.values()],
    unknownStatuses: ambiguities.flatMap((a) =>
      a.statusIds.map((statusId) => ({ optionId: a.optionId, statusId, start: a.start })),
    ),
    blocks: [...allDerived.filter((b) => b.kind === 'overnight'), ...endpoints],
    scenarioCount,
    restLocations,
  };
}
