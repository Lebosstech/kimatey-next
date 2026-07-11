// Habit learning: detect recurring trips from the user's trip history.
// Heuristic clustering (per the manual §6.3: "clustering simple des trajets
// par heure/jour/trajectoire"). A lightweight ML model can replace this later.

import type { HabitualTrip, TripCandidate, TripRecord } from "./types";
import { getHabits } from "./store";

const MIN_OCCURRENCES = 2; // how many times a destination must recur
const GEO_BUCKET = 1000; // ~100 m clustering (round lat/lng to 3 decimals)

function minutesOfDay(ts: number): number {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

function destKey(t: TripRecord): string {
  const la = Math.round(t.lat * GEO_BUCKET) / GEO_BUCKET;
  const ln = Math.round(t.lng * GEO_BUCKET) / GEO_BUCKET;
  return `${la},${ln}`;
}

/**
 * Groups trip records by destination and returns those that recur, with a
 * departure-time window and the set of weekdays they occur on.
 */
export function detectRecurringTrips(history: TripRecord[]): TripCandidate[] {
  const groups = new Map<string, TripRecord[]>();
  for (const t of history) {
    if (typeof t.lat !== "number" || typeof t.lng !== "number") continue;
    const k = destKey(t);
    const arr = groups.get(k) ?? [];
    arr.push(t);
    groups.set(k, arr);
  }

  const candidates: TripCandidate[] = [];
  for (const [key, trips] of groups) {
    if (trips.length < MIN_OCCURRENCES) continue;
    const mins = trips.map((t) => minutesOfDay(t.ts));
    const weekdays = Array.from(
      new Set(trips.map((t) => new Date(t.ts).getDay()))
    ).sort((a, b) => a - b);
    // Representative window padded by 15 min on each side.
    const start = Math.max(0, Math.min(...mins) - 15);
    const end = Math.min(24 * 60 - 1, Math.max(...mins) + 15);
    // Most recent name wins (destinations can be renamed).
    const latest = trips.reduce((a, b) => (a.ts > b.ts ? a : b));
    candidates.push({
      key,
      destName: latest.name,
      destLat: latest.lat,
      destLng: latest.lng,
      departStartMin: start,
      departEndMin: end,
      weekdays,
      occurrences: trips.length,
    });
  }

  return candidates.sort((a, b) => b.occurrences - a.occurrences);
}

/** Candidates that are not already saved as habitual trips (by destination). */
export function newCandidates(history: TripRecord[]): TripCandidate[] {
  const existing = new Set(
    getHabits().map(
      (h) =>
        `${Math.round(h.destLat * GEO_BUCKET) / GEO_BUCKET},${
          Math.round(h.destLng * GEO_BUCKET) / GEO_BUCKET
        }`
    )
  );
  return detectRecurringTrips(history).filter((c) => !existing.has(c.key));
}
