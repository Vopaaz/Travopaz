import { test, expect, type Page } from '@playwright/test';
import { DateTime } from 'luxon';
import { createWorkspace } from '../../src/domain/factory';
import { emptyLocation, emptyMetadata, type ConcreteBlock } from '../../src/domain/schema';
import { fromLocal, ms } from '../../src/domain/time';
async function savedWorkspace(page: Page) {
  await expect(page.locator('.save-status')).toHaveText('已保存到本机');
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('keyval-store');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const read = (key: string) =>
      new Promise<any>((resolve, reject) => {
        const req = db.transaction('keyval').objectStore('keyval').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const id = await read('active'),
      workspace = await read(`workspace:${id}`);
    db.close();
    return workspace;
  });
}
test('浏览、编辑、拖动、撤销、时区、自动保存与明文导出', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '京都 · 慢游三日' })).toBeVisible();
  await expect(page.locator('.save-status')).toHaveText('已保存到本机');
  await page.screenshot({ path: 'test-results/workbench.png', fullPage: true });
  const block = page.locator('.timeline-block').filter({ hasText: '锦市场' }).first();
  await block.click();
  const start = page.getByLabel('安排开始', { exact: true });
  await expect(start).toHaveValue('2026-10-12T11:00');
  const box = await block.boundingBox();
  if (!box) throw new Error('Block 不可见');
  await page.mouse.move(box.x + 55, box.y + 18);
  await page.mouse.down();
  await page.mouse.move(box.x + 55, box.y + 66, { steps: 8 });
  await page.mouse.up();
  await expect(start).toHaveValue('2026-10-12T12:00');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(start).toHaveValue('2026-10-12T11:00');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(start).toHaveValue('2026-10-12T12:00');
  await start.fill('2026-10-12T11:15');
  await start.blur();
  await expect(page.locator('.save-status')).toHaveText('已保存到本机');
  await page.reload();
  await page.locator('.timeline-block').filter({ hasText: '锦市场' }).first().click();
  await expect(page.getByLabel('安排开始', { exact: true })).toHaveValue('2026-10-12T11:15');
  await page.getByLabel('显示时区', { exact: true }).selectOption('Asia/Shanghai');
  await expect(page.locator('.timeline-block').filter({ hasText: '锦市场' }).first()).toContainText(
    '10:15',
  );
  await expect(page.getByLabel('安排开始', { exact: true })).toHaveValue('2026-10-12T11:15');
  await page.getByRole('button', { name: '日历总览', exact: true }).click();
  // Tokyo midnight becomes the previous Sunday in Shanghai: the display spans two weeks.
  await expect(page.locator('.calendar-cell')).toHaveCount(14);
  await page.getByRole('button', { name: '导出行程', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'AI Context · 明文 JSON', exact: false }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('itinerary-context.json');
  expect(errors).toEqual([]);
});

