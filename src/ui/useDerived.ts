import { useEffect, useMemo, useRef, useState } from 'react';
import type { Workspace, Location, Mode } from '../domain/schema';
import { derive } from '../domain/derive';
import { locationQuery, routeKey, unknownRoute, type RouteResult } from '../domain/routing';

export function useDerived(w: Workspace) {
  const cache = useRef(new Map<string, { result: RouteResult; expires: number }>());
  const inFlight = useRef(new Set<string>()),
    [version, setVersion] = useState(0),
    [busy, setBusy] = useState(false),
    [configured, setConfigured] = useState(false);
  const refresh = () => {
    cache.current.clear();
    void fetch('/api/routes/clear', { method: 'POST' }).then(() => setVersion((v) => v + 1));
    void fetch('/api/health')
      .then((r) => r.json())
      .then((r) => setConfigured(Boolean(r.routingConfigured)))
      .catch(() => setConfigured(false));
  };
  useEffect(() => {
    void fetch('/api/health')
      .then((r) => r.json())
      .then((r) => setConfigured(Boolean(r.routingConfigured)))
      .catch(() => setConfigured(false));
  }, []);
  const { derived, requests } = useMemo(() => {
    const requests = new Map<string, { origin: Location; destination: Location; mode: Mode }>();
    const derived = derive(w, (origin, destination, mode) => {
      const key = routeKey(origin, destination, mode),
        hit = cache.current.get(key);
      if (hit && hit.expires > Date.now()) return hit.result;
      requests.set(key, { origin, destination, mode });
      return unknownRoute();
    });
    return { derived, requests };
  }, [w, version]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const jobs = [...requests].filter(([key]) => !inFlight.current.has(key));
      if (!jobs.length) return;
      for (const [key] of jobs) inFlight.current.add(key);
      setBusy(true);
      let cursor = 0;
      const worker = async () => {
        while (cursor < jobs.length) {
          const [key, q] = jobs[cursor++];
          let result: RouteResult;
          try {
            const response = await fetch('/api/routes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                origin: locationQuery(q.origin),
                destination: locationQuery(q.destination),
                mode: q.mode,
              }),
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
          cache.current.set(key, {
            result,
            expires: Date.now() + (result.status === 'ok' ? 3600000 : 30000),
          });
          inFlight.current.delete(key);
        }
      };
      void Promise.all([worker(), worker(), worker()]).then(() => {
        setBusy(inFlight.current.size > 0);
        setVersion((v) => v + 1);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [requests]);
  return { derived, busy, configured, refresh };
}
