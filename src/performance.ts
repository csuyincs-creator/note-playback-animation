import type {Activation} from './types';

// Adapted from the supplied starter: every gap is one continuous hop.
export const SCORE_SCALE = 0.016;
export const INTRO_SECONDS = 0.15;

export function groupLandings(notes: Activation[], staff: 1 | 2) {
  const groups: Activation[][] = [];
  for (const note of notes.filter(n => n.staff === staff).sort((a, b) => a.time - b.time)) {
    const last = groups.at(-1);
    if (last && Math.abs(last[0].time - note.time) < 1e-5) last.push(note);
    else groups.push([note]);
  }
  return groups.map(group => [...group].sort((a, b) =>
    (a.kind === 'attack' ? 0 : 1) - (b.kind === 'attack' ? 0 : 1) ||
    (staff === 1 ? b.pitch - a.pitch : a.pitch - b.pitch))[0]);
}

export function arcPoint(a: Activation, b: Activation, u: number): [number, number, number] {
  const p = Math.max(0, Math.min(1, u));
  const distance = Math.hypot(b.x - a.x, b.y - a.y) * SCORE_SCALE;
  const interval = Math.max(0, b.time - a.time);
  const hop = (0.27 + Math.min(0.13, distance * 0.045)) * Math.min(1, Math.max(0.18, interval / 0.22));
  const [x, z] = scorePathPoint(a, b, p);
  return [x * SCORE_SCALE, 0.097 + 4 * p * (1 - p) * hop, z * SCORE_SCALE];
}

export function scorePathPoint(a: Pick<Activation, 'x' | 'y' | 'system'>, b: Pick<Activation, 'x' | 'y' | 'system'>, u: number): [number, number] {
  const p = Math.max(0, Math.min(1, u));
  if (a.system === b.system) return [a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p];

  // Every odd system reads right-to-left, so the next row begins at the right.
  // Even systems begin on the left; wrap around the corresponding page edge.
  const returnsOnRight = b.system % 2 === 1;
  const edge = returnsOnRight ? Math.max(a.x, b.x) + 48 : Math.min(a.x, b.x) - 48;
  const inverse = 1 - p;
  const x = inverse ** 3 * a.x + 3 * inverse ** 2 * p * edge + 3 * inverse * p ** 2 * edge + p ** 3 * b.x;
  const y = inverse ** 3 * a.y + 3 * inverse ** 2 * p * a.y + 3 * inverse * p ** 2 * b.y + p ** 3 * b.y;
  return [x, y];
}

export function performanceAt(targets: Activation[], t: number) {
  let low = 0;
  let high = targets.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (targets[middle].time <= t) low = middle + 1;
    else high = middle;
  }
  const i = Math.max(0, low - 1);
  const current = targets[i];
  const next = targets[i + 1];
  const age = t - current.time;
  const landed = age >= 0;
  const restGap = next ? next.time - current.time - current.duration : 0;
  const resting = !!next && restGap > 0.65;
  const interval = next ? Math.max(0.001, next.time - current.time) : 0;
  const travelDuration = next ? (resting ? Math.min(0.62, interval) : interval) : 0;
  const travelStart = next ? next.time - travelDuration : Number.POSITIVE_INFINITY;
  const departing = !!next && landed && t >= travelStart && t < next.time;
  const u = departing ? Math.max(0, Math.min(1, (t - travelStart) / travelDuration)) : 1;
  const from = departing ? current : targets[Math.max(0, i - 1)];
  const to = departing ? next! : current;
  const pathFrom = departing ? current : (i > 0 ? targets[i - 1] : current);
  const position = departing ? arcPoint(current, next!, u) : [current.x * SCORE_SCALE, 0.097, current.y * SCORE_SCALE] as [number, number, number];
  let opacity = 1;
  if (!landed) {
    opacity = Math.max(0, Math.min(1, (t - current.time + INTRO_SECONDS) / INTRO_SECONDS));
    position[1] = 0.097 + 0.18 * (1 - opacity * opacity);
  } else if (resting && !departing) {
    opacity = Math.max(0, Math.min(1, (current.time + current.duration + 0.18 - t) / 0.18));
  } else if (!next) {
    opacity = Math.max(0, Math.min(1, (current.time + current.duration + 0.18 - t) / 0.18));
  }
  if (departing && resting) opacity = Math.min(1, Math.max(0, (t - travelStart) / 0.12));
  const trailOpacity = departing ? .82 : (i > 0 ? .62 * Math.max(0, 1 - age / .62) : 0);
  return {position, opacity, landed, pulse: landed ? Math.exp(-Math.max(0, age) / 0.1) : 0,
    from, to, pathFrom, u, trailOpacity, departing};
}
