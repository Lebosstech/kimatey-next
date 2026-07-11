// Core of the system (manual §6.3): relate a reported incident to the habitual
// routes it affects, taking the departure time window into account.

import { distanceToSegmentKm, haversineKm } from "./geo";
import type { HabitualTrip, Incident } from "./types";

/** Alert if the incident is within this distance of the trip's route. */
export const MATCH_RADIUS_KM = 1.5;
/** Alert this many minutes before the departure window opens (manual: ~45). */
export const LEAD_MINUTES = 60;

export interface Match {
  trip: HabitualTrip;
  distanceKm: number;
}

function nowMinutes(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/** Is `now` within the trip's alerting window (lead-in → end of departure)? */
export function isWithinDepartureWindow(trip: HabitualTrip, now: Date): boolean {
  if (!trip.weekdays.includes(now.getDay())) return false;
  const m = nowMinutes(now);
  return m >= trip.departStartMin - LEAD_MINUTES && m <= trip.departEndMin;
}

/** Distance from an incident to a trip's route (destination or origin→dest). */
export function incidentDistanceKm(
  incident: Incident,
  trip: HabitualTrip
): number | null {
  if (typeof incident.lat !== "number" || typeof incident.lng !== "number") {
    return null; // no coordinates → cannot match geographically
  }
  const toDest = haversineKm(
    incident.lat,
    incident.lng,
    trip.destLat,
    trip.destLng
  );
  if (typeof trip.originLat === "number" && typeof trip.originLng === "number") {
    const toSeg = distanceToSegmentKm(
      incident.lat,
      incident.lng,
      trip.originLat,
      trip.originLng,
      trip.destLat,
      trip.destLng
    );
    return Math.min(toDest, toSeg);
  }
  return toDest;
}

/**
 * Returns the habitual trips affected by an incident right now: enabled,
 * within their departure window, and geographically on the route.
 */
export function matchIncidentToTrips(
  incident: Incident,
  trips: HabitualTrip[],
  now: Date = new Date()
): Match[] {
  const matches: Match[] = [];
  for (const trip of trips) {
    if (!trip.alertsEnabled) continue;
    if (!isWithinDepartureWindow(trip, now)) continue;
    const d = incidentDistanceKm(incident, trip);
    if (d === null || d > MATCH_RADIUS_KM) continue;
    matches.push({ trip, distanceKm: d });
  }
  return matches;
}
