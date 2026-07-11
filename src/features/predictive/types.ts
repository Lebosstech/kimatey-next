// Predictive trip-alert feature — shared types.
// Implements the flagship feature from the AbidjanFlow manual (section 6):
// warn the user about incidents on their habitual routes before they open the app.

/** A single trip record as stored by the legacy app in `kfn_history`. */
export interface TripRecord {
  name: string; // destination name
  lat: number; // destination latitude
  lng: number; // destination longitude
  dist?: number | string;
  dur?: number | string;
  ts: number; // departure timestamp (ms)
  date?: string;
}

/** A learned or user-defined recurring trip. */
export interface HabitualTrip {
  id: string;
  name: string; // e.g. "Trajet Travail"
  destName: string;
  destLat: number;
  destLng: number;
  originLat?: number;
  originLng?: number;
  /** Departure window in minutes from midnight (local time). */
  departStartMin: number;
  departEndMin: number;
  /** Recurring weekdays, 0 = Sunday … 6 = Saturday. */
  weekdays: number[];
  alertsEnabled: boolean;
  source: "learned" | "manual";
  createdAt: number;
  occurrences?: number; // how many history trips backed this detection
}

/** A candidate recurring trip detected from history, not yet confirmed. */
export interface TripCandidate {
  key: string;
  destName: string;
  destLat: number;
  destLng: number;
  departStartMin: number;
  departEndMin: number;
  weekdays: number[];
  occurrences: number;
}

export type IncidentType =
  | "accident"
  | "bouchon"
  | "inondation"
  | "controle"
  | "danger"
  | "autre";

/** An incident as read from Firebase `kcm_abidjan/incidents`. */
export interface Incident {
  id: string;
  type: IncidentType | string;
  title?: string;
  ts: number;
  severity?: string;
  lat?: number | null;
  lng?: number | null;
}

/** A fired predictive alert (matched incident × habitual trip). */
export interface PredictiveAlert {
  id: string; // `${incidentId}:${tripId}`
  tripId: string;
  tripName: string;
  incidentId: string;
  incidentType: string;
  title: string;
  body: string;
  distanceKm: number;
  createdAt: number;
}

export interface Consent {
  granted: boolean;
  at: number;
}
