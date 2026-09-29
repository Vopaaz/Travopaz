import { z } from 'zod';
import type { RouteResult } from './routing';

export const ROUTE_CACHE_TTL = 14 * 24 * 60 * 60 * 1000;
export const ROUTE_FAILURE_TTL = 30_000;
export const ROUTE_CACHE_FILE = 'route-cache.json';
const entrySchema = z.object({
  origin: z.string().trim().min(1).max(2000),
  destination: z.string().trim().min(1).max(2000),
  mode: z.enum(['WALK', 'DRIVE']),
  fetchedAt: z.number().nonnegative(),
  result: z.object({
    status: z.literal('ok'),
    minutes: z.number().nonnegative(),
    distanceMeters: z.number().nonnegative().nullable(),
    source: z.string().min(1),
  }),
});
export type RouteCacheEntry = z.infer<typeof entrySchema>;
export type RouteCache = { version: 1; entries: RouteCacheEntry[] };
export const emptyRouteCache = (): RouteCache => ({ version: 1, entries: [] });
export const cacheEntryKey = (e: Pick<RouteCacheEntry, 'origin' | 'destination' | 'mode'>) =>
  JSON.stringify([e.origin, e.destination, e.mode]);
export const freshRouteEntry = (entry: RouteCacheEntry, now = Date.now()) =>
  entry.fetchedAt <= now && entry.fetchedAt + ROUTE_CACHE_TTL > now;

/** Cache data is expendable. Invalid, expired and future-dated entries are ignored. */
export function parseRouteCache(value: unknown, now = Date.now()): RouteCache {
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('entries' in value) ||
    !Array.isArray(value.entries)
  )
    return emptyRouteCache();
  const entries = new Map<string, RouteCacheEntry>();
  for (const input of value.entries) {
    const parsed = entrySchema.safeParse(input);
    if (!parsed.success || !freshRouteEntry(parsed.data, now)) continue;
    const key = cacheEntryKey(parsed.data),
      previous = entries.get(key);
    if (!previous || parsed.data.fetchedAt > previous.fetchedAt) entries.set(key, parsed.data);
  }
  return {
    version: 1,
    entries: [...entries.values()].sort((a, b) => b.fetchedAt - a.fetchedAt).slice(0, 2000),
  };
}

export function routeCacheEntry(
  origin: string,
  destination: string,
  mode: 'WALK' | 'DRIVE' | 'RIDESHARE',
  result: RouteResult,
): RouteCacheEntry | null {
  if (result.status !== 'ok') return null;
  const fetchedAt = result.fetchedAt ?? Date.now();
  return (
    parseRouteCache({
      version: 1,
      entries: [
        {
          origin,
          destination,
          mode: mode === 'RIDESHARE' ? 'DRIVE' : mode,
          fetchedAt,
          result: {
            status: 'ok',
            minutes: result.minutes,
            distanceMeters: result.distanceMeters,
            source: result.source,
          },
        },
      ],
    }).entries[0] ?? null
  );
}
