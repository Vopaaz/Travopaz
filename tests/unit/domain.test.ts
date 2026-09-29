import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { createWorkspace, placeCandidate } from '../../src/domain/factory';
import { derive } from '../../src/domain/derive';
import { edgeTiming } from '../../src/domain/edgeTiming';
import { bounds, moveBlocks, unwrapOption, wrapOption } from '../../src/domain/operations';
import {
  emptyLocation,
  emptyMetadata,
  parseWorkspace,
  uid,
  type Candidate,
  type Workspace,
  type ConcreteBlock,
  type OptionBlock,
} from '../../src/domain/schema';
import { at, fromLocal, ms, shiftTime, daysBetween } from '../../src/domain/time';
import type { RouteLookup } from '../../src/domain/routing';
import { issueContextsWorkspace } from '../fixtures/issueContexts';

const zone = 'Asia/Tokyo';
const t = (hours: number) =>
  at(DateTime.fromISO('2026-10-12T00:00', { zone }).toMillis() + hours * 3600000, zone);
const location = (name: string) => ({ ...emptyLocation(), name, address: name });
const route: RouteLookup = () => ({
  status: 'ok',
  minutes: 10,
  distanceMeters: 800,
  source: 'test',
});
function workspace() {
  const w = createWorkspace('测试');
  w.trip.timezones = [zone, 'America/Los_Angeles'];
  w.trip.primaryTimezone = zone;
  w.trip.displayStart = t(0);
  w.trip.displayEnd = t(72);
  w.trip.overnightBreaks = [];
  w.trip.startLocation = location('家');
  w.trip.endLocation = location('家');
  return w;
}
function activity(w: Workspace, title: string, start: number, end: number): ConcreteBlock {
  const c: Candidate = {
    id: uid(),
    kind: 'activity',
    title,
    location: location(title),
    metadata: emptyMetadata(),
    constraints: { intervals: [], minMinutes: null, maxMinutes: null },
  };
  w.candidates.push(c);
  const b: ConcreteBlock = {
    id: uid(),
    kind: 'candidate',
    candidateId: c.id,
    start: t(start),
    end: t(end),
  };
  w.blocks.push(b);
  return b;
}
function status(w: Workspace, kind: 'hotel' | 'rentalCar', start: number, end: number) {
  const id = uid();
  w.statuses.push({ id, kind, title: id, location: location(kind), metadata: emptyMetadata() });
  const boundary = (role: 'start' | 'end', hour: number) => {
    const c: Candidate = {
      id: uid(),
      kind: 'boundary',
      title: role,
      location: location(kind),
      metadata: emptyMetadata(),
      statusId: id,
      role,
      defaultStart: t(hour),
      defaultEnd: t(hour + 0.5),
    };
    w.candidates.push(c);
    const b = placeCandidate(c, 0, zone);
    w.blocks.push(b);
    return b;
  };
  return { id, pickup: boundary('start', start), dropoff: boundary('end', end) };
}
const codes = (w: Workspace, lookup = route) => derive(w, lookup).issues.map((i) => i.code);

