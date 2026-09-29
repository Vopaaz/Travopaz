import { expect, it } from 'vitest';
import { ScenarioContexts } from '../../src/domain/scenarioContexts';
import { emptyMetadata, type OptionBlock } from '../../src/domain/schema';

it('保留相关联的方案组合，不将 A1/B1 或 A2/B2 误认为所有组合都适用', () => {
  const options: OptionBlock[] = ['A', 'B', '无关'].map((id) => ({
    id,
    kind: 'option',
    title: id,
    metadata: emptyMetadata(),
    variants: [1, 2].map((i) => ({ id: `${id}${i}`, title: `${id}${i}`, blocks: [] })),
  }));
  const contexts = new ScenarioContexts(options);
  const result = {};
  for (const variant of ['无关1', '无关2']) {
    contexts.record(result, { A: 'A1', B: 'B1', 无关: variant });
    contexts.record(result, { A: 'A2', B: 'B2', 无关: variant });
    contexts.record(result, { A: 'A2', B: 'B2', 无关: variant });
  }
  expect(contexts.describe([result])).toEqual(['A · A1 / B · B1', 'A · A2 / B · B2']);
});
