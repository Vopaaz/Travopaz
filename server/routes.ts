import { z } from 'zod';
import type { RouteResult } from '../src/domain/routing';

const querySchema = z
  .object({
    origin: z.string().trim().min(1).max(2000),
    destination: z.string().trim().min(1).max(2000),
    mode: z.enum(['WALK', 'DRIVE', 'RIDESHARE']),
  })
  .strict();
type CacheEntry = { expires: number; result: RouteResult };
export class GoogleRoutes {
  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, Promise<RouteResult>>();
  constructor(
    private key: () => string | undefined,
    private fetcher: typeof fetch = fetch,
  ) {}
  configured() {
    return Boolean(this.key());
  }
  clear() {
    this.cache.clear();
  }
  async lookup(input: unknown): Promise<RouteResult> {
    const query = querySchema.parse(input);
    const key = JSON.stringify([
      query.origin,
      query.destination,
      query.mode === 'RIDESHARE' ? 'DRIVE' : query.mode,
    ]);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.result;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const job = this.request(query)
      .then((result) => {
        // Derived, session-only cache. Never store provider responses in canonical workspace.
        this.cache.set(key, {
          expires: Date.now() + (result.status === 'ok' ? 3600000 : 30000),
          result,
        });
        if (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value!);
        return result;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, job);
    return job;
  }
  private async request(query: z.infer<typeof querySchema>): Promise<RouteResult> {
    const apiKey = this.key();
    if (!apiKey)
      return {
        status: 'unavailable',
        minutes: null,
        message: '尚未配置 Google Routes API Key，请查看设置中的配置指南。',
        source: 'google',
      };
    try {
      const mode = query.mode === 'WALK' ? 'WALK' : 'DRIVE';
      const response = await this.fetcher(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
          },
          body: JSON.stringify({
            origin: { address: query.origin },
            destination: { address: query.destination },
            travelMode: mode,
            ...(mode === 'DRIVE' ? { routingPreference: 'TRAFFIC_UNAWARE' } : {}),
            computeAlternativeRoutes: false,
            languageCode: 'zh-CN',
            units: 'METRIC',
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok)
        return {
          status: 'unavailable',
          minutes: null,
          message: `Google Routes 请求失败（HTTP ${response.status}），请检查 API 启用、Key 限制与配额。`,
          source: 'google',
        };
      const data = (await response.json()) as {
        routes?: { duration: string; distanceMeters?: number }[];
      };
      const route = data.routes?.[0];
      if (!route || !/^\d+(\.\d+)?s$/.test(route.duration))
        return {
          status: 'unavailable',
          minutes: null,
          message: 'Google 未返回可用路线。',
          source: 'google',
        };
      return {
        status: 'ok',
        minutes: Number.parseFloat(route.duration) / 60,
        distanceMeters: route.distanceMeters ?? null,
        source: 'google',
      };
    } catch {
      return {
        status: 'unavailable',
        minutes: null,
        message: '路线查询超时或网络不可用，请稍后重试。',
        source: 'google',
      };
    }
  }
}
