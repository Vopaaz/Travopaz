import { formatDuration } from './time';

type TimingSource = {
  effectiveMinutes: number | null;
  availableMinutes: number | null;
  departure: number | null;
  arrival: number | null;
};

// Round at 30 seconds, including negative gaps. Normalize floating-point dust
// to the timeline's millisecond precision before deciding which minute to use.
const roundMinutes = (minutes: number | null) =>
  minutes === null
    ? null
    : Math.sign(minutes) * Math.round(Math.round(Math.abs(minutes) * 60000) / 60000);

const formatMinutes = (minutes: number | null) =>
  minutes !== null && minutes < 0 ? `-${formatDuration(-minutes)}` : formatDuration(minutes);

export const formatTravelDuration = (minutes: number | null) =>
  formatMinutes(roundMinutes(minutes));

/** Shared by consistency checks, timeline cards, the inspector and human exports. */
export function edgeTiming(edge: TimingSource) {
  // Round the route + buffer total once, then compare the same values we display.
  const required = roundMinutes(edge.effectiveMinutes);
  const available = roundMinutes(edge.availableMinutes);
  const derived = available === null;
  const slot = derived
    ? edge.departure === null || edge.arrival === null
      ? null
      : roundMinutes((edge.arrival - edge.departure) / 60000)
    : available;
  return {
    insufficient: required !== null && available !== null && required > available,
    requiredText: formatMinutes(required),
    availableText: formatMinutes(available),
    slotText: derived
      ? `${formatMinutes(slot)}（推导）`
      : slot !== null && slot < 0
        ? `重叠 ${formatMinutes(-slot)}`
        : formatMinutes(slot),
  };
}