describe('路线耗时与冲突共用时间语义', () => {
  it.each([
    [20.2, 10, 30, false, '30 分钟', '30 分钟'],
    [20.1, 10.2, 30.3, false, '30 分钟', '30 分钟'],
    [20.5 - 1 / 60000, 10, 30, false, '30 分钟', '30 分钟'],
    [20.5, 10, 30, true, '31 分钟', '30 分钟'],
    [20.5 + 1 / 60000, 10, 30, true, '31 分钟', '30 分钟'],
    [20.5, 10, 30.5 - 1 / 60000, true, '31 分钟', '30 分钟'],
    [20.5, 10, 30.5, false, '31 分钟', '31 分钟'],
    [20.8, 10, 30.5, false, '31 分钟', '31 分钟'],
    [20.3, 10.3, 30, true, '31 分钟', '30 分钟'],
    [59.5, 0, 60, false, '1 小时', '1 小时'],
    [59 + 59 / 60, 1 / 60, 60, false, '1 小时', '1 小时'],
  ] as const)(
    '路线 %s + buffer %s，空档 %s 的显示与检查一致',
    (minutes, buffer, gap, conflict, requiredText, availableText) => {
      const w = workspace();
      const a = activity(w, 'A', 9, 10);
      const b = activity(w, 'B', 11, 12);
      b.start = shiftTime(a.end, gap);
      const key = `${a.id}>${b.id}`;
      w.edgeOverrides[key] = 'WALK';
      w.edgeOverheadOverrides[key] = buffer;
      const d = derive(w, () => ({ status: 'ok', minutes, distanceMeters: 800, source: 'test' }));
      const edge = d.edges.find((e) => e.key === key)!;
      expect(edgeTiming(edge)).toMatchObject({
        requiredText,
        availableText,
        slotText: availableText,
        insufficient: conflict,
      });
      const issue = d.issues.find(
        (i) => i.code === 'travel_short' && i.targetIds.includes(edge.id),
      );
      expect(Boolean(issue)).toBe(conflict);
      if (conflict)
        expect(issue?.message).toBe(
          `路程与额外耗时共需 ${requiredText}，当前仅有 ${availableText}。`,
        );
    },
  );
  it('推导路段的时段也取整，未知路线仍然未知', () => {
    const w = workspace();
    const a = activity(w, 'A', 9, 10);
    w.edgeOverrides[`trip-start>${a.id}`] = 'WALK';
    w.edgeOverheadOverrides[`trip-start>${a.id}`] = 20.5;
    const incoming = (d: ReturnType<typeof derive>) =>
      d.edges.find((e) => e.fromId === 'trip-start')!;
    expect(edgeTiming(incoming(derive(w, route)))).toMatchObject({
      requiredText: '31 分钟',
      slotText: '31 分钟（推导）',
      insufficient: false,
    });
    expect(edgeTiming(incoming(derive(w)))).toMatchObject({
      requiredText: '未知',
      slotText: '未知（推导）',
      insufficient: false,
    });
  });
});

