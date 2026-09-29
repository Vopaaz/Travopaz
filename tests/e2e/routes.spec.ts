import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { routesWorkspace } from '../fixtures/routes';
import { ROUTE_CACHE_TTL } from '../../src/domain/routeCache';
import { shiftTime } from '../../src/domain/time';

const edge = (page: Page) => page.locator('.travel-edge[data-edge-key="A>B"]');
async function importWorkspace(page: Page, w = routesWorkspace()) {
  await page.locator('input[type="file"][accept=".zip,.json"]').setInputFiles({
    name: 'routes.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(w)),
  });
  await expect(page.getByRole('heading', { name: w.trip.name })).toBeVisible();
}
async function exportWorkspace(page: Page) {
  await expect(page.locator('.save-status')).toHaveText('已保存到本机');
  await page.getByRole('button', { name: '工作区', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Workspace', exact: true }).click();
  const downloaded = await downloading,
    file = (await downloaded.path())!;
  const bytes = await readFile(file),
    zip = await JSZip.loadAsync(bytes);
  return {
    bytes,
    cache: JSON.parse(await zip.file('route-cache.json')!.async('string')),
    canonical: JSON.parse(await zip.file('workspace.json')!.async('string')),
  };
}

test('路线与时段按 30 秒取整，卡片、详情和冲突比较相同的整分钟值', async ({ page }) => {
  await page.route('**/api/routes', (r) =>
    r.fulfill({ json: { status: 'ok', minutes: 20.2, distanceMeters: 800, source: 'test' } }),
  );
  const w = routesWorkspace();
  w.edgeOverrides['A>B'] = 'RIDESHARE';
  w.edgeOverheadOverrides['A>B'] = 10;
  await page.goto('/');
  await importWorkspace(page, w);
  await expect(edge(page).locator('.edge-duration')).toHaveText('所需 30 分钟');
  await expect(edge(page).locator('.edge-slot')).toHaveText('时段 30 分钟');
  await edge(page).click();
  const panel = page.locator('.detail-panel');
  const metric = (label: string) =>
    panel.locator('dt').filter({ hasText: label }).locator('xpath=following-sibling::dd[1]');
  await expect(metric('总耗时')).toHaveText('30 分钟');
  await expect(metric('路线耗时')).toHaveText('20 分钟');
  await expect(metric('时段长度')).toHaveText('30 分钟');
  await expect(panel.locator('.issue-item')).toHaveCount(0);
  const buffer = panel.getByLabel('额外耗时（buffer）/ 分钟', { exact: true });
  await buffer.fill('10.3');
  await buffer.blur();
  await expect(edge(page).locator('.edge-duration')).toHaveText('所需 31 分钟');
  await expect(metric('总耗时')).toHaveText('31 分钟');
  await expect(panel.locator('.issue-item')).toHaveText(
    '冲突路程与额外耗时共需 31 分钟，当前仅有 30 分钟。',
  );

  // The slot uses the same rounding threshold as the required duration.
  w.edgeOverheadOverrides['A>B'] = 10.6;
  const b = w.blocks[1];
  if (b.kind === 'option') throw new Error('Expected a concrete block');
  b.start = shiftTime(b.start, 0.5);
  await importWorkspace(page, w);
  await edge(page).click();
  await expect(edge(page).locator('.edge-duration')).toHaveText('所需 31 分钟');
  await expect(edge(page).locator('.edge-slot')).toHaveText('时段 31 分钟');
  await expect(metric('总耗时')).toHaveText('31 分钟');
  await expect(metric('时段长度')).toHaveText('31 分钟');
  await expect(panel.locator('.issue-item')).toHaveCount(0);
});

test('缓存跨刷新和 ZIP 导入复用，时间编辑不查询，14 天后过期并可手动刷新', async ({
  page,
  browser,
}) => {
  let requests = 0,
    fetchedAt = Date.now() - 13 * 86400000,
    minutes = 8;
  const setup = async (p: Page) => {
    await p.route('**/api/health', (r) =>
      r.fulfill({ json: { ok: true, routingConfigured: true } }),
    );
    await p.route('**/api/routes', (r) => {
      const q = r.request().postDataJSON();
      if (q.origin === 'cache-A' && q.destination === 'cache-B') requests++;
      return r.fulfill({
        json: { status: 'ok', minutes, distanceMeters: 800, source: 'google', fetchedAt },
      });
    });
  };
  await setup(page);
  await page.goto('/');
  await importWorkspace(page);
  await expect(edge(page)).toContainText('8 分钟');
  await expect(edge(page).locator('.edge-slot')).toHaveText('时段 30 分钟');
  expect(requests).toBe(1);
  await expect(page.locator('.save-status')).toHaveText('已保存到本机');
  await page.reload();
  await expect(edge(page)).toContainText('8 分钟');
  await page.locator('.timeline-block').filter({ hasText: '活动 B' }).click();
  await page.getByLabel('安排开始', { exact: true }).fill('2026-10-20T10:40');
  await page.getByLabel('安排开始', { exact: true }).blur();
  await expect(edge(page).locator('.edge-duration')).toHaveText('所需 8 分钟');
  await expect(edge(page).locator('.edge-slot')).toHaveText('时段 40 分钟');
  await page.waitForTimeout(700);
  expect(requests).toBe(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('安排开始', { exact: true })).toHaveValue('2026-10-20T10:30');
  await expect(edge(page).locator('.edge-slot')).toHaveText('时段 30 分钟');
  const bundle = await exportWorkspace(page);
  expect(bundle.cache.entries).toHaveLength(1);
  expect(bundle.cache.entries[0].fetchedAt).toBe(fetchedAt);
  expect(bundle.canonical).not.toHaveProperty('routeCache');
  const independent = await browser.newContext();
  try {
    const imported = await independent.newPage();
    await setup(imported);
    await imported.goto(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173');
    await imported
      .locator('input[type="file"][accept=".zip,.json"]')
      .setInputFiles({ name: 'copy.zip', mimeType: 'application/zip', buffer: bundle.bytes });
    await expect(edge(imported)).toContainText('8 分钟');
    await imported.waitForTimeout(700);
    expect(requests).toBe(1);
  } finally {
    await independent.close();
  }
  fetchedAt += ROUTE_CACHE_TTL;
  minutes = 9;
  await page.clock.setFixedTime(new Date(fetchedAt));
  await page.reload();
  await expect(edge(page)).toContainText('9 分钟');
  expect(requests).toBe(2);
  minutes = 12;
  await page.getByRole('button', { name: '重新查询路线', exact: true }).click();
  await expect(edge(page)).toContainText('12 分钟');
  expect(requests).toBe(3);
  expect((await exportWorkspace(page)).cache.entries[0].fetchedAt).toBe(fetchedAt);
});

test('路段 buffer 可覆盖旅行默认、设零、撤销恢复、跨方式保存，并随 ZIP 恢复', async ({ page }) => {
  let queries = 0;
  await page.route('**/api/routes', (r) => {
    const q = r.request().postDataJSON();
    if (q.origin === 'cache-A' && q.destination === 'cache-B') queries++;
    return r.fulfill({ json: { status: 'ok', minutes: 8, distanceMeters: 800, source: 'test' } });
  });
  const w = routesWorkspace();
  w.globalConfig.overhead.WALK = 3;
  w.trip.config.overhead = { WALK: 7, DRIVE: 11, RIDESHARE: 17 };
  await page.goto('/');
  await importWorkspace(page, w);
  await expect(edge(page).locator('.edge-duration')).toHaveText('所需 15 分钟');
  await expect(edge(page).locator('.edge-slot')).toHaveText('时段 30 分钟');
  await expect(edge(page)).toHaveAttribute('title', /路线 8 分钟 \+ buffer 7 分钟/);
  await edge(page).click();
  const panel = page.locator('.detail-panel'),
    buffer = panel.getByLabel('额外耗时（buffer）/ 分钟', { exact: true });
  const metric = (label: string) =>
    panel.locator('dt').filter({ hasText: label }).locator('xpath=following-sibling::dd[1]');
  await expect(buffer).toHaveValue('');
  await expect(metric('时段长度')).toHaveText('30 分钟');
  await expect(buffer).toHaveAttribute('placeholder', '旅行默认：7 分钟');
  await buffer.fill('25');
  await buffer.blur();
  await expect(metric('总耗时')).toHaveText('33 分钟');
  await expect(edge(page).locator('.edge-duration')).toHaveText('所需 33 分钟');
  await expect(edge(page).locator('.edge-slot')).toHaveText('时段 30 分钟');
  await expect(edge(page).locator('.edge-customization')).toHaveAttribute(
    'title',
    '已自定义 buffer',
  );
  await expect(panel).toContainText('当前仅有 30 分钟');
  await page.waitForTimeout(700);
  expect(queries).toBe(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(buffer).toHaveValue('');
  await expect(metric('总耗时')).toHaveText('15 分钟');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(buffer).toHaveValue('25');
  await buffer.fill('0');
  await buffer.blur();
  await expect(metric('总耗时')).toHaveText('8 分钟');
  await expect(panel.locator('.issue-item')).toHaveCount(0);
  await buffer.fill('');
  await buffer.blur();
  await expect(metric('总耗时')).toHaveText('15 分钟');
  await buffer.fill('12');
  await buffer.blur();
  await panel.getByRole('combobox', { name: '交通方式', exact: true }).selectOption('RIDESHARE');
  await expect(metric('总耗时')).toHaveText('20 分钟');
  await expect(buffer).toHaveValue('12');
  await expect(buffer).toHaveAttribute('placeholder', '旅行默认：17 分钟');
  await expect(edge(page).locator('.edge-customization')).toHaveAttribute(
    'title',
    '已指定交通方式；已自定义 buffer',
  );
  await panel.getByRole('button', { name: '恢复默认额外耗时', exact: true }).click();
  await expect(buffer).toHaveValue('');
  await expect(metric('总耗时')).toHaveText('25 分钟');
  await buffer.fill('9');
  await buffer.blur();
  const bundle = await exportWorkspace(page);
  expect(bundle.canonical.edgeOverheadOverrides).toEqual({ 'A>B': 9 });
  expect(bundle.canonical.edgeOverrides).toEqual({ 'A>B': 'RIDESHARE' });
  await page.reload();
  await edge(page).click();
  await expect(buffer).toHaveValue('9');
  await importWorkspace(page, routesWorkspace());
  await page
    .locator('input[type="file"][accept=".zip,.json"]')
    .setInputFiles({ name: 'buffer.zip', mimeType: 'application/zip', buffer: bundle.bytes });
  await expect(edge(page).locator('.edge-duration')).toHaveText('所需 17 分钟');
  await expect(edge(page).locator('.edge-slot')).toHaveText('时段 30 分钟');
  await edge(page).click();
  await expect(buffer).toHaveValue('9');
  await expect(metric('总耗时')).toHaveText('17 分钟');
});

test('同址无移动默认零耗时、允许自定义 buffer；异址手动无移动报错', async ({ page }) => {
  const queries: { origin: string; destination: string }[] = [];
  await page.route('**/api/routes', (r) => {
    queries.push(r.request().postDataJSON());
    return r.fulfill({ json: { status: 'ok', minutes: 8, distanceMeters: 800, source: 'test' } });
  });
  const w = routesWorkspace(true);
  w.globalConfig.overhead = { WALK: 7, DRIVE: 20, RIDESHARE: 30 };
  await page.goto('/');
  await importWorkspace(page, w);
  await expect(edge(page)).toContainText('无移动');
  await expect(edge(page).locator('.edge-duration')).toHaveText('所需 0 分钟');
  await expect(edge(page).locator('.edge-slot')).toHaveText('时段 30 分钟');
  await expect(edge(page).locator('.edge-customization')).toHaveCount(0);
  await edge(page).click();
  const panel = page.locator('.detail-panel');
  await expect(panel.locator('.issue-item')).toHaveCount(0);
  for (const label of ['路线耗时', '额外耗时', '总耗时'])
    await expect(
      panel.locator('dt').filter({ hasText: label }).locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('0 分钟');
  const buffer = panel.getByLabel('额外耗时（buffer）/ 分钟', { exact: true });
  await expect(buffer).toHaveAttribute('placeholder', '默认：0 分钟');
  await buffer.fill('12');
  await buffer.blur();
  await expect(edge(page).locator('.edge-duration')).toHaveText('所需 12 分钟');
  await expect(edge(page).locator('.edge-slot')).toHaveText('时段 30 分钟');
  await expect(edge(page).locator('.edge-customization')).toHaveAttribute(
    'title',
    '已自定义 buffer',
  );
  await expect(
    panel.locator('dt').filter({ hasText: '总耗时' }).locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('12 分钟');
  await expect(
    panel.locator('dt').filter({ hasText: '路线耗时' }).locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('0 分钟');
  await page.waitForTimeout(700);
  expect(queries.some((q) => q.origin === 'cache-A' || q.destination === 'cache-A')).toBe(false);
  await panel.getByRole('button', { name: '恢复默认额外耗时', exact: true }).click();
  await expect(buffer).toHaveValue('');
  await expect(
    panel.locator('dt').filter({ hasText: '总耗时' }).locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('0 分钟');
  await panel.getByRole('combobox', { name: '交通方式', exact: true }).selectOption('NONE');
  await expect(edge(page).locator('.edge-customization')).toHaveAttribute(
    'title',
    '已指定交通方式',
  );
  await page.locator('.timeline-block').filter({ hasText: '活动 B' }).click();
  await page.getByLabel('地点地址', { exact: true }).fill('cache-B');
  await page.getByLabel('地点地址', { exact: true }).blur();
  await edge(page).click();
  await expect(panel).toContainText('“无移动”要求前后项目位于同一地址');
  await expect(page.locator('.save-status')).toHaveText('已保存到本机');
  await page.reload();
  await edge(page).click();
  await expect(panel.getByRole('combobox', { name: '交通方式', exact: true })).toHaveValue('NONE');
  await expect(panel).toContainText('“无移动”要求前后项目位于同一地址');
  await panel.getByRole('combobox', { name: '交通方式', exact: true }).selectOption('');
  await expect(edge(page)).toContainText('步行');
  await expect(panel).not.toContainText('“无移动”要求前后项目位于同一地址');
});

test('路段时段区分固定空档、推导区间和重叠，路线未知仍显示固定空档', async ({ page }) => {
  await page.route('**/api/routes', (r) =>
    r.fulfill({ json: { status: 'ok', minutes: 8, distanceMeters: 800, source: 'test' } }),
  );
  const w = routesWorkspace();
  w.trip.startLocation.address = 'cache-start';
  w.trip.endLocation.address = 'cache-end';
  w.edgeOverheadOverrides = { 'trip-start>A': 5, 'B>trip-end': 7 };
  await page.goto('/');
  await importWorkspace(page, w);
  const panel = page.locator('.detail-panel');
  const slotMetric = panel
    .locator('dt')
    .filter({ hasText: '时段长度' })
    .locator('xpath=following-sibling::dd[1]');
  for (const [key, duration] of [
    ['trip-start>A', 13],
    ['B>trip-end', 15],
  ] as const) {
    const endpoint = page.locator(`.travel-edge[data-edge-key="${key}"]`);
    await expect(endpoint.locator('.edge-duration')).toHaveText(`所需 ${duration} 分钟`);
    await expect(endpoint.locator('.edge-slot')).toHaveText(`时段 ${duration} 分钟（推导）`);
    await endpoint.click();
    await expect(slotMetric).toHaveText(`${duration} 分钟（推导）`);
  }
  await page.locator('.timeline-block').filter({ hasText: '活动 B' }).click();
  const start = page.getByLabel('安排开始', { exact: true });
  await start.fill('2026-10-20T10:00');
  await start.blur();
  await expect(edge(page).locator('.edge-slot')).toHaveText('时段 0 分钟');
  await start.fill('2026-10-20T09:50');
  await start.blur();
  await expect(edge(page).locator('.edge-slot')).toHaveText('时段 重叠 10 分钟');
  await edge(page).click();
  await expect(slotMetric).toHaveText('重叠 10 分钟');

  w.globalConfig.routingProvider = 'unavailable';
  await importWorkspace(page, w);
  await expect(edge(page).locator('.edge-duration')).toHaveText('所需 未知');
  await expect(edge(page).locator('.edge-slot')).toHaveText('时段 30 分钟');
  await edge(page).click();
  await expect(slotMetric).toHaveText('30 分钟');
  await expect(page.locator('.travel-edge[data-edge-key="trip-start>A"] .edge-slot')).toHaveText(
    '时段 未知（推导）',
  );
});

test('重新导入同 ID 工作区后，旧查询的迟到结果不能污染新缓存', async ({ page }) => {
  let calls = 0,
    release!: () => void;
  await page.route('**/api/routes', async (r) => {
    const q = r.request().postDataJSON();
    const target = q.origin === 'cache-A' && q.destination === 'cache-B';
    const old = target && ++calls === 1;
    if (old)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await r.fulfill({
      json: { status: 'ok', minutes: old ? 55 : 8, distanceMeters: 800, source: 'test' },
    });
  });
  await page.goto('/');
  const w = routesWorkspace();
  await importWorkspace(page, w);
  await expect.poll(() => calls).toBe(1);
  w.trip.name = '重新导入后的工作区';
  await importWorkspace(page, w);
  await expect(edge(page)).toContainText('8 分钟');
  release();
  await page.waitForTimeout(700);
  expect(calls).toBe(2);
  expect((await exportWorkspace(page)).cache.entries[0].result.minutes).toBe(8);
});
