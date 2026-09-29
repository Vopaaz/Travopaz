import { useEffect, useMemo, useState } from 'react';
import type { Location } from '../domain/schema';
import { derive } from '../domain/derive';
import {
  locationQuery,
  routeKey,
  unknownRoute,
  type RouteResult,
  type RoutingMode,
} from '../domain/routing';
import {
  cacheEntryKey,
  freshRouteEntry,
  routeCacheEntry,
  ROUTE_CACHE_TTL,
  ROUTE_FAILURE_TTL,
  type RouteCacheEntry,
} from '../domain/routeCache';
import { session } from '../storage/session';

export function useDerived(state: ReturnType<typeof session.getSnapshot>) {
  const { workspace: w, routeCache, routeCacheEpoch: epoch, loading } = state;
  // New workspace / import / explicit refresh gets its own request generation.
  const memory = useMemo(
    () => ({
      cache: new Map<string, { result: RouteResult; expires: number }>(),
      inFlight: new Set<string>(),
    }),
    [epoch],
  );
  const saved = useMemo(
    () => new Map(routeCache.entries.map((e) => [cacheEntryKey(e), e])),
    [routeCache],
  );
  const [version, setVersion] = useState(0),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [configured, setConfigured] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    session.clearRouteCache();
    try {
      await fetch('/api/routes/clear', { method: 'POST' });
      const health = await (await fetch('/api/health')).json();
      setConfigured(Boolean(health.routingConfigured));
    } catch {
      setConfigured(false);
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => {
    void fetch('/api/health')
      .then((r) => r.json())
      .then((r) => setConfigured(Boolean(r.routingConfigured)))
      .catch(() => setConfigured(false));
  }, []);
  const { derived, requests } = useMemo(() => {
    const requests = new Map<
      string,
      { origin: Location; destination: Location; mode: RoutingMode }
    >();
    const derived = derive(w, (origin, destination, mode) => {
      const key = routeKey(origin, destination, mode),
        entry = saved.get(key),
        hit = memory.cache.get(key);
      if (entry && freshRouteEntry(entry)) return entry.result;
      if (hit && hit.expires > Date.now()) return hit.result;
      if (!loading && !refreshing) requests.set(key, { origin, destination, mode });
      return unknownRoute();
    });
    return { derived, requests };
  }, [w, saved, memory, loading, refreshing, version]);
  useEffect(() => {
    setBusy(memory.inFlight.size > 0);
    const timer = setTimeout(() => {
      const jobs = [...requests].filter(([key]) => !memory.inFlight.has(key));
      if (!jobs.length) return;
      for (const [key] of jobs) memory.inFlight.add(key);
      setBusy(true);
      let cursor = 0;
      const entries: RouteCacheEntry[] = [];
      const worker = async () => {
        while (cursor < jobs.length) {
          if (session.getSnapshot().routeCacheEpoch !== epoch) return;
          const [key, q] = jobs[cursor++];
          const origin = locationQuery(q.origin),
            destination = locationQuery(q.destination);
          let result: RouteResult;
          try {
            const response = await fetch('/api/routes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ origin, destination, mode: q.mode }),
              signal: AbortSignal.timeout(20000),
            });
            if (!response.ok) throw new Error();
            result = (await response.json()) as RouteResult;
          } catch {
            result = {
              status: 'unavailable',
              minutes: null,
              source: 'google',
              message: '本地路线服务不可用，请确认服务已启动。',
            };
          }
          const entry = routeCacheEntry(origin, destination, q.mode, result);
          if (entry) entries.push(entry);
          memory.cache.set(key, {
            result: entry?.result ?? result,
            expires: entry ? entry.fetchedAt + ROUTE_CACHE_TTL : Date.now() + ROUTE_FAILURE_TTL,
          });
          memory.inFlight.delete(key);
        }
      };
      void Promise.all([worker(), worker(), worker()]).then(() => {
        if (session.getSnapshot().routeCacheEpoch !== epoch) return;
        session.recordRoutes(epoch, entries);
        setBusy(memory.inFlight.size > 0);
        setVersion((v) => v + 1);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [requests, memory, epoch]);
  return { derived, busy: busy || refreshing, configured, refresh };
}
