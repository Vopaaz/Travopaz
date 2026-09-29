import type { Location, Mode } from './schema';
export type RouteResult =
  | {
      status: 'ok';
      minutes: number;
      distanceMeters: number | null;
      source: string;
      fetchedAt?: number;
    }
  | { status: 'unknown' | 'unavailable'; minutes: null; message: string; source: string };
export type RoutingMode = Exclude<Mode, 'NONE'>;
export type RouteLookup = (
  origin: Location,
  destination: Location,
  mode: RoutingMode,
) => RouteResult;
export const modeLabel: Record<Mode, string> = {
  WALK: '步行',
  DRIVE: '驾车',
  RIDESHARE: '打车',
  NONE: '无移动',
};
export const locationQuery = (l: Location) => l.address.trim() || l.name.trim();
export const routeKey = (a: Location, b: Location, mode: Mode) =>
  JSON.stringify([locationQuery(a), locationQuery(b), mode === 'RIDESHARE' ? 'DRIVE' : mode]);
export const hasLocation = (l: Location) => Boolean(locationQuery(l));
export const sameLocation = (a: Location, b: Location) =>
  hasLocation(a) && locationQuery(a) === locationQuery(b);
export const unknownRoute = (message = '路线尚未查询'): RouteResult => ({
  status: 'unknown',
  minutes: null,
  message,
  source: 'google',
});
export function navigationUrl(location: Location, app: 'google' | 'apple') {
  const custom = app === 'google' ? location.googleMapsUrl : location.appleMapsUrl;
  if (custom && /^https?:\/\//i.test(custom)) return custom;
  const query = encodeURIComponent(locationQuery(location));
  return app === 'google'
    ? `https://www.google.com/maps/search/?api=1&query=${query}`
    : `https://maps.apple.com/?q=${query}`;
}