describe('用户拥有 Placement', () => {
  it('derive 不修改任何 canonical 数据；interval 与 duration 独立检查', () => {
    const w = workspace(),
      b = activity(w, '演出', 19.25, 19.75),
      c = w.candidates[0];
    if (c.kind !== 'activity') throw new Error();
    c.constraints = {
      minMinutes: 60,
      maxMinutes: 100,
      intervals: [
        { relation: 'covers', start: t(19), end: t(20) },
        { relation: 'within', start: t(10), end: t(12) },
      ],
    };
    const before = JSON.stringify(w);
    const result = derive(w, route);
    expect(result.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['duration_min', 'time_constraint']),
    );
    expect(JSON.stringify(w)).toBe(before);
    expect(ms(b.start)).toBe(ms(t(19.25)));
  });
  it('覆盖候选区间只需满足其中之一；精确 duration 用 min=max', () => {
    const w = workspace();
    activity(w, '演出', 19, 20);
    const c = w.candidates[0];
    if (c.kind !== 'activity') throw new Error();
    c.constraints = {
      minMinutes: 60,
      maxMinutes: 60,
      intervals: [
        { relation: 'within', start: t(9), end: t(12) },
        { relation: 'covers', start: t(19), end: t(20) },
      ],
    };
    expect(codes(w)).not.toContain('time_constraint');
    expect(codes(w)).not.toContain('duration_min');
    expect(codes(w)).not.toContain('duration_max');
  });
  it('批量平移包含 Option 时不重复移动已选中的子项目', () => {
    const w = workspace(),
      a = activity(w, 'A', 9, 10),
      b = activity(w, 'B', 11, 12);
    const o = wrapOption(w, [a.id]);
    moveBlocks(w, [o.id, a.id, b.id], 30);
    expect(ms(a.start)).toBe(ms(t(9.5)));
    expect(ms(b.start)).toBe(ms(t(11.5)));
    expect(bounds(o)?.start).toBe(ms(a.start));
    expect('start' in o).toBe(false);
  });
  it('检查所有重叠对，不遗漏包住多个项目的长活动', () => {
    const w = workspace();
    activity(w, '长活动', 9, 15);
    activity(w, '短1', 10, 11);
    activity(w, '短2', 12, 13);
    expect(derive(w, route).issues.filter((i) => i.code === 'overlap')).toHaveLength(2);
  });
  it('主要交通初始 Placement 复制 scheduled，移动后只报错；路线使用缓冲外沿', () => {
    const w = workspace();
    const a = activity(w, '机场附近', 8, 8.5);
    const c: Candidate = {
      id: uid(),
      kind: 'transport',
      title: '航班',
      subtype: 'flight',
      origin: location('机场'),
      destination: location('目的机场'),
      departure: t(10),
      arrival: t(12),
      preBuffer: 60,
      postBuffer: 30,
      operator: '',
      serviceNumber: '',
      metadata: emptyMetadata(),
    };
    w.candidates.push(c);
    const b = placeCandidate(c, ms(t(7)), zone);
    w.blocks.push(b);
    const next = activity(w, '午饭', 13, 14);
    const result = derive(w, route);
    expect(result.edges.find((e) => e.toId === b.id && e.fromId === a.id)?.availableMinutes).toBe(
      30,
    );
    expect(result.edges.find((e) => e.fromId === b.id && e.toId === next.id)?.departure).toBe(
      ms(t(12.5)),
    );
    moveBlocks(w, [b.id], 30);
    expect(codes(w)).toContain('scheduled_mismatch');
    expect(ms(c.departure)).toBe(ms(t(10)));
  });
});
describe('酒店、租车与住宿检查', () => {
  it('状态从开始手续结束到结束手续开始，Boundary 必须正时长与成对', () => {
    const w = workspace(),
      s = status(w, 'hotel', 14, 58);
    const d = derive(w, route);
    expect(d.statuses[0].start).toBe(ms(t(14.5)));
    expect(d.statuses[0].end).toBe(ms(t(58)));
    w.blocks = w.blocks.filter((b) => b.id !== s.dropoff.id);
    expect(codes(w)).toContain('boundary_pair');
    s.pickup.end = s.pickup.start;
    expect(codes(w)).toContain('duration_positive');
  });
  it('酒店休息需要整个 Placement 被同一酒店覆盖', () => {
    const w = workspace();
    status(w, 'hotel', 14, 58);
    w.blocks.push({
      id: uid(),
      kind: 'hotelRest',
      title: '休息',
      start: t(14.25),
      end: t(15),
      metadata: emptyMetadata(),
    });
    expect(codes(w)).toContain('hotel_rest');
    (w.blocks[2] as ConcreteBlock).start = t(15);
    expect(codes(w)).not.toContain('hotel_rest');
  });
  it('生成只读 Overnight，删除 breakpoint 后不再要求住宿', () => {
    const w = workspace();
    activity(w, '晚餐', 19, 20);
    activity(w, '早餐', 32, 33);
    const point = { id: uid(), time: t(27.5) };
    w.trip.overnightBreaks = [point];
    expect(codes(w)).toContain('lodging_missing');
    status(w, 'hotel', 14, 58);
    const overnight = derive(w, route).blocks.find((b) => b.kind === 'overnight');
    expect(overnight?.start).toBe(ms(t(20)) + 10 * 60000);
    expect(overnight?.end).toBe(ms(t(32)) - 10 * 60000);
    w.trip.overnightBreaks = [];
    expect(derive(w, route).blocks.filter((b) => b.kind === 'overnight')).toHaveLength(0);
    expect(codes(w)).not.toContain('lodging_missing');
  });
  it('实际活动跨过 break point 必须报错，不静默豁免', () => {
    const w = workspace();
    status(w, 'hotel', 14, 58);
    activity(w, '夜间活动', 25, 30);
    w.trip.overnightBreaks = [{ id: uid(), time: t(27.5) }];
    expect(codes(w)).toContain('break_overlap');
    expect(derive(w, route).blocks.some((b) => b.kind === 'overnight')).toBe(false);
  });
  it('取车完成后默认 DRIVE；手动 DRIVE 在无车时保留并报错', () => {
    const w = workspace();
    const s = status(w, 'rentalCar', 8, 17),
      b = activity(w, '景点', 10, 11);
    expect(
      derive(w, route).edges.find((e) => e.fromId === s.pickup.id && e.toId === b.id)?.mode,
    ).toBe('DRIVE');
    w.blocks = w.blocks.filter((x) => x.id !== s.pickup.id && x.id !== s.dropoff.id);
    w.edgeOverrides[`trip-start>${b.id}`] = 'DRIVE';
    const d = derive(w, route);
    expect(d.edges.find((e) => e.toId === b.id)?.mode).toBe('DRIVE');
    expect(d.issues.some((i) => i.code === 'drive_without_car')).toBe(true);
  });
});
describe('Option 完整路径', () => {
  it('各方案可在不同时刻开启同一实例，主 Timeline 仍有确定状态', () => {
    const w = workspace(),
      car = status(w, 'rentalCar', 8, 17);
    const first = car.pickup,
      second = structuredClone(first);
    second.id = uid();
    second.start = t(9);
    second.end = t(9.5);
    const o = wrapOption(w, [first.id]);
    o.variants.push({ id: uid(), title: '稍晚取车', blocks: [second] });
    const a = activity(w, '午饭', 11, 12),
      b = activity(w, '下午', 13, 14);
    const d = derive(w, route);
    expect(d.issues.some((i) => i.code === 'option_status')).toBe(false);
    expect(d.unknownStatuses).toHaveLength(0);
    expect(
      d.edges.filter((e) => e.fromId === a.id && e.toId === b.id).every((e) => e.mode === 'DRIVE'),
    ).toBe(true);
  });
  it('一个方案内部开关完整配对时，其他方案可完全不涉及状态', () => {
    const w = workspace(),
      car = status(w, 'rentalCar', 8, 11);
    const o = wrapOption(w, [car.pickup.id, car.dropoff.id]);
    const b = activity(w, '步行游览', 9, 10);
    w.blocks = w.blocks.filter((x) => x.id !== b.id);
    o.variants.push({ id: uid(), title: '不租车', blocks: [b] });
    expect(codes(w)).not.toContain('option_status');
  });
  it('不同实例对外开启必须报错，后续状态未知且不擅自推导路线总时长', () => {
    const w = workspace(),
      car = status(w, 'rentalCar', 8, 17),
      car2 = status(w, 'rentalCar', 8, 18);
    const o = wrapOption(w, [car.pickup.id]);
    w.blocks = w.blocks.filter((x) => x.id !== car2.pickup.id);
    o.variants.push({ id: uid(), title: '另一笔租车', blocks: [car2.pickup] });
    const a = activity(w, '午饭', 11, 12),
      b = activity(w, '下午', 13, 14),
      d = derive(w, route);
    expect(d.issues.some((i) => i.code === 'option_status' && i.targetIds.includes(o.id))).toBe(
      true,
    );
    expect(d.unknownStatuses.map((s) => s.statusId)).toEqual(
      expect.arrayContaining([car.id, car2.id]),
    );
    const edge = d.edges.find((e) => e.fromId === a.id && e.toId === b.id);
    expect(edge?.modeKnown).toBe(false);
    expect(edge?.effectiveMinutes).toBeNull();
  });
  it('租车不一致不应污染各方案一致开启的酒店状态', () => {
    const w = workspace(),
      car = status(w, 'rentalCar', 8, 17),
      hotel = status(w, 'hotel', 9, 34);
    const o = wrapOption(w, [car.pickup.id, hotel.pickup.id]);
    const secondHotel = structuredClone(hotel.pickup);
    secondHotel.id = uid();
    o.variants.push({ id: uid(), title: '不租车但同一酒店', blocks: [secondHotel] });
    const d = derive(w, route);
    expect(d.unknownStatuses.map((s) => s.statusId)).toEqual([car.id]);
    expect(
      d.statuses.filter((s) => s.status.id === hotel.id).every((s) => s.ambiguousAfter === null),
    ).toBe(true);
  });
  it('所有 Variant 都检查 incoming/outgoing，慢路线导致外层 worst-case issue', () => {
    const w = workspace();
    const previous = activity(w, '前一个', 8, 9),
      a = activity(w, '近景点', 10, 11),
      b = activity(w, '远景点', 10, 11);
    activity(w, '后一个', 12, 13);
    w.blocks = w.blocks.filter((x) => x.id !== a.id && x.id !== b.id);
    const o: OptionBlock = {
      id: uid(),
      kind: 'option',
      title: '方案',
      metadata: emptyMetadata(),
      variants: [
        { id: uid(), title: 'A', blocks: [a] },
        { id: uid(), title: 'B', blocks: [b] },
      ],
    };
    w.blocks.push(o);
    const d = derive(w, (origin, destination) => ({
      status: 'ok',
      minutes: origin.name === '远景点' || destination.name === '远景点' ? 80 : 10,
      distanceMeters: 5000,
      source: 'test',
    }));
    expect(d.scenarioCount).toBe(2);
    expect(d.issues.some((i) => i.code === 'option_worst_case' && i.targetIds.includes(o.id))).toBe(
      true,
    );
    expect(ms(previous.end)).toBe(ms(t(9)));
    expect(w.blocks).toHaveLength(3);
  });
  it('解除包装只允许剩下一个方案，保留内部项目 ID 和 Placement', () => {
    const w = workspace(),
      b = activity(w, 'A', 9, 10),
      o = wrapOption(w, [b.id]);
    o.variants.push({ id: uid(), title: 'B', blocks: [] });
    unwrapOption(w, o.id);
    expect(w.blocks[0].kind).toBe('option');
    o.variants.pop();
    unwrapOption(w, o.id);
    expect(w.blocks[0]).toEqual(b);
  });
});
describe('每条路线的额外耗时', () => {
  it('默认继承旅行配置，覆盖独立于交通方式，显式 0 与留空不同', () => {
    const w = workspace(),
      a = activity(w, 'A', 9, 10),
      b = activity(w, 'B', 11, 12),
      key = `${a.id}>${b.id}`;
    w.globalConfig.overhead.WALK = 3;
    w.trip.config.overhead = { WALK: 7, DRIVE: 11, RIDESHARE: 17 };
    const edge = () => derive(w, route).edges.find((e) => e.key === key)!;
    expect(edge()).toMatchObject({ overhead: 7, effectiveMinutes: 17, overheadOverridden: false });
    w.edgeOverheadOverrides[key] = 0;
    expect(edge()).toMatchObject({ overhead: 0, effectiveMinutes: 10, overheadOverridden: true });
    w.edgeOverheadOverrides[key] = 12.5;
    w.edgeOverrides[key] = 'RIDESHARE';
    expect(edge()).toMatchObject({ mode: 'RIDESHARE', overhead: 12.5, effectiveMinutes: 22.5 });
    delete w.edgeOverheadOverrides[key];
    expect(edge()).toMatchObject({
      mode: 'RIDESHARE',
      overhead: 17,
      effectiveMinutes: 27,
      overheadOverridden: false,
    });
    expect(derive(w, route).edges.find((e) => e.fromId === 'trip-start')?.overhead).toBe(7);
  });
  it('影响路段冲突、抵达时间及必须出发时间，未知路线仍然未知', () => {
    const w = workspace(),
      a = activity(w, 'A', 9, 10),
      b = activity(w, 'B', 10.25, 11),
      key = `${a.id}>${b.id}`;
    w.edgeOverheadOverrides[key] = 10;
    w.edgeOverheadOverrides[`trip-start>${a.id}`] = 30;
    const d = derive(w, route);
    expect(d.edges.find((e) => e.key === key)?.arrival).toBe(ms(t(10)) + 20 * 60000);
    expect(
      d.issues.some((i) => i.code === 'travel_short' && i.targetIds.includes(`edge:${key}`)),
    ).toBe(true);
    expect(d.blocks.find((b) => b.kind === 'start')?.start).toBe(ms(t(9)) - 40 * 60000);
    expect(derive(w).edges.find((e) => e.key === key)?.effectiveMinutes).toBeNull();
  });
  it('默认驾车可行性和手动驾车检查均使用该路段的 buffer', () => {
    const w = workspace(),
      car = status(w, 'rentalCar', 8, 10),
      a = activity(w, '景点', 9, 9.5),
      key = `${a.id}>${car.dropoff.id}`;
    w.globalConfig.overhead.DRIVE = 25;
    expect(derive(w, route).edges.find((e) => e.key === key)?.mode).toBe('WALK');
    w.edgeOverheadOverrides[key] = 0;
    expect(derive(w, route).edges.find((e) => e.key === key)?.mode).toBe('DRIVE');
    w.edgeOverrides[key] = 'DRIVE';
    w.edgeOverheadOverrides[key] = 30;
    expect(
      derive(w, route).issues.some(
        (i) => i.code === 'drive_without_car' && i.targetIds.includes(`edge:${key}`),
      ),
    ).toBe(true);
  });
  it('Option 内部的路段可单独覆盖，并影响对应方案的检查', () => {
    const w = workspace(),
      a = activity(w, 'A', 9, 10),
      b = activity(w, 'B', 10.25, 11),
      o = wrapOption(w, [a.id, b.id]);
    const c = activity(w, 'C', 9, 10),
      d = activity(w, 'D', 10.25, 11);
    w.blocks = w.blocks.filter((block) => block.id !== c.id && block.id !== d.id);
    o.variants.push({ id: uid(), title: '另一方案', blocks: [c, d] });
    w.edgeOverheadOverrides[`${a.id}>${b.id}`] = 10;
    const result = derive(w, route);
    expect(result.edges.find((e) => e.key === `${a.id}>${b.id}`)?.effectiveMinutes).toBe(20);
    expect(result.edges.find((e) => e.key === `${c.id}>${d.id}`)?.effectiveMinutes).toBe(10);
    expect(
      result.issues.some((i) => i.code === 'option_worst_case' && i.targetIds.includes(o.id)),
    ).toBe(true);
  });
  it('无移动允许单独 buffer，仍不查询路线；未设置时为 0', () => {
    const w = workspace(),
      a = activity(w, '同址', 9, 10),
      b = activity(w, '同址', 10.25, 11),
      key = `${a.id}>${b.id}`;
    w.trip.startLocation = w.trip.endLocation = location('同址');
    const lookup = vi.fn(route);
    w.edgeOverheadOverrides[key] = 20;
    const d = derive(w, lookup);
    expect(d.edges.find((e) => e.key === key)).toMatchObject({
      mode: 'NONE',
      route: { minutes: 0 },
      overhead: 20,
      effectiveMinutes: 20,
      overheadOverridden: true,
    });
    expect(
      d.issues.some((i) => i.code === 'travel_short' && i.targetIds.includes(`edge:${key}`)),
    ).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
    delete w.edgeOverheadOverrides[key];
    expect(derive(w, lookup).edges.find((e) => e.key === key)?.effectiveMinutes).toBe(0);
  });
  it('旧工作区默认没有路段覆盖，拒绝负数和无限耗时', () => {
    const { edgeOverheadOverrides, ...legacy } = workspace();
    expect(parseWorkspace(legacy).edgeOverheadOverrides).toEqual({});
    for (const value of [-1, Infinity, NaN])
      expect(() =>
        parseWorkspace({ ...legacy, edgeOverheadOverrides: { 'A>B': value } }),
      ).toThrow();
  });
});
describe('无移动', () => {
  it('同址优先推导无移动，不加任何 overhead，无需路线 API 或有效租车状态', () => {
    const w = workspace();
    const a = activity(w, '同址活动 A', 9, 10),
      b = activity(w, '同址活动 B', 10, 11);
    for (const c of w.candidates) if (c.kind === 'activity') c.location.address = '同一地址';
    w.trip.startLocation = location('同一地址');
    w.trip.endLocation = location('同一地址');
    w.globalConfig.overhead = { WALK: 7, DRIVE: 20, RIDESHARE: 30 };
    w.globalConfig.routingProvider = 'unavailable';
    const lookup = vi.fn(route),
      d = derive(w, lookup);
    expect(lookup).not.toHaveBeenCalled();
    expect(
      d.edges.every((e) => e.mode === 'NONE' && e.overhead === 0 && e.effectiveMinutes === 0),
    ).toBe(true);
    expect(d.edges.find((e) => e.fromId === a.id && e.toId === b.id)?.route.minutes).toBe(0);
    expect(d.issues).toHaveLength(0);
  });
  it('手动无移动保留并持久化；异址或空地点报错，不伪装成有效同址', () => {
    const w = workspace(),
      a = activity(w, 'A', 9, 10),
      b = activity(w, 'B', 11, 12),
      key = `${a.id}>${b.id}`;
    w.edgeOverrides[key] = 'NONE';
    expect(parseWorkspace(w).edgeOverrides[key]).toBe('NONE');
    const lookup = vi.fn(route),
      d = derive(w, lookup),
      edge = d.edges.find((e) => e.key === key)!;
    expect(edge.effectiveMinutes).toBe(0);
    expect(edge.overhead).toBe(0);
    expect(
      d.issues.some((i) => i.code === 'no_movement_location' && i.targetIds.includes(edge.id)),
    ).toBe(true);
    expect(lookup.mock.calls.some(([from, to]) => from.name === 'A' && to.name === 'B')).toBe(
      false,
    );
    for (const c of w.candidates) if (c.kind === 'activity') c.location = emptyLocation();
    expect(codes(w)).toContain('no_movement_location');
  });
  it('租车期间同址仍默认无移动，手动交通方式继续优先于默认值', () => {
    const w = workspace();
    status(w, 'rentalCar', 8, 17);
    const a = activity(w, '景点', 10, 11),
      b = activity(w, '景点', 11, 12),
      key = `${a.id}>${b.id}`;
    expect(derive(w, route).edges.find((e) => e.key === key)?.mode).toBe('NONE');
    w.edgeOverrides[key] = 'DRIVE';
    expect(derive(w, route).edges.find((e) => e.key === key)?.mode).toBe('DRIVE');
  });
});
describe('冲突与路线的相关方案', () => {
  it('共同路段只显示一次冲突，不附带之后 40 种无关的完整方案组合', () => {
    const w = issueContextsWorkspace();
    const before = JSON.stringify(w);
    const d = derive(w, () => ({
      status: 'ok',
      minutes: 5.5,
      distanceMeters: 800,
      source: 'test',
    }));
    const edge = d.edges.find((e) => e.key === 'airport>costco')!;
    const issues = d.issues.filter((i) => i.targetIds.includes(edge.id));
    expect(d.scenarioCount).toBe(40);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe('路程与额外耗时共需 16 分钟，当前仅有 15 分钟。');
    expect(issues[0].contexts).toEqual([]);
    expect(edge.context).toBe('');
    expect(d.blocks.find((b) => b.kind === 'start')?.context).toBe('');
    expect(JSON.stringify(w)).toBe(before);
  });

  it('方案专属的进出路线保留相关方案，但不展开其他独立 Option', () => {
    const w = issueContextsWorkspace();
    const d = derive(w, (origin, destination) => ({
      status: 'ok',
      minutes: destination.name === '午餐候选地点 1' ? 3000 : 10,
      distanceMeters: 800,
      source: 'test',
    }));
    const edge = d.edges.find((e) => e.key === 'costco>choice-0-0')!;
    const issue = d.issues.find((i) => i.code === 'travel_short' && i.targetIds.includes(edge.id))!;
    expect(issue.contexts).toEqual(['午餐候选 · 方案 1']);
    expect(edge.context).toBe('午餐候选 · 方案 1');
  });

  it('主时间轴的状态冲突仍能指出影响它的上游方案，端点只标注决定其时间的方案', () => {
    const w = workspace();
    const hotel = status(w, 'hotel', 14, 34);
    const checkIn = wrapOption(w, [hotel.pickup.id]);
    checkIn.title = '入住时间';
    checkIn.variants[0].title = '早入住';
    checkIn.variants.push({
      id: uid(),
      title: '晚入住',
      blocks: [{ ...hotel.pickup, id: uid(), start: t(16), end: t(16.5) }],
    });
    const rest = {
      id: uid(),
      kind: 'hotelRest' as const,
      title: '休息',
      start: t(15),
      end: t(15.5),
      metadata: emptyMetadata(),
    };
    w.blocks.push(rest);
    const a = activity(w, '后一天 A', 40, 41),
      b = activity(w, '后一天 B', 40, 41);
    w.blocks = w.blocks.filter((block) => block.id !== b.id);
    const future = wrapOption(w, [a.id]);
    future.variants.push({ id: uid(), title: 'B', blocks: [b] });
    const d = derive(w, route);
    expect(
      d.issues.find((i) => i.code === 'hotel_rest' && i.targetIds.includes(rest.id))?.contexts,
    ).toEqual(['入住时间 · 晚入住']);
    expect(d.statuses.map((s) => s.context).sort()).toEqual([
      '入住时间 · 早入住',
      '入住时间 · 晚入住',
    ]);
    // Late check-in leaves the first rest's location unknown, so departure is unknown too.
    expect(d.blocks.find((block) => block.kind === 'start')?.start).toBeNull();
    expect(d.blocks.find((block) => block.kind === 'start')?.context).toBe('入住时间 · 晚入住');
    expect(d.blocks.find((block) => block.kind === 'end')?.context).toBe('');
    rest.start = t(17);
    rest.end = t(17.5);
    const knownDeparture = derive(w, route).blocks.find((block) => block.kind === 'start');
    expect(knownDeparture?.start).toBe(ms(t(14)) - 10 * 60000);
    expect(knownDeparture?.context).toBe('入住时间 · 早入住');
  });
});
describe('时区与 schema', () => {
  it('start/end 可拥有不同原始时区，duration 使用绝对时间', () => {
    const a = fromLocal('2026-10-12T10:00', 'Asia/Tokyo'),
      b = fromLocal('2026-10-12T10:00', 'America/Los_Angeles');
    expect((ms(b) - ms(a)) / 3600000).toBe(16);
    expect(a.timezone).toBe('Asia/Tokyo');
  });
  it('DST 跳跃日与回拨日按真实分钟数，拒绝不存在的本地时间', () => {
    const zone = 'America/Los_Angeles';
    expect(() => fromLocal('2026-03-08T02:30', zone)).toThrow();
    const day = daysBetween(
      fromLocal('2026-03-08T00:00', zone),
      fromLocal('2026-03-08T23:59', zone),
      zone,
    )[0];
    expect(day.plus({ days: 1 }).diff(day, 'hours').hours).toBe(23);
    const fall = DateTime.fromISO('2026-11-01T01:30', { zone });
    expect(fall.getPossibleOffsets()).toHaveLength(2);
  });
  it('允许业务无效 Placement，拒绝 schema 错误、重复 ID 和危险附件路径', () => {
    const w = workspace(),
      b = activity(w, 'A', 10, 9);
    expect(() => parseWorkspace(w)).not.toThrow();
    w.blocks.push(structuredClone(b));
    expect(() => parseWorkspace(w)).toThrow('唯一');
    w.blocks.pop();
    w.attachments.push({
      id: uid(),
      path: 'attachments/../../outside',
      name: 'x',
      mime: '',
      size: 0,
    });
    expect(() => parseWorkspace(w)).toThrow();
  });
  it('查询失败保留 null duration，不能推导虚假的离家时间', () => {
    const w = workspace();
    activity(w, 'A', 9, 10);
    const d = derive(w);
    expect(d.edges[0].effectiveMinutes).toBeNull();
    expect(d.blocks.find((b) => b.kind === 'start')?.start).toBeNull();
    expect(d.issues.some((i) => i.code === 'route_unknown')).toBe(true);
  });
});
