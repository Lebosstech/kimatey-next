// Builds the user-facing alert text (manual §6.2 example wording).

import type { HabitualTrip, Incident, PredictiveAlert } from "./types";
import type { Match } from "./match";

const LABELS: Record<string, { icon: string; label: string }> = {
  accident: { icon: "⚠️", label: "Accident" },
  inondation: { icon: "🌊", label: "Inondation" },
  bouchon: { icon: "🚗", label: "Bouchon" },
  controle: { icon: "🚓", label: "Contrôle" },
  danger: { icon: "🕳️", label: "Danger" },
  autre: { icon: "📍", label: "Incident" },
};

export function incidentLabel(type: string): { icon: string; label: string } {
  return LABELS[type] ?? LABELS.autre;
}

export function buildAlert(incident: Incident, match: Match): PredictiveAlert {
  const { trip, distanceKm } = match;
  const { icon, label } = incidentLabel(String(incident.type));
  const where = incident.title ? ` (${incident.title})` : "";
  const title = `${icon} ${label} sur votre trajet ${trip.name}`;
  const body =
    `${label} signalé à ${distanceKm.toFixed(1)} km de votre itinéraire ` +
    `${trip.name}${where}. Prévoyez un itinéraire alternatif ou partez plus tôt.`;
  return {
    id: `${incident.id}:${trip.id}`,
    tripId: trip.id,
    tripName: trip.name,
    incidentId: incident.id,
    incidentType: String(incident.type),
    title,
    body,
    distanceKm,
    createdAt: Date.now(),
  };
}

/** Human-readable departure window, e.g. "06:45 – 07:15". */
export function formatWindow(trip: HabitualTrip): string {
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(
      2,
      "0"
    )}`;
  return `${fmt(trip.departStartMin)} – ${fmt(trip.departEndMin)}`;
}

const DAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
export function formatDays(weekdays: number[]): string {
  if (weekdays.length === 7) return "Tous les jours";
  const sorted = [...weekdays].sort((a, b) => a - b);
  if (
    sorted.length === 5 &&
    sorted.every((d, i) => d === i + 1)
  )
    return "Lun – Ven";
  return sorted.map((d) => DAYS[d]).join(", ");
}
