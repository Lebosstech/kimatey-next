// Persistence for the predictive-alerts feature (localStorage, client-side).
// Consistent with the app's existing `kfn_*` keys.

import type { Consent, HabitualTrip, PredictiveAlert, TripRecord } from "./types";

const K_HABITS = "kfn_habits";
const K_CONSENT = "kfn_habit_consent";
const K_ALERTS = "kfn_predictive_alerts";
const K_NOTIFIED = "kfn_predictive_notified";
const K_HISTORY = "kfn_history"; // written by the legacy app

const NOTIFIED_TTL_MS = 6 * 60 * 60 * 1000; // 6h dedupe window
const MAX_ALERTS = 30;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — ignore */
  }
}

// ── Consent ──────────────────────────────────────────────────────────────
export function getConsent(): Consent | null {
  return read<Consent | null>(K_CONSENT, null);
}
export function setConsent(granted: boolean): Consent {
  const c: Consent = { granted, at: Date.now() };
  write(K_CONSENT, c);
  return c;
}

// ── Trip history (read-only, produced by the legacy app) ─────────────────
export function getTripHistory(): TripRecord[] {
  return read<TripRecord[]>(K_HISTORY, []);
}

// ── Habitual trips ───────────────────────────────────────────────────────
export function getHabits(): HabitualTrip[] {
  return read<HabitualTrip[]>(K_HABITS, []);
}
export function saveHabits(habits: HabitualTrip[]): void {
  write(K_HABITS, habits);
}
export function addHabit(trip: HabitualTrip): HabitualTrip[] {
  const habits = getHabits();
  habits.push(trip);
  saveHabits(habits);
  return habits;
}
export function updateHabit(
  id: string,
  patch: Partial<HabitualTrip>
): HabitualTrip[] {
  const habits = getHabits().map((h) => (h.id === id ? { ...h, ...patch } : h));
  saveHabits(habits);
  return habits;
}
export function removeHabit(id: string): HabitualTrip[] {
  const habits = getHabits().filter((h) => h.id !== id);
  saveHabits(habits);
  return habits;
}

// ── Fired alerts feed ────────────────────────────────────────────────────
export function getAlerts(): PredictiveAlert[] {
  return read<PredictiveAlert[]>(K_ALERTS, []);
}
export function pushAlert(alert: PredictiveAlert): PredictiveAlert[] {
  const alerts = [alert, ...getAlerts()].slice(0, MAX_ALERTS);
  write(K_ALERTS, alerts);
  return alerts;
}

// ── Notification dedupe ──────────────────────────────────────────────────
type NotifiedMap = Record<string, number>;
export function wasNotified(alertId: string): boolean {
  const map = read<NotifiedMap>(K_NOTIFIED, {});
  const at = map[alertId];
  return typeof at === "number" && Date.now() - at < NOTIFIED_TTL_MS;
}
export function markNotified(alertId: string): void {
  const map = read<NotifiedMap>(K_NOTIFIED, {});
  const now = Date.now();
  // prune expired entries while we're here
  for (const k of Object.keys(map)) {
    if (now - map[k] > NOTIFIED_TTL_MS) delete map[k];
  }
  map[alertId] = now;
  write(K_NOTIFIED, map);
}

// ── Right to erasure (privacy — loi n°2013-450) ──────────────────────────
export function eraseAllPredictiveData(): void {
  if (typeof window === "undefined") return;
  [K_HABITS, K_CONSENT, K_ALERTS, K_NOTIFIED].forEach((k) =>
    localStorage.removeItem(k)
  );
}
