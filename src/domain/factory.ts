import { DateTime } from 'luxon';
import { at, fromLocal, shiftTime, daysBetween } from './time';
import {
  defaultConfig,
  emptyMetadata,
  uid,
  type Workspace,
  type Config,
  type Candidate,
  type ConcreteBlock,
} from './schema';

export function createWorkspace(
  name = '我的新旅行',
  config: Config = defaultConfig(),
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): Workspace {
  const day = DateTime.now().setZone(zone).startOf('day').plus({ days: 1 });
  const start = at(day.toMillis(), zone),
    end = at(day.plus({ days: 3 }).minus({ minutes: 1 }).toMillis(), zone);
  return {
    schemaVersion: 1,
    id: uid(),
    globalConfig: structuredClone(config),
    trip: {
      name,
      startLocation: structuredClone(config.home),
      endLocation: structuredClone(config.home),
      displayStart: start,
      displayEnd: end,
      timezones: [zone],
      primaryTimezone: zone,
      overnightBreaks: daysBetween(start, end, zone)
        .slice(1)
        .map((d) => ({ id: uid(), time: fromLocal(`${d.toISODate()}T03:30`, zone) })),
      config: {},
    },
    candidates: [],
    statuses: [],
    blocks: [],
    edgeOverrides: {},
    attachments: [],
  };
}

export function placeCandidate(
  candidate: Candidate,
  dropTime: number,
  timezone: string,
): ConcreteBlock {
  const initial =
    candidate.kind === 'transport'
      ? { start: candidate.departure, end: candidate.arrival }
      : candidate.kind === 'boundary'
        ? { start: candidate.defaultStart, end: candidate.defaultEnd }
        : { start: at(dropTime, timezone), end: at(dropTime + 60 * 60000, timezone) };
  // Default intervals are copied, never linked back to definitions.
  const times = structuredClone(initial);
  if (
    candidate.kind === 'boundary' &&
    Date.parse(times.end.instant) <= Date.parse(times.start.instant)
  )
    times.end = shiftTime(times.start, 1);
  return { id: uid(), kind: 'candidate', candidateId: candidate.id, ...times };
}

export function createDemo(): Workspace {
  const zone = 'Asia/Tokyo',
    w = createWorkspace('京都 · 慢游三日', defaultConfig(), zone);
  const t = (value: string) => fromLocal(`2026-10-${value}`, zone);
  const loc = (name: string, address: string) => ({
    name,
    address,
    googleMapsUrl: '',
    appleMapsUrl: '',
  });
  const station = loc('京都站', '京都府京都市下京区東塩小路釜殿町');
  const hotel = loc('京都格兰比亚酒店', '京都府京都市下京区烏丸通塩小路下ル JR京都駅中央口');
  w.trip = {
    ...w.trip,
    startLocation: station,
    endLocation: station,
    displayStart: t('12T00:00'),
    displayEnd: t('14T23:59'),
    timezones: [zone, 'Asia/Shanghai', 'America/Los_Angeles'],
    overnightBreaks: [
      { id: uid(), time: t('13T03:30') },
      { id: uid(), time: t('14T03:30') },
    ],
  };
  const statusId = uid();
  w.statuses.push({
    id: statusId,
    kind: 'hotel',
    title: '京都格兰比亚酒店',
    location: hotel,
    metadata: {
      ...emptyMetadata(),
      reservation: '示例预订 · 2 晚',
      notes: '这是演示数据，可自由修改或新建工作区。',
    },
  });
  const checkIn: Candidate = {
    id: uid(),
    kind: 'boundary',
    title: '办理酒店入住',
    role: 'start',
    statusId,
    location: hotel,
    defaultStart: t('12T14:00'),
    defaultEnd: t('12T14:30'),
    metadata: emptyMetadata(),
  };
  const checkOut: Candidate = {
    id: uid(),
    kind: 'boundary',
    title: '办理酒店退房',
    role: 'end',
    statusId,
    location: hotel,
    defaultStart: t('14T10:00'),
    defaultEnd: t('14T10:20'),
    metadata: emptyMetadata(),
  };
  w.candidates.push(checkIn, checkOut);
  w.blocks.push(placeCandidate(checkIn, 0, zone), placeCandidate(checkOut, 0, zone));
  const add = (
    title: string,
    location: ReturnType<typeof loc>,
    start?: string,
    end?: string,
    minMinutes: number | null = null,
  ) => {
    const candidate: Candidate = {
      id: uid(),
      kind: 'activity',
      title,
      location,
      metadata: { ...emptyMetadata(), tags: ['京都'] },
      constraints: { intervals: [], minMinutes, maxMinutes: null },
    };
    w.candidates.push(candidate);
    if (start && end)
      w.blocks.push({
        id: uid(),
        kind: 'candidate',
        candidateId: candidate.id,
        start: t(start),
        end: t(end),
      });
    return candidate;
  };
  add('锦市场 · 寻找京都的味道', loc('锦市场', '京都市中京区錦小路通'), '12T11:00', '12T12:30');
  add('清水寺与二年坂', loc('清水寺', '京都市東山区清水1丁目294'), '12T15:30', '12T18:00', 90);
  add('祇园 · 傍晚散步', loc('祇园白川', '京都市東山区末吉町'), '12T18:30', '12T19:30');
  add(
    '伏见稻荷 · 千本鸟居',
    loc('伏见稻荷大社', '京都市伏見区深草薮之内町68'),
    '13T09:00',
    '13T11:30',
  );
  add('鸭川边的午后', loc('鸭川三角洲', '京都市左京区下鴨宮河町'), '13T14:00', '13T16:00');
  add('哲学之道', loc('哲学之道', '京都市左京区浄土寺石橋町'));
  add('岚山竹林', loc('岚山竹林小径', '京都市右京区嵯峨天龍寺芒ノ馬場町'));
  w.blocks.push({
    id: uid(),
    kind: 'hotelRest',
    title: '酒店早餐与休息',
    start: t('14T08:00'),
    end: t('14T09:30'),
    metadata: emptyMetadata(),
  });
  return w;
}
