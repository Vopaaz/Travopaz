import { createWorkspace } from '../../src/domain/factory';
import { emptyLocation, emptyMetadata } from '../../src/domain/schema';
import { fromLocal } from '../../src/domain/time';

export function routesWorkspace(sameAddress = false) {
  const w = createWorkspace('路线缓存与无移动', undefined, 'UTC');
  const time = (value: string) => fromLocal(`2026-10-20T${value}`, 'UTC');
  const loc = (name: string) => ({ ...emptyLocation(), name, address: name });
  w.trip.displayStart = time('00:00');
  w.trip.displayEnd = time('23:59');
  w.trip.overnightBreaks = [];
  w.trip.startLocation = loc('cache-A');
  w.trip.endLocation = loc(sameAddress ? 'cache-A' : 'cache-B');
  w.globalConfig.overhead = { WALK: 0, DRIVE: 10, RIDESHARE: 8 };
  for (const [id, start, end] of [
    ['A', '09:00', '10:00'],
    ['B', '10:30', '11:00'],
  ]) {
    w.candidates.push({
      id: `candidate-${id}`,
      kind: 'activity',
      title: `活动 ${id}`,
      location: loc(sameAddress ? 'cache-A' : `cache-${id}`),
      metadata: emptyMetadata(),
      constraints: { minMinutes: null, maxMinutes: null, intervals: [] },
    });
    w.blocks.push({
      id,
      kind: 'candidate',
      candidateId: `candidate-${id}`,
      start: time(start),
      end: time(end),
    });
  }
  return w;
}
