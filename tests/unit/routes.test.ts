import { describe, expect, it, vi } from 'vitest';
import { GoogleRoutes } from '../../server/routes';
import { ROUTE_CACHE_TTL } from '../../src/domain/routeCache';
describe('Google Routes 官方适配', () => {
  it('缓存 14 天且保留获取时间，合并并发；清空时迟到请求不能重新填回缓存', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(
          async () => new Response(JSON.stringify({ routes: [{ duration: '600s' }] })),
        );
      const provider = new GoogleRoutes(() => 'test', fetcher),
        query = { origin: 'A', destination: 'B', mode: 'DRIVE' };
      const results = await Promise.all(Array.from({ length: 40 }, () => provider.lookup(query)));
      expect(fetcher).toHaveBeenCalledTimes(1);
      const initial = results[0];
      vi.setSystemTime(Date.now() + ROUTE_CACHE_TTL - 1);
      expect(await provider.lookup(query)).toEqual(initial);
      expect(fetcher).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + 1);
      await provider.lookup(query);
      expect(fetcher).toHaveBeenCalledTimes(2);
      let resolve!: (response: Response) => void;
      fetcher.mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
      provider.clear();
      const pending = provider.lookup(query);
      provider.clear();
      resolve(new Response(JSON.stringify({ routes: [{ duration: '900s' }] })));
      await pending;
      await provider.lookup(query);
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
  it('驾驶查询非实时，最小 field mask，不请求实时信息；相同请求缓存', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ routes: [{ duration: '123.5s', distanceMeters: 3456 }] })),
      );
    const provider = new GoogleRoutes(() => 'test-key', fetcher),
      request = { origin: 'A', destination: 'B', mode: 'RIDESHARE' };
    const result = await provider.lookup(request);
    expect(result.minutes).toBeCloseTo(123.5 / 60);
    const options = fetcher.mock.calls[0][1]!;
    const body = JSON.parse(options.body as string);
    expect(body).toMatchObject({ travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' });
    expect(body.departureTime).toBeUndefined();
    expect(options.headers).toHaveProperty(
      'X-Goog-FieldMask',
      'routes.duration,routes.distanceMeters',
    );
    await provider.lookup({ ...request, mode: 'DRIVE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('WALK 不携带只适用于驾驶的 routingPreference', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ routes: [{ duration: '600s' }] })));
    await new GoogleRoutes(() => 'test', fetcher).lookup({
      origin: 'A',
      destination: 'B',
      mode: 'WALK',
    });
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).routingPreference).toBeUndefined();
  });
  it('缺 key、无路线、网络错误均为未知时长，而不是 0', async () => {
    const input = { origin: 'A', destination: 'B', mode: 'DRIVE' };
    expect((await new GoogleRoutes(() => '').lookup(input)).minutes).toBeNull();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    expect((await new GoogleRoutes(() => 'test', fetcher).lookup(input)).minutes).toBeNull();
    const broken = vi.fn<typeof fetch>().mockRejectedValue(new Error('network'));
    expect((await new GoogleRoutes(() => 'test', broken).lookup(input)).minutes).toBeNull();
  });
});
