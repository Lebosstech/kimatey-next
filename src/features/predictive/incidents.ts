// Reads community incidents from Firebase Realtime Database via its REST
// endpoint, so the feature needs neither the Firebase SDK nor a specific
// Firebase version loaded on the page.

import type { Incident, IncidentType } from "./types";

const RTDB_URL =
  "https://kimatey-flow-navigator-default-rtdb.firebaseio.com";
const CHANNEL = "kcm_abidjan";

function classify(type: string, title = ""): IncidentType {
  const s = `${type} ${title}`.toLowerCase();
  if (/accident|collision|choc|crash/.test(s)) return "accident";
  if (/inondation|eau|pluie/.test(s)) return "inondation";
  if (/bouchon|embouteillage|trafic|congestion|satur/.test(s)) return "bouchon";
  if (/contr[oô]le|police|barrage/.test(s)) return "controle";
  if (/danger|nid|pothole|route/.test(s)) return "danger";
  return "autre";
}

/**
 * Fetch recent incidents. Returns [] on any error (offline-friendly).
 *
 * We fetch without a server-side `orderBy`/`limitToLast` because that requires
 * an `.indexOn: "ts"` rule on the database; instead we sort and slice
 * client-side. The incidents list is bounded, so this is cheap.
 */
export async function fetchIncidents(limit = 30): Promise<Incident[]> {
  try {
    const res = await fetch(`${RTDB_URL}/${CHANNEL}/incidents.json`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    return normalize(await res.json(), limit);
  } catch {
    return [];
  }
}

function normalize(
  data: Record<string, Record<string, unknown>> | null,
  limit: number
): Incident[] {
  if (!data || typeof data !== "object") return [];
  const list: Incident[] = Object.entries(data).map(([id, v]) => {
    const type = String(v.type ?? "autre");
    const title = v.title ? String(v.title) : undefined;
    return {
      id,
      type: classify(type, title),
      title,
      ts: Number(v.ts ?? 0),
      severity: v.severity ? String(v.severity) : undefined,
      lat: typeof v.lat === "number" ? v.lat : null,
      lng: typeof v.lng === "number" ? v.lng : null,
    };
  });
  return list.sort((a, b) => b.ts - a.ts).slice(0, limit);
}
