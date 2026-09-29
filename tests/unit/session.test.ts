import { afterEach, expect, it, vi } from 'vitest';
import * as browser from '../../src/storage/browser';
import { WorkspaceSession } from '../../src/storage/session';
import { createWorkspace } from '../../src/domain/factory';
import { emptyRouteCache, type RouteCacheEntry } from '../../src/domain/routeCache';

vi.mock('../../src/storage/browser', () => ({
  loadActive: vi.fn(async () => null),
  loadBrowserRouteCache: vi.fn(async () => ({ version: 1, entries: [] })),
  saveBrowser: vi.fn(async () => {}),
  saveBrowserRouteCache: vi.fn(async () => {}),
  putBlob: vi.fn(async () => {}),
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const entry = (): RouteCacheEntry => ({
  origin: 'A',
  destination: 'B',
  mode: 'WALK',
  fetchedAt: Date.now(),
  result: { status: 'ok', minutes: 8, distanceMeters: 800, source: 'google' },
});

it('切换工作区前等待已完成查询的缓存落盘，旧查询迟到时不能进入新工作区', async () => {
  vi.stubGlobal('window', {});
  const session = new WorkspaceSession();
  await session.initialize();
  await session.flush();
  const old = session.getSnapshot(),
    cached = entry();
  let finish!: () => void;
  vi.mocked(browser.saveBrowser).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  session.edit((w) => {
    w.trip.name = '等待磁盘写入';
  });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  session.recordRoutes(old.routeCacheEpoch, [cached]);
  const next = createWorkspace('新工作区');
  const switching = session.replaceBrowser(next, new Map(), emptyRouteCache());
  finish();
  await switching;
  expect(browser.saveBrowserRouteCache).toHaveBeenCalledWith(old.workspace.id, {
    version: 1,
    entries: [cached],
  });
  session.recordRoutes(old.routeCacheEpoch, [entry()]);
  expect(session.getSnapshot().workspace.id).toBe(next.id);
  expect(session.getSnapshot().routeCache).toEqual(emptyRouteCache());
});

it('缓存更新不添加撤销记录，也不会随行程撤销而丢失', async () => {
  vi.stubGlobal('window', {});
  const session = new WorkspaceSession();
  await session.initialize();
  session.edit((w) => {
    w.trip.name = '编辑';
  });
  const cached = entry();
  session.recordRoutes(session.getSnapshot().routeCacheEpoch, [cached]);
  session.undo();
  await session.flush();
  expect(session.getSnapshot().workspace.trip.name).not.toBe('编辑');
  expect(session.getSnapshot().routeCache.entries).toEqual([cached]);
  expect(session.getSnapshot().canUndo).toBe(false);
});