test('创建 Candidate、拖入、Resize、多选平移、Option 与附件 Workspace roundtrip', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '添加候选项目', exact: true }).click();
  await page.getByRole('dialog').getByLabel('名称', { exact: true }).fill('浏览器测试活动');
  await page.getByRole('dialog').getByLabel('地点名称').fill('京都站');
  await page.getByRole('button', { name: '加入候选库', exact: true }).click();
  await expect(page.locator('.candidate-card').filter({ hasText: '浏览器测试活动' })).toBeVisible();
  await page.getByRole('button', { name: '安排到时间轴', exact: true }).click();
  const b = page.locator('.timeline-block').filter({ hasText: '浏览器测试活动' });
  await b.scrollIntoViewIfNeeded();
  await expect(page.getByLabel('安排开始', { exact: true })).toHaveValue('2026-10-12T09:00');
  const bb = await b.boundingBox();
  if (!bb) throw new Error('missing block');
  await page.mouse.move(bb.x + 30, bb.y + bb.height - 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + 30, bb.y + bb.height + 22, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByLabel('安排结束', { exact: true })).toHaveValue('2026-10-12T10:30');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('button', { name: '用选中项目创建 Option', exact: true }).click();
  await expect(page.locator('.option-block')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '解除 Option 包装', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '添加方案', exact: true }).click();
  await expect(page.getByRole('button', { name: '解除 Option 包装', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '删除方案', exact: true }).last().click();
  await page.getByRole('button', { name: '解除 Option 包装', exact: true }).click();
  await expect(page.locator('.option-block')).toHaveCount(0);
  await b.click();
  await page.locator('.detail-panel input[type="file"]').setInputFiles({
    name: 'ticket.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('confirmation 123'),
  });
  await expect(page.locator('.attachment-row')).toContainText('ticket.txt');
  await page.getByRole('button', { name: '工作区', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Workspace', exact: true }).click();
  const bundle = await downloadPromise;
  const path = await bundle.path();
  if (!path) throw new Error('missing download');
  await page.locator('input[type="file"][accept=".zip,.json"]').setInputFiles(path);
  await expect(page.locator('.global-banner')).toContainText('工作区已导入');
  await page.locator('.candidate-card').filter({ hasText: '浏览器测试活动' }).click();
  await expect(page.locator('.attachment-row')).toContainText('ticket.txt');
});

test('候选库真实拖入、框选、批量平移保持相对时间，缩放不修改数据', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.save-status')).toHaveText('已保存到本机');
  const candidate = page.locator('.candidate-card').filter({ hasText: '哲学之道' });
  await candidate.scrollIntoViewIfNeeded();
  const grid = page.locator('.day-grid').first();
  await candidate.dragTo(grid, { targetPosition: { x: 250, y: 13 * 60 * 0.8 } });
  const placed = page.locator('.timeline-block').filter({ hasText: '哲学之道' }).first();
  await expect(placed).toBeVisible();
  await expect(page.getByLabel('安排开始', { exact: true })).toHaveValue('2026-10-12T13:00');
  // Select two independent placements using the real modifier gesture.
  const market = page.locator('.timeline-block').filter({ hasText: '锦市场' }).first();
  await market.click();
  await placed.click({ modifiers: ['Shift'] });
  await expect(page.locator('.timeline-block.selected')).toHaveCount(2);
  const before = await savedWorkspace(page);
  const rect = await placed.boundingBox();
  if (!rect) throw new Error('No block');
  await page.mouse.move(rect.x + 40, rect.y + 15);
  await page.mouse.down();
  await page.mouse.move(rect.x + 40, rect.y + 39, { steps: 5 });
  await page.mouse.up();
  const after = await savedWorkspace(page);
  const selectedIds = await page
    .locator('.timeline-block.selected')
    .evaluateAll((elements) => elements.map((e) => (e as HTMLElement).dataset.blockId));
  for (const id of selectedIds) {
    const a = before.blocks.find((b: { id: string }) => b.id === id),
      b = after.blocks.find((b: { id: string }) => b.id === id);
    expect(Date.parse(b.start.instant) - Date.parse(a.start.instant)).toBe(30 * 60000);
    expect(Date.parse(b.end.instant) - Date.parse(a.end.instant)).toBe(30 * 60000);
  }
  expect(after.candidates).toEqual(before.candidates);
  const marketRect = await market.boundingBox(),
    placedRect = await placed.boundingBox();
  if (!marketRect || !placedRect) throw new Error('缺少框选目标');
  await page.mouse.move(marketRect.x - 8, marketRect.y - 5);
  await page.mouse.down();
  await page.mouse.move(
    Math.max(marketRect.x + marketRect.width, placedRect.x + placedRect.width) + 5,
    placedRect.y + placedRect.height + 5,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(market).toHaveClass(/selected/);
  await expect(placed).toHaveClass(/selected/);
  const scroller = page.locator('.timeline-scroll');
  const s = await scroller.boundingBox();
  if (!s) throw new Error();
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect(page.locator('.zoom-control')).not.toContainText('100%');
  const afterZoom = await savedWorkspace(page);
  expect(afterZoom).toEqual(after);
});

test('非法 Workspace 导入不破坏当前计划；未知路线可手动覆盖并撤销', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.travel-edge').first()).toBeVisible();
  await page.locator('.travel-edge').first().click();
  await page.getByRole('combobox', { name: '交通方式', exact: true }).selectOption('DRIVE');
  await expect(page.locator('.detail-panel')).toContainText(
    '驾驶路段未被唯一有效的租车状态完整覆盖',
  );
  await expect(page.getByRole('combobox', { name: '交通方式', exact: true })).toHaveValue('DRIVE');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '交通方式', exact: true })).toHaveValue('');
  await page.locator('input[type="file"][accept=".zip,.json"]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schemaVersion":999}'),
  });
  await expect(page.locator('.global-banner')).toContainText('不支持 schemaVersion');
  await expect(page.getByRole('heading', { name: '京都 · 慢游三日' })).toBeVisible();
  await expect(page.locator('.timeline-block')).toHaveCount(8);
});

