import { createWorkspace } from '../../src/domain/factory';
import { emptyLocation, emptyMetadata, type ConcreteBlock } from '../../src/domain/schema';
import { fromLocal } from '../../src/domain/time';

/** Synthetic reproduction: one shared route followed by 5 × 2 × 2 × 2 choices. */
export function issueContextsWorkspace() {
  const zone = 'Pacific/Honolulu';
  const w = createWorkspace('冲突说明回归', undefined, zone);
  const time = (value: string) => fromLocal(`2026-10-${value}`, zone);
  const location = (name: string) => ({ ...emptyLocation(), name, address: name });
  w.trip.displayStart = time('20T00:00');
  w.trip.displayEnd = time('21T23:59');
  w.trip.overnightBreaks = [];
  w.trip.startLocation = location('起点');
  w.trip.endLocation = location('终点');
  w.globalConfig.overhead.RIDESHARE = 10;
  const activity = (id: string, title: string, start: string, end: string): ConcreteBlock => {
    w.candidates.push({
      id: `candidate-${id}`,
      kind: 'activity',
      title,
      location: location(title),
      metadata: emptyMetadata(),
      constraints: { intervals: [], minMinutes: null, maxMinutes: null },
    });
    return {
      id,
      kind: 'candidate',
      candidateId: `candidate-${id}`,
      start: time(start),
      end: time(end),
    };
  };
  w.blocks = [
    activity('airport', 'Kahului Airport (OGG)', '20T08:00', '20T09:00'),
    activity('costco', 'Costco Wholesale', '20T09:15', '20T10:00'),
  ];
  ['午餐候选', '晚餐候选', '买虾后的安排', '翌日午饭候选'].forEach((title, index) => {
    const hour = 12 + index * 2;
    w.blocks.push({
      id: `option-${index}`,
      kind: 'option',
      title,
      metadata: emptyMetadata(),
      variants: Array.from({ length: index === 0 ? 5 : 2 }, (_, variant) => ({
        id: `variant-${index}-${variant}`,
        title: `方案 ${variant + 1}`,
        blocks: [
          activity(
            `choice-${index}-${variant}`,
            `${title}地点 ${variant + 1}`,
            `21T${hour}:00`,
            `21T${hour + 1}:00`,
          ),
        ],
      })),
    });
  });
  w.edgeOverrides['airport>costco'] = 'RIDESHARE';
  return w;
}
