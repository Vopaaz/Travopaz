import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createWorkspace } from '../../src/domain/factory';
import {
  emptyRouteCache,
  parseRouteCache,
  routeCacheEntry,
  ROUTE_CACHE_TTL,
  type RouteCacheEntry,
} from '../../src/domain/routeCache';
import { makeBundle, readBundle } from '../../src/storage/browser';
import { aiContext, humanItinerary } from '../../src/storage/exports';
import { derive } from '../../src/domain/derive';

export const entry = (fetchedAt = Date.now()): RouteCacheEntry => ({
  origin: 'A',
  destination: 'B',
  mode: 'DRIVE',
  fetchedAt,
  result: { status: 'ok', minutes: 12, distanceMeters: 3456, source: 'google' },
});
describe('14 天工作区路线缓存', () => {
  it('按获取时间失效，命中、合并与打车/驾车转换都不延长 TTL', () => {
    const now = Date.now(),
      old = entry(now - ROUTE_CACHE_TTL + 1);
    expect(parseRouteCache({ version: 1, entries: [old] }, now).entries).toEqual([old]);
    expect(parseRouteCache({ version: 1, entries: [old] }, now + 1).entries).toEqual([]);
    const recent = entry(now - 13 * 86400000);
    expect(
      routeCacheEntry(' A ', ' B ', 'RIDESHARE', { ...recent.result, fetchedAt: recent.fetchedAt }),
    ).toEqual(recent);
    expect(
      parseRouteCache({ version: 1, entries: [entry(now - 1000), entry(now - 2000)] }, now)
        .entries[0].fetchedAt,
    ).toBe(now - 1000);
    expect(
      routeCacheEntry('A', 'B', 'WALK', {
        status: 'unavailable',
        minutes: null,
        source: 'google',
        message: 'offline',
      }),
    ).toBeNull();
  });
  it('丢弃过期、未来、非法和未知版本的缓存', () => {
    const now = Date.now();
    expect(
      parseRouteCache(
        {
          version: 1,
          entries: [
            entry(now + 1),
            entry(now - ROUTE_CACHE_TTL),
            { ...entry(now), result: { ...entry(now).result, minutes: -1 } },
            entry(now),
          ],
        },
        now,
      ).entries,
    ).toEqual([entry(now)]);
    expect(parseRouteCache({ version: 2, entries: [entry()] })).toEqual(emptyRouteCache());
  });
  it('Workspace ZIP 携带缓存且保留原始获取时间；旧 ZIP、纯 JSON 和损坏缓存可导入', async () => {
    const w = createWorkspace(),
      cached = entry(Date.now() - 13 * 86400000);
    const blob = await makeBundle(
      w,
      async () => {
        throw new Error('无附件');
      },
      { version: 1, entries: [cached] },
    );
    const restored = await readBundle(new File([blob], 'trip.zip'));
    expect(restored.routeCache.entries).toEqual([cached]);
    expect(restored.workspace).toEqual(w);
    expect(restored.workspace).not.toHaveProperty('routeCache');
    const zip = new JSZip();
    zip.file('workspace.json', JSON.stringify(w));
    expect(
      (await readBundle(new File([await zip.generateAsync({ type: 'arraybuffer' })], 'old.zip')))
        .routeCache,
    ).toEqual(emptyRouteCache());
    zip.file('route-cache.json', '{broken');
    expect(
      (
        await readBundle(
          new File([await zip.generateAsync({ type: 'arraybuffer' })], 'broken-cache.zip'),
        )
      ).workspace,
    ).toEqual(w);
    expect((await readBundle(new File([JSON.stringify(w)], 'trip.json'))).routeCache).toEqual(
      emptyRouteCache(),
    );
  });
  it('人类与 AI 导出不携带工作区缓存', async () => {
    const w = createWorkspace(),
      d = derive(w);
    const ai = aiContext(w, d, w.trip.primaryTimezone);
    expect(JSON.stringify(ai)).not.toContain('routeCache');
    const human = await humanItinerary(w, d, w.trip.primaryTimezone, async () => new Blob());
    const zip = await JSZip.loadAsync(await human.arrayBuffer());
    expect(zip.file('route-cache.json')).toBeNull();
  });
});
