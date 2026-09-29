import { expect, test } from '@playwright/test';
import { createWorkspace } from '../../src/domain/factory';
import { emptyLocation, emptyMetadata, type ConcreteBlock } from '../../src/domain/schema';
import { fromLocal, shiftTime } from '../../src/domain/time';

test('活动卡片随实际高度逐级隐藏地点和时间，缩放与 Option 中都没有半行文字', async ({ page }) => {
  const w = createWorkspace('卡片内容高度回归', undefined, 'UTC');
  const time = (value: string) => fromLocal(`2026-10-20T${value}`, 'UTC');
  const location = { ...emptyLocation(), name: '景点地址', address: '同一地址' };
  w.trip.displayStart = time('00:00');
  w.trip.displayEnd = time('23:59');
  w.trip.overnightBreaks = [];
  w.trip.startLocation = w.trip.endLocation = location;
  const activity = (id: string, start: string, minutes: number): ConcreteBlock => {
    w.candidates.push({
      id: `candidate-${id}`,
      kind: 'activity',
      title: `活动 ${id}`,
      location,
      metadata: emptyMetadata(),
      constraints: { intervals: [], minMinutes: null, maxMinutes: null },
    });
    return {
      id,
      kind: 'candidate',
      candidateId: `candidate-${id}`,
      start: time(start),
      end: shiftTime(time(start), minutes),
    };
  };
  w.blocks = [
    activity('short', '09:00', 55),
    activity('medium', '11:00', 85),
    activity('full', '13:00', 150),
    {
      id: 'option',
      kind: 'option',
      title: '并排方案',
      metadata: emptyMetadata(),
      variants: ['A', 'B'].map((id) => ({
        id,
        title: id,
        blocks: [
          activity(`${id}-short`, '17:00', 55),
          activity(`${id}-medium`, '18:30', 85),
          activity(`${id}-full`, '20:30', 150),
        ],
      })),
    },
  ];
  await page.goto('/');
  await page.locator('input[type="file"][accept=".zip,.json"]').setInputFiles({
    name: 'block-content.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(w)),
  });
  await expect(page.getByRole('heading', { name: w.trip.name })).toBeVisible();
  const block = (id: string) => page.locator(`.timeline-block[data-block-id="${id}"]`);
  const noClipping = async () => {
    await expect
      .poll(() =>
        page.locator('.timeline-block').evaluateAll((blocks) =>
          blocks.flatMap((block) => {
            const box = block.getBoundingClientRect();
            return [...block.querySelectorAll('.block-title, .block-time, .block-location')]
              .filter((row) => getComputedStyle(row).display !== 'none')
              .filter((row) => {
                const rect = row.getBoundingClientRect();
                return rect.top < box.top || rect.bottom > box.bottom;
              })
              .map((row) => `${block.getAttribute('data-block-id')}: ${row.className}`);
          }),
        ),
      )
      .toEqual([]);
  };
  for (const width of [1800, 1440, 1100]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const prefix of ['', 'A-', 'B-']) {
      await expect(block(`${prefix}short`).locator('.block-time')).toBeHidden();
      await expect(block(`${prefix}short`).locator('.block-location')).toBeHidden();
      await expect(block(`${prefix}medium`).locator('.block-time')).toBeVisible();
      await expect(block(`${prefix}medium`).locator('.block-location')).toBeHidden();
      await expect(block(`${prefix}full`).locator('.block-time')).toBeVisible();
      await expect(block(`${prefix}full`).locator('.block-location')).toBeVisible();
    }
    await noClipping();
  }
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.getByTitle('放大时间轴', { exact: true }).click();
  await page.getByTitle('放大时间轴', { exact: true }).click();
  await expect(block('short').locator('.block-time')).toBeVisible();
  await expect(block('medium').locator('.block-location')).toBeVisible();
  await noClipping();
  await page.getByTitle('缩小时间轴', { exact: true }).click();
  await page.getByTitle('缩小时间轴', { exact: true }).click();
  await expect(block('short').locator('.block-time')).toBeHidden();
  await expect(block('medium').locator('.block-location')).toBeHidden();
  await expect(block('short')).toHaveAttribute('title', /09:00–10\/20 09:55\n景点地址/);
  await block('short').click();
  await expect(page.getByLabel('安排结束', { exact: true })).toHaveValue('2026-10-20T09:55');
});
