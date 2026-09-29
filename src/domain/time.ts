import { DateTime } from 'luxon';
import type { ZonedTime } from './schema';
export const ms = (t: ZonedTime) => DateTime.fromISO(t.instant).toMillis();
export const at = (millis: number, timezone: string): ZonedTime => ({
  instant: DateTime.fromMillis(millis).toUTC().toISO()!,
  timezone,
});
export const shiftTime = (t: ZonedTime, minutes: number) => at(ms(t) + minutes * 60000, t.timezone);
export const localValue = (t: ZonedTime) =>
  DateTime.fromISO(t.instant).setZone(t.timezone).toFormat("yyyy-MM-dd'T'HH:mm");
export function fromLocal(value: string, timezone: string, preferredInstant?: string): ZonedTime {
  const dt = DateTime.fromISO(value, { zone: timezone });
  if (!dt.isValid || dt.toFormat("yyyy-MM-dd'T'HH:mm") !== value.slice(0, 16))
    throw new Error('该本地时间不存在（可能处于夏令时跳跃区间）。请选择有效时间。');
  const possibilities = dt.getPossibleOffsets();
  const preferredOffset = preferredInstant
    ? DateTime.fromISO(preferredInstant).setZone(timezone).offset
    : undefined;
  const chosen = possibilities.find((p) => p.offset === preferredOffset) ?? possibilities[0];
  return at(chosen.toMillis(), timezone);
}
export const formatTime = (t: ZonedTime | number, zone: string, format = 'HH:mm') =>
  DateTime.fromMillis(typeof t === 'number' ? t : ms(t))
    .setZone(zone)
    .setLocale('zh-CN')
    .toFormat(format);
export const formatDuration = (minutes: number | null) =>
  minutes === null
    ? '未知'
    : minutes < 60
      ? `${Math.round(minutes)} 分钟`
      : `${Math.floor(minutes / 60)} 小时${Math.round(minutes % 60) ? ` ${Math.round(minutes % 60)} 分` : ''}`;
export function daysBetween(start: ZonedTime, end: ZonedTime, zone: string) {
  const days: DateTime[] = [];
  let day = DateTime.fromMillis(Math.min(ms(start), ms(end)))
    .setZone(zone)
    .startOf('day');
  const last = DateTime.fromMillis(Math.max(ms(start), ms(end)))
    .setZone(zone)
    .startOf('day');
  while (day <= last) {
    days.push(day);
    day = day.plus({ days: 1 });
  }
  return days;
}
