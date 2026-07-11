// Orchestrates a predictive check: fetch incidents, match them against the
// user's habitual trips, fire notifications for new matches, and record alerts.

import { buildAlert } from "./format";
import { fetchIncidents } from "./incidents";
import { matchIncidentToTrips } from "./match";
import { showAlertNotification } from "./notify";
import {
  getConsent,
  getHabits,
  markNotified,
  pushAlert,
  wasNotified,
} from "./store";
import type { HabitualTrip, Incident, PredictiveAlert } from "./types";

export interface CheckResult {
  incidentsChecked: number;
  newAlerts: PredictiveAlert[];
}

/**
 * Runs one full check against live incidents. Notifies (deduped) and records
 * any new alert. No-ops unless the user has consented.
 */
export async function runPredictiveCheck(
  now: Date = new Date()
): Promise<CheckResult> {
  const consent = getConsent();
  if (!consent?.granted) return { incidentsChecked: 0, newAlerts: [] };

  const trips = getHabits().filter((t) => t.alertsEnabled);
  if (trips.length === 0) return { incidentsChecked: 0, newAlerts: [] };

  const incidents = await fetchIncidents();
  const newAlerts = await evaluate(incidents, trips, now);
  return { incidentsChecked: incidents.length, newAlerts };
}

/** Match a given incident list against trips, notifying new matches. */
export async function evaluate(
  incidents: Incident[],
  trips: HabitualTrip[],
  now: Date = new Date()
): Promise<PredictiveAlert[]> {
  const fired: PredictiveAlert[] = [];
  for (const incident of incidents) {
    const matches = matchIncidentToTrips(incident, trips, now);
    for (const match of matches) {
      const alert = buildAlert(incident, match);
      if (wasNotified(alert.id)) continue;
      await showAlertNotification(alert);
      markNotified(alert.id);
      pushAlert(alert);
      fired.push(alert);
    }
  }
  return fired;
}

/**
 * Demo/test helper: fabricates an incident located right on a trip's route and
 * runs it through the real matching + notification pipeline. Bypasses the
 * departure-window check so it can be demonstrated at any time.
 */
export async function simulateIncidentForTrip(
  trip: HabitualTrip,
  type = "inondation"
): Promise<PredictiveAlert | null> {
  const incident: Incident = {
    id: `sim-${Date.now()}`,
    type,
    title: trip.destName,
    ts: Date.now(),
    severity: "Modéré",
    lat: trip.destLat,
    lng: trip.destLng,
  };
  const match = { trip, distanceKm: 0.2 };
  const alert = buildAlert(incident, match);
  await showAlertNotification(alert);
  markNotified(alert.id);
  pushAlert(alert);
  return alert;
}
