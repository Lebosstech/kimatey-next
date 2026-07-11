// Confidence scoring for mesh incidents (manual §6.4: reliability, false
// positives). An incident is trusted more when independent nodes corroborate it
// and when its emitter has a good track record. Pure and portable.

import { type MeshEnvelope } from "./protocol";

/** Emitter reputation in [0,1]; unknown emitters start neutral. */
export type ReputationTable = Record<string, number>;

const NEUTRAL = 0.5;
const CORROBORATION_WEIGHT = 0.18; // each independent confirmation adds trust
const MAX_CORROBORATION_BONUS = 0.45;
const AGE_HALF_LIFE_MS = 30 * 60 * 1000; // confidence halves every 30 min

export function reputationOf(table: ReputationTable, originId: string): number {
  const r = table[originId];
  return typeof r === "number" ? r : NEUTRAL;
}

/**
 * Confidence in [0,1] that an incident is real, combining:
 *  - emitter reputation,
 *  - number of independent corroborations (capped),
 *  - recency (older reports decay).
 */
export function confidenceScore(
  env: MeshEnvelope,
  reputation: ReputationTable = {},
  now = Date.now()
): number {
  const base = reputationOf(reputation, env.originId);
  const corr = Math.min(
    MAX_CORROBORATION_BONUS,
    env.corroborations.length * CORROBORATION_WEIGHT
  );
  const ageMs = Math.max(0, now - env.createdAt);
  const recency = Math.pow(0.5, ageMs / AGE_HALF_LIFE_MS);
  const raw = (base + corr) * recency;
  return Math.max(0, Math.min(1, raw));
}

/** Should this incident trigger a user-facing alert? */
export function isTrusted(
  env: MeshEnvelope,
  reputation: ReputationTable = {},
  threshold = 0.6,
  now = Date.now()
): boolean {
  return confidenceScore(env, reputation, now) >= threshold;
}