test.describe('配置与新建旅行', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('从全局设置继承默认值，创建前确认全部旅行配置并持久化', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.save-status')).toHaveText('已保存到本机');
    await page.getByRole('button', { name: '全局设置', exact: true }).click();
    const panel = page.locator('.detail-panel');
    const globalSettings = page.getByRole('dialog', { name: '全局设置', exact: true });
    await expect(globalSettings).toBeVisible();
    await expect(page.getByRole('button', { name: '偏好与路线设置', exact: true })).toHaveCount(0);
    await globalSettings.getByLabel('Home名称', { exact: true }).fill('我的家');
    await globalSettings.getByLabel('Home地址', { exact: true }).fill('上海市徐汇区');
    await globalSettings.getByLabel('默认交通出发前缓冲 / 分钟').fill('120');
    await globalSettings.getByRole('button', { name: '完成', exact: true }).click();
    // A previous trip's override must not become the next trip's global default.
    await page.getByRole('button', { name: '编辑旅行设置', exact: true }).click();
    await panel.getByLabel('默认交通出发前缓冲 / 分钟').fill('5');
    await panel.getByLabel('默认交通出发前缓冲 / 分钟').blur();
    await page.getByRole('button', { name: '全局设置', exact: true }).click();
    await expect(globalSettings.getByLabel('默认交通出发前缓冲 / 分钟')).toHaveValue('120');
    await globalSettings.getByLabel('Home名称', { exact: true }).press('Escape');
    await expect(globalSettings).toHaveCount(0);
    await expect(panel.getByRole('heading', { name: '旅行设置', exact: true })).toBeVisible();
    await expect(panel.getByLabel('默认交通出发前缓冲 / 分钟')).toHaveValue('5');

    await page.getByRole('button', { name: '工作区', exact: true }).click();
    await page.getByRole('button', { name: '新建旅行', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建旅行', exact: true });
    await expect(dialog.getByRole('combobox', { name: '主时区', exact: true })).toHaveValue(
      'America/Los_Angeles',
    );
    await expect(dialog.getByLabel('旅行起点名称', { exact: true })).toHaveValue('我的家');
    await expect(dialog.getByLabel('旅行终点名称', { exact: true })).toHaveValue('我的家');
    await expect(dialog.getByLabel('默认交通出发前缓冲 / 分钟')).toHaveValue('120');
    const initialStart = await dialog.getByLabel('显示开始', { exact: true }).inputValue();
    await dialog
      .getByRole('combobox', { name: '主时区', exact: true })
      .selectOption('Asia/Shanghai');
    await expect(dialog.getByLabel('显示开始', { exact: true })).toHaveValue(
      DateTime.fromISO(initialStart, { zone: 'America/Los_Angeles' })
        .setZone('Asia/Shanghai')
        .toFormat("yyyy-MM-dd'T'HH:mm"),
    );
    await expect(
      dialog.getByRole('button', { name: '移除时区 Asia/Shanghai', exact: true }),
    ).toBeDisabled();
    await dialog.getByLabel('其他旅行时区', { exact: true }).fill('Mars/Base');
    await dialog.getByRole('button', { name: '添加时区', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('有效的 IANA 时区');
    await dialog.getByLabel('其他旅行时区', { exact: true }).fill('Europe/Paris');
    await dialog.getByRole('button', { name: '添加时区', exact: true }).click();
    await dialog.getByRole('button', { name: '移除时区 America/Los_Angeles', exact: true }).click();
    await dialog.getByLabel('旅行名称', { exact: true }).fill('已确认配置的旅行');
    await dialog.getByLabel('显示开始', { exact: true }).fill('2026-11-01T00:00');
    await dialog.getByLabel('显示结束', { exact: true }).fill('2026-11-03T23:59');
    await dialog.getByLabel('旅行起点名称', { exact: true }).fill('上海虹桥站');
    await dialog.getByLabel('旅行起点地址', { exact: true }).fill('上海市闵行区申贵路');
    await dialog.getByLabel('旅行终点名称', { exact: true }).fill('上海浦东机场');
    await dialog.getByLabel('默认交通出发前缓冲 / 分钟').fill('105');
    await dialog.getByLabel('步行阈值 / 分钟').fill('12');
    await dialog.getByLabel('步行阈值 / 分钟').blur();
    await page.screenshot({ path: 'test-results/new-trip-settings.png', fullPage: true });
    await dialog.getByRole('button', { name: '创建工作区', exact: true }).click();
    await expect(page.getByRole('heading', { name: '已确认配置的旅行' })).toBeVisible();
    const saved = await savedWorkspace(page);
    expect(saved.trip.timezones).toEqual(['Asia/Shanghai', 'Europe/Paris']);
    expect(saved.trip.primaryTimezone).toBe('Asia/Shanghai');
    expect(saved.trip.displayStart).toEqual({
      instant: '2026-10-31T16:00:00.000Z',
      timezone: 'Asia/Shanghai',
    });
    expect(saved.trip.displayEnd).toEqual({
      instant: '2026-11-03T15:59:00.000Z',
      timezone: 'Asia/Shanghai',
    });
    expect(saved.trip.startLocation).toMatchObject({
      name: '上海虹桥站',
      address: '上海市闵行区申贵路',
    });
    expect(saved.trip.endLocation.name).toBe('上海浦东机场');
    expect(saved.trip.config).toEqual({ preBuffer: 105, walkingThreshold: 12 });
    expect(saved.globalConfig.preBuffer).toBe(120);
    expect(saved.globalConfig.home).toMatchObject({ name: '我的家', address: '上海市徐汇区' });
    expect(
      saved.trip.overnightBreaks.map(
        (point: { time: { instant: string; timezone: string } }) => point.time,
      ),
    ).toEqual([
      { instant: '2026-11-01T19:30:00.000Z', timezone: 'Asia/Shanghai' },
      { instant: '2026-11-02T19:30:00.000Z', timezone: 'Asia/Shanghai' },
    ]);
    await page.reload();
    await expect(page.getByLabel('显示时区', { exact: true })).toHaveValue('Asia/Shanghai');
    await page.getByLabel('显示时区', { exact: true }).selectOption('Europe/Paris');
    await page.getByRole('button', { name: '编辑旅行设置', exact: true }).click();
    await expect(panel.getByRole('combobox', { name: '主时区', exact: true })).toHaveValue(
      'Asia/Shanghai',
    );
  });

  test('无效显示范围和不存在的本地时间不能创建，取消保留原旅行', async ({ page }) => {
    await page.goto('/');
    const original = await savedWorkspace(page);
    await page.getByRole('button', { name: '工作区', exact: true }).click();
    await page.getByRole('button', { name: '新建旅行', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建旅行', exact: true });
    const start = dialog.getByLabel('显示开始', { exact: true });
    const end = dialog.getByLabel('显示结束', { exact: true });
    const create = dialog.getByRole('button', { name: '创建工作区', exact: true });
    await start.fill('2027-03-15T00:00');
    await end.fill('2027-03-14T23:59');
    await end.blur();
    await expect(create).toBeDisabled();
    await expect(dialog.getByRole('alert')).toContainText('显示结束必须晚于显示开始');
    await start.fill('2027-03-14T02:30'); // Spring-forward gap in Los Angeles.
    await start.blur();
    await expect(dialog).toContainText('该本地时间不存在');
    await expect(create).toBeDisabled();
    await start.fill('2027-03-14T03:30');
    await start.blur();
    await expect(create).toBeEnabled();
    await end.clear();
    await end.blur();
    await expect(create).toBeDisabled();
    await expect(dialog).toContainText('请填写日期与时间');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect(await savedWorkspace(page)).toEqual(original);
  });
});

test('Option 各方案及跨日内部路线独立可见、可点击，进出路线不互相覆盖', async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.route('**/api/routes', (request) =>
    request.fulfill({
      json: { status: 'ok', minutes: 10, distanceMeters: 800, source: 'browser-test' },
    }),
  );
  const w = createWorkspace('多方案路线回归', undefined, 'Asia/Tokyo');
  const time = (value: string) => fromLocal(`2026-10-${value}`, 'Asia/Tokyo');
  w.trip.displayStart = time('12T00:00');
  w.trip.displayEnd = time('13T23:59');
  w.trip.timezones.push('America/Los_Angeles');
  w.trip.overnightBreaks = [];
  w.trip.startLocation = { ...emptyLocation(), name: '家' };
  w.trip.endLocation = { ...emptyLocation(), name: '家' };
  const activity = (id: string, title: string, start: string, end: string): ConcreteBlock => {
    w.candidates.push({
      id: `candidate-${id}`,
      kind: 'activity',
      title,
      location: { ...emptyLocation(), name: title },
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
    activity('before', '共同出发', '12T09:00', '12T10:00'),
    {
      id: 'option',
      kind: 'option',
      title: '三条游览路线',
      metadata: emptyMetadata(),
      variants: ['A', 'B', 'C'].map((id) => ({
        id,
        title: `方案 ${id}`,
        blocks: [
          activity(`${id}-1`, `${id} 博物馆`, '12T10:30', '12T12:00'),
          activity(`${id}-2`, `${id} 咖啡馆`, '12T13:00', '12T14:00'),
          activity(`${id}-3`, `${id} 早餐`, '13T09:00', '13T10:00'),
          activity(`${id}-4`, `${id} 散步`, '13T11:00', '13T12:00'),
        ],
      })),
    },
    activity('after', '共同结束', '13T13:00', '13T14:00'),
  ];
  await page.goto('/');
  await expect(page.locator('.save-status')).toHaveText('已保存到本机');
  await page.locator('input[type="file"][accept=".zip,.json"]').setInputFiles({
    name: 'variants.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(w)),
  });
  await expect(page.getByRole('heading', { name: w.trip.name })).toBeVisible();
  const panel = page.locator('.detail-panel');
  for (const id of ['A', 'B', 'C']) {
    // Check the known route on each day, including the first and middle alternatives.
    for (const index of [1, 3]) {
      const edge = page.locator(
        `.variant-column[data-variant-id="${id}"] .travel-edge[data-edge-key="${id}-${index}>${id}-${index + 1}"]`,
      );
      await expect(edge).toHaveCount(1);
      await edge.scrollIntoViewIfNeeded();
      await expect(edge).toContainText('10 分钟');
      await edge.click(); // Fails if another alternative covers it.
      await expect(panel.locator('.route-endpoints')).toContainText(
        `${id} ${index === 1 ? '博物馆' : '早餐'}`,
      );
      await expect(panel.locator('.route-endpoints')).toContainText(
        `${id} ${index === 1 ? '咖啡馆' : '散步'}`,
      );
      const alignment = await edge.evaluate((element) => {
        const card = element.getBoundingClientRect();
        const column = element.closest('.variant-column')!;
        const columnBox = column.getBoundingClientRect();
        const fromId = element.getAttribute('data-edge-key')!.split('>')[0];
        const block = column.querySelector(`[data-block-id="${fromId}"]`)!.getBoundingClientRect();
        return {
          within: card.left >= columnBox.left && card.right <= columnBox.right,
          delta: card.top - block.bottom,
        };
      });
      expect(alignment.within).toBe(true);
      expect(Math.abs(alignment.delta)).toBeLessThan(2);
    }
    for (const key of [`before>${id}-1`, `${id}-4>after`]) {
      const edge = page.locator(`.edge-lane .travel-edge[data-edge-key="${key}"]`);
      await edge.click();
      await expect(panel.locator('.route-endpoints')).toContainText(id);
    }
  }
  const internal = page.locator('.variant-edge-lane .travel-edge');
  await expect(internal).toHaveCount(9);
  await page
    .locator('.variant-column[data-variant-id="B"] .travel-edge[data-edge-key="B-1>B-2"]')
    .click();
  await panel.getByRole('combobox', { name: '交通方式', exact: true }).selectOption('RIDESHARE');
  const saved = await savedWorkspace(page);
  expect(saved.edgeOverrides).toEqual({ 'B-1>B-2': 'RIDESHARE' });
  expect(saved.blocks).toEqual(w.blocks);
  await page.screenshot({ path: 'test-results/option-travel-edges.png', fullPage: true });
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '全局设置', exact: true });
  await settings
    .getByRole('combobox', { name: '路线查询', exact: true })
    .selectOption('unavailable');
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await expect(internal).toHaveCount(9);
  for (const id of ['A', 'B', 'C']) {
    const edge = page.locator(
      `.variant-column[data-variant-id="${id}"] .travel-edge[data-edge-key="${id}-1>${id}-2"]`,
    );
    await edge.click();
    await expect(edge).toContainText('未知');
    await expect(panel.locator('.route-endpoints')).toContainText(`${id} 博物馆`);
  }
});

for (const scenario of ['短途出发', '不同方案出发时间', '路线未知', '午夜零距离'] as const) {
  test(`首项 Option 的出发提示避让标题：${scenario}`, async ({ page }) => {
    await page.route('**/api/routes', (request) =>
      request.fulfill({
        json: {
          status: 'ok',
          minutes:
            scenario === '不同方案出发时间' &&
            request.request().postDataJSON().destination === '地点 B'
              ? 12
              : 8,
          distanceMeters: 500,
          source: 'browser-test',
        },
      }),
    );
    const w = createWorkspace(`首项 Option · ${scenario}`, undefined, 'Asia/Tokyo');
    const time = (value: string) => fromLocal(`2026-10-12T${value}`, 'Asia/Tokyo');
    w.trip.displayStart = time('00:00');
    w.trip.displayEnd = time('23:59');
    w.trip.overnightBreaks = [];
    w.trip.startLocation = { ...emptyLocation(), name: '家' };
    w.trip.endLocation = { ...emptyLocation(), name: '家' };
    if (scenario === '路线未知') w.globalConfig.routingProvider = 'unavailable';
    const start = scenario === '午夜零距离' ? '00:00' : '05:00';
    const end = scenario === '午夜零距离' ? '01:00' : '06:00';
    w.blocks = [
      {
        id: 'first-option',
        kind: 'option',
        title: '待决定的安排',
        metadata: emptyMetadata(),
        variants: ['A', 'B'].map((id) => {
          w.candidates.push({
            id: `candidate-${id}`,
            kind: 'activity',
            title: `活动 ${id}`,
            location: { ...emptyLocation(), name: scenario === '午夜零距离' ? '家' : `地点 ${id}` },
            metadata: emptyMetadata(),
            constraints: { intervals: [], minMinutes: null, maxMinutes: null },
          });
          return {
            id,
            title: `方案 ${id}`,
            blocks: [
              {
                id: `block-${id}`,
                kind: 'candidate',
                candidateId: `candidate-${id}`,
                start: time(start),
                end: time(end),
              },
            ],
          };
        }),
      },
    ];
    await page.goto('/');
    await expect(page.locator('.save-status')).toHaveText('已保存到本机');
    await page.locator('input[type="file"][accept=".zip,.json"]').setInputFiles({
      name: 'first-option.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(w)),
    });
    await expect(page.getByRole('heading', { name: w.trip.name })).toBeVisible();
    const labels = page.locator('.trip-endpoint.start');
    const expectedTimes =
      scenario === '路线未知'
        ? ['时间未知']
        : scenario === '午夜零距离'
          ? ['00:00']
          : scenario === '不同方案出发时间'
            ? ['04:48'] // The global departure uses the earliest requirement across all variants.
            : ['04:52'];
    await expect(labels).toHaveCount(expectedTimes.length);
    for (const text of expectedTimes) await expect(labels.filter({ hasText: text })).toBeVisible();
    const verifyLayout = async () => {
      const geometry = await page.locator('.day-grid').evaluate((grid) => {
        const header = grid.querySelector('.option-grip')!.getBoundingClientRect();
        const starts = [...grid.querySelectorAll('.trip-endpoint.start')].map((element) => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        });
        const option = grid.querySelector('.option-block') as HTMLElement;
        const gridTop = grid.getBoundingClientRect().top;
        const marker = grid.querySelector('.trip-endpoint-connector i')!.getBoundingClientRect();
        return {
          headerTop: header.top,
          starts,
          earliestTop: Math.min(...starts.map((rect) => rect.top)),
          dayHeaderBottom: grid.previousElementSibling!.getBoundingClientRect().bottom,
          optionTop: parseFloat(option.style.top),
          pixelsPerMinute: grid.getBoundingClientRect().height / 1440,
          actualMarkerTop: marker.top + marker.height / 2 - gridTop,
        };
      });
      for (const rect of geometry.starts)
        expect(rect.bottom).toBeLessThanOrEqual(geometry.headerTop - 2);
      const sorted = [...geometry.starts].sort((a, b) => a.top - b.top);
      for (let i = 1; i < sorted.length; i++)
        expect(sorted[i - 1].bottom).toBeLessThanOrEqual(sorted[i].top - 2);
      expect(geometry.optionTop).toBeCloseTo(
        ((ms(time(start)) - ms(time('00:00'))) / 60000) * geometry.pixelsPerMinute,
        4,
      );
      const anchorTime = scenario === '路线未知' ? start : expectedTimes[0];
      expect(geometry.actualMarkerTop).toBeCloseTo(
        ((ms(time(anchorTime)) - ms(time('00:00'))) / 60000) * geometry.pixelsPerMinute,
        1,
      );
      // Midnight labels have reserved space instead of extending underneath the day header.
      if (scenario === '午夜零距离')
        expect(geometry.earliestTop).toBeGreaterThanOrEqual(geometry.dayHeaderBottom);
    };
    await verifyLayout();
    if (scenario === '短途出发') {
      await page.screenshot({ path: 'test-results/first-option-departure.png', fullPage: true });
      for (let i = 0; i < 5; i++) await page.getByTitle('缩小时间轴', { exact: true }).click();
      await verifyLayout();
      for (let i = 0; i < 12; i++) await page.getByTitle('放大时间轴', { exact: true }).click();
      await verifyLayout();
      await expect(labels).toContainText('04:52');
    }
    expect((await savedWorkspace(page)).blocks).toEqual(w.blocks);
  });
}
